// Ida y vuelta del almacenamiento local (plan §8, §13): archivos reales en mkdtemp.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import {
  EmptyObjectError,
  InvalidObjectKeyError,
  ObjectNotFoundError,
  StorageWriteError,
} from "../src/ports/storage.js";
import {
  buildTestStorage,
  chunked,
  collect,
  createTestDirectory,
  encode,
  fixedRandomHex128,
  installTestAppEnv,
  listNames,
  removeDirectory,
  sha256Hex,
} from "./support.js";
import { LocalPrivateFolderStorage } from "../src/local/private-folder-storage.js";
import { nodeFileOps } from "../src/local/file-ops.js";

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

const FIXTURE = new Uint8Array(
  Buffer.concat([
    Buffer.from("primera fila con acentos é ñ\r\nsegunda fila\n", "utf8"),
    Buffer.alloc(250_000, 7),
  ]),
);

/** Directorio de la instancia privada `tmp/<instancia>`; falla si falta. */
async function instanceDirectory(rootPath: string): Promise<string> {
  const entries = await listNames(`${rootPath}${sep}tmp`);
  const name = entries[0];
  if (name === undefined) throw new Error("El área de trabajo no se registró en tmp/.");
  return `${rootPath}${sep}tmp${sep}${name}`;
}

async function listAll(
  storage: LocalPrivateFolderStorage,
): Promise<{ key: string; sizeBytes: number }[]> {
  const all: { key: string; sizeBytes: number }[] = [];
  for await (const entry of storage.listObjects()) {
    all.push(entry);
  }
  return all;
}

