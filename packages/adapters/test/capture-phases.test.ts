// Captura de correo: resultados por fase de la publicación y del bloqueo (plan de P1-T5,
// §9.4 y §9.5; una prueba por fila de la tabla de §9.5). Archivos reales; cada fallo se
// inyecta con FileOps en la llamada al sistema que corresponde.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import { nodeFileOps, type FileOps } from "../src/local/file-ops.js";
import type { CaptureMaintenanceEvent } from "../src/local/capture-email-sender.js";
import {
  CaptureIntegrityError,
  CaptureKeyBusyError,
  CaptureWriteError,
} from "../src/ports/email.js";
import {
  buildTestCapture,
  captureIdOf,
  instanceDirectoryOf,
  manualTiming,
  sampleEmail,
  type TestCaptureContext,
} from "./capture-support.js";
import {
  createTestDirectory,
  decorateFileOps,
  encode,
  installTestAppEnv,
  listNames,
} from "./support.js";

let restoreAppEnv: () => void;
beforeEach(() => {
  restoreAppEnv = installTestAppEnv();
});
afterEach(() => {
  restoreAppEnv();
});

const KEY = "entrega-0002:confirmacion-0002";
const CAPTURE_ID = captureIdOf(KEY);

function errorWithCode(code: string): Error {
  return Object.assign(new Error(`inyección: ${code}`), { code });
}

/** El `rename` de publicación: `locks/<id>/staged` → `captures/<id>`. */
function isPublish(source: string, destination: string): boolean {
  return source.endsWith(`${sep}staged`) && destination.includes(`${sep}captures${sep}`);
}

/** El `rename` de adquisición: `tmp/<instancia>/lock-<op>` → `locks/<id>`. */
function isAcquire(source: string, destination: string): boolean {
  return source.includes(`${sep}lock-`) && destination.endsWith(`${sep}locks${sep}${CAPTURE_ID}`);
}

async function capture(fileOps: Partial<FileOps>, directory?: string): Promise<TestCaptureContext> {
  return buildTestCapture(
    { fileOps: decorateFileOps(nodeFileOps, fileOps), timing: manualTiming() },
    directory,
  );
}

async function expectNoCapture(context: TestCaptureContext): Promise<void> {
  expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
}

describe("orden de durabilidad (§9.5, pasos 2 a 6)", () => {
  it("cada archivo y directorio preparado tiene fsync antes de adquirir; captures/ antes de liberar", async () => {
    const events: string[] = [];
    const name = (path: string): string =>
      path.slice(path.lastIndexOf(sep) + 1).replace(/^lock-.*/, "lock-<op>");
    const context = await capture({
      openTempForWrite: async (path: string) => {
        const inner = await nodeFileOps.openTempForWrite(path);
        return {
          write: (buffer: Uint8Array) => inner.write(buffer),
          readInto: (buffer: Uint8Array, position: number) => inner.readInto(buffer, position),
          fstat: () => inner.fstat(),
          fchmod: (mode: number) => inner.fchmod(mode),
          fsync: async () => {
            await inner.fsync();
            events.push(`fsync ${name(path)}`);
          },
          close: () => inner.close(),
        };
      },
      fsyncDir: async (path: string) => {
        await nodeFileOps.fsyncDir(path);
        events.push(`fsyncDir ${name(path)}`);
      },
      rename: async (source: string, destination: string) => {
        await nodeFileOps.rename(source, destination);
        if (isAcquire(source, destination)) events.push("adquisición");
        else if (isPublish(source, destination)) events.push("publicación");
        else if (destination.includes(`${sep}.reclaim${sep}`)) events.push("liberación");
      },
    });
    events.length = 0;
    await context.sender.send(KEY, sampleEmail());
    expect(events).toEqual([
      "fsync owner.json",
      "fsync attachment.bin",
      "fsync message.json",
      "fsync record.json",
      "fsyncDir payload",
      "fsyncDir staged",
      "fsyncDir lock-<op>",
      "adquisición",
      "publicación",
      "fsyncDir captures",
      "liberación",
    ]);
  });
});

