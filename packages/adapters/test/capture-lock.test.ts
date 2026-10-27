// Bloqueo por clave de las capturas entre instancias y procesos (plan de P1-T5, §9.4 y §13):
// adquisiciones simultáneas, titular pausado más de 120 s con reloj manual, liberación
// normal dentro de la espera, proceso caído sin ruptura automática, envíos simultáneos con
// la misma clave y una prueba focalizada entre procesos separados. Las carreras se fuerzan
// con compuertas, sin pausas arbitrarias.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CaptureKeyLocks, type CaptureTiming } from "../src/local/capture-key-lock.js";
import { nodeFileOps, type FileOps } from "../src/local/file-ops.js";
import { WorkArea } from "../src/local/work-area.js";
import { CaptureKeyBusyError, type EmailSendResult } from "../src/ports/email.js";
import {
  buildTestCapture,
  captureIdOf,
  DAY_MS,
  manualTiming,
  readJsonFile,
  sampleEmail,
} from "./capture-support.js";
import {
  createGate,
  createTestDirectory,
  decorateFileOps,
  installTestAppEnv,
  listNames,
  withTimeout,
} from "./support.js";

let restoreAppEnv: () => void;
beforeEach(() => {
  restoreAppEnv = installTestAppEnv();
});
afterEach(() => {
  restoreAppEnv();
});

const KEY = "entrega-0003:confirmacion-0003";
const CAPTURE_ID = captureIdOf(KEY);

/** Pausa la lectura de `record.json` de la captura (verificación bajo el bloqueo) cuando
 * `armed` está activo: el titular queda con el bloqueo tomado hasta abrir `release`. */
function pausingRecordReads(): {
  fileOps: FileOps;
  arm: () => void;
  reached: Promise<void>;
  release: () => void;
} {
  const reached = createGate();
  const gate = createGate();
  const control = { armed: false };
  return {
    fileOps: decorateFileOps(nodeFileOps, {
      openObjectForRead: async (path: string) => {
        if (control.armed && path.endsWith(`${CAPTURE_ID}${sep}record.json`)) {
          control.armed = false;
          reached.open();
          await gate.promise;
        }
        return nodeFileOps.openObjectForRead(path);
      },
    }),
    arm: () => {
      control.armed = true;
    },
    reached: reached.promise,
    release: gate.open,
  };
}

describe("adquisición atómica (§9.4)", () => {
  it("dos adquisiciones simultáneas de la misma clave, en 50 rondas: una obtiene el bloqueo y la otra lo ve ocupado", async () => {
    const context = await buildTestCapture();
    const timing = manualTiming();
    const makeLocks = async (instanceId: string): Promise<CaptureKeyLocks> => {
      const workArea = new WorkArea({
        rootPath: context.rootPath,
        instanceId,
        fileOps: nodeFileOps,
        timing,
      });
      await workArea.initialize();
      return new CaptureKeyLocks({
        fileOps: nodeFileOps,
        rootPath: context.rootPath,
        workArea,
        processUid: process.getuid?.() ?? 0,
        timing,
      });
    };
    const [locksA, locksB] = await Promise.all([
      makeLocks("a".repeat(32)),
      makeLocks("b".repeat(32)),
    ]);
    const tally: Record<string, number> = {};
    for (let round = 0; round < 50; round += 1) {
      const op = String(round).padStart(32, "0");
      const [preparedA, preparedB] = await Promise.all([
        locksA.prepare(op, "READ", () => Promise.resolve(undefined)),
        locksB.prepare(op, "READ", () => Promise.resolve(undefined)),
      ]);
      const [heldA, heldB] = await Promise.all([
        locksA.tryAcquire(preparedA.prepared, CAPTURE_ID),
        locksB.tryAcquire(preparedB.prepared, CAPTURE_ID),
      ]);
      const pair = [heldA === null ? "OCUPADA" : "TOMADA", heldB === null ? "OCUPADA" : "TOMADA"]
        .sort()
        .join("+");
      tally[pair] = (tally[pair] ?? 0) + 1;
      const [winner, loserLocks, loserPrepared] =
        heldA !== null ? [heldA, locksB, preparedB.prepared] : [heldB, locksA, preparedA.prepared];
      if (winner === null) throw new Error("ninguna adquisición tuvo éxito");
      // El bloqueo tiene el owner.json del ganador; lo preparado por el otro sigue intacto.
      const owner = await readJsonFile(`${winner.path}${sep}owner.json`);
      expect(owner["token"]).toBe(winner.token);
      expect(await listNames(loserPrepared.path)).toEqual(["owner.json"]);
      await loserLocks.removePrepared(loserPrepared.path);
      await (heldA !== null ? locksA : locksB).release(winner);
    }
    expect(tally).toEqual({ "OCUPADA+TOMADA": 50 });
  });
});

