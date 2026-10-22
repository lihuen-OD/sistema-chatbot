// Fases de escritura con inyecciones de FileOps (plan §8.4, §13): cada inyección es una
// pieza de nodo que falla equivocadamente y el estado queda descrito por fase (§8.4).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, symlink, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import type {
  InternalStorageOptions,
  StorageMaintenanceEvent,
} from "../src/local/private-folder-storage.js";
import { LocalPrivateFolderStorage } from "../src/local/private-folder-storage.js";
import { nodeFileOps, type FileOps } from "../src/local/file-ops.js";
import {
  buildTestStorage,
  createTestDirectory,
  decorateFileOps,
  encode,
  fixedRandomHex128,
  installTestAppEnv,
  listNames,
  removeDirectory,
  type TestStorageContext,
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

function iterable(values: Uint8Array[]): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: async function* (): AsyncIterableIterator<Uint8Array> {
      for (const value of values) {
        await Promise.resolve();
        yield value;
      }
    },
  };
}

const KEY_E = "ea761ba8834e58179bd4b20e8e761ba8";

function instanceDirectory(context: TestStorageContext): string {
  return `${context.rootPath}${sep}tmp${sep}${context.storage.instanceId}`;
}

async function listAll(storage: LocalPrivateFolderStorage): Promise<string[]> {
  const all: string[] = [];
  for await (const entry of storage.listObjects()) {
    all.push(entry.key);
  }
  return all;
}

function errorWithCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** Otra instancia sobre la misma raíz, con fileOps propio para las inyecciones. */
async function rebuild(
  context: TestStorageContext,
  overrides: Partial<FileOps>,
  extra: Partial<InternalStorageOptions> = {},
): Promise<TestStorageContext> {
  return buildTestStorage(
    {
      randomHex128: fixedRandomHex128(KEY_E),
      fileOps: decorateFileOps(nodeFileOps, overrides),
      ...extra,
    },
    context.tempRoot,
  );
}

