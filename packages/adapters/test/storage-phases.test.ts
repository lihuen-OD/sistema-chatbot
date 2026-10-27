// Fases de escritura con inyecciones de FileOps (plan §8.4, §13): cada inyección hace
// fallar o detiene un paso concreto sobre archivos reales, y se comprueba el resultado
// y el estado en disco que §8.4 fija para esa fase.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { lstat, readFile, symlink, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import type {
  InternalStorageOptions,
  StorageMaintenanceEvent,
} from "../src/local/private-folder-storage.js";
import { LocalPrivateFolderStorage } from "../src/local/private-folder-storage.js";
import { nodeFileOps, type FileOps, type FileOpsHandle } from "../src/local/file-ops.js";
import {
  buildTestStorage,
  collect,
  collectUnhandledRejections,
  createTestDirectory,
  decorateFileOps,
  encode,
  fixedRandomHex128,
  installTestAppEnv,
  listNames,
  removeDirectory,
  sha256Hex,
  withTimeout,
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

describe("borrados concurrentes por inyección (§8.5)", () => {
  /** Traducción del adaptador, sin depender del sistema de archivos: cuando la segunda
   * llamada a `unlink` ve ENOENT, los dos borrados dan `DELETED` + `ALREADY_ABSENT`.
   * El par con `unlink` reales está en storage.test.ts (en APFS no se cumple: decisión
   * pendiente, registrada en el README y en PROJECT_STATUS). */
  it("par exacto DELETED y ALREADY_ABSENT cuando la segunda llamada ve ENOENT", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const first = await buildTestStorage({ randomHex128: fixedRandomHex128(KEY_E) }, temporary);
    await first.storage.put(iterable([encode("objeto")]), { maxBytes: 1000 });
    let unlinkCalls = 0;
    const vistoDosVeces = await rebuild(first, {
      unlink: async (path: string) => {
        unlinkCalls += 1;
        if (unlinkCalls > 1)
          await Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
        await nodeFileOps.unlink(path);
      },
    });
    const results = await Promise.all([
      vistoDosVeces.storage.delete(KEY_E),
      vistoDosVeces.storage.delete(KEY_E),
    ]);
    expect(results.sort()).toEqual(["ALREADY_ABSENT", "DELETED"]);
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

describe("errores del sistema que no son ausencia (§8.4 y §8.5, revisión de la entrega)", () => {
  const objectPathEnd = `${sep}objects${sep}${KEY_E}`;

  /** `link` falla con un error que no es EEXIST y el `lstat` de reconciliación falla con
   * EIO: no se puede saber si el enlace se creó. No se informa como destino ausente: la
   * clave sale en AFTER_PUBLISH con LEFT_IN_PLACE para que el host la borre (delete es
   * repetible). Dos versiones: el enlace sí se había creado, o no. */
  it.each([true, false])(
    "`link` con otro error y `lstat` del destino con EIO (enlace creado: %s): AFTER_PUBLISH con clave",
    async (linkTookEffect) => {
      const temporary = await createTestDirectory();
      let failDestinationLstat = false;
      const context = await buildTestStorage(
        {
          randomHex128: fixedRandomHex128(KEY_E),
          fileOps: decorateFileOps(nodeFileOps, {
            link: async (source: string, destination: string) => {
              if (!destination.endsWith(objectPathEnd)) {
                await nodeFileOps.link(source, destination);
                return;
              }
              if (linkTookEffect) await nodeFileOps.link(source, destination);
              failDestinationLstat = true;
              throw errorWithCode("EBUSY_INYECTADO");
            },
            lstat: async (path: string) => {
              if (failDestinationLstat && path.endsWith(objectPathEnd)) {
                failDestinationLstat = false;
                throw errorWithCode("EIO_INYECTADO");
              }
              return nodeFileOps.lstat(path);
            },
          }),
        },
        temporary,
      );
      await expect(
        context.storage.put(iterable([encode("estado no verificable")]), { maxBytes: 1000 }),
      ).rejects.toMatchObject({
        name: "StorageWriteError",
        phase: "AFTER_PUBLISH",
        key: KEY_E,
        objectState: "LEFT_IN_PLACE",
      });
      expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual(
        linkTookEffect ? [KEY_E] : [],
      );
      expect(await listNames(instanceDirectory(context))).toEqual(["instance.json"]);
      // Lo que el host hace con la clave informada: borrarla, haya quedado o no.
      await expect(context.storage.delete(KEY_E)).resolves.toBe(
        linkTookEffect ? "DELETED" : "ALREADY_ABSENT",
      );
    },
  );

  it("`link` con EEXIST y `lstat` del destino con EIO: KEY_COLLISION y el ajeno intacto", async () => {
    const temporary = await createTestDirectory();
    let failDestinationLstat = false;
    const context = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(KEY_E),
        fileOps: decorateFileOps(nodeFileOps, {
          link: async (source: string, destination: string) => {
            if (destination.endsWith(objectPathEnd)) failDestinationLstat = true;
            await nodeFileOps.link(source, destination);
          },
          lstat: async (path: string) => {
            if (failDestinationLstat && path.endsWith(objectPathEnd)) {
              failDestinationLstat = false;
              throw errorWithCode("EIO_INYECTADO");
            }
            return nodeFileOps.lstat(path);
          },
        }),
      },
      temporary,
    );
    const foreignPath = `${context.rootPath}${objectPathEnd}`;
    await writeFile(foreignPath, encode("ajeno"), { mode: 0o600 });
    await expect(
      context.storage.put(iterable([encode("nuevo")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "KEY_COLLISION" });
    expect(await readFile(foreignPath, "utf8")).toBe("ajeno");
  });

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
