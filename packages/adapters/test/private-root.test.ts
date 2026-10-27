import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, lstat, mkdir, readFile, rename, rm, stat, symlink } from "node:fs/promises";
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
  statsWithUid,
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
    // Reemplazo determinista (revisión de CI): el original se conserva con `rename` a
    // otra ubicación, así su inodo queda ocupado y el directorio nuevo NO puede
    // reutilizar la misma identidad en ningún sistema de archivos.
    const preserved = `${context.tempRoot}${sep}objects-preservado`;
    await rename(objects, preserved);
    await mkdir(objects, { mode: 0o700 });
    const originalStat = await lstat(preserved);
    const replacementStat = await lstat(objects);
    expect(replacementStat.dev).toBe(originalStat.dev);
    expect(replacementStat.ino).not.toBe(originalStat.ino);
    const entriesBefore = await listNames(objects);
    // Con contenido real: si la comprobación no rechazara, el objeto se escribiría en el
    // directorio nuevo (con un flujo vacío la prueba solo vería EmptyObjectError).
    await expect(
      context.storage.put(iterable([new TextEncoder().encode("contenido")]), { maxBytes: 100 }),
    ).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "SUBDIRECTORY_REPLACED",
    });
    expect(await listNames(objects)).toEqual(entriesBefore);
    expect(await listNames(preserved)).toEqual([]);
  });

  it("rechaza la raíz reemplazada después de construir, con el original conservado por `rename` (§6.5)", async () => {
    const context = await buildTestStorage();
    const preserved = `${context.tempRoot}${sep}raiz-preservada`;
    await rename(context.rootPath, preserved);
    await mkdir(context.rootPath, { mode: 0o700 });
    await mkdir(`${context.rootPath}${sep}objects`, { mode: 0o700 });
    const originalStat = await lstat(preserved);
    const replacementStat = await lstat(context.rootPath);
    expect(replacementStat.ino).not.toBe(originalStat.ino);
    await expect(
      context.storage.put(iterable([new TextEncoder().encode("contenido")]), { maxBytes: 100 }),
    ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "ROOT_REPLACED" });
    expect(await listNames(`${context.rootPath}${sep}objects`)).toEqual([]);
    expect(await listNames(`${preserved}${sep}objects`)).toEqual([]);
  });

  it("rechaza una subcarpeta reemplazada por un enlace simbólico (§6.5)", async () => {
    const context = await buildTestStorage();
    const objects = `${context.rootPath}${sep}objects`;
    // La identidad que se reemplaza aquí no necesita conservarse: el rechazo es por
    // tipo de entrada, no por comparación de inodos; `rm` descarta el original.
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

/** Comprueba luego una construcción normal sobre la misma raíz: sin residuos del probe. */
async function buildAvailableAfterProbe(directory: string): Promise<boolean> {
  const { rootPath } = await buildTestStorage({}, directory);
  const statTmp = await stat(`${rootPath}${sep}tmp`);
  return statTmp.isDirectory();
}

describe("antecesores, modos y escrituras completas (revisión de la entrega)", () => {
  it("rechaza un antecesor con escritura de otros: no crea nada debajo (§6.4, revisión)", async () => {
    const directory = await createTestDirectory();
    try {
      // Directorio propio con escritura de otros: la decisión de §6.3 lo rechaza ANTES
      // de crear la raíz debajo de él.
      const open = `${directory}${sep}abierto`;
      await mkdir(open, { mode: 0o0700 });
      await chmod(open, 0o0777);
      const rootPath = `${open}${sep}raiz`;
      await expect(
        LocalPrivateFolderStorage.build({ appEnv: TEST_APP_ENV, rootPath }),
      ).rejects.toMatchObject({
        name: "StorageIntegrityError",
        reason: "ANCESTOR_WRITABLE",
      });
      await expect(lstat(rootPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await removeDirectory(directory);
    }
  });

  it("no convierte un error del sistema en ausencia: EACCES de lstat se propaga crudo (§6.4, revisión)", async () => {
    const directory = await createTestDirectory();
    try {
      const rootPath = `${directory}${sep}=raiz`;
      const expectedError = Object.assign(new Error("EACCES inyectado"), { code: "EACCES" });
      const rejects = await LocalPrivateFolderStorage.build({
        appEnv: TEST_APP_ENV,
        rootPath,
        fileOps: {
          ...nodeFileOps,
          lstat: async (path: string) => {
            if (path === rootPath) throw expectedError;
            return nodeFileOps.lstat(path);
          },
        },
      }).catch((error: unknown) => error);
      expect(rejects).toBe(expectedError);
      await expect(lstat(rootPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await removeDirectory(directory);
    }
  });

  it("cada directorio creado nace 0700 desde `mkdir`, antes del `chmod`, aun con umask 000 (§6.4)", async () => {
    const directory = await createTestDirectory();
    process.umask(0o000);
    // Componentes intermedios que faltan, la raíz, sus subdirectorios y la instancia.
    const rootPath = `${directory}${sep}a${sep}b${sep}raiz`;
    const modesRightAfterMkdir = new Map<string, number>();
    const storage = await LocalPrivateFolderStorage.build({
      appEnv: TEST_APP_ENV,
      rootPath,
      fileOps: {
        ...nodeFileOps,
        mkdir: async (path: string, mode?: number) => {
          await nodeFileOps.mkdir(path, mode);
          modesRightAfterMkdir.set(path, (await lstat(path)).mode & 0o7777);
        },
      },
    });
    expect([...modesRightAfterMkdir.keys()]).toEqual([
      `${directory}${sep}a`,
      `${directory}${sep}a${sep}b`,
      rootPath,
      `${rootPath}${sep}objects`,
      `${rootPath}${sep}tmp`,
      `${rootPath}${sep}.reclaim`,
      `${rootPath}${sep}tmp${sep}${storage.instanceId}`,
    ]);
    for (const mode of modesRightAfterMkdir.values()) expect(mode).toBe(0o700);
    await storage.close();
  });

  it("`instance.json` llega completo aunque `write` entregue 2 bytes por llamada (§8.3, revisión)", async () => {
    const directory = await createTestDirectory();
    try {
      const instanceId = "0102030405060708090a0b0c0d0e0f10";
      const createdAt = new Date(Date.UTC(2026, 0, 15, 12, 30));
      const storage = await LocalPrivateFolderStorage.build({
        appEnv: TEST_APP_ENV,
        instanceId,
        timing: { now: () => createdAt },
        rootPath: `${directory}${sep}raiz`,
        fileOps: {
          ...nodeFileOps,
          openTempForWrite: async (path: string) => {
            const inner = await nodeFileOps.openTempForWrite(path);
            return {
              write: async (buffer: Uint8Array) => {
                return inner.write(buffer.subarray(0, Math.min(2, buffer.byteLength)));
              },
              readInto: (buffer: Uint8Array, position: number) => inner.readInto(buffer, position),
              fstat: () => inner.fstat(),
              fchmod: (m: number) => inner.fchmod(m),
              fsync: () => inner.fsync(),
              close: () => inner.close(),
            };
          },
        },
      });
      try {
        const contentChars = await readFile(
          `${instanceJsonDir(directory, instanceId)}${sep}instance.json`,
          {
            encoding: "utf8",
          },
        );
        expect(JSON.parse(contentChars)).toEqual({
          instanceId,
          pid: process.pid,
          createdAt: createdAt.toISOString(),
        });
      } finally {
        await expect(storage.close()).resolves.toEqual({
          ownLeftoverEntries: 0,
          reclaimEntriesRemoved: 0,
          retainedEntries: 0,
        });
      }
    } finally {
      await removeDirectory(directory);
    }
  });
});

describe("efectos sobre disco de la raíz (§6.2 a §6.5, revisión de la entrega)", () => {
  /** Un enlace "de root" (simulado: la prueba no tiene privilegios) que apunta a un
   * directorio con escritura de otros. El recorrido configurado lo acepta por su dueño;
   * el canónico rechaza el destino. Ese rechazo tiene que llegar ANTES de crear la raíz
   * debajo del destino. Solo se simula el dueño del enlace: el resto es real. */
  it("valida la ruta canónica de los antecesores existentes antes de crear nada debajo", async () => {
    const directory = await createTestDirectory();
    const open = `${directory}${sep}abierto`;
    await mkdir(open, { mode: 0o700 });
    await chmod(open, 0o777);
    const link = `${directory}${sep}enlace`;
    await symlink(open, link);
    await expect(
      LocalPrivateFolderStorage.build({
        appEnv: TEST_APP_ENV,
        rootPath: `${link}${sep}raiz`,
        fileOps: decorateFileOps(nodeFileOps, {
          lstat: async (path: string) => {
            const stats = await nodeFileOps.lstat(path);
            return path === link ? statsWithUid(stats, 0) : stats;
          },
        }),
      }),
    ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "ANCESTOR_WRITABLE" });
    expect(await listNames(open)).toEqual([]);
  });

  /** Un componente recién creado que no resulta del usuario del proceso (simulado) se
   * rechaza en ese momento, sin crear los siguientes debajo. */
  it("un componente creado que no es del usuario del proceso detiene la creación", async () => {
    const directory = await createTestDirectory();
    const first = `${directory}${sep}a`;
    const uid = process.getuid?.() ?? 0;
    await expect(
      LocalPrivateFolderStorage.build({
        appEnv: TEST_APP_ENV,
        rootPath: `${first}${sep}b${sep}raiz`,
        fileOps: decorateFileOps(nodeFileOps, {
          lstat: async (path: string) => {
            const stats = await nodeFileOps.lstat(path);
            return path === first ? statsWithUid(stats, uid + 1) : stats;
          },
        }),
      }),
    ).rejects.toMatchObject({ name: "StorageIntegrityError", reason: "ANCESTOR_OWNER" });
    expect(await listNames(first)).toEqual([]);
  });

  /** §6.4: si `mkdir` falla con EEXIST porque otra instancia creó la entrada en el
   * medio, se vuelve a comprobar con `lstat` en lugar de fallar. Se simula la otra
   * instancia creando el directorio justo antes del `mkdir` propio. */
  it.each(["raiz", `raiz${sep}objects`])(
    "EEXIST de `mkdir` por otra instancia en %s: vuelve a comprobar y construye",
    async (relative) => {
      const directory = await createTestDirectory();
      const rootPath = `${directory}${sep}raiz`;
      const contested = `${directory}${sep}${relative}`;
      const storage = await LocalPrivateFolderStorage.build({
        appEnv: TEST_APP_ENV,
        rootPath,
        fileOps: decorateFileOps(nodeFileOps, {
          mkdir: async (path: string, mode?: number) => {
            if (path === contested) await nodeFileOps.mkdir(path, 0o700);
            await nodeFileOps.mkdir(path, mode);
          },
        }),
      });
      expect((await lstat(contested)).mode & 0o7777).toBe(0o700);
      await storage.close();
    },
  );

  it("dos construcciones simultáneas sobre la misma raíz nueva: ambas terminan", async () => {
    const directory = await createTestDirectory();
    const rootPath = `${directory}${sep}raiz`;
    const built = await Promise.all(
      Array.from({ length: 4 }, () =>
        LocalPrivateFolderStorage.build({ appEnv: TEST_APP_ENV, rootPath }),
      ),
    );
    expect(new Set(built.map((storage) => storage.instanceId)).size).toBe(4);
    for (const storage of built) await storage.close();
  });

  /** §6.5 y la regla de ausencia: solo ENOENT significa "reemplazado"; un EIO al
   * comprobar `objects/` se propaga tal cual, sin escribir. */
  it("la comprobación de cada operación propaga un EIO de `lstat` en lugar de informar un reemplazo", async () => {
    const directory = await createTestDirectory();
    const rootPath = `${directory}${sep}raiz`;
    const injected = Object.assign(new Error("EIO inyectado"), { code: "EIO" });
    let failObjects = false;
    const storage = await LocalPrivateFolderStorage.build({
      appEnv: TEST_APP_ENV,
      rootPath,
      fileOps: decorateFileOps(nodeFileOps, {
        lstat: async (path: string) => {
          if (failObjects && path === `${rootPath}${sep}objects`) throw injected;
          return nodeFileOps.lstat(path);
        },
      }),
    });
    failObjects = true;
    await expect(
      storage.put(iterable([new TextEncoder().encode("contenido")]), { maxBytes: 100 }),
    ).rejects.toBe(injected);
    failObjects = false;
    expect(await listNames(`${rootPath}${sep}objects`)).toEqual([]);
  });

  /** La limpieza recorre los antecesores (§6.5) pero no crea: si la raíz desapareció, la
   * limpieza falla y no la vuelve a crear como efecto secundario. */
  it("`recoverWorkArea` con la raíz ausente: rechaza y no la recrea", async () => {
    const context = await buildTestStorage();
    await rename(context.rootPath, `${context.tempRoot}${sep}raiz-retirada`);
    await expect(context.storage.recoverWorkArea()).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "ROOT_REPLACED",
    });
    await expect(lstat(context.rootPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  /** `instance.json` con escritura sin progreso: la construcción falla limpiamente, con
   * el descriptor cerrado y sin dejar el directorio de una instancia que nadie usará. */
  it("`instance.json` sin progreso de escritura: la construcción falla, cierra y no deja la instancia", async () => {
    const directory = await createTestDirectory();
    const rootPath = `${directory}${sep}raiz`;
    let closes = 0;
    const failure = await LocalPrivateFolderStorage.build({
      appEnv: TEST_APP_ENV,
      rootPath,
      fileOps: decorateFileOps(nodeFileOps, {
        openTempForWrite: async (path: string) => {
          const inner = await nodeFileOps.openTempForWrite(path);
          if (!path.endsWith(`${sep}instance.json`)) return inner;
          return {
            write: () => Promise.resolve(0),
            readInto: (buffer: Uint8Array, position: number) => inner.readInto(buffer, position),
            fstat: () => inner.fstat(),
            fchmod: (mode: number) => inner.fchmod(mode),
            fsync: () => inner.fsync(),
            close: async () => {
              closes += 1;
              await inner.close();
            },
          };
        },
      }),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/sin progreso/);
    expect(closes).toBe(1);
    expect(await listNames(`${rootPath}${sep}tmp`)).toEqual([]);
  });
});

function instanceJsonDir(directory: string, instanceId: string): string {
  return `${directory}${sep}raiz${sep}tmp${sep}${instanceId}`;
}