describe("adquisición del bloqueo (§9.4 y §9.5, fila 3)", () => {
  it("la adquisición traslada lo preparado bajo el bloqueo en el mismo `rename`: ya no está en tmp/", async () => {
    const observed: string[][] = [];
    const context = await capture({
      rename: async (source: string, destination: string) => {
        await nodeFileOps.rename(source, destination);
        if (isAcquire(source, destination)) {
          observed.push(
            await listNames(destination),
            await listNames(`${destination}${sep}staged`),
            await listNames(source.slice(0, source.lastIndexOf(sep))),
          );
        }
      },
    });
    await context.sender.send(KEY, sampleEmail());
    expect(observed).toEqual([
      ["owner.json", "staged"],
      ["payload", "record.json"],
      ["instance.json"],
    ]);
  });

  it("con otro error pero el bloqueo creado (mismo inodo): sigue y publica", async () => {
    const context = await capture({
      rename: async (source: string, destination: string) => {
        await nodeFileOps.rename(source, destination);
        if (isAcquire(source, destination)) throw errorWithCode("EIO");
      },
    });
    await expect(context.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      outcome: "CAPTURED",
      duplicate: false,
    });
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
  });

  it("con otro error y sin bloqueo creado: BEFORE_PUBLISH, lo preparado se borra y nada se publica", async () => {
    const context = await capture({
      rename: async (source: string, destination: string) => {
        if (isAcquire(source, destination)) throw errorWithCode("EIO");
        await nodeFileOps.rename(source, destination);
      },
    });
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
      name: "CaptureWriteError",
      phase: "BEFORE_PUBLISH",
    });
    await expectNoCapture(context);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    expect(await listNames(instanceDirectoryOf(context))).toEqual(["instance.json"]);
  });

  it("con otro error y sin poder comprobar si tomó efecto: BEFORE_PUBLISH, el material se conserva y nada se rompe", async () => {
    const control = { failLockLstat: false };
    const context = await capture({
      rename: async (source: string, destination: string) => {
        if (isAcquire(source, destination)) {
          control.failLockLstat = true;
          throw errorWithCode("EIO");
        }
        await nodeFileOps.rename(source, destination);
      },
      lstat: async (path: string) => {
        if (control.failLockLstat && path.endsWith(`${sep}locks${sep}${CAPTURE_ID}`)) {
          control.failLockLstat = false;
          throw errorWithCode("EIO");
        }
        return nodeFileOps.lstat(path);
      },
    });
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
      name: "CaptureWriteError",
      phase: "BEFORE_PUBLISH",
    });
    // Lo preparado sigue (retenido): ni la operación ni la limpieza propia lo borran.
    const kept = (await listNames(instanceDirectoryOf(context))).filter((name) =>
      name.startsWith("lock-"),
    );
    expect(kept).toHaveLength(1);
    await expect(context.sender.recoverWorkArea()).resolves.toMatchObject({
      ownLeftoverEntries: 0,
    });
    expect(
      (await listNames(instanceDirectoryOf(context))).filter((name) => name.startsWith("lock-")),
    ).toEqual(kept);
    await expectNoCapture(context);
    // El cierre tampoco lo borra: conserva el directorio de la instancia y lo informa.
    await expect(context.sender.close()).resolves.toMatchObject({ retainedEntries: 1 });
    expect(
      (await listNames(instanceDirectoryOf(context))).filter((name) => name.startsWith("lock-")),
    ).toEqual(kept);
  });
});

