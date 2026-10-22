// Guardas de entorno y configuración (plan §5, §13): APP_ENV defínido y ese se contrasta;
// maxFileBytes de corazonada inválida no se construye (TypeError).
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
