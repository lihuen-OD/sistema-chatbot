// Fases de escritura con inyecciones de FileOps (plan §8.4, §13): cada inyección hace
// fallar o detiene un paso concreto sobre archivos reales, y se comprueba el resultado
// y el estado en disco que §8.4 fija para esa fase.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import type {
  InternalStorageOptions,
  StorageMaintenanceEvent,
} from "../src/local/private-folder-storage.js";
import { LocalPrivateFolderStorage } from "../src/local/private-folder-storage.js";
import { nodeFileOps, type FileOps, type FileOpsHandle } from "../src/local/file-ops.js";
import { StorageWriteError, UncertainPublicationError } from "../src/ports/storage.js";
import {
  buildTestStorage,
  collect,
  collectUnhandledRejections,
  createGate,
  createTestDirectory,
  decorateFileOps,
  encode,
  fixedRandomHex128,
  installTestAppEnv,
  listNames,
  removeDirectory,
  sequenceHex128,
  sha256Hex,
  withTimeout,
  writePausedOnGate,
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

  it("el retiro (`rename`) falla sin trasladar: BEFORE_REMOVE, el objeto sigue y no queda destino privado", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    await first.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    const bloqueado = await rebuild(first, {
      rename: async (source: string, destination: string) => {
        if (source.endsWith(`${sep}objects${sep}${KEY_E}`)) throw errorWithCode("EACCES");
        await nodeFileOps.rename(source, destination);
      },
    });
    await expect(bloqueado.storage.delete(KEY_E)).rejects.toMatchObject({
      name: "StorageWriteError",
      phase: "BEFORE_REMOVE",
      key: KEY_E,
    });
    expect(await listAll(bloqueado.storage)).toEqual([KEY_E]);
    expect(await listNames(instanceDirectory(bloqueado))).toEqual(["instance.json"]);
  });

  it("el retiro (`rename`) informa un error pero trasladó el objeto: se sigue y da DELETED", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    await first.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    const espurio = await rebuild(first, {
      rename: async (source: string, destination: string) => {
        await nodeFileOps.rename(source, destination);
        if (source.endsWith(`${sep}objects${sep}${KEY_E}`)) throw errorWithCode("EIO");
      },
    });
    await expect(espurio.storage.delete(KEY_E)).resolves.toBe("DELETED");
    expect(await listAll(espurio.storage)).toEqual([]);
    expect(await listNames(instanceDirectory(espurio))).toEqual(["instance.json"]);
  });

  it("el borrado físico falla después del retiro: DELETED, evento de residuo y la limpieza propia lo retoma", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const events: StorageMaintenanceEvent[] = [];
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    await first.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    let failPhysicalRemoval = true;
    const conResiduo = await rebuild(
      first,
      {
        rm: async (path: string, options: { force?: boolean; recursive?: boolean }) => {
          if (failPhysicalRemoval && path.includes(`${sep}del-`)) throw errorWithCode("EIO");
          await nodeFileOps.rm(path, options);
        },
      },
      { onMaintenanceEvent: (event) => events.push(event) },
    );
    await expect(conResiduo.storage.delete(KEY_E)).resolves.toBe("DELETED");
    expect(events).toEqual([{ kind: "DELETED_OBJECT_RESIDUE" }]);
    expect(await listAll(conResiduo.storage)).toEqual([]);
    expect(await listNames(instanceDirectory(conResiduo))).toEqual([
      `del-${KEY_E}`,
      "instance.json",
    ]);
    // Sin operación activa, el destino privado es un resto propio (§7.2).
    failPhysicalRemoval = false;
    const report = await conResiduo.storage.recoverWorkArea();
    expect(report.ownLeftoverEntries).toBe(1);
    expect(await listNames(instanceDirectory(conResiduo))).toEqual(["instance.json"]);
    await expect(conResiduo.storage.delete(KEY_E)).resolves.toBe("ALREADY_ABSENT");
  });

  it("la entrada cambia entre la comprobación y el retiro: TARGET_CHANGED, se restituye y nada se borra", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    await first.storage.put(iterable([encode("comprobado")]), { maxBytes: 1000 });
    const objectPath = `${first.rootPath}${sep}objects${sep}${KEY_E}`;
    // Un proceso del mismo usuario (simulado) reemplaza la entrada justo antes del rename.
    // El original se conserva aparte con `rename`, para que el reemplazo no pueda
    // reutilizar su inodo.
    const held = `${first.tempRoot}${sep}original-conservado`;
    const reemplazado = await rebuild(first, {
      rename: async (source: string, destination: string) => {
        if (source === objectPath) {
          await nodeFileOps.rename(objectPath, held);
          await writeFile(objectPath, encode("otro contenido"), { mode: 0o600 });
        }
        await nodeFileOps.rename(source, destination);
      },
    });
    await expect(reemplazado.storage.delete(KEY_E)).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "TARGET_CHANGED",
    });
    expect(await readFile(objectPath, "utf8")).toBe("otro contenido");
    expect(await readFile(held, "utf8")).toBe("comprobado");
    expect(await listNames(instanceDirectory(reemplazado))).toEqual(["instance.json"]);
  });

  it("`fsync` de objects/ falla tras el retiro: AFTER_REMOVE y el reintento da ALREADY_ABSENT", async () => {
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

describe("borrados concurrentes con el retiro exclusivo (§8.5)", () => {
  /** Intercalación forzada con una compuerta: los dos borrados ya comprobaron que el
   * objeto existe y los dos intentan el `rename`. Solo uno lo encuentra; el otro recibe
   * ENOENT y da ALREADY_ABSENT. El par con llamadas reales, en una y en dos instancias,
   * está en storage.test.ts. */
  it("los dos llegan al `rename` después de comprobar: un DELETED y un ALREADY_ABSENT", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    await first.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    const bothChecked = createGate();
    let renamesWaiting = 0;
    const objectPath = `${first.rootPath}${sep}objects${sep}${KEY_E}`;
    const intercalado = await rebuild(
      first,
      {
        rename: async (source: string, destination: string) => {
          if (source === objectPath) {
            renamesWaiting += 1;
            if (renamesWaiting === 2) bothChecked.open();
            await bothChecked.promise;
          }
          await nodeFileOps.rename(source, destination);
        },
      },
      { randomHex128: sequenceHex128() },
    );
    const results = await Promise.all([
      intercalado.storage.delete(KEY_E),
      intercalado.storage.delete(KEY_E),
    ]);
    expect(renamesWaiting).toBe(2);
    expect([...results].sort()).toEqual(["ALREADY_ABSENT", "DELETED"]);
    expect(await listAll(intercalado.storage)).toEqual([]);
    expect(await listNames(instanceDirectory(intercalado))).toEqual(["instance.json"]);
  });

  /** Una lectura abierta antes del retiro sigue leyendo el objeto completo, aunque el
   * borrado físico ya ocurrió (semántica POSIX); una apertura nueva no lo encuentra. */
  it("una lectura abierta antes del borrado sigue; una apertura nueva da ObjectNotFoundError", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage({}, temporary);
    const content = Buffer.alloc(200_000, 9);
    const { key } = await context.storage.put(iterable([content]), { maxBytes: 300_000 });
    const opened = await context.storage.open(key);
    await expect(context.storage.delete(key)).resolves.toBe("DELETED");
    await expect(context.storage.open(key)).rejects.toMatchObject({
      name: "ObjectNotFoundError",
    });
    expect(await collect(opened.stream)).toEqual(new Uint8Array(content));
  });
});
describe("escrituras completas y cancelación (revisión de la entrega)", () => {
  /** `write` que acepta como máximo 2 bytes por llamada: el bucle de escritura completa
   * avanza con los bytes realmente escritos y el objeto queda idéntico. */
  it("`write` de 2 bytes por llamada: tamaño, SHA-256 y contenido completos", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage(
      { fileOps: decorateFileOps(nodeFileOps, writesAtMost2Bytes("partial2")) },
      temporary,
    );
    const content = Buffer.concat([
      Buffer.from("contenido largo para trocear en escrituras de dos bytes é ñ\n"),
      Buffer.alloc(3000, 5),
    ]);
    const stored = await context.storage.put(iterable([content]), { maxBytes: 100_000 });
    expect(stored.sizeBytes).toBe(content.length);
    expect(stored.sha256).toBe(sha256Hex(content));
    const read = await context.storage.open(stored.key);
    expect(await collect(read.stream)).toEqual(new Uint8Array(content));
  });

  it("cero progreso en `write`: rechazo sin publicar y sin residuo temporal", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(KEY_E),
        fileOps: decorateFileOps(nodeFileOps, writesAtMost2Bytes("zero")),
      },
      temporary,
    );
    await expect(
      context.storage.put(iterable([encode("contenido")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({ name: "StorageWriteError", phase: "BEFORE_PUBLISH" });
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
  });

  it("resultado inválido de `write` (más bytes que los pendientes): rechazo sin publicar", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(KEY_E),
        fileOps: decorateFileOps(nodeFileOps, writesAtMost2Bytes("invalid")),
      },
      temporary,
    );
    await expect(
      context.storage.put(iterable([encode("contenido")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({ name: "StorageWriteError", phase: "BEFORE_PUBLISH" });
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
  });

  it("error tras escribir parcialmente: BEFORE_PUBLISH, sin publicar y sin residuo", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(KEY_E),
        fileOps: decorateFileOps(nodeFileOps, writesAtMost2Bytes("errorAfterFirst")),
      },
      temporary,
    );
    await expect(
      context.storage.put(iterable([encode("contenido")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({ name: "StorageWriteError", phase: "BEFORE_PUBLISH" });
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
  });

  /** Una fuente que nunca coopera no puede bloquear la cancelación: el rechazo de la
   * operación, el cierre del descriptor y el retiro del temporal no esperan a `return()`;
   * la resolución o el rechazo tardío de la fuente no produce escrituras ni rechazos
   * sin manejar. */
  it("cancelación con fuente bloqueada en `next`: put rechaza sin esperar a la fuente", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    const controller = new AbortController();
    async function* blocked(): AsyncIterableIterator<Uint8Array> {
      await Promise.resolve();
      yield encode("primera porción");
      await new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("la fuente tardía no debe bloquear la cancelación"));
        }, 300);
      });
      yield encode("nunca");
    }
    const put = context.storage.put(blocked(), { maxBytes: 10_000, signal: controller.signal });
    await waitForPart(context, `${KEY_E}.part`);
    controller.abort();
    const startedAt = Date.now();
    await expect(put).rejects.toMatchObject({
      name: "StorageWriteError",
      phase: "BEFORE_PUBLISH",
      failureReason: "CANCELLED",
    });
    // El rechazo es por evento, no por los 300 ms de la fuente.
    expect(Date.now() - startedAt).toBeLessThan(290);
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
    // La fuente rechaza a los 300 ms: su rechazo no queda sin manejar ni afecta a put.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 320);
    });
  });

  /** Cancelación inyectada al terminar el `lstat` del temporal: la última espera antes
   * del `link` revalida la señal, y una cancelación observada antes de publicar no
   * publica (después del `link`, la semántica aprobada se conserva). */
  it("cancelación al concluir el `lstat` del temporal: no publica y retira el temporal", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const controller = new AbortController();
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(KEY_E),
        fileOps: decorateFileOps(nodeFileOps, {
          lstat: async (path: string) => {
            const stats = await nodeFileOps.lstat(path);
            if (path.endsWith(".part")) controller.abort();
            return stats;
          },
        }),
      },
      temporary,
    );
    await expect(
      context.storage.put(iterable([encode("contenido")]), {
        maxBytes: 1000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      name: "StorageWriteError",
      phase: "BEFORE_PUBLISH",
      failureReason: "CANCELLED",
    });
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
  });
});

