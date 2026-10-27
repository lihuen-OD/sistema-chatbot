// Limpieza en ejecución (plan §7.2, §13): restos propios, nada de otras instancias,
// drenaje de .reclaim entre instancias competidoras y cierres con operaciones activas.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, rm, symlink, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import { Buffer } from "node:buffer";
import { nodeFileOps, type FileOpsHandle } from "../src/local/file-ops.js";
import { StorageClosedError } from "../src/ports/storage.js";
import {
  buildTestStorage,
  createGate,
  createTestDirectory,
  decorateFileOps,
  encode,
  fixedRandomHex128,
  installTestAppEnv,
  listNames,
  removeDirectory,
  type TestStorageContext,
  writePausedOnGate,
} from "./support.js";

let restoreAppEnv: () => void;
const leftovers: string[] = [];

beforeEach(() => {
  restoreAppEnv = installTestAppEnv();
});

afterEach(async () => {
  restoreAppEnv();
  for (const directory of leftovers.splice(0)) {
    await removeDirectory(directory);
  }
});

function instanceDirectory(context: TestStorageContext): string {
  return `${context.rootPath}${sep}tmp${sep}${context.storage.instanceId}`;
}

describe("limpieza en ejecución (plan §7.2, §7.3 y §13)", () => {
  it("restos propios se retoman; instance.json se conserva y .reclaim queda vacío", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage(
      { randomHex128: fixedRandomHex128("abababababababababababababababab") },
      temporary,
    );
    const own = instanceDirectory(context);
    await writeFile(`${own}${sep}abababababababababababababababab.part`, encode("resto"), {
      mode: 0o600,
    });
    await writeFile(`${own}${sep}lock-abababababababababababababababab`, encode("bloqueo"), {
      mode: 0o600,
    });
    const report = await context.storage.recoverWorkArea();
    expect(report.ownLeftoverEntries).toBe(2);
    expect(await listNames(own)).toEqual(["instance.json"]);
    expect(await listNames(`${context.rootPath}${sep}.reclaim`)).toEqual([]);
  });

  it("una operación viva protegida: el temporal es para ella y ni la edad ni otra instancia lo toca", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const gate = createGate();
    let paused: FileOpsHandle | undefined;
    const withGate = decorateFileOps(nodeFileOps, {
      openTempForWrite: async (path: string) => {
        const inner = await nodeFileOps.openTempForWrite(path);
        if (path.includes(`${sep}instance.json`)) return inner;
        paused = inner;
        return writePausedOnGate(inner, gate);
      },
    });
    const primera = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128("cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"),
        fileOps: withGate,
      },
      temporary,
    );
    const segunda = await buildTestStorage(
      { randomHex128: fixedRandomHex128("cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd") },
      temporary,
    );
    const operation = primera.storage.put(iterableDeUna(), { maxBytes: 1000 });
    const temporal = `${instanceDirectory(primera)}${sep}cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd.part`;
    await waitForFile(temporal);
    if (paused === undefined) throw new Error("La operación no llegó a la primera escritura.");

    // La segunda instancia, en su limpieza, no toca lo de la primera.
    const reportOtra = await segunda.storage.recoverWorkArea();
    expect(reportOtra.ownLeftoverEntries).toBe(0);
    expect((await lstat(temporal)).isFile()).toBe(true);

    // Envejecido artificialmente no cambia la regla (principio A4).
    const utimes = (await import("node:fs/promises")).utimes;
    const oldDate = new Date(Date.now() - 6 * 86_400_000);
    await utimes(temporal, oldDate, oldDate);
    const reportViejada = await segunda.storage.recoverWorkArea();
    expect(reportViejada.ownLeftoverEntries).toBe(0);
    expect((await lstat(temporal)).isFile()).toBe(true);

    // La limpieza de la PROPIA instancia con la operación en el registro tampoco lo borra.
    const reportPropia = await primera.storage.recoverWorkArea();
    expect(reportPropia.ownLeftoverEntries).toBe(0);
    expect((await lstat(temporal)).isFile()).toBe(true);

    // Al reanudarse, la operación publica sin sustos (§13, operación lenta).
    gate.open();
    const stored = await operation;
    expect(stored.key).toBe("cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd");
    expect(await listNames(`${primera.rootPath}${sep}objects`)).toEqual([stored.key]);
    expect(await listNames(instanceDirectory(primera))).toEqual(["instance.json"]);
  });

  it("el drenaje de .reclaim funciona en competencia entre dos instancias y queda vacío", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage(
      { randomHex128: fixedRandomHex128("efefefefefefefefefefefefefefefef") },
      temporary,
    );
    const otra = await buildTestStorage(
      { randomHex128: fixedRandomHex128("efefefefefefefefefefefefefefefef") },
      temporary,
    );
    const reclaim = `${context.rootPath}${sep}.reclaim`;
    for (let index = 0; index < 5; index += 1) {
      const padded = String(index).padStart(2, "0");
      await writeFile(`${reclaim}${sep}aji-${padded}`, encode("desprendido"), { mode: 0o600 });
    }
    const [unReport, otroReport] = await Promise.all([
      context.storage.recoverWorkArea(),
      otra.storage.recoverWorkArea(),
    ]);
    expect(
      unReport.reclaimEntriesRemoved + otroReport.reclaimEntriesRemoved,
    ).toBeGreaterThanOrEqual(5);
    expect(await listNames(reclaim)).toEqual([]);
    expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
    expect(await listNames(instanceDirectory(otra))).toEqual(["instance.json"]);
  });

  it("un ENOENT de una carrera en .reclaim cuenta como borrado (§7.2)", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const withRacer = decorateFileOps(nodeFileOps, {
      readdir: async (path: string) => {
        const listing = await nodeFileOps.readdir(path);
        if (path.endsWith(`${sep}.reclaim`)) {
          return [...listing, "desaparecedor-en-carrera"];
        }
        return listing;
      },
      rm: async (path: string, options?: { force?: boolean; recursive?: boolean }) => {
        if (path.endsWith("desaparecedor-en-carrera")) {
          const error = Object.assign(new Error("ENOENT en carrera"), { code: "ENOENT" });
          throw error;
        }
        await nodeFileOps.rm(path, options ?? {});
      },
    });
    const context = await buildTestStorage(
      {
        fileOps: withRacer,
        randomHex128: fixedRandomHex128("fafafafafafafafafafafafafafafafafafafafaf"),
      },
      temporary,
    );
    const report = await context.storage.recoverWorkArea();
    expect(report.reclaimEntriesRemoved).toBe(1);
  });

  it(":close borra el directorio de la instancia si no quedan operaciones; después queda limpia la raíz", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage(
      { randomHex128: fixedRandomHex128("fbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfb") },
      temporary,
    );
    const report = await context.storage.close();
    expect(report.ownLeftoverEntries).toBe(0);
    await expect(lstat(instanceDirectory(context))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it(":close con un put admitido antes espera a que termine: el temporal no se toca y el put publica", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const gate = createGate();
    const removed: string[] = [];
    const primera = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128("fcfcfcfcfcfcfcfcfcfcfcfcfcfcfcfc"),
        fileOps: decorateFileOps(nodeFileOps, {
          openTempForWrite: async (path: string) => {
            const inner = await nodeFileOps.openTempForWrite(path);
            return path.endsWith(".part") ? writePausedOnGate(inner, gate) : inner;
          },
          rm: async (path: string, options: { force?: boolean; recursive?: boolean }) => {
            removed.push(path);
            await nodeFileOps.rm(path, options);
          },
        }),
      },
      temporary,
    );
    // Solo interesan los borrados desde el cierre (la construcción borra su prueba de
    // enlace duro).
    removed.length = 0;
    const operation = primera.storage.put(iterableDeUna(), { maxBytes: 1000 });
    const temporal = `${instanceDirectory(primera)}${sep}fcfcfcfcfcfcfcfcfcfcfcfcfcfcfcfc.part`;
    await waitForFile(temporal);
    let closeSettled = false;
    const closing = primera.storage.close().finally(() => {
      closeSettled = true;
    });
    // El cierre espera a la operación admitida: ninguna cantidad de vueltas del bucle lo
    // hace avanzar mientras el put siga en pausa.
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
    expect(closeSettled).toBe(false);
    expect(removed).toEqual([]);
    expect((await lstat(temporal)).isFile()).toBe(true);

    gate.open();
    const stored = await operation;
    expect(stored.key).toBe("fcfcfcfcfcfcfcfcfcfcfcfcfcfcfcfc");
    await expect(closing).resolves.toEqual({
      ownLeftoverEntries: 0,
      reclaimEntriesRemoved: 0,
      retainedEntries: 0,
    });
    await expect(lstat(instanceDirectory(primera))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await listNames(`${primera.rootPath}${sep}objects`)).toEqual([stored.key]);
  });

  it("un enlace simbólico plantado como resto propio: el momento de la limpieza lo retira sin seguirlo", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage(
      { randomHex128: fixedRandomHex128("fdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfd") },
      temporary,
    );
    const enlace = `${instanceDirectory(context)}${sep}fdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfd.part`;
    await symlink(`${temporary}${sep}-no-creo-que-exista`, enlace);
    const report = await context.storage.recoverWorkArea();
    expect(report.ownLeftoverEntries).toBe(1);
    await expect(lstat(enlace)).rejects.toMatchObject({ code: "ENOENT" });
    // El desprendimiento es un rename, no un recorrido: el objetivo ajeno no fue borrado.
    await expect(
      rm(`${temporary}${sep}-no-creo-que-exista`, { force: true }),
    ).resolves.toBeUndefined();
  });
});