describe("publicación bajo el bloqueo (§9.5, fila 4)", () => {
  it("una entrada plantada bajo el bloqueo antes de publicar: CaptureIntegrityError y la plantada intacta", async () => {
    let planted = "";
    const context = await capture({
      rename: async (source: string, destination: string) => {
        if (isPublish(source, destination)) {
          planted = destination;
          await mkdir(destination, { mode: 0o700 });
          await writeFile(`${destination}${sep}plantado`, encode("fuera del protocolo"));
        }
        await nodeFileOps.rename(source, destination);
      },
    });
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
      name: "CaptureIntegrityError",
      reason: "ENTRY_APPEARED_UNDER_LOCK",
    });
    expect(await listNames(planted)).toEqual(["plantado"]);
    expect(await readFile(`${planted}${sep}plantado`, "utf8")).toBe("fuera del protocolo");
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
  });

  it("`staged/` quitado del bloqueo antes de publicar: CaptureIntegrityError (STAGED_MISSING) y nada publicado", async () => {
    const context = await capture({
      rename: async (source: string, destination: string) => {
        if (isPublish(source, destination)) await rm(source, { recursive: true, force: true });
        await nodeFileOps.rename(source, destination);
      },
    });
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
      name: "CaptureIntegrityError",
      reason: "STAGED_MISSING",
    });
    await expectNoCapture(context);
  });

  it("publicación con otro error y la entrada creada (mismo inodo que staged/): sigue como publicada", async () => {
    const context = await capture({
      rename: async (source: string, destination: string) => {
        await nodeFileOps.rename(source, destination);
        if (isPublish(source, destination)) throw errorWithCode("EIO");
      },
    });
    await expect(context.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      outcome: "CAPTURED",
      duplicate: false,
    });
    await expect(context.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      payloadAvailable: true,
    });
  });

  it("publicación con otro error y sin entrada: BEFORE_PUBLISH; el reintento publica", async () => {
    const control = { fail: true };
    const context = await capture({
      rename: async (source: string, destination: string) => {
        if (control.fail && isPublish(source, destination)) {
          control.fail = false;
          throw errorWithCode("EIO");
        }
        await nodeFileOps.rename(source, destination);
      },
    });
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
      name: "CaptureWriteError",
      phase: "BEFORE_PUBLISH",
    });
    await expectNoCapture(context);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    await expect(context.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      outcome: "CAPTURED",
      duplicate: false,
    });
  });

  it.each([true, false])(
    "publicación y su comprobación fallan (publicada: %s): PUBLISH_UNCERTAIN con captureId; el reintento lo resuelve",
    async (tookEffect) => {
      const control = { fail: true, failEntryLstat: false };
      const context = await capture({
        rename: async (source: string, destination: string) => {
          if (control.fail && isPublish(source, destination)) {
            control.fail = false;
            if (tookEffect) await nodeFileOps.rename(source, destination);
            control.failEntryLstat = true;
            throw errorWithCode("EIO");
          }
          await nodeFileOps.rename(source, destination);
        },
        lstat: async (path: string) => {
          if (control.failEntryLstat && path.endsWith(`${sep}captures${sep}${CAPTURE_ID}`)) {
            control.failEntryLstat = false;
            throw errorWithCode("EIO");
          }
          return nodeFileOps.lstat(path);
        },
      });
      const failure = await context.sender
        .send(KEY, sampleEmail())
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CaptureWriteError);
      expect(failure).toMatchObject({ phase: "PUBLISH_UNCERTAIN", captureId: CAPTURE_ID });
      expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual(
        tookEffect ? [CAPTURE_ID] : [],
      );
      await expect(context.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
        outcome: "CAPTURED",
        duplicate: tookEffect,
      });
      expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([CAPTURE_ID]);
    },
  );

  it("la entrada desaparece durante la verificación bajo el bloqueo propio: CaptureIntegrityError, sin publicar encima", async () => {
    const control = { removeOnRecordRead: false };
    const held = `${await createTestDirectory()}${sep}fuera`;
    const context = await capture({
      openObjectForRead: async (path: string) => {
        if (control.removeOnRecordRead && path.endsWith(`${CAPTURE_ID}${sep}record.json`)) {
          control.removeOnRecordRead = false;
          await rename(path.slice(0, path.lastIndexOf(sep)), held);
        }
        return nodeFileOps.openObjectForRead(path);
      },
    });
    await context.sender.send(KEY, sampleEmail());
    control.removeOnRecordRead = true;
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
      name: "CaptureIntegrityError",
      reason: "ENTRY_VANISHED_UNDER_LOCK",
    });
    await expectNoCapture(context);
    expect(await listNames(held)).toEqual(["payload", "record.json"]);
  });
});

