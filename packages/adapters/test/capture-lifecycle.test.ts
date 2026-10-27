// Ciclo de vida, limpieza y guardas de la captura (plan de P1-T5, §5, §7.2 y §7.5): el cierre
// espera a las operaciones admitidas y rechaza las nuevas; la limpieza no toca material
// activo; una colisión de id no afecta a la otra operación; las guardas de entorno. Las
// carreras se fuerzan con compuertas.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat } from "node:fs/promises";
import { sep } from "node:path";
import type { CaptureTiming } from "../src/local/capture-key-lock.js";
import { LocalCaptureEmailSender } from "../src/local/capture-email-sender.js";
import { nodeFileOps, type FileOps } from "../src/local/file-ops.js";
import { CaptureClosedError, CaptureWriteError } from "../src/ports/email.js";
import {
  buildTestCapture,
  captureIdOf,
  instanceDirectoryOf,
  manualTiming,
  sampleEmail,
} from "./capture-support.js";
import {
  createGate,
  createTestDirectory,
  decorateFileOps,
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
