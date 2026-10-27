// Guardas de entorno y configuración (plan §5, §13): APP_ENV definido e igual al recibido,
// también en lo diferido; un maxFileBytes inválido no construye el adaptador (TypeError).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdapterEnvironmentError } from "../src/environment.js";
import { createTestDirectory, installTestAppEnv, removeDirectory } from "./support.js";

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

async function expectEnvironmentMismatch(
  run: (
    storage: import("../src/local/private-folder-storage.js").LocalPrivateFolderStorage,
  ) => Promise<unknown>,
): Promise<void> {
  const { buildTestStorage } = await import("./support.js");
  const temporary = await createTestDirectory();
  leftovers.push(temporary);
  const context = await buildTestStorage({}, temporary);
  const previous = process.env["APP_ENV"];
  process.env["APP_ENV"] = "production";
  try {
    await expect(run(context.storage)).rejects.toMatchObject({
      name: "AdapterEnvironmentError",
      reason: "PROCESS_APP_ENV_MISMATCH",
    });
  } finally {
    if (previous === undefined) delete process.env["APP_ENV"];
    else process.env["APP_ENV"] = previous;
  }
}

describe("guardas de entorno y configuración (plan §5)", () => {
  it("APP_ENV tras construirse concreto: todas las operaciones rechazan PROCESS_APP_ENV_MISMATCH", async () => {
    await expectEnvironmentMismatch(async (storage) => {
      const source = (async function* source(): AsyncIterableIterator<Uint8Array> {
        await Promise.resolve();
        yield new Uint8Array([104, 111, 108]);
      })();
      return storage.put(source, { maxBytes: 100 });
    });
    await expectEnvironmentMismatch((storage) => storage.open("0102030405060708090a0b0c0d0e0f10"));
    await expectEnvironmentMismatch((storage) =>
      storage.delete("0102030405060708090a0b0c0d0e0f10"),
    );
    await expectEnvironmentMismatch(async (storage) => {
      for await (const entry of storage.listObjects()) {
        if (entry.key === "") throw new Error("no ocurrió");
      }
    });
    await expectEnvironmentMismatch((storage) => storage.recoverWorkArea());
    await expectEnvironmentMismatch((storage) => storage.close());
  });

  it("APP_ENV sin definir: la construcción de un nuevo adaptador rechaza (§5)", async () => {
    const previous = process.env["APP_ENV"];
    delete process.env["APP_ENV"];
    try {
      const { LocalPrivateFolderStorage } = await import("../src/local/private-folder-storage.js");
      const temporary = await createTestDirectory();
      leftovers.push(temporary);
      await expect(
        LocalPrivateFolderStorage.build({
          appEnv: "test",
          rootPath: `${temporary}/raiz`,
        }),
      ).rejects.toMatchObject({
        name: "AdapterEnvironmentError",
        reason: "PROCESS_APP_ENV_MISSING",
      });
    } finally {
      if (previous === undefined) delete process.env["APP_ENV"];
      else process.env["APP_ENV"] = previous;
    }
  });

  it("maxFileBytes inválida no construye el adaptador: TypeError en la construcción", async () => {
    const { LocalPrivateFolderStorage } = await import("../src/local/private-folder-storage.js");
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    for (const badLimit of [0, -1, -100, 1.5, Number.NaN, 10_485_761, Number.MAX_SAFE_INTEGER]) {
      await expect(
        LocalPrivateFolderStorage.build({
          appEnv: "test",
          rootPath: `${temporary}/raiz-${String(badLimit)}`,
          maxFileBytes: badLimit,
        }),
      ).rejects.toBeInstanceOf(TypeError);
    }
  });

  it("el catálogo de la guardia expone el código sin valor de entorno en el mensaje", () => {
    const error = new AdapterEnvironmentError("PROCESS_APP_ENV_MISMATCH");
    expect(error.code).toBe("LOCAL_ADAPTER_FORBIDDEN_ENVIRONMENT");
    expect(error.message).not.toContain("production");
  });
});