describe("titular pausado y ausencia de ruptura automática (A4)", () => {
  it("un titular pausado más de 120 s conserva el bloqueo: KEY_BUSY a los 5 s, la purga lo omite, nada lo rompe y al reanudarse termina", async () => {
    const directory = await createTestDirectory();
    const timing = manualTiming();
    const paused = pausingRecordReads();
    const holder = await buildTestCapture({ timing, fileOps: paused.fileOps }, directory);
    const other = await buildTestCapture({ timing }, directory);
    await holder.sender.send(KEY, sampleEmail());
    timing.advance(8 * DAY_MS); // el contenido ya venció
    paused.arm();
    const holding = holder.sender.send(KEY, sampleEmail());
    await paused.reached;
    const lockOwner = await readJsonFile(
      `${holder.rootPath}${sep}locks${sep}${CAPTURE_ID}${sep}owner.json`,
    );

    timing.advance(121_000);
    const busyStartedAt = timing.current();
    await expect(other.sender.send(KEY, sampleEmail())).rejects.toBeInstanceOf(CaptureKeyBusyError);
    expect(timing.current() - busyStartedAt).toBeGreaterThanOrEqual(5000);
    await expect(other.sender.purgeCaptures()).resolves.toMatchObject({
      skippedBusy: [CAPTURE_ID],
      payloadsPurged: 0,
    });
    // Ni la limpieza de otra instancia, ni una instancia nueva, ni días de reloj lo rompen.
    timing.advance(30 * DAY_MS);
    await other.sender.recoverWorkArea();
    const third = await buildTestCapture({ timing }, directory);
    await third.sender.recoverWorkArea();
    expect(
      await readJsonFile(`${holder.rootPath}${sep}locks${sep}${CAPTURE_ID}${sep}owner.json`),
    ).toEqual(lockOwner);

    paused.release();
    await expect(holding).resolves.toMatchObject({
      outcome: "CAPTURED",
      duplicate: true,
      payloadAvailable: true,
    });
    expect(await listNames(`${holder.rootPath}${sep}locks`)).toEqual([]);
    // Liberado: la purga procesa la clave (el registro ya venció con el reloj avanzado).
    await expect(other.sender.purgeCaptures()).resolves.toMatchObject({ entriesPurged: 1 });
  });

  it("liberación normal dentro de la espera: el send que esperaba adquiere y verifica sin KEY_BUSY", async () => {
    const directory = await createTestDirectory();
    const paused = pausingRecordReads();
    const holder = await buildTestCapture(
      { timing: manualTiming(), fileOps: paused.fileOps },
      directory,
    );
    await holder.sender.send(KEY, sampleEmail());
    paused.arm();
    const holding = holder.sender.send(KEY, sampleEmail());
    await paused.reached;
    // El primer reintento de la espera libera al titular y espera a que termine.
    const base = manualTiming();
    const waitingTiming: CaptureTiming = {
      now: () => base.now(),
      sleep: async (ms) => {
        paused.release();
        await holding;
        await base.sleep(ms);
      },
    };
    const waiting = await buildTestCapture({ timing: waitingTiming }, directory);
    await expect(waiting.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      outcome: "CAPTURED",
      duplicate: true,
    });
    await expect(holding).resolves.toMatchObject({ duplicate: true });
  });

  it("proceso caído con el bloqueo tomado: el bloqueo persiste con otras instancias y su limpieza; KEY_BUSY y la purga lo omite", async () => {
    const directory = await createTestDirectory();
    const timing = manualTiming();
    const paused = pausingRecordReads();
    const crashed = await buildTestCapture({ timing, fileOps: paused.fileOps }, directory);
    await crashed.sender.send(KEY, sampleEmail());
    timing.advance(8 * DAY_MS);
    paused.arm();
    // La instancia "cae": su operación queda sin terminar y nunca se la libera ni se la cierra.
    void crashed.sender.send(KEY, sampleEmail()).catch(() => undefined);
    await paused.reached;
    const other = await buildTestCapture({ timing }, directory);
    await other.sender.recoverWorkArea();
    const later = await buildTestCapture({ timing }, directory);
    await later.sender.recoverWorkArea();
    timing.advance(365 * DAY_MS);
    await expect(later.sender.send(KEY, sampleEmail())).rejects.toBeInstanceOf(CaptureKeyBusyError);
    await expect(later.sender.purgeCaptures()).resolves.toMatchObject({
      skippedBusy: [CAPTURE_ID],
    });
    await expect(later.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      payloadAvailable: true,
    });
    expect(await listNames(`${directory}${sep}capturas${sep}locks`)).toEqual([CAPTURE_ID]);
    // Recuperarlo es del mantenimiento con los consumidores detenidos (§7.3), bloque posterior.
  });
});