describe("fuentes que no cooperan (§8.3 y §8.4, revisión de la entrega)", () => {
  /** El protocolo de iteración no llama `return()` después de `done`: una fuente cuyo
   * `return()` nunca responde no puede retener un `put` que ya terminó de leer. */
  it("exhaustión normal: put no llama a `return()` ni lo espera", async () => {
    const temporary = await createTestDirectory();
    const context = await buildTestStorage({}, temporary);
    const chunks = [encode("uno"), encode("dos")];
    let index = 0;
    let returnCalls = 0;
    const iterator: AsyncIterator<Uint8Array> = {
      next: () => {
        const value = chunks[index];
        index += 1;
        return Promise.resolve(
          value === undefined ? { done: true, value: undefined } : { done: false, value },
        );
      },
      return: () => {
        returnCalls += 1;
        return new Promise<IteratorResult<Uint8Array>>(() => undefined);
      },
    };
    const stored = await withTimeout(
      context.storage.put({ [Symbol.asyncIterator]: () => iterator }, { maxBytes: 1000 }),
      2000,
      "put con una fuente agotada",
    );
    expect(stored.sizeBytes).toBe(6);
    expect(stored.sha256).toBe(sha256Hex(encode("unodos")));
    expect(returnCalls).toBe(0);
  });

  /** La fuente entrega un trozo y después no responde nunca a `next()`; su `return()`
   * tampoco coopera, de cuatro maneras. La cancelación rechaza sin esperarla, cierra el
   * descriptor, borra el temporal y no deja rechazos sin manejar, aunque la fuente
   * rechace más tarde la espera abandonada. */
  it.each(["queda pendiente", "lanza en forma síncrona", "no devuelve una promesa", "rechaza"])(
    "cancelación con una fuente que no responde y cuyo `return()` %s",
    async (returnMode) => {
      const temporary = await createTestDirectory();
      let closes = 0;
      const context = await buildTestStorage(
        {
          randomHex128: fixedRandomHex128(KEY_E),
          // Solo el temporal de `put`: la prueba de enlace duro de la construcción abre y
          // cierra su propio archivo.
          fileOps: decorateFileOps(nodeFileOps, {
            openTempForWrite: async (path: string) => {
              const inner = await nodeFileOps.openTempForWrite(path);
              if (!path.endsWith(".part")) return inner;
              return countingCloses(inner, () => {
                closes += 1;
              });
            },
          }),
        },
        temporary,
      );
      let nextCalls = 0;
      let returnCalls = 0;
      const pending: { reject?: (error: Error) => void } = {};
      const iterator: AsyncIterator<Uint8Array> = {
        next: () => {
          nextCalls += 1;
          if (nextCalls === 1) {
            return Promise.resolve({ done: false, value: encode("primera porción") });
          }
          return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
            pending.reject = reject;
          });
        },
        return: () => {
          returnCalls += 1;
          if (returnMode === "lanza en forma síncrona") throw new Error("return() síncrono");
          if (returnMode === "no devuelve una promesa") {
            return { done: true, value: undefined } as unknown as Promise<
              IteratorResult<Uint8Array>
            >;
          }
          if (returnMode === "rechaza") return Promise.reject(new Error("return() rechazado"));
          return new Promise<IteratorResult<Uint8Array>>(() => undefined);
        },
      };
      const controller = new AbortController();
      const unhandled = await collectUnhandledRejections(async () => {
        const put = context.storage.put(
          { [Symbol.asyncIterator]: () => iterator },
          { maxBytes: 10_000, signal: controller.signal },
        );
        await waitUntil(() => nextCalls === 2, "segunda espera de la fuente");
        controller.abort();
        await expect(withTimeout(put, 2000, "put cancelado")).rejects.toMatchObject({
          name: "StorageWriteError",
          phase: "BEFORE_PUBLISH",
          failureReason: "CANCELLED",
        });
        pending.reject?.(new Error("rechazo tardío de la espera abandonada"));
      });
      expect(unhandled).toEqual([]);
      expect(returnCalls).toBe(1);
      expect(closes).toBe(1);
      expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
      expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
    },
  );

  /** `for await` acepta un `next()` que devuelve el resultado sin promesa; con señal,
   * `put` tiene que aceptarlo igual, sin un TypeError propio. */
  it("`next()` que devuelve el resultado sin promesa: con señal, put lo acepta", async () => {
    const temporary = await createTestDirectory();
    const context = await buildTestStorage({}, temporary);
    const chunks = [encode("sin "), encode("promesa")];
    let index = 0;
    const iterator = {
      next: () => {
        const value = chunks[index];
        index += 1;
        return value === undefined ? { done: true, value: undefined } : { done: false, value };
      },
    } as unknown as AsyncIterator<Uint8Array>;
    const stored = await context.storage.put(
      { [Symbol.asyncIterator]: () => iterator },
      { maxBytes: 1000, signal: new AbortController().signal },
    );
    expect(stored.sizeBytes).toBe(11);
    expect(stored.sha256).toBe(sha256Hex(encode("sin promesa")));
  });
});