describe("revalidación de entorno en APIs diferidas (§5.4, revisión)", () => {
  /** El guardia se ejecuta en el MOMENTO del consumo, no solo al crear el listado:
   * `APP_ENV` cambiado después de obtener el iterable también se detecta en la
   * primera `next()`. */
  it("listObjects creado bajo test y consumido tras cambiar el entorno: rechazar (§5.4)", async () => {
    const { buildTestStorage } = await import("./support.js");
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage({}, temporary);
    const listing = context.storage.listObjects()[Symbol.asyncIterator]();
    const previous = process.env["APP_ENV"];
    process.env["APP_ENV"] = "production";
    try {
      const error = await listing.next().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toMatchObject({
        name: "AdapterEnvironmentError",
        reason: "PROCESS_APP_ENV_MISMATCH",
      });
    } finally {
      if (previous === undefined) delete process.env["APP_ENV"];
      else process.env["APP_ENV"] = previous;
    }
  });

  /** Reanudación: el primer resultado visto bajo test no evita la revalidación antes
   * de cada elemento siguiente; el entorno cambiado corta el listado (§5.4). */
  it("listObjects reanudado: validar el entorno entre dos resultados consecutivos", async () => {
    const { buildTestStorage, encode } = await import("./support.js");
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const context = await buildTestStorage({}, temporary);
    await context.storage.put(iterableOf(encode("primero")), { maxBytes: 1000 });
    await context.storage.put(iterableOf(encode("segundo")), { maxBytes: 1000 });
    const iterator = context.storage.listObjects()[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    const previous = process.env["APP_ENV"];
    process.env["APP_ENV"] = "production";
    try {
      const error = await iterator.next().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toMatchObject({
        name: "AdapterEnvironmentError",
        reason: "PROCESS_APP_ENV_MISMATCH",
      });
    } finally {
      if (previous === undefined) delete process.env["APP_ENV"];
      else process.env["APP_ENV"] = previous;
    }
  });
});

describe("revalidación de entorno en lecturas y escrituras en curso (§5.4, revisión de la entrega)", () => {
  /** El stream de `open` es otro recorrido diferido: abrirlo bajo `test` y leerlo después
   * de cambiar el entorno no elude la guarda, ni al empezar ni al reanudar; el
   * descriptor se cierra al rechazar. */
  it.each([0, 1])(
    "stream de `open` leído tras cambiar el entorno (trozos leídos antes: %i): rechaza y cierra",
    async (chunksBefore) => {
      const { buildTestStorage } = await import("./support.js");
      const { nodeFileOps } = await import("../src/local/file-ops.js");
      const temporary = await createTestDirectory();
      let closes = 0;
      const context = await buildTestStorage(
        {
          fileOps: {
            ...nodeFileOps,
            openObjectForRead: async (path: string) => {
              const inner = await nodeFileOps.openObjectForRead(path);
              return {
                write: (buffer: Uint8Array) => inner.write(buffer),
                readInto: (buffer: Uint8Array, position: number) =>
                  inner.readInto(buffer, position),
                fstat: () => inner.fstat(),
                fchmod: (mode: number) => inner.fchmod(mode),
                fsync: () => inner.fsync(),
                close: async () => {
                  closes += 1;
                  await inner.close();
                },
              };
            },
          },
        },
        temporary,
      );
      // Más de un trozo de lectura (64 KiB), para que haya una reanudación.
      const content = new Uint8Array(200_000).fill(7);
      const stored = await context.storage.put(iterableOf(content), { maxBytes: 300_000 });
      const opened = await context.storage.open(stored.key);
      const iterator = opened.stream[Symbol.asyncIterator]();
      for (let index = 0; index < chunksBefore; index += 1) {
        expect((await iterator.next()).done).toBe(false);
      }
      const previous = process.env["APP_ENV"];
      process.env["APP_ENV"] = "production";
      try {
        await expect(iterator.next()).rejects.toMatchObject({
          name: "AdapterEnvironmentError",
          reason: "PROCESS_APP_ENV_MISMATCH",
        });
      } finally {
        if (previous === undefined) delete process.env["APP_ENV"];
        else process.env["APP_ENV"] = previous;
      }
      expect(closes).toBe(1);
      expect((await iterator.next()).done).toBe(true);
    },
  );

  /** `put` consume una fuente que puede tardar: si el entorno cambia mientras tanto, la
   * publicación (el `link`) no ocurre y el temporal se borra. */
  it("`put` con el entorno cambiado durante la lectura de la fuente: no publica", async () => {
    const { buildTestStorage, encode, listNames } = await import("./support.js");
    const temporary = await createTestDirectory();
    const context = await buildTestStorage({}, temporary);
    const previous = process.env["APP_ENV"];
    async function* source(): AsyncIterableIterator<Uint8Array> {
      await Promise.resolve();
      yield encode("antes del cambio");
      process.env["APP_ENV"] = "production";
      yield encode("después del cambio");
    }
    try {
      await expect(context.storage.put(source(), { maxBytes: 1000 })).rejects.toMatchObject({
        name: "AdapterEnvironmentError",
        reason: "PROCESS_APP_ENV_MISMATCH",
      });
    } finally {
      if (previous === undefined) delete process.env["APP_ENV"];
      else process.env["APP_ENV"] = previous;
    }
    expect(await listNames(`${context.rootPath}/objects`)).toEqual([]);
    expect(await listNames(`${context.rootPath}/tmp/${context.storage.instanceId}`)).toEqual([
      "instance.json",
    ]);
  });
});

function iterableOf(value: Uint8Array): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: async function* (): AsyncIterableIterator<Uint8Array> {
      await Promise.resolve();
      yield value;
    },
  };
}