describe("envíos simultáneos con la misma clave (§9.6)", () => {
  it("diez envíos simultáneos en una instancia: una sola captura; uno la publica y los demás la verifican o reciben KEY_BUSY", async () => {
    const context = await buildTestCapture();
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        context.sender.send(KEY, sampleEmail()).catch((error: unknown) => error),
      ),
    );
    const results = outcomes.filter((value): value is EmailSendResult => !(value instanceof Error));
    expect(
      outcomes
        .filter((value) => value instanceof Error)
        .every((error) => error instanceof CaptureKeyBusyError),
    ).toBe(true);
    expect(
      results.filter((result) => result.outcome === "CAPTURED" && !result.duplicate),
    ).toHaveLength(1);
    expect(results.every((result) => result.outcome === "CAPTURED")).toBe(true);
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([CAPTURE_ID]);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
  });

  it("dos instancias, cinco envíos cada una a la vez: una sola captura y el bloqueo libre al final", async () => {
    const directory = await createTestDirectory();
    const first = await buildTestCapture({}, directory);
    const second = await buildTestCapture({}, directory);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 === 0 ? first : second).sender
          .send(KEY, sampleEmail())
          .catch((error: unknown) => error),
      ),
    );
    const published = outcomes.filter(
      (value): value is EmailSendResult =>
        !(value instanceof Error) &&
        (value as EmailSendResult).outcome === "CAPTURED" &&
        !(value as { duplicate?: boolean }).duplicate,
    );
    expect(published).toHaveLength(1);
    expect(
      outcomes
        .filter((value) => value instanceof Error)
        .every((error) => error instanceof CaptureKeyBusyError),
    ).toBe(true);
    expect(await listNames(`${first.rootPath}${sep}captures`)).toEqual([CAPTURE_ID]);
    expect(await listNames(`${first.rootPath}${sep}locks`)).toEqual([]);
  });
});

describe("entre procesos separados (§9.4)", () => {
  /** El hijo es otro proceso de Node que corre las mismas fuentes (soporte de tipos de Node,
   * sin compilar). Toma el bloqueo y espera; el padre, con su propia instancia sobre la misma
   * raíz, recibe KEY_BUSY; al continuar el hijo publica y el padre reconoce su captura. */
  it("el bloqueo de un proceso hijo excluye al padre; al liberarlo, el padre verifica la captura del hijo", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const message = {
      to: ["proceso.ficticio@example.com"],
      subject: "Entre procesos",
      textBody: "Prueba entre procesos.",
    };
    const parent = await buildTestCapture({ timing: manualTiming() });
    const child = spawn(
      process.execPath,
      [
        "--conditions=@sistema-chatbot/source",
        "--import",
        join(here, "fixtures", "register-ts-source.mjs"),
        join(here, "fixtures", "capture-lock-holder.ts"),
        parent.rootPath,
        KEY,
        JSON.stringify(message),
      ],
      { env: { ...process.env, APP_ENV: "test" }, stdio: ["pipe", "pipe", "pipe"] },
    );
    const output = lineCollector(child.stdout);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const exited = new Promise<number | null>((resolve) => {
      child.once("exit", resolve);
    });
    try {
      await withTimeout(
        output.waitFor("HOLDING"),
        30_000,
        `el hijo no tomó el bloqueo (${stderr})`,
      );
      const owner = await readJsonFile(
        `${parent.rootPath}${sep}locks${sep}${CAPTURE_ID}${sep}owner.json`,
      );
      expect(owner["pid"]).toBe(child.pid);
      expect(owner["pid"]).not.toBe(process.pid);
      await expect(parent.sender.send(KEY, message)).rejects.toBeInstanceOf(CaptureKeyBusyError);
      child.stdin.write("CONTINUE\n");
      const resultLine = await withTimeout(output.waitFor("RESULT "), 30_000, "el hijo no terminó");
      expect(JSON.parse(resultLine.slice("RESULT ".length))).toMatchObject({
        outcome: "CAPTURED",
        captureId: CAPTURE_ID,
        duplicate: false,
      });
      expect(await withTimeout(exited, 30_000, "el hijo no salió")).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill();
    }
    await expect(parent.sender.send(KEY, message)).resolves.toMatchObject({
      outcome: "CAPTURED",
      duplicate: true,
    });
    expect(await listNames(`${parent.rootPath}${sep}captures`)).toEqual([CAPTURE_ID]);
    expect(await listNames(`${parent.rootPath}${sep}locks`)).toEqual([]);
    const record = await readFile(
      `${parent.rootPath}${sep}captures${sep}${CAPTURE_ID}${sep}record.json`,
      "utf8",
    );
    expect(record).not.toContain("proceso.ficticio");
  }, 60_000);
});

/** Acumula las líneas de un flujo y permite esperar la primera que empieza con un prefijo. */
function lineCollector(stream: NodeJS.ReadableStream): {
  waitFor: (prefix: string) => Promise<string>;
} {
  const lines: string[] = [];
  const waiters: { prefix: string; resolve: (line: string) => void }[] = [];
  let pending = "";
  stream.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      lines.push(line);
      for (const waiter of [...waiters]) {
        if (line.startsWith(waiter.prefix)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(line);
        }
      }
      newline = pending.indexOf("\n");
    }
  });
  return {
    waitFor: (prefix) => {
      const found = lines.find((line) => line.startsWith(prefix));
      if (found !== undefined) return Promise.resolve(found);
      return new Promise<string>((resolve) => {
        waiters.push({ prefix, resolve });
      });
    },
  };
}