describe("publicación incierta y conciliación (§8.4.1, decisión del propietario)", () => {
  const OP_P = "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f";
  const objectPathEnd = `${sep}objects${sep}${KEY_E}`;

  /** `link` de la publicación según el escenario y, después, el `lstat` de comparación
   * fallando `lstatFailures` veces (Infinity: hasta que la prueba lo cambie). La operación
   * de `put` usa OP_P y la clave KEY_E; las siguientes reciben ids distintos. */
  async function uncertainStorage(linkMode: "NOT_LINKED" | "LINKED" | "REAL") {
    const temporary = await createTestDirectory();
    const control = { lstatFailures: 0 };
    const context = await buildTestStorage(
      {
        randomHex128: sequenceHex128(OP_P, KEY_E),
        fileOps: decorateFileOps(nodeFileOps, {
          link: async (source: string, destination: string) => {
            if (!destination.endsWith(objectPathEnd)) {
              await nodeFileOps.link(source, destination);
              return;
            }
            control.lstatFailures = Math.max(control.lstatFailures, 1);
            if (linkMode === "REAL") {
              await nodeFileOps.link(source, destination);
              return;
            }
            if (linkMode === "LINKED") await nodeFileOps.link(source, destination);
            throw errorWithCode("EIO");
          },
          lstat: async (path: string) => {
            if (control.lstatFailures > 0 && path.endsWith(objectPathEnd)) {
              control.lstatFailures -= 1;
              throw errorWithCode("EIO");
            }
            return nodeFileOps.lstat(path);
          },
        }),
      },
      temporary,
    );
    return { context, control };
  }

  /** Los tres estados posibles del destino. En ninguno se informa AFTER_PUBLISH, en
   * ninguno se borra la clave a ciegas y ningún objeto anterior se toca. */
  it.each([
    {
      escenario: "destino ausente (el link no se hizo)",
      linkMode: "NOT_LINKED" as const,
      previous: false,
      expected: "NOT_PUBLISHED" as const,
    },
    {
      escenario: "destino propio (el link se hizo y después informó EIO)",
      linkMode: "LINKED" as const,
      previous: false,
      expected: "WITHDRAWN" as const,
    },
    {
      escenario: "objeto anterior y link con EIO antes de modificarlo",
      linkMode: "NOT_LINKED" as const,
      previous: true,
      expected: "KEY_HELD_BY_OTHER" as const,
    },
    {
      escenario: "objeto anterior y link real con EEXIST",
      linkMode: "REAL" as const,
      previous: true,
      expected: "KEY_HELD_BY_OTHER" as const,
    },
  ])("$escenario: UncertainPublicationError y la conciliación da $expected", async (scenario) => {
    const { context } = await uncertainStorage(scenario.linkMode);
    const objectPath = `${context.rootPath}${objectPathEnd}`;
    if (scenario.previous) {
      await writeFile(objectPath, encode("objeto anterior"), { mode: 0o600 });
    }
    const failure = await context.storage
      .put(iterable([encode("publicación incierta")]), { maxBytes: 1000 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UncertainPublicationError);
    expect(failure).toMatchObject({ name: "UncertainPublicationError", key: KEY_E });
    expect(failure).not.toBeInstanceOf(StorageWriteError);
    // La prueba se conserva: el temporal sigue y ninguna limpieza en ejecución lo toca.
    const retained = `${instanceDirectory(context)}${sep}${OP_P}.part`;
    expect(await readFile(retained, "utf8")).toBe("publicación incierta");
    await expect(context.storage.recoverWorkArea()).resolves.toMatchObject({
      ownLeftoverEntries: 0,
    });
    expect(await readFile(retained, "utf8")).toBe("publicación incierta");
    // Seguir el procedimiento equivocado (borrar la clave) no está permitido.
    await expect(context.storage.delete(KEY_E)).rejects.toBeInstanceOf(UncertainPublicationError);
    if (scenario.previous) expect(await readFile(objectPath, "utf8")).toBe("objeto anterior");

    await expect(context.storage.resolveUncertainPublication(KEY_E)).resolves.toBe(
      scenario.expected,
    );
    if (scenario.previous) {
      expect(await readFile(objectPath, "utf8")).toBe("objeto anterior");
    } else {
      await expect(lstat(objectPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
    await expect(context.storage.resolveUncertainPublication(KEY_E)).resolves.toBe("NOT_RETAINED");
    if (scenario.previous) {
      // Ya conciliada, la clave es del objeto anterior y su borrado vuelve a ser normal.
      await expect(context.storage.delete(KEY_E)).resolves.toBe("DELETED");
    }
  });

  it("si la comparación sigue fallando, la conciliación sigue incierta y conserva todo", async () => {
    const { context, control } = await uncertainStorage("LINKED");
    await expect(
      context.storage.put(iterable([encode("incierta")]), { maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(UncertainPublicationError);
    control.lstatFailures = Number.POSITIVE_INFINITY;
    await expect(context.storage.resolveUncertainPublication(KEY_E)).rejects.toBeInstanceOf(
      UncertainPublicationError,
    );
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([KEY_E]);
    expect(await listNames(instanceDirectory(context))).toEqual([`${OP_P}.part`, "instance.json"]);
    control.lstatFailures = 0;
    await expect(context.storage.resolveUncertainPublication(KEY_E)).resolves.toBe("WITHDRAWN");
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
  });

  it("la prueba perdida (el temporal retenido ya no está): sigue incierta y no retira nada", async () => {
    const { context } = await uncertainStorage("LINKED");
    await expect(
      context.storage.put(iterable([encode("incierta")]), { maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(UncertainPublicationError);
    await rm(`${instanceDirectory(context)}${sep}${OP_P}.part`);
    await expect(context.storage.resolveUncertainPublication(KEY_E)).rejects.toBeInstanceOf(
      UncertainPublicationError,
    );
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([KEY_E]);
    await expect(context.storage.delete(KEY_E)).rejects.toBeInstanceOf(UncertainPublicationError);
  });

  it("dos conciliaciones concurrentes de la misma clave comparten el resultado", async () => {
    const { context } = await uncertainStorage("LINKED");
    await expect(
      context.storage.put(iterable([encode("incierta")]), { maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(UncertainPublicationError);
    const results = await Promise.all([
      context.storage.resolveUncertainPublication(KEY_E),
      context.storage.resolveUncertainPublication(KEY_E),
    ]);
    expect(results).toEqual(["WITHDRAWN", "WITHDRAWN"]);
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
  });

  it("el cierre con una publicación incierta pendiente conserva la prueba y el directorio", async () => {
    const { context } = await uncertainStorage("LINKED");
    await expect(
      context.storage.put(iterable([encode("incierta")]), { maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(UncertainPublicationError);
    await expect(context.storage.close()).resolves.toEqual({
      ownLeftoverEntries: 0,
      reclaimEntriesRemoved: 0,
      retainedEntries: 1,
    });
    expect(await listNames(instanceDirectory(context))).toEqual([`${OP_P}.part`, "instance.json"]);
    // El enlace se hizo: el objeto y la prueba comparten inodo (lo que usará el
    // mantenimiento de §7.3 para decidir).
    const objectStat = await lstat(`${context.rootPath}${objectPathEnd}`);
    const proofStat = await lstat(`${instanceDirectory(context)}${sep}${OP_P}.part`);
    expect([objectStat.ino, objectStat.nlink]).toEqual([proofStat.ino, 2]);
  });
});

describe("propiedad de temporales y registro de operaciones (§7.1 y §8.3)", () => {
  it("un `<op>.part` preexistente: put falla sin modificarlo ni borrarlo", async () => {
    const temporary = await createTestDirectory();
    const context = await buildTestStorage({ randomHex128: sequenceHex128(KEY_E) }, temporary);
    const preexisting = `${instanceDirectory(context)}${sep}${KEY_E}.part`;
    await writeFile(preexisting, encode("preexistente"), { mode: 0o600 });
    const before = await lstat(preexisting);
    const failure = await context.storage
      .put(iterable([encode("nuevo")]), { maxBytes: 1000 })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "StorageWriteError", phase: "BEFORE_PUBLISH" });
    expect((failure as Error).cause).toMatchObject({ code: "EEXIST" });
    const after = await lstat(preexisting);
    expect([after.ino, after.size]).toEqual([before.ino, before.size]);
    expect(await readFile(preexisting, "utf8")).toBe("preexistente");
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
  });

  /** Dos put con el mismo id (generador defectuoso): el segundo no se admite y no toca ni
   * el temporal ni el registro del primero, que la limpieza propia sigue protegiendo. */
  it("una colisión de id con un put activo: el segundo falla y el primero publica intacto", async () => {
    const temporary = await createTestDirectory();
    const gate = createGate();
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(KEY_E),
        fileOps: decorateFileOps(nodeFileOps, {
          openTempForWrite: async (path: string) => {
            const inner = await nodeFileOps.openTempForWrite(path);
            return path.endsWith(".part") ? writePausedOnGate(inner, gate) : inner;
          },
        }),
      },
      temporary,
    );
    const first = context.storage.put(iterable([encode("primero")]), { maxBytes: 1000 });
    const temporaryOfFirst = `${instanceDirectory(context)}${sep}${KEY_E}.part`;
    await waitForPart(context, `${KEY_E}.part`);
    const second = await context.storage
      .put(iterable([encode("segundo")]), { maxBytes: 1000 })
      .catch((error: unknown) => error);
    expect(second).toMatchObject({ name: "StorageWriteError", phase: "BEFORE_PUBLISH" });
    expect((second as Error).cause).toMatchObject({ name: "OperationIdInUseError" });
    expect((await lstat(temporaryOfFirst)).isFile()).toBe(true);
    await expect(context.storage.recoverWorkArea()).resolves.toMatchObject({
      ownLeftoverEntries: 0,
    });
    expect((await lstat(temporaryOfFirst)).isFile()).toBe(true);
    gate.open();
    const stored = await first;
    expect(stored.sha256).toBe(sha256Hex(encode("primero")));
    expect(await readFile(`${context.rootPath}${sep}objects${sep}${stored.key}`, "utf8")).toBe(
      "primero",
    );
  });

  it("un `del-<op>/` preexistente: delete falla con BEFORE_REMOVE sin tocarlo y el objeto sigue", async () => {
    const temporary = await createTestDirectory();
    const OP_D = "0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d";
    const context = await buildTestStorage(
      { randomHex128: sequenceHex128(KEY_E, KEY_E, OP_D) },
      temporary,
    );
    await context.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    const preexisting = `${instanceDirectory(context)}${sep}del-${OP_D}`;
    await mkdir(preexisting, { mode: 0o700 });
    await writeFile(`${preexisting}${sep}contenido`, encode("ajeno"), { mode: 0o600 });
    await expect(context.storage.delete(KEY_E)).rejects.toMatchObject({
      name: "StorageWriteError",
      phase: "BEFORE_REMOVE",
      key: KEY_E,
    });
    expect(await readFile(`${preexisting}${sep}contenido`, "utf8")).toBe("ajeno");
    expect(await listAll(context.storage)).toEqual([KEY_E]);
  });

  /** El destino privado de un retiro en curso es de esa operación: la limpieza propia no
   * lo toca mientras está activa. */
  it("la limpieza en ejecución no toca el destino privado de un delete activo", async () => {
    const temporary = await createTestDirectory();
    const OP_D = "0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d";
    const afterWithdrawal = createGate();
    const reachedFsync = createGate();
    // Pausa el `fsync` de objects/ del delete: el objeto ya está en su destino privado.
    const control = { pauseNextObjectsFsync: false };
    const context = await buildTestStorage(
      {
        randomHex128: sequenceHex128(KEY_E, KEY_E, OP_D),
        fileOps: decorateFileOps(nodeFileOps, {
          fsyncDir: async (path: string) => {
            if (control.pauseNextObjectsFsync && path.endsWith(`${sep}objects`)) {
              control.pauseNextObjectsFsync = false;
              reachedFsync.open();
              await afterWithdrawal.promise;
            }
            await nodeFileOps.fsyncDir(path);
          },
        }),
      },
      temporary,
    );
    await context.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    control.pauseNextObjectsFsync = true;
    const deletion = context.storage.delete(KEY_E);
    await reachedFsync.promise;
    const privateDirectory = `${instanceDirectory(context)}${sep}del-${OP_D}`;
    expect(await listNames(privateDirectory)).toEqual([KEY_E]);
    await expect(context.storage.recoverWorkArea()).resolves.toMatchObject({
      ownLeftoverEntries: 0,
    });
    expect(await listNames(privateDirectory)).toEqual([KEY_E]);
    afterWithdrawal.open();
    await expect(deletion).resolves.toBe("DELETED");
    expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
  });
});

describe("errores del sistema que no son ausencia (§8.5, revisión de la entrega)", () => {
  const objectPathEnd = `${sep}objects${sep}${KEY_E}`;

  it("`delete` con EIO en el `lstat` del objeto: BEFORE_REMOVE con clave y el objeto presente", async () => {
    const temporary = await createTestDirectory();
    let failObjectLstat = false;
    const injected = errorWithCode("EIO_INYECTADO");
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(KEY_E),
        fileOps: decorateFileOps(nodeFileOps, {
          lstat: async (path: string) => {
            if (failObjectLstat && path.endsWith(objectPathEnd)) throw injected;
            return nodeFileOps.lstat(path);
          },
        }),
      },
      temporary,
    );
    await context.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    failObjectLstat = true;
    const failure = await context.storage.delete(KEY_E).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "StorageWriteError",
      phase: "BEFORE_REMOVE",
      key: KEY_E,
    });
    expect((failure as Error).cause).toBe(injected);
    failObjectLstat = false;
    expect(await listAll(context.storage)).toEqual([KEY_E]);
  });

  it("`open` con un error del sistema al abrir (EMFILE): se propaga, no es TARGET_TYPE", async () => {
    const temporary = await createTestDirectory();
    const injected = errorWithCode("EMFILE");
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(KEY_E),
        fileOps: decorateFileOps(nodeFileOps, {
          openObjectForRead: () => Promise.reject(injected),
        }),
      },
      temporary,
    );
    await context.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    await expect(context.storage.open(KEY_E)).rejects.toBe(injected);
  });

  it("`listObjects` con EACCES en el `lstat` de una entrada: se propaga, no la saltea", async () => {
    const temporary = await createTestDirectory();
    let failObjectLstat = false;
    const injected = errorWithCode("EACCES");
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(KEY_E),
        fileOps: decorateFileOps(nodeFileOps, {
          lstat: async (path: string) => {
            if (failObjectLstat && path.endsWith(objectPathEnd)) throw injected;
            return nodeFileOps.lstat(path);
          },
        }),
      },
      temporary,
    );
    await context.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    failObjectLstat = true;
    await expect(listAll(context.storage)).rejects.toBe(injected);
  });
});

/** Delegación explícita con conteo de cierres (el spread perdería el `this` real). */
function countingCloses(inner: FileOpsHandle, onClose: () => void): FileOpsHandle {
  return {
    write: (buffer: Uint8Array) => inner.write(buffer),
    readInto: (buffer: Uint8Array, position: number) => inner.readInto(buffer, position),
    fstat: () => inner.fstat(),
    fchmod: (mode: number) => inner.fchmod(mode),
    fsync: () => inner.fsync(),
    close: async () => {
      onClose();
      await inner.close();
    },
  };
}

async function waitUntil(condition: () => boolean, label: string): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > 5000) throw new Error(`No se cumplió: ${label}`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2);
    });
  }
}

