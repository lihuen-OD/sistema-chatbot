import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, lstat, mkdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { sep } from "node:path";
import { LocalPrivateFolderStorage } from "../src/local/private-folder-storage.js";
import { nodeFileOps } from "../src/local/file-ops.js";
import { decorateFileOps } from "./support.js";
import {
  TEST_APP_ENV,
  buildTestStorage,
  createTestDirectory,
  installTestAppEnv,
  listNames,
  removeDirectory,
} from "./support.js";

let originalUmask: number;
let restoreAppEnv: () => void;

beforeEach(() => {
  originalUmask = process.umask(0o022);
  restoreAppEnv = installTestAppEnv();
});

afterEach(() => {
  process.umask(originalUmask);
  restoreAppEnv();
});

describe("raíz privada con archivos reales (plan §6)", () => {
  it("rechaza la construcción si el sistema de archivos no admite enlaces duros (§6.4)", async () => {
    const directory = await createTestDirectory();
    try {
      const rejects = await LocalPrivateFolderStorage.build({
        appEnv: TEST_APP_ENV,
        rootPath: `${directory}${sep}raiz`,
        fileOps: decorateFileOps(nodeFileOps, {
          link: async () => {
            await Promise.reject(Object.assign(new Error("EPERM inyectado"), { code: "EPERM" }));
          },
        }),
      }).catch((error: unknown) => error);
      expect(rejects).toMatchObject({
        name: "StorageIntegrityError",
        reason: "HARD_LINK_UNSUPPORTED",
      });
      // La prueba de compatibilidad limpia sus residuos: tmp/ queda usable.
      await expect(buildAvailableAfterProbe(directory)).resolves.toBe(true);
    } finally {
      await removeDirectory(directory);
    }
  });
  it("acepta una raíz en mkdtemp(os.tmpdir()): recorre los enlaces de root de macOS y los sticky de Linux", async () => {
    // El recorrido configurado (/var → private/var en macOS, /tmp en Linux) y el
    // canónico se ejercitan al construir dentro de un mkdtemp (§13, rutas legítimas).
    const beforeUmask = process.umask(0o077);
    try {
      const { rootPath } = await buildTestStorage();
      for (const name of ["root", "objects", "tmp", ".reclaim"]) {
        const path = name === "root" ? rootPath : `${rootPath}${sep}${name}`;
        const stat = await lstat(path);
        expect(stat.isDirectory()).toBe(true);
        expect(stat.uid).toBe(process.getuid?.() ?? -1);
        expect(stat.mode & 0o7777).toBe(0o700);
      }
    } finally {
      process.umask(beforeUmask);
    }
  });

  it("escribe instance.json con 0600 y el registro de la instancia (§7.1)", async () => {
    const { rootPath, storage } = await buildTestStorage();
    const instanceJson = `${rootPath}${sep}tmp${sep}${storage.instanceId}${sep}instance.json`;
    const stat = await lstat(instanceJson);
    expect(stat.mode & 0o7777).toBe(0o600);
    const contents = JSON.parse(await readFile(instanceJson, "utf8")) as {
      instanceId: string;
      pid: number;
      createdAt: string;
    };
    expect(contents.instanceId).toBe(storage.instanceId);
    expect(contents.pid).toBe(process.pid);
    expect(contents.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("rechaza una raíz existente con modo 0750 y no la corrige en silencio (§6.4)", async () => {
    const directory = await createTestDirectory();
    try {
      const rootPath = `${directory}${sep}raiz`;
      await mkdir(rootPath, { mode: 0o750 });
      await expect(
        LocalPrivateFolderStorage.build({ appEnv: TEST_APP_ENV, rootPath }),
      ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "ROOT_MODE" });
      const stat = await lstat(rootPath);
      expect(stat.mode & 0o7777).toBe(0o750);
    } finally {
      await removeDirectory(directory);
    }
  });

  it("rechaza la raíz como enlace simbólico (§6.4)", async () => {
    const directory = await createTestDirectory();
    try {
      const real = `${directory}${sep}real`;
      await mkdir(real);
      const rootPath = `${directory}${sep}enlace`;
      await symlink(real, rootPath);
      await expect(
        LocalPrivateFolderStorage.build({ appEnv: TEST_APP_ENV, rootPath }),
      ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "ROOT_SYMLINK" });
    } finally {
      await removeDirectory(directory);
    }
  });

  it("rechaza un enlace de usuario en un antecesor de la ruta configurada (§6.2)", async () => {
    const directory = await createTestDirectory();
    try {
      const real = `${directory}${sep}real`;
      await mkdir(real);
      await symlink(real, `${directory}${sep}enlace`);
      await expect(
        LocalPrivateFolderStorage.build({
          appEnv: TEST_APP_ENV,
          rootPath: `${directory}${sep}enlace${sep}raiz`,
        }),
      ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "ANCESTOR_SYMLINK" });
    } finally {
      await removeDirectory(directory);
    }
  });

  it("rechaza un antecesor del usuario con escritura de otros (§6.3)", async () => {
    const directory = await createTestDirectory();
    try {
      const writable = `${directory}${sep}abierto`;
      await mkdir(writable);
      // La umask del proceso recorta el modo al crear: se fija explícitamente (§6.4).
      await chmod(writable, 0o757);
      await expect(
        LocalPrivateFolderStorage.build({
          appEnv: TEST_APP_ENV,
          rootPath: `${directory}${sep}abierto${sep}raiz`,
        }),
      ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "ANCESTOR_WRITABLE" });
    } finally {
      await removeDirectory(directory);
    }
  });

  it.each(["raiz-relativa", "./raiz", "/"])(
    "rechaza la forma de la ruta inválida: %j (§6.1)",
    async (rootPath) => {
      await expect(
        LocalPrivateFolderStorage.build({ appEnv: TEST_APP_ENV, rootPath }),
      ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "ROOT_PATH_SHAPE" });
    },
  );

  it("rechaza una subcarpeta reemplazada después de construir: la operación siguiente falla sin escribir (§6.5)", async () => {
    const context = await buildTestStorage();
    const objects = `${context.rootPath}${sep}objects`;
    const objectsIno = (await lstat(objects)).ino;
    await rm(objects, { recursive: true, force: true });
    await mkdir(objects, { mode: 0o700 });
    const entriesBefore = await listNames(objects);
    await expect(context.storage.put(iterable([]), { maxBytes: 100 })).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "SUBDIRECTORY_REPLACED",
    });
    expect(await listNames(objects)).toEqual(entriesBefore);
    expect((await lstat(objects)).ino).not.toBe(objectsIno);
  });

  it("rechaza una subcarpeta reemplazada por un enlace simbólico (§6.5)", async () => {
    const context = await buildTestStorage();
    const objects = `${context.rootPath}${sep}objects`;
    await rm(objects, { recursive: true, force: true });
    await symlink(context.tempRoot, objects);
    await expect(context.storage.put(iterable([]), { maxBytes: 10 })).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "UNEXPECTED_ENTRY_TYPE",
    });
    expect((await lstat(objects)).isSymbolicLink()).toBe(true);
  });
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

/** Comprueba luego una construcción normal sobre la misma raíz: sin residuos que tapen el tmp. */
/** Comprueba luego una construcción normal sobre la misma raíz: sin residuos que tapen el tmp. */
async function buildAvailableAfterProbe(directory: string): Promise<boolean> {
  const { rootPath } = await buildTestStorage({}, directory);
  const statTmp = await stat(`${rootPath}${sep}tmp`);
  return statTmp.isDirectory();
}
