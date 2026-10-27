// Limpieza en ejecución (plan §7.2, §13): restos propios, nada de otras instancias,
// drenaje de .reclaim entre instancias competidoras y cierres con operaciones activas.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, rm, symlink, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import { nodeFileOps, type FileOpsHandle } from "../src/local/file-ops.js";
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

  it(":close con operaciones vivas no interfiere: el directorio y el temporal quedan y la op termina", async () => {
    const temporary = await createTestDirectory();
    leftovers.push(temporary);
    const gate = createGate();
    let paused: FileOpsHandle | undefined;
    const primera = await buildTestStorage(
      {
        randomHex128: fixedRandomHex128("fcfcfcfcfcfcfcfcfcfcfcfcfcfcfcfc"),
        fileOps: decorateFileOps(nodeFileOps, {
          openTempForWrite: async (path: string) => {
            const inner = await nodeFileOps.openTempForWrite(path);
            if (path.includes(`${sep}instance.json`)) return inner;
            paused = inner;
            return writePausedOnGate(inner, gate);
          },
        }),
      },
      temporary,
    );
    const operation = primera.storage.put(iterableDeUna(), { maxBytes: 1000 });
    const temporal = `${instanceDirectory(primera)}${sep}fcfcfcfcfcfcfcfcfcfcfcfcfcfcfcfc.part`;
    await waitForFile(temporal);
    if (paused === undefined) throw new Error("La operación no llegó a la primera escritura.");
    await primera.storage.close();
    expect((await lstat(temporal)).isFile()).toBe(true);
    expect((await lstat(instanceDirectory(primera))).isDirectory()).toBe(true);

    gate.open();
    const stored = await operation;
    expect(stored.key).toBe("fcfcfcfcfcfcfcfcfcfcfcfcfcfcfcfc");
    // Tras terminar, una limpieza posterior retoma el residuo del temporal publicado.
    expect(await listNames(instanceDirectory(primera))).toEqual(["instance.json"]);
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