/** Envuelve cada manija nueva: `write` según el modo, quizá corrupto a propósito. */
function writesAtMost2Bytes(mode: "partial2" | "zero" | "invalid" | "errorAfterFirst") {
  return {
    openTempForWrite: async (path: string) => {
      const inner = await nodeFileOps.openTempForWrite(path);
      if (path.endsWith(`${sep}instance.json`)) return inner;
      let calls = 0;
      return {
        write: async (buffer: Uint8Array) => {
          calls += 1;
          if (mode === "zero") return 0;
          if (mode === "invalid") return buffer.byteLength + 99;
          if (mode === "errorAfterFirst") {
            if (calls === 1) return Math.min(2, buffer.byteLength);
            await Promise.reject(errorWithCode("EIO_SECUENCIA"));
            return 0;
          }
          const slice = buffer.subarray(0, Math.min(2, buffer.byteLength));
          return inner.write(slice);
        },
        readInto: (buffer: Uint8Array, position: number) => inner.readInto(buffer, position),
        fstat: () => inner.fstat(),
        fchmod: (m: number) => inner.fchmod(m),
        fsync: () => inner.fsync(),
        close: () => inner.close(),
      };
    },
  };
}

/** Espera a que el archivo exista y sea regular (la operación quedó en su etapa esperada). */
async function waitForPart(context: TestStorageContext, name: string): Promise<void> {
  const path = `${instanceDirectory(context)}${sep}${name}`;
  const startedAt = Date.now();
  for (;;) {
    if ((await lstatOrNull(path))?.isFile()) return;
    if (Date.now() - startedAt > 5000) throw new Error(`La porción no apareció: ${path}`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

async function lstatOrNull(path: string): Promise<{ isFile(): boolean } | null> {
  try {
    const stat = await lstat(path);
    return { isFile: () => stat.isFile() };
  } catch {
    return null;
  }
}
