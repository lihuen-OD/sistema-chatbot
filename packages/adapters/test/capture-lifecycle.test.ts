// Ciclo de vida, limpieza y guardas de la captura (plan de P1-T5, §5, §7.2 y §7.5): el cierre
// espera a las operaciones admitidas, también a sus pasos internos, y rechaza las nuevas; la
// limpieza no toca material activo; una colisión de id no afecta a la otra operación; las
// guardas de entorno, también cuando el entorno cambia durante una operación. Las carreras se
// fuerzan con compuertas.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat } from "node:fs/promises";
import { sep } from "node:path";
import type { CaptureTiming } from "../src/local/capture-key-lock.js";
import { LocalCaptureEmailSender } from "../src/local/capture-email-sender.js";
import { nodeFileOps, type FileOps } from "../src/local/file-ops.js";
import { WorkArea } from "../src/local/work-area.js";
import { CaptureClosedError, CaptureWriteError, type OutgoingEmail } from "../src/ports/email.js";
import {
  buildTestCapture,
  captureIdOf,
  DAY_MS,
  instanceDirectoryOf,
  manualTiming,
  sampleEmail,
} from "./capture-support.js";
import {
  createGate,
  createTestDirectory,
  decorateFileOps,
  encode,
  errorWithCode,
  installTestAppEnv,
  listNames,
  TEST_APP_ENV,
} from "./support.js";

let restoreAppEnv: () => void;
beforeEach(() => {
  restoreAppEnv = installTestAppEnv();
});
afterEach(() => {
  restoreAppEnv();
});

const KEY = "entrega-0005:confirmacion-0005";
const CAPTURE_ID = captureIdOf(KEY);
const OTHER_KEY = "entrega-0006:confirmacion-0006";

/** Cambia `APP_ENV` del proceso en medio de una operación; `afterEach` restaura el original. */
function setProcessAppEnv(value: string): void {
  process.env["APP_ENV"] = value;
}

const ENVIRONMENT_REJECTION = {
  name: "AdapterEnvironmentError",
  reason: "PROCESS_APP_ENV_MISMATCH",
} as const;

/** Pausa la publicación (`rename` de `staged/` a `captures/`) cuando está armada: el envío
 * queda con el bloqueo tomado. */
function pausingPublication(): {
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
      rename: async (source: string, destination: string) => {
        if (control.armed && source.endsWith(`${sep}staged`)) {
          control.armed = false;
          reached.open();
          await gate.promise;
        }
        await nodeFileOps.rename(source, destination);
      },
    }),
    arm: () => {
      control.armed = true;
    },
    reached: reached.promise,
    release: gate.open,
  };
}

async function turns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