describe("fases por inyección (plan §8.4 y §13)", () => {
  it("apertura del temporal imposibilitada por un enlace plantado: BEFORE_PUBLISH y el enlace queda", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    const planted = `${instanceDirectory(context)}${sep}${KEY_E}.part`;
    await symlink(temporary, planted);
    await expect(
      context.storage.put(iterable([encode("contenido")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({ name: "StorageWriteError", phase: "BEFORE_PUBLISH" });
    expect((await lstat(planted)).isSymbolicLink()).toBe(true);
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
  });

  it("`link` con EEXIST y destino ajeno regular: KEY_COLLISION y el ajeno queda intacto", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    await writeFile(`${context.rootPath}${sep}objects${sep}${KEY_E}`, encode("ajeno"), {
      mode: 0o600,
    });
    await expect(
      context.storage.put(iterable([encode("nuevo")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "KEY_COLLISION" });
    expect(await listAll(context.storage)).toEqual([KEY_E]);
  });

  it("`link` con otro error y destino ya creado: se toma como publicado y put resuelve", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    const conforme = await rebuild(first, {
      link: async (source: string, destination: string) => {
        // La inyección solo afecta la publicación (§8.4), no la prueba de compatibilidad
        // de enlaces duros de la construcción (§6.4), que usa el mismo fileOps.
        if (!destination.includes(`${sep}objects${sep}`)) {
          await nodeFileOps.link(source, destination);
          return;
        }
        await nodeFileOps.link(source, destination);
        throw errorWithCode("EBUSY_INYECTADO");
      },
    });
    const stored = await conforme.storage.put(iterable([encode("publicado igualmente")]), {
      maxBytes: 1000,
    });
    expect(stored.key).toBe(KEY_E);
    expect(await listAll(conforme.storage)).toEqual([KEY_E]);
    expect(await listNames(instanceDirectory(conforme))).toEqual(["instance.json"]);
  });

  it("`link` con otro error y destino no creado: BEFORE_PUBLISH y temporal borrado", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    const conforme = await rebuild(first, {
      link: async (source: string, destination: string) => {
        // Solo la publicación; la prueba de compatibilidad de la construcción (§6.4) pasa.
        if (!destination.includes(`${sep}objects${sep}`)) {
          await nodeFileOps.link(source, destination);
          return;
        }
        await Promise.reject(errorWithCode("EBUSY_INYECTADO"));
      },
    });
    await expect(
      conforme.storage.put(iterable([encode("contenido")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({ name: "StorageWriteError", phase: "BEFORE_PUBLISH" });
    expect(await listNames(`${conforme.rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(instanceDirectory(conforme))).toEqual(["instance.json"]);
  });

  it("`fsync` del archivo falla: BEFORE_PUBLISH y temporal borrado", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    const conforme = await rebuild(first, {
      openTempForWrite: async (path: string) => {
        const inner = await nodeFileOps.openTempForWrite(path);
        if (path.includes(`${sep}instance.json`)) return inner;
        return {
          write: (buffer: Uint8Array) => inner.write(buffer),
          readInto: (buffer: Uint8Array, position: number) => inner.readInto(buffer, position),
          fstat: () => inner.fstat(),
          fchmod: (mode: number) => inner.fchmod(mode),
          fsync: async () => {
            await Promise.reject(errorWithCode("EIO_FSYNC"));
          },
          close: () => inner.close(),
        };
      },
    });
    await expect(
      conforme.storage.put(iterable([encode("contenido")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({ name: "StorageWriteError", phase: "BEFORE_PUBLISH" });
    expect(await listNames(`${conforme.rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(instanceDirectory(conforme))).toEqual(["instance.json"]);
  });

  it("`fsync` de objects/ falla: AFTER_PUBLISH WITHDRAWN y sin objeto listado", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    const conforme = await rebuild(first, {
      fsyncDir: async (path: string) => {
        if (path.endsWith(`${sep}objects`)) throw errorWithCode("EIO_FSYNC");
        await nodeFileOps.fsyncDir(path);
      },
    });
    await expect(
      conforme.storage.put(iterable([encode("contenido")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({
      name: "StorageWriteError",
      phase: "AFTER_PUBLISH",
      key: KEY_E,
      objectState: "WITHDRAWN",
    });
    expect(await listAll(conforme.storage)).toEqual([]);
    expect(await listNames(`${conforme.rootPath}${sep}objects`)).toEqual([]);
  });

  it("`fsync` de objects/ y del retiro fallan: AFTER_PUBLISH LEFT_IN_PLACE y objeto visible", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    const conforme = await rebuild(first, {
      fsyncDir: async (path: string) => {
        if (path.endsWith(`${sep}objects`)) throw errorWithCode("EIO_FSYNC");
        await nodeFileOps.fsyncDir(path);
      },
      unlink: async (path: string) => {
        if (path.includes(`${sep}objects${sep}`)) throw errorWithCode("EIO_UNLINK");
        await nodeFileOps.unlink(path);
      },
    });
    await expect(
      conforme.storage.put(iterable([encode("contenido")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({
      name: "StorageWriteError",
      phase: "AFTER_PUBLISH",
      key: KEY_E,
      objectState: "LEFT_IN_PLACE",
    });
    expect(await listAll(conforme.storage)).toEqual([KEY_E]);
  });

  it("`unlink` del temporal falla al publicar: put resuelve, evento de residuo y limpieza posterior", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const events: StorageMaintenanceEvent[] = [];
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    const conforme = await rebuild(
      first,
      {
        unlink: async (path: string) => {
          if (path.includes(`${sep}tmp${sep}`) && path.endsWith(".part")) {
            throw errorWithCode("EIO_UNLINK");
          }
          await nodeFileOps.unlink(path);
        },
      },
      { onMaintenanceEvent: (event) => events.push(event) },
    );
    const stored = await conforme.storage.put(iterable([encode("objeto intacto")]), {
      maxBytes: 1000,
    });
    expect(stored.key).toBe(KEY_E);
    expect(await listAll(conforme.storage)).toEqual([KEY_E]);
    expect(events).toEqual([{ kind: "PUBLISHED_TEMPORARY_RESIDUE" }]);
    expect(await listNames(instanceDirectory(conforme))).toEqual([
      `${KEY_E}.part`,
      "instance.json",
    ]);
    // La limpieza en ejecución propia retoma el residuo (§7.2): entra en .reclaim y se borra.
    const report = await conforme.storage.recoverWorkArea();
    expect(report.ownLeftoverEntries).toBe(1);
    expect(await listNames(instanceDirectory(conforme))).toEqual(["instance.json"]);
    await expect(listNames(`${conforme.rootPath}${sep}.reclaim`)).resolves.toEqual([]);
  });

  it("`unlink` del objeto con error ajeno: BEFORE_REMOVE y el objeto sigue presente", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    await first.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    const bloqueado = await rebuild(first, {
      unlink: async (path: string) => {
        if (path.includes(`${sep}objects${sep}`)) throw errorWithCode("EACCES_INYECTADO");
        await nodeFileOps.unlink(path);
      },
    });
    await expect(bloqueado.storage.delete(KEY_E)).rejects.toMatchObject({
      name: "StorageWriteError",
      phase: "BEFORE_REMOVE",
      key: KEY_E,
    });
    expect(await listAll(bloqueado.storage)).toEqual([KEY_E]);
  });

  it("`fsync` de objects/ falla tras el unlink: AFTER_REMOVE y el reintento da ALREADY_ABSENT", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    await first.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    const sinsincronizar = await rebuild(first, {
      fsyncDir: async (path: string) => {
        if (path.endsWith(`${sep}objects`)) throw errorWithCode("EIO_FSYNC");
        await nodeFileOps.fsyncDir(path);
      },
    });
    await expect(sinsincronizar.storage.delete(KEY_E)).rejects.toMatchObject({
      name: "StorageWriteError",
      phase: "AFTER_REMOVE",
      key: KEY_E,
    });
    expect(await listAll(sinsincronizar.storage)).toEqual([]);
    const normal = await rebuild(first, {});
    await expect(normal.storage.delete(KEY_E)).resolves.toBe("ALREADY_ABSENT");
  });
});