describe("ida y vuelta del almacenamiento (plan §8)", () => {
  it("put, open y delete conservan bytes, tamaño y SHA-256; listObjects y repetibilidad", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    const stored = await storage.put(chunked(FIXTURE, 17_333), { maxBytes: 1_048_576 });
    expect(stored.key).toMatch(/^[0-9a-f]{32}$/);
    expect(stored.sizeBytes).toBe(FIXTURE.length);
    expect(stored.sha256).toBe(sha256Hex(FIXTURE));

    const read = await storage.open(stored.key);
    expect(read.sizeBytes).toBe(FIXTURE.length);
    expect(await collect(read.stream)).toEqual(FIXTURE);

    await expect(storage.delete(stored.key)).resolves.toBe("DELETED");
    await expect(storage.open(stored.key)).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(storage.delete(stored.key)).resolves.toBe("ALREADY_ABSENT");
    expect(await listAll(storage)).toEqual([]);
    expect(await listNames(await instanceDirectory(rootPath))).toEqual(["instance.json"]);
  });

  it("las interrupciones del recorrido cierran el descriptor: break y throw (§8.5)", async () => {
    const { storage } = await buildTestStorage();
    const stored = await storage.put(iterable([FIXTURE]), { maxBytes: 500_000 });
    const opened = await storage.open(stored.key);
    for await (const chunk of opened.stream) {
      if (chunk.length > 0) break;
    }
    const opened2 = await storage.open(stored.key);
    await expect(async () => {
      for await (const chunk of opened2.stream) {
        if (chunk.length > 0) throw new Error("interrupción de prueba");
      }
    }).rejects.toThrow("interrupción de prueba");
    const opened3 = await storage.open(stored.key);
    expect(await collect(opened3.stream)).toEqual(FIXTURE);
  });

  it("un objeto en curso sigue legible si la entrada la reemplaza el mismo usuario (limitación §6.6)", async () => {
    const key = "0123456789abcdef0123456789abcdef";
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const { rootPath, storage } = await buildTestStorage(
      { randomHex128: fixedRandomHex128(key) },
      temporary,
    );
    await storage.put(iterable([encode("primera versión")]), { maxBytes: 1000 });
    const read = await storage.open(key);
    const objectPath = `${rootPath}${sep}objects${sep}${key}`;
    await rm(objectPath);
    await writeFile(objectPath, encode("segunda versión"), { mode: 0o600 });
    expect(await collect(read.stream)).toEqual(encode("primera versión"));
  });

  it("límites: el exacto pasa, cada exceso se rechaza, el vacío se rechaza (§8.3)", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    await expect(
      storage.put(iterable([Buffer.alloc(4097, 3)]), { maxBytes: 4096 }),
    ).rejects.toMatchObject({
      name: "ObjectTooLargeError",
      limitBytes: 4096,
      receivedBytes: 4097,
    });
    await expect(
      storage.put(iterable([Buffer.alloc(4096, 1)]), { maxBytes: 4096 }),
    ).resolves.toMatchObject({
      sizeBytes: 4096,
    });
    await expect(storage.put(iterable([encode("a")]), { maxBytes: 1 })).resolves.toMatchObject({
      sizeBytes: 1,
    });
    await expect(storage.put(iterable([]), { maxBytes: 100 })).rejects.toBeInstanceOf(
      EmptyObjectError,
    );
    expect((await lstat(`${rootPath}${sep}objects`)).mode & 0o7777).toBe(0o700);
    expect((await listAll(storage)).length).toBe(2);
  });

  it("al superar el límite la fuente deja de entregar trozos", async () => {
    const { storage } = await buildTestStorage();
    let delivered = 0;
    async function* source(): AsyncIterableIterator<Uint8Array> {
      while (delivered < 10) {
        delivered += 1;
        await Promise.resolve();
        yield new Uint8Array(1000);
      }
    }
    await expect(storage.put(source(), { maxBytes: 2000 })).rejects.toMatchObject({
      name: "ObjectTooLargeError",
      limitBytes: 2000,
      receivedBytes: 3000,
    });
    expect(delivered).toBe(3);
    expect(await listAll(storage)).toEqual([]);
  });

  it("el máximo configurado acota pedidos mayores y se escala por construcción (§8.3)", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const { storage } = await buildTestStorage({ maxFileBytes: 4096 }, temporary);
    await expect(
      storage.put(iterable([Buffer.alloc(4097, 1)]), { maxBytes: Number.MAX_SAFE_INTEGER }),
    ).rejects.toMatchObject({ limitBytes: 4096, receivedBytes: 4097 });
  });

  it("parámetros inválidos se rechazan sin escribir ni crear temporales (§8.3)", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    for (const badLimit of [0, -1, -500, 1.5, Number.NaN]) {
      await expect(
        storage.put(iterable([encode("a")]), { maxBytes: badLimit }),
      ).rejects.toBeInstanceOf(TypeError);
    }
    for (const badKey of [
      "",
      "../traversal",
      "/objects/abc",
      "%2e%2e%2f",
      "con\0nulo",
      " ABCDEF0123456789ABCDEF0123456789",
      "abcdef0123456789abcdef0123456789abcdef0",
      "abc",
      "con áccentos y espacios ",
    ]) {
      await expect(storage.open(badKey)).rejects.toBeInstanceOf(InvalidObjectKeyError);
      await expect(storage.delete(badKey)).rejects.toBeInstanceOf(InvalidObjectKeyError);
    }
    expect(await listNames(`${rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(await instanceDirectory(rootPath))).toEqual(["instance.json"]);
  });

  it("con umask indulgente, el objeto queda exactamente 0600 y la instancia 0700 (§6.4)", async () => {
    const previousUmask = process.umask(0o000);
    try {
      const { storage, rootPath } = await buildTestStorage();
      leftovers.push(rootPath);
      const stored = await storage.put(iterable([encode("contenido con umask indulgente")]), {
        maxBytes: 1000,
      });
      expect((await lstat(`${rootPath}${sep}objects${sep}${stored.key}`)).mode & 0o7777).toBe(
        0o600,
      );
      expect((await lstat(`${rootPath}${sep}tmp${sep}${storage.instanceId}`)).mode & 0o7777).toBe(
        0o700,
      );
    } finally {
      process.umask(previousUmask);
    }
  });

  it("enlaces plantados con formato de clave: put conserva el ajeno; open y delete los rechazan (§8.5)", async () => {
    const key = "0123456789abcdef0123456789abcdef";
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const { rootPath, storage } = await buildTestStorage(
      { randomHex128: fixedRandomHex128(key) },
      temporary,
    );
    const objectsPath = `${rootPath}${sep}objects`;
    const foreign = `${rootPath}${sep}ajeno.bin`;
    await writeFile(foreign, encode("ajeno"), { mode: 0o600 });
    await symlink(foreign, `${objectsPath}${sep}${key}`);

    await expect(
      storage.put(iterable([encode("nuevo")]), { maxBytes: 1000 }),
    ).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "KEY_COLLISION",
    });
    expect((await lstat(`${objectsPath}${sep}${key}`)).isSymbolicLink()).toBe(true);

    await expect(storage.open(key)).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "TARGET_SYMLINK",
    });
    await expect(storage.delete(key)).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "TARGET_SYMLINK",
    });
    expect((await lstat(`${objectsPath}${sep}${key}`)).isSymbolicLink()).toBe(true);

    await unlink(`${objectsPath}${sep}${key}`);
    await expect(
      storage.put(iterable([encode("nuevo")]), { maxBytes: 1000 }),
    ).resolves.toMatchObject({ key });
  });

  it("un directorio con formato de clave: listObjects lo excluye y delete marca TARGET_TYPE (§8.5)", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    const stored = await storage.put(iterable([encode("objeto real")]), { maxBytes: 1000 });
    await mkdir(`${rootPath}${sep}objects${sep}${"b".repeat(32)}`, { mode: 0o700 });
    await expect(storage.delete("b".repeat(32))).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "TARGET_TYPE",
    });
    expect(await listAll(storage)).toEqual([{ key: stored.key, sizeBytes: "objeto real".length }]);
  });

  it("listObjects salta entradas que no son claves u objetos del propio usuario (§8.1)", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    const stored = await storage.put(iterable([encode("a")]), { maxBytes: 1000 });
    await writeFile(`${rootPath}${sep}objects${sep}no-es-clave`, encode("x"), { mode: 0o600 });
    await mkdir(`${rootPath}${sep}objects${sep}${"a".repeat(32)}`, { mode: 0o700 });
    expect(await listAll(storage)).toEqual([{ key: stored.key, sizeBytes: 1 }]);
  });

  it("50 put en paralelo: claves todas distintas, tamaños y SHA-256 conforme al contenido", async () => {
    const { storage } = await buildTestStorage();
    const payloads = Array.from({ length: 50 }, (_, index) => Buffer.alloc(1000 + index, index));
    const results = await Promise.all(
      payloads.map((payload) => storage.put(iterable([payload]), { maxBytes: 100_000 })),
    );
    const keys = new Set(results.map((result) => result.key));
    expect(keys.size).toBe(50);
    for (const [index, result] of results.entries()) {
      expect(result.sizeBytes).toBe(payloads[index]?.length ?? -1);
      expect(result.sha256).toBe(sha256Hex(payloads[index] ?? Buffer.alloc(0)));
    }
  });

  it("dos borrados concurrentes dan un DELETED y un ALREADY_ABSENT, en 100 rondas con `unlink` reales (§8.5)", async () => {
    // Contrato del plan §8.5, sin debilitar. Medido el 27/10/2026 en macOS 27.0.1 (APFS):
    // dos `unlink` concurrentes del mismo nombre devuelven éxito los dos en la gran
    // mayoría de los pares, así que esta prueba falla en macOS. La decisión de diseño
    // está pendiente del propietario (README, PROJECT_STATUS). Las 100 rondas hacen que
    // el resultado no dependa de una intercalación afortunada en ninguna plataforma.
    const { storage } = await buildTestStorage();
    const tally: Record<string, number> = {};
    for (let round = 0; round < 100; round += 1) {
      const stored = await storage.put(iterable([encode(`ronda ${String(round)}`)]), {
        maxBytes: 1000,
      });
      const results = await Promise.all([storage.delete(stored.key), storage.delete(stored.key)]);
      const pair = [...results].sort().join("+");
      tally[pair] = (tally[pair] ?? 0) + 1;
      await expect(storage.delete(stored.key)).resolves.toBe("ALREADY_ABSENT");
    }
    expect(tally).toEqual({ "ALREADY_ABSENT+DELETED": 100 });
  });

  it("listObjects en orden determinista y con tamaños reales (§8.1)", async () => {
    const { storage } = await buildTestStorage();
    const one = await storage.put(iterable([encode("a")]), { maxBytes: 1000 });
    const two = await storage.put(iterable([encode("bb")]), { maxBytes: 1000 });
    const keys = (await listAll(storage)).map((entry) => entry.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain(one.key);
    expect(keys).toContain(two.key);
  });

  it("publicación normal: objeto visible, temporal borrado y sin residuos (§8.4)", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    await expect(
      storage.put(iterable([encode("nuevo")]), { maxBytes: 1000 }),
    ).resolves.toMatchObject({
      key: /^[0-9a-f]{32}$/,
    });
    expect(await listNames(`${rootPath}${sep}objects`)).toHaveLength(1);
    expect(await listNames(await instanceDirectory(rootPath))).toEqual(["instance.json"]);
  });
});

describe("fases de escritura con archivos reales (§8.4)", () => {
  it("fallo del flujo a mitad de la copia: BEFORE_PUBLISH con causa, objetos sin escribir y temporal borrado", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    async function* stream(): AsyncIterableIterator<Uint8Array> {
      await Promise.resolve();
      yield encode("primera porción");
      throw new Error("fallo inyectado del flujo");
    }
    const failure = await storage.put(stream(), { maxBytes: 1000 }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(StorageWriteError);
    expect(failure instanceof StorageWriteError && failure.phase).toBe("BEFORE_PUBLISH");
    expect(failure instanceof StorageWriteError && (failure.cause as Error).message).toBe(
      "fallo inyectado del flujo",
    );
    expect(await listNames(`${rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(await instanceDirectory(rootPath))).toEqual(["instance.json"]);
  });

  it("objeto vacío: rechazo sin destino y sin temporal", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    await expect(storage.put(iterable([]), { maxBytes: 1000 })).rejects.toBeInstanceOf(
      EmptyObjectError,
    );
    expect(await listNames(`${rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(await instanceDirectory(rootPath))).toEqual(["instance.json"]);
  });

  it("cancelación durante la copia: BEFORE_PUBLISH con CANCELLED y sin rastro de objeto ni temporal", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    const controller = new AbortController();
    async function* stream(): AsyncIterableIterator<Uint8Array> {
      yield encode("porción inicial");
      controller.abort();
      const step = new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
      await step;
      throw new Error("el generador no debía seguir: la cancelación ganó la carrera");
    }
    await expect(
      storage.put(stream(), { maxBytes: 1000, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "StorageWriteError",
      phase: "BEFORE_PUBLISH",
      failureReason: "CANCELLED",
    });
    expect(controller.signal.aborted).toBe(true);
    expect(await listNames(`${rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(await instanceDirectory(rootPath))).toEqual(["instance.json"]);
  });

  it("señal ya abortada al empezar: rechazo inmediato con CANCELLED, sin leer nada", async () => {
    const { storage, rootPath } = await buildTestStorage();
    leftovers.push(rootPath);
    const controller = new AbortController();
    controller.abort();
    await expect(
      storage.put(iterable([encode("nunca se lee")]), {
        maxBytes: 1000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ failureReason: "CANCELLED" });
    expect(await listNames(`${rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(await instanceDirectory(rootPath))).toEqual(["instance.json"]);
  });

  it("cancelación tras el link se ignora: put resuelve y el objeto queda (§8.3)", async () => {
    const key = "0123456789abcdef0123456789abcdef";
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const controller = new AbortController();
    const conforme = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128(key),
        fileOps: {
          ...nodeFileOps,
          link: async (source: string, destination: string) => {
            // El aborto llega con el enlace de publicación; la prueba de compatibilidad
            // de enlaces duros de la construcción (§6.4) no lo activa.
            if (!destination.includes(`${sep}objects${sep}`)) {
              await nodeFileOps.link(source, destination);
              return;
            }
            await nodeFileOps.link(source, destination);
            controller.abort();
          },
        },
      },
      temporary,
    );
    const stored = await conforme.storage.put(iterable([encode("publicado")]), {
      maxBytes: 1000,
      signal: controller.signal,
    });
    expect(stored.key).toBe(key);
    expect((await listAll(conforme.storage)).map((entry) => entry.key)).toEqual([key]);
  });
});