describe("ciclo de vida de la instancia y cierre (plan §7.5)", () => {
  /** Escenario de la revisión: el `rm` del directorio de la instancia en pausa y un put
   * que empieza durante el cierre. Antes, el put entraba, abría su temporal y fallaba con
   * ENOENT cuando el cierre borraba el directorio. Ahora no se admite. */
  it("un put que empieza mientras close borra el directorio no se admite y no crea nada", async () => {
    const temporary = await createTestDirectory();
    const rmEntered = createGate();
    const rmGate = createGate();
    const writeGate = createGate();
    let instanceDir = "";
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128("abcdabcdabcdabcdabcdabcdabcdabcd"),
        fileOps: decorateFileOps(nodeFileOps, {
          openTempForWrite: async (path: string) => {
            const inner = await nodeFileOps.openTempForWrite(path);
            return path.endsWith(".part") ? writePausedOnGate(inner, writeGate) : inner;
          },
          rm: async (path: string, options: { force?: boolean; recursive?: boolean }) => {
            if (path === instanceDir) {
              rmEntered.open();
              await rmGate.promise;
            }
            await nodeFileOps.rm(path, options);
          },
        }),
      },
      temporary,
    );
    instanceDir = instanceDirectory(context);
    const temporal = `${instanceDir}${sep}abcdabcdabcdabcdabcdabcdabcdabcd.part`;
    const closing = context.storage.close();
    await rmEntered.promise;
    // La coreografía de la revisión: el put empieza con el `rm` en pausa y, si se lo
    // admitiera, abriría su temporal y quedaría en pausa en la primera escritura. Se
    // espera a que rechace o a que su temporal exista; recién después sigue el cierre.
    const progress = { settled: false };
    const outcome = context.storage.put(iterableDeUna(), { maxBytes: 1000 }).then(
      () => "RESUELTO",
      (error: unknown) => error,
    );
    void outcome.then(() => {
      progress.settled = true;
    });
    for (;;) {
      if (progress.settled) break;
      try {
        if ((await lstat(temporal)).isFile()) break;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
    rmGate.open();
    const report = await closing;
    writeGate.open();
    expect(await outcome).toBeInstanceOf(StorageClosedError);
    expect(report).toMatchObject({ retainedEntries: 0 });
    await expect(lstat(instanceDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
  });

  it("llamadas concurrentes y repetidas a close comparten un intento y el informe", async () => {
    const temporary = await createTestDirectory();
    let instanceDirRemovals = 0;
    let instanceDir = "";
    const context = await buildTestStorage(
      {
        fileOps: decorateFileOps(nodeFileOps, {
          rm: async (path: string, options: { force?: boolean; recursive?: boolean }) => {
            if (path === instanceDir) instanceDirRemovals += 1;
            await nodeFileOps.rm(path, options);
          },
        }),
      },
      temporary,
    );
    instanceDir = instanceDirectory(context);
    const [first, second] = await Promise.all([context.storage.close(), context.storage.close()]);
    expect(second).toBe(first);
    expect(await context.storage.close()).toBe(first);
    expect(instanceDirRemovals).toBe(1);
  });

  it("después del cierre, toda operación nueva rechaza con StorageClosedError", async () => {
    const temporary = await createTestDirectory();
    const context = await buildTestStorage({}, temporary);
    const stored = await context.storage.put(iterableDeUna(), { maxBytes: 1000 });
    // Creados antes del cierre: el stream sigue leyendo; el listado aún no empezado, no.
    const opened = await context.storage.open(stored.key);
    const listing = context.storage.listObjects()[Symbol.asyncIterator]();
    await context.storage.close();
    const key = stored.key;
    const attempts: (() => Promise<unknown>)[] = [
      () => context.storage.put(iterableDeUna(), { maxBytes: 1000 }),
      () => context.storage.open(key),
      () => context.storage.delete(key),
      () => context.storage.resolveUncertainPublication(key),
      () => context.storage.recoverWorkArea(),
      () => listing.next(),
      async () => {
        for await (const entry of context.storage.listObjects()) return entry;
        return undefined;
      },
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(StorageClosedError);
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of opened.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("operación lenta");
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([key]);
  });

  it("un cierre fallido deja la instancia sin admitir operaciones y el siguiente close reintenta", async () => {
    const temporary = await createTestDirectory();
    let failInstanceRemoval = true;
    let instanceDir = "";
    const context = await buildTestStorage(
      {
        fileOps: decorateFileOps(nodeFileOps, {
          rm: async (path: string, options: { force?: boolean; recursive?: boolean }) => {
            if (failInstanceRemoval && path === instanceDir) {
              throw Object.assign(new Error("EIO inyectado"), { code: "EIO" });
            }
            await nodeFileOps.rm(path, options);
          },
        }),
      },
      temporary,
    );
    instanceDir = instanceDirectory(context);
    await expect(context.storage.close()).rejects.toMatchObject({ code: "EIO" });
    await expect(context.storage.put(iterableDeUna(), { maxBytes: 1000 })).rejects.toBeInstanceOf(
      StorageClosedError,
    );
    failInstanceRemoval = false;
    await expect(context.storage.close()).resolves.toMatchObject({ retainedEntries: 0 });
    await expect(lstat(instanceDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("close espera a un delete admitido antes: el objeto se borra y después se retira la instancia", async () => {
    const temporary = await createTestDirectory();
    const reachedFsync = createGate();
    const release = createGate();
    const control = { pauseNextObjectsFsync: false };
    const context = await buildTestStorage(
      {
        fileOps: decorateFileOps(nodeFileOps, {
          fsyncDir: async (path: string) => {
            if (control.pauseNextObjectsFsync && path.endsWith(`${sep}objects`)) {
              control.pauseNextObjectsFsync = false;
              reachedFsync.open();
              await release.promise;
            }
            await nodeFileOps.fsyncDir(path);
          },
        }),
      },
      temporary,
    );
    const stored = await context.storage.put(iterableDeUna(), { maxBytes: 1000 });
    control.pauseNextObjectsFsync = true;
    const deletion = context.storage.delete(stored.key);
    await reachedFsync.promise;
    const closing = context.storage.close();
    await expect(context.storage.delete(stored.key)).rejects.toBeInstanceOf(StorageClosedError);
    release.open();
    await expect(deletion).resolves.toBe("DELETED");
    await expect(closing).resolves.toMatchObject({ retainedEntries: 0 });
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
    await expect(lstat(instanceDirectory(context))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function iterableDeUna(): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: async function* (): AsyncIterableIterator<Uint8Array> {
      await Promise.resolve();
      yield encode("operación lenta");
    },
  };
}

/** Espera hasta que el archivo exista y sea regular (la escritura queda en pausa). */
async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      if ((await lstat(path)).isFile()) return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    if (Date.now() - startedAt > timeoutMs) throw new Error(`El archivo no llegó: ${path}`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}