describe("después de publicar (§9.5, filas 5 y 6)", () => {
  it("falla el `fsync` de captures/: AFTER_PUBLISH con captureId; el reintento da duplicate y repite el fsync", async () => {
    const control = { fail: true, capturesFsyncs: 0 };
    const context = await capture({
      fsyncDir: async (path: string) => {
        if (path.endsWith(`${sep}captures`)) {
          control.capturesFsyncs += 1;
          if (control.fail) {
            control.fail = false;
            throw errorWithCode("EIO");
          }
        }
        await nodeFileOps.fsyncDir(path);
      },
    });
    const failure = await context.sender.send(KEY, sampleEmail()).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "CaptureWriteError",
      phase: "AFTER_PUBLISH",
      captureId: CAPTURE_ID,
    });
    // Visible y completa: no se retira.
    await expect(context.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      payloadAvailable: true,
    });
    const before = control.capturesFsyncs;
    await expect(context.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      outcome: "CAPTURED",
      duplicate: true,
      payloadAvailable: true,
    });
    expect(control.capturesFsyncs).toBe(before + 1);
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([CAPTURE_ID]);
  });

  it("falla la liberación: send resuelve; otra instancia recibe KEY_BUSY hasta que la limpieza propia libera", async () => {
    const directory = await createTestDirectory();
    const events: CaptureMaintenanceEvent[] = [];
    const control = { failRelease: true };
    const first = await buildTestCapture(
      {
        timing: manualTiming(),
        onMaintenanceEvent: (event) => events.push(event),
        fileOps: decorateFileOps(nodeFileOps, {
          rename: async (source: string, destination: string) => {
            if (control.failRelease && source.endsWith(`${sep}locks${sep}${CAPTURE_ID}`)) {
              throw errorWithCode("EIO");
            }
            await nodeFileOps.rename(source, destination);
          },
        }),
      },
      directory,
    );
    const second = await buildTestCapture({ timing: manualTiming() }, directory);
    await expect(first.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      outcome: "CAPTURED",
    });
    expect(events).toEqual([{ kind: "CAPTURE_LOCK_RELEASE_PENDING", captureId: CAPTURE_ID }]);
    expect(await listNames(`${first.rootPath}${sep}locks`)).toEqual([CAPTURE_ID]);
    await expect(second.sender.send(KEY, sampleEmail())).rejects.toBeInstanceOf(
      CaptureKeyBusyError,
    );
    // La limpieza de la otra instancia nunca quita un bloqueo ajeno.
    await expect(second.sender.recoverWorkArea()).resolves.toMatchObject({ locksReleased: 0 });
    expect(await listNames(`${first.rootPath}${sep}locks`)).toEqual([CAPTURE_ID]);
    control.failRelease = false;
    await expect(first.sender.recoverWorkArea()).resolves.toMatchObject({
      locksReleased: 1,
      locksStillPending: 0,
    });
    expect(await listNames(`${first.rootPath}${sep}locks`)).toEqual([]);
    await expect(second.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      duplicate: true,
    });
  });

  it("un bloqueo propio pendiente que alguien fuera del protocolo reemplazó: la liberación no lo toca", async () => {
    const directory = await createTestDirectory();
    const events: CaptureMaintenanceEvent[] = [];
    const control = { failRelease: true };
    const context = await buildTestCapture(
      {
        timing: manualTiming(),
        onMaintenanceEvent: (event) => events.push(event),
        fileOps: decorateFileOps(nodeFileOps, {
          rename: async (source: string, destination: string) => {
            if (control.failRelease && source.endsWith(`${sep}locks${sep}${CAPTURE_ID}`)) {
              throw errorWithCode("EIO");
            }
            await nodeFileOps.rename(source, destination);
          },
        }),
      },
      directory,
    );
    await context.sender.send(KEY, sampleEmail());
    const lockPath = `${context.rootPath}${sep}locks${sep}${CAPTURE_ID}`;
    // Fuera del protocolo: el bloqueo se cambia por otro con su propio owner.json.
    await rename(lockPath, `${directory}${sep}bloqueo-original`);
    await mkdir(lockPath, { mode: 0o700 });
    await writeFile(`${lockPath}${sep}owner.json`, encode('{"token":"otro"}\n'), { mode: 0o600 });
    control.failRelease = false;
    await expect(context.sender.recoverWorkArea()).resolves.toMatchObject({
      locksReleased: 0,
      locksStillPending: 0,
    });
    expect(events.at(-1)).toEqual({ kind: "CAPTURE_LOCK_NOT_OWNED", captureId: CAPTURE_ID });
    expect(await listNames(lockPath)).toEqual(["owner.json"]);
    expect((await lstat(lockPath)).isDirectory()).toBe(true);
  });
});

describe("errores tipados", () => {
  it("CaptureIntegrityError y CaptureKeyBusyError llevan el captureId y ningún contenido", () => {
    const integrity = new CaptureIntegrityError(CAPTURE_ID, "RECORD_MISSING");
    const busy = new CaptureKeyBusyError(CAPTURE_ID);
    expect([integrity.captureId, busy.captureId, busy.code]).toEqual([
      CAPTURE_ID,
      CAPTURE_ID,
      "KEY_BUSY",
    ]);
    expect(integrity.message).not.toContain(KEY);
  });
});