describe("cierre (§7.5)", () => {
  it("close espera a un send admitido; desde que empieza, las operaciones nuevas rechazan con CaptureClosedError", async () => {
    const paused = pausingPublication();
    const context = await buildTestCapture({ timing: manualTiming(), fileOps: paused.fileOps });
    paused.arm();
    const sending = context.sender.send(KEY, sampleEmail());
    await paused.reached;
    let closeSettled = false;
    const closing = context.sender.close().finally(() => {
      closeSettled = true;
    });
    await turns(20);
    expect(closeSettled).toBe(false);
    for (const attempt of [
      () => context.sender.send("otra-clave", sampleEmail()),
      () => context.sender.readCapture(CAPTURE_ID),
      () => context.sender.purgeCaptures(),
      () => context.sender.recoverWorkArea(),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(CaptureClosedError);
    }
    paused.release();
    await expect(sending).resolves.toMatchObject({ outcome: "CAPTURED", duplicate: false });
    await expect(closing).resolves.toEqual({
      ownLeftoverEntries: 0,
      reclaimEntriesRemoved: 0,
      retainedEntries: 0,
      locksStillPending: 0,
    });
    await expect(lstat(instanceDirectoryOf(context))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([CAPTURE_ID]);
  });

  it("un send que empieza mientras close borra el directorio de la instancia no se admite ni crea nada", async () => {
    const rmEntered = createGate();
    const rmGate = createGate();
    const target = { instanceDir: "" };
    const context = await buildTestCapture({
      fileOps: decorateFileOps(nodeFileOps, {
        rm: async (path: string, options: { force?: boolean; recursive?: boolean }) => {
          if (path === target.instanceDir) {
            rmEntered.open();
            await rmGate.promise;
          }
          await nodeFileOps.rm(path, options);
        },
      }),
    });
    target.instanceDir = instanceDirectoryOf(context);
    const closing = context.sender.close();
    await rmEntered.promise;
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toBeInstanceOf(
      CaptureClosedError,
    );
    expect(await listNames(target.instanceDir)).toEqual(["instance.json"]);
    rmGate.open();
    await expect(closing).resolves.toMatchObject({ retainedEntries: 0 });
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
  });

  it("llamadas concurrentes y repetidas a close comparten intento e informe", async () => {
    const context = await buildTestCapture();
    const [first, second] = await Promise.all([context.sender.close(), context.sender.close()]);
    expect(second).toBe(first);
    expect(await context.sender.close()).toBe(first);
  });
});

describe("operaciones admitidas antes del cierre y sus pasos internos (§7.5)", () => {
  /** Dos capturas vencidas, ordenadas como las recorre la purga. */
  async function twoExpiredCaptures(
    fileOps: FileOps,
  ): Promise<{ context: Awaited<ReturnType<typeof buildTestCapture>>; ids: string[] }> {
    const timing = manualTiming();
    const context = await buildTestCapture({ timing, fileOps });
    for (const key of [KEY, OTHER_KEY]) await context.sender.send(key, sampleEmail());
    timing.advance(31 * DAY_MS);
    return { context, ids: [captureIdOf(KEY), captureIdOf(OTHER_KEY)].sort() };
  }

  it("close durante el escaneo de la purga: la purga admitida termina sus candidatos, close la espera y las operaciones nuevas rechazan", async () => {
    const reached = createGate();
    const resume = createGate();
    const control = { pauseScan: false };
    const { context } = await twoExpiredCaptures(
      decorateFileOps(nodeFileOps, {
        openObjectForRead: async (path: string) => {
          if (control.pauseScan && path.endsWith(`${sep}record.json`)) {
            control.pauseScan = false;
            reached.open();
            await resume.promise;
          }
          return nodeFileOps.openObjectForRead(path);
        },
      }),
    );
    control.pauseScan = true;
    const purging = context.sender.purgeCaptures();
    await reached.promise;
    let closeSettled = false;
    const closing = context.sender.close().finally(() => {
      closeSettled = true;
    });
    await turns(20);
    expect(closeSettled).toBe(false);
    for (const attempt of [
      () => context.sender.send("otra-clave", sampleEmail()),
      () => context.sender.readCapture(CAPTURE_ID),
      () => context.sender.purgeCaptures(),
      () => context.sender.recoverWorkArea(),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(CaptureClosedError);
    }
    resume.open();
    await expect(purging).resolves.toEqual({
      scanned: 2,
      payloadsPurged: 0,
      entriesPurged: 2,
      skippedBusy: [],
      skippedRecreated: [],
      integrityProblems: [],
      unreadable: [],
    });
    await expect(closing).resolves.toEqual({
      ownLeftoverEntries: 0,
      reclaimEntriesRemoved: 0,
      retainedEntries: 0,
      locksStillPending: 0,
    });
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    await expect(lstat(instanceDirectoryOf(context))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("close entre candidatos de la purga: el siguiente se procesa, close no borra lo que prepara y lo espera", async () => {
    const afterFirst = { reached: createGate(), resume: createGate() };
    const atSecondLock = { reached: createGate(), resume: createGate() };
    const control = { armed: false, secondId: "" };
    const { context, ids } = await twoExpiredCaptures(
      decorateFileOps(nodeFileOps, {
        // Primera barrera: el bloqueo del primer candidato ya está liberado (trasladado a
        // `.reclaim/`) y falta su borrado; el segundo candidato todavía no empezó.
        rm: async (path: string, options: { force?: boolean; recursive?: boolean }) => {
          if (control.armed && path.includes(`${sep}.reclaim${sep}`) && path.includes("-lock-")) {
            control.armed = false;
            afterFirst.reached.open();
            await afterFirst.resume.promise;
          }
          await nodeFileOps.rm(path, options);
        },
        // Segunda barrera: adquisición del bloqueo del segundo candidato, con lo preparado
        // todavía en `tmp/<instancia>/`.
        rename: async (source: string, destination: string) => {
          if (
            control.secondId !== "" &&
            destination.endsWith(`${sep}locks${sep}${control.secondId}`)
          ) {
            control.secondId = "";
            atSecondLock.reached.open();
            await atSecondLock.resume.promise;
          }
          await nodeFileOps.rename(source, destination);
        },
      }),
    );
    const [, secondId] = ids as [string, string];
    control.armed = true;
    control.secondId = secondId;
    const purging = context.sender.purgeCaptures();
    await afterFirst.reached.promise;
    let closeSettled = false;
    const closing = context.sender.close().finally(() => {
      closeSettled = true;
    });
    await turns(20);
    expect(closeSettled).toBe(false);
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([secondId]);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    afterFirst.resume.open();
    // Si el segundo candidato no pudiera admitirse, la purga rechazaría antes de la barrera.
    await Promise.race([atSecondLock.reached.promise, purging]);
    await turns(20);
    expect(closeSettled).toBe(false);
    expect(
      (await listNames(instanceDirectoryOf(context))).filter((name) => name.startsWith("lock-")),
    ).toHaveLength(1);
    atSecondLock.resume.open();
    await expect(purging).resolves.toMatchObject({ entriesPurged: 2, skippedBusy: [] });
    await expect(closing).resolves.toMatchObject({ retainedEntries: 0, locksStillPending: 0 });
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    await expect(lstat(instanceDirectoryOf(context))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("close mientras readCapture pasa al camino con bloqueo: la lectura admitida termina y close la espera", async () => {
    const reached = createGate();
    const resume = createGate();
    const control = { failOnce: false };
    const context = await buildTestCapture({
      fileOps: decorateFileOps(nodeFileOps, {
        openObjectForRead: async (path: string) => {
          if (control.failOnce && path.endsWith(`${CAPTURE_ID}${sep}record.json`)) {
            // La lectura sin bloqueo encuentra un error del sistema: decide bajo el bloqueo.
            control.failOnce = false;
            reached.open();
            await resume.promise;
            throw errorWithCode("EIO");
          }
          return nodeFileOps.openObjectForRead(path);
        },
      }),
    });
    await context.sender.send(KEY, sampleEmail());
    control.failOnce = true;
    const reading = context.sender.readCapture(CAPTURE_ID);
    await reached.promise;
    let closeSettled = false;
    const closing = context.sender.close().finally(() => {
      closeSettled = true;
    });
    await turns(20);
    expect(closeSettled).toBe(false);
    resume.open();
    await expect(reading).resolves.toMatchObject({
      captureId: CAPTURE_ID,
      payloadAvailable: true,
    });
    await expect(closing).resolves.toMatchObject({ retainedEntries: 0, locksStillPending: 0 });
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    await expect(lstat(instanceDirectoryOf(context))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("un paso interno exige una admisión vigente: durante CLOSING no entra nada nuevo y una admisión liberada no registra pasos", async () => {
    const context = await buildTestCapture();
    const workArea = new WorkArea({
      rootPath: context.rootPath,
      instanceId: "c".repeat(32),
      fileOps: nodeFileOps,
      closedError: () => new CaptureClosedError(),
    });
    await workArea.initialize();
    const admission = workArea.admitUntracked();
    const closing = workArea.closeWith(() => Promise.resolve({}));
    expect(workArea.state).toBe("CLOSING");
    expect(() => workArea.admitUntracked()).toThrow(CaptureClosedError);
    expect(() => {
      workArea.admitOperation("1".repeat(32));
    }).toThrow(CaptureClosedError);
    // La operación ya admitida registra su paso interno aunque el cierre haya empezado.
    admission.admitInternal("2".repeat(32));
    expect(workArea.activeOperationCount).toBe(1);
    workArea.finishOperation("2".repeat(32));
    admission.release();
    expect(() => {
      admission.admitInternal("3".repeat(32));
    }).toThrow();
    expect(workArea.activeOperationCount).toBe(0);
    await expect(closing).resolves.toMatchObject({ retainedEntries: 0 });
    expect(workArea.state).toBe("CLOSED");
  });
});

describe("limpieza sin tocar material activo (§7.2)", () => {
  it("un send que espera un bloqueo ocupado conserva lo preparado ante la limpieza propia y el cierre lo espera", async () => {
    const directory = await createTestDirectory();
    const holderPause = pausingPublication();
    const holder = await buildTestCapture(
      { timing: manualTiming(), fileOps: holderPause.fileOps },
      directory,
    );
    holderPause.arm();
    const holding = holder.sender.send(KEY, sampleEmail());
    await holderPause.reached;

    const waitingReached = createGate();
    const waitingGate = createGate();
    const base = manualTiming();
    const waitingTiming: CaptureTiming = {
      now: () => base.now(),
      sleep: async (ms) => {
        waitingReached.open();
        await waitingGate.promise;
        await base.sleep(ms);
      },
    };
    const waiter = await buildTestCapture({ timing: waitingTiming }, directory);
    const waiting = waiter.sender.send(KEY, sampleEmail());
    await waitingReached.promise;
    const prepared = (await listNames(instanceDirectoryOf(waiter))).filter((name) =>
      name.startsWith("lock-"),
    );
    expect(prepared).toHaveLength(1);
    await expect(waiter.sender.recoverWorkArea()).resolves.toMatchObject({ ownLeftoverEntries: 0 });
    await expect(holder.sender.recoverWorkArea()).resolves.toMatchObject({ ownLeftoverEntries: 0 });
    expect(
      (await listNames(instanceDirectoryOf(waiter))).filter((name) => name.startsWith("lock-")),
    ).toEqual(prepared);

    let closeSettled = false;
    const closing = waiter.sender.close().finally(() => {
      closeSettled = true;
    });
    await turns(20);
    expect(closeSettled).toBe(false);
    holderPause.release();
    await expect(holding).resolves.toMatchObject({ duplicate: false });
    waitingGate.open();
    await expect(waiting).resolves.toMatchObject({ outcome: "CAPTURED", duplicate: true });
    await expect(closing).resolves.toMatchObject({ retainedEntries: 0, locksStillPending: 0 });
  });

  it("una colisión de id con un send activo: el segundo falla sin tocar el material ni el registro del primero", async () => {
    const OP = "0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e";
    const paused = pausingPublication();
    const context = await buildTestCapture({
      timing: manualTiming(),
      fileOps: paused.fileOps,
      randomHex128: () => OP,
    });
    paused.arm();
    const first = context.sender.send(KEY, sampleEmail());
    await paused.reached;
    const failure = await context.sender
      .send("otra-clave", sampleEmail())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CaptureWriteError);
    expect(failure).toMatchObject({ phase: "BEFORE_PUBLISH" });
    expect((failure as Error).cause).toMatchObject({ name: "OperationIdInUseError" });
    expect(await listNames(`${context.rootPath}${sep}locks${sep}${CAPTURE_ID}`)).toEqual([
      "owner.json",
      "staged",
    ]);
    paused.release();
    await expect(first).resolves.toMatchObject({ outcome: "CAPTURED", duplicate: false });
    await expect(context.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      payloadAvailable: true,
    });
  });
});

describe("guardas de entorno (§5)", () => {
  it("APP_ENV cambiado a production después de construir: todas las operaciones rechazan", async () => {
    const context = await buildTestCapture();
    await context.sender.send(KEY, sampleEmail());
    const previous = process.env["APP_ENV"];
    process.env["APP_ENV"] = "production";
    try {
      for (const attempt of [
        () => context.sender.send("otra", sampleEmail()),
        () => context.sender.readCapture(CAPTURE_ID),
        () => context.sender.purgeCaptures(),
        () => context.sender.recoverWorkArea(),
        () => context.sender.close(),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          name: "AdapterEnvironmentError",
          reason: "PROCESS_APP_ENV_MISMATCH",
        });
      }
    } finally {
      if (previous === undefined) delete process.env["APP_ENV"];
      else process.env["APP_ENV"] = previous;
    }
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([CAPTURE_ID]);
  });

  it.each(["production", "staging", "desconocido"])(
    "construir con %s se rechaza",
    async (appEnv) => {
      const directory = await createTestDirectory();
      await expect(
        LocalCaptureEmailSender.build({ appEnv, rootPath: `${directory}${sep}capturas` }),
      ).rejects.toMatchObject({ name: "AdapterEnvironmentError" });
      expect(await listNames(directory)).toEqual([]);
    },
  );

  it("la fuente del adjunto cambia APP_ENV a production durante la copia: rechaza sin tomar el bloqueo ni publicar y retira lo preparado", async () => {
    const lockAttempts: string[] = [];
    const context = await buildTestCapture({
      timing: manualTiming(),
      fileOps: decorateFileOps(nodeFileOps, {
        rename: async (source: string, destination: string) => {
          if (destination.includes(`${sep}locks${sep}`)) lockAttempts.push(destination);
          await nodeFileOps.rename(source, destination);
        },
      }),
    });
    const switchingSource: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: async function* (): AsyncIterableIterator<Uint8Array> {
        await Promise.resolve();
        yield encode("%PDF-1.7 primera parte ficticia");
        setProcessAppEnv("production");
        yield encode(" y segunda parte");
      },
    };
    const message: OutgoingEmail = {
      ...sampleEmail({ withAttachment: false }),
      attachment: {
        fileName: "constancia-ficticia.pdf",
        mimeType: "application/pdf",
        content: switchingSource,
      },
    };
    await expect(context.sender.send(KEY, message)).rejects.toMatchObject(ENVIRONMENT_REJECTION);
    expect(lockAttempts).toEqual([]);
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    expect(await listNames(instanceDirectoryOf(context))).toEqual(["instance.json"]);
    setProcessAppEnv(TEST_APP_ENV);
    await expect(context.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      outcome: "CAPTURED",
      duplicate: false,
    });
  });

  it("APP_ENV cambia durante la espera por un bloqueo ocupado: el send que espera rechaza sin adquirir y retira lo preparado; el titular no se ve afectado", async () => {
    const directory = await createTestDirectory();
    const holderPause = pausingPublication();
    const holder = await buildTestCapture(
      { timing: manualTiming(), fileOps: holderPause.fileOps },
      directory,
    );
    holderPause.arm();
    const holding = holder.sender.send(KEY, sampleEmail());
    await holderPause.reached;
    const sleeping = createGate();
    const wake = createGate();
    const base = manualTiming();
    const waiter = await buildTestCapture(
      {
        timing: {
          now: () => base.now(),
          sleep: async (ms) => {
            sleeping.open();
            await wake.promise;
            await base.sleep(ms);
          },
        },
      },
      directory,
    );
    const waiting = waiter.sender.send(KEY, sampleEmail());
    await sleeping.promise;
    setProcessAppEnv("production");
    wake.open();
    await expect(waiting).rejects.toMatchObject(ENVIRONMENT_REJECTION);
    expect(await listNames(instanceDirectoryOf(waiter))).toEqual(["instance.json"]);
    // El bloqueo sigue siendo el del titular, con su captura preparada.
    expect(await listNames(`${holder.rootPath}${sep}locks${sep}${CAPTURE_ID}`)).toEqual([
      "owner.json",
      "staged",
    ]);
    setProcessAppEnv(TEST_APP_ENV);
    holderPause.release();
    await expect(holding).resolves.toMatchObject({ outcome: "CAPTURED", duplicate: false });
    await expect(waiter.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      duplicate: true,
    });
  });

  it("APP_ENV cambia con el bloqueo ya tomado y antes de publicar: rechaza sin publicar y libera el bloqueo con lo preparado", async () => {
    const control = { switchOnEntryCheck: false };
    const context = await buildTestCapture({
      timing: manualTiming(),
      fileOps: decorateFileOps(nodeFileOps, {
        lstat: async (path: string) => {
          // La comprobación de la entrada bajo el bloqueo (§9.5, paso 4) es la última espera
          // antes del `rename` de publicación.
          if (control.switchOnEntryCheck && path.endsWith(`${sep}captures${sep}${CAPTURE_ID}`)) {
            control.switchOnEntryCheck = false;
            setProcessAppEnv("production");
          }
          return nodeFileOps.lstat(path);
        },
      }),
    });
    control.switchOnEntryCheck = true;
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject(
      ENVIRONMENT_REJECTION,
    );
    expect(control.switchOnEntryCheck).toBe(false);
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    expect(await listNames(`${context.rootPath}${sep}.reclaim`)).toEqual([]);
    expect(await listNames(instanceDirectoryOf(context))).toEqual(["instance.json"]);
    setProcessAppEnv(TEST_APP_ENV);
    await expect(context.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      outcome: "CAPTURED",
      duplicate: false,
    });
  });

  it("APP_ENV cambia con la publicación ya en curso: no se informa BEFORE_PUBLISH; CAPTURED y el bloqueo propio se libera", async () => {
    const paused = pausingPublication();
    const context = await buildTestCapture({ timing: manualTiming(), fileOps: paused.fileOps });
    paused.arm();
    const sending = context.sender.send(KEY, sampleEmail());
    await paused.reached;
    setProcessAppEnv("production");
    paused.release();
    await expect(sending).resolves.toEqual({
      outcome: "CAPTURED",
      captureId: CAPTURE_ID,
      duplicate: false,
      payloadAvailable: true,
      delivered: false,
    });
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([CAPTURE_ID]);
    setProcessAppEnv(TEST_APP_ENV);
    await expect(context.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      payloadAvailable: true,
    });
  });

  it("APP_ENV cambia durante una lectura: readCapture no entrega el contenido y no deja bloqueos", async () => {
    const control = { switchOnAttachment: false };
    const context = await buildTestCapture({
      fileOps: decorateFileOps(nodeFileOps, {
        openObjectForRead: async (path: string) => {
          if (control.switchOnAttachment && path.endsWith(`${sep}attachment.bin`)) {
            control.switchOnAttachment = false;
            setProcessAppEnv("production");
          }
          return nodeFileOps.openObjectForRead(path);
        },
      }),
    });
    await context.sender.send(KEY, sampleEmail());
    control.switchOnAttachment = true;
    await expect(context.sender.readCapture(CAPTURE_ID)).rejects.toMatchObject(
      ENVIRONMENT_REJECTION,
    );
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    setProcessAppEnv(TEST_APP_ENV);
    await expect(context.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      payloadAvailable: true,
    });
  });

  it("APP_ENV cambia con el bloqueo de la purga tomado: no traslada nada y libera el bloqueo", async () => {
    const timing = manualTiming();
    const control = { recordReads: 0, armed: false };
    const context = await buildTestCapture({
      timing,
      fileOps: decorateFileOps(nodeFileOps, {
        openObjectForRead: async (path: string) => {
          // Primera lectura del registro: el escaneo; segunda: la relectura bajo el bloqueo.
          if (control.armed && path.endsWith(`${CAPTURE_ID}${sep}record.json`)) {
            control.recordReads += 1;
            if (control.recordReads === 2) setProcessAppEnv("production");
          }
          return nodeFileOps.openObjectForRead(path);
        },
      }),
    });
    await context.sender.send(KEY, sampleEmail());
    timing.advance(31 * DAY_MS);
    control.armed = true;
    await expect(context.sender.purgeCaptures()).rejects.toMatchObject(ENVIRONMENT_REJECTION);
    expect(control.recordReads).toBe(2);
    expect(await listNames(`${context.rootPath}${sep}captures${sep}${CAPTURE_ID}`)).toEqual([
      "payload",
      "record.json",
    ]);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    expect(await listNames(instanceDirectoryOf(context))).toEqual(["instance.json"]);
  });

  it("APP_ENV cambia entre candidatos de la purga: se detiene sin tocar el siguiente y libera su bloqueo y lo preparado", async () => {
    const timing = manualTiming();
    const control = { switchAfterFirstPurge: false };
    const context = await buildTestCapture({
      timing,
      fileOps: decorateFileOps(nodeFileOps, {
        fsyncDir: async (path: string) => {
          await nodeFileOps.fsyncDir(path);
          if (control.switchAfterFirstPurge && path.endsWith(`${sep}captures`)) {
            control.switchAfterFirstPurge = false;
            setProcessAppEnv("production");
          }
        },
      }),
    });
    for (const key of [KEY, OTHER_KEY]) await context.sender.send(key, sampleEmail());
    timing.advance(31 * DAY_MS);
    control.switchAfterFirstPurge = true;
    await expect(context.sender.purgeCaptures()).rejects.toMatchObject(ENVIRONMENT_REJECTION);
    expect(await listNames(`${context.rootPath}${sep}captures`)).toHaveLength(1);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    expect(await listNames(instanceDirectoryOf(context))).toEqual(["instance.json"]);
    setProcessAppEnv(TEST_APP_ENV);
    await expect(context.sender.purgeCaptures()).resolves.toMatchObject({ entriesPurged: 1 });
  });

  it("construir con un APP_ENV de proceso distinto del recibido se rechaza", async () => {
    const directory = await createTestDirectory();
    await expect(
      LocalCaptureEmailSender.build({
        appEnv: "development",
        rootPath: `${directory}${sep}capturas`,
      }),
    ).rejects.toMatchObject({ reason: "PROCESS_APP_ENV_MISMATCH" });
    expect(TEST_APP_ENV).toBe("test");
  });
});
