// Apoyo compartido por las pruebas (plan de P1-T5 §13): archivos reales en directorios
// temporales exclusivos creados con mkdtemp; nunca documentos del usuario.
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { sep, join } from "node:path";
import { onTestFinished } from "vitest";
import {
  LocalPrivateFolderStorage,
  type InternalStorageOptions,
} from "../src/local/private-folder-storage.js";
import type { FileOps, FileOpsHandle } from "../src/local/file-ops.js";

export const TEST_APP_ENV = "test";

export interface TestStorageContext {
  readonly tempRoot: string;
  readonly rootPath: string;
  readonly storage: LocalPrivateFolderStorage;
}

/** Directorio temporal propio de cada prueba (mkdtemp), recién limpio. Se borra al
 * terminar la prueba que lo creó, aunque la prueba falle. */
export async function createTestDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "adapters-p1t5-"));
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

/** Rechaza si la promesa no termina en el plazo: una espera bloqueada falla la prueba
 * con un mensaje propio en vez de agotar el tiempo de vitest. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Sin respuesta en ${String(ms)} ms: ${label}`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Copia de un `Stats` real con otro dueño: simula entradas de root o de otro usuario
 * que una prueba sin privilegios no puede crear. No toca el sistema de archivos. */
export function statsWithUid(stats: Stats, uid: number): Stats {
  const copy = Object.create(Object.getPrototypeOf(stats) as object) as Stats;
  return Object.assign(copy, stats, { uid });
}

/** Rechazos sin manejar observados mientras corre `run` (más dos vueltas del bucle). */
export async function collectUnhandledRejections(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const listener = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on("unhandledRejection", listener);
  try {
    await run();
    for (let turn = 0; turn < 2; turn += 1) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
  } finally {
    process.off("unhandledRejection", listener);
  }
  return seen;
}

export async function buildTestStorage(
  overrides: Partial<InternalStorageOptions> = {},
  directory?: string,
): Promise<TestStorageContext> {
  const tempRoot = directory ?? (await createTestDirectory());
  const rootPath = `${tempRoot}${sep}raiz`;
  const storage = await LocalPrivateFolderStorage.build({
    appEnv: TEST_APP_ENV,
    rootPath,
    ...overrides,
  });
  return { tempRoot, rootPath, storage };
}

export async function removeDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Fuente determinista de identificadores para las pruebas: misma cadena para el id de
 * operación y para la clave; los nombres quedan predecibles. */
export function fixedRandomHex128(value: string): () => string {
  return () => value;
}

/** Fuente determinista de identificadores distintos: devuelve en orden los valores dados
 * y después sigue con un contador de 32 hexadecimales. */
export function sequenceHex128(...first: string[]): () => string {
  const pending = [...first];
  let counter = 0;
  return () => {
    const next = pending.shift();
    if (next !== undefined) return next;
    counter += 1;
    return counter.toString(16).padStart(32, "0");
  };
}

export function chunked(content: Uint8Array, chunkSize: number): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: async function* (): AsyncIterableIterator<Uint8Array> {
      for (let offset = 0; offset < content.length; offset += chunkSize) {
        await Promise.resolve();
        yield content.subarray(offset, Math.min(offset + chunkSize, content.length));
      }
    },
  };
}

/** Colecta todo el stream de una lectura para comparar la ida y vuelta. */
export async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const collected: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    collected.push(chunk);
    total += chunk.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of collected) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Decorador simple de FileOps: el resto de las operaciones delega tal cual. */
export function decorateFileOps(fileOps: FileOps, overrides: Partial<FileOps>): FileOps {
  return { ...fileOps, ...overrides };
}

/** Envuelve todo archivo nuevo abierto para escritura, sin tocar `instance.json`. */
export function decorateNewHandles(
  fileOps: FileOps,
  decorate: (handle: FileOpsHandle) => FileOpsHandle,
): FileOps {
  return decorateFileOps(fileOps, {
    openTempForWrite: async (path) => {
      const inner = await fileOps.openTempForWrite(path);
      return path.endsWith(`${sep}instance.json`) ? inner : decorate(inner);
    },
  });
}

export interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

export function createGate(): Gate {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, open: release };
}

/** Manija con la primera escritura en pausa hasta que la prueba abra la compuerta.
 * Delega explícitamente: el spread perdería el `this` de la implementación real. */
export function writePausedOnGate(handle: FileOpsHandle, gate: Gate): FileOpsHandle {
  let pausedWriteDone = false;
  return {
    write: async (buffer: Uint8Array): Promise<number> => {
      if (!pausedWriteDone) {
        pausedWriteDone = true;
        await gate.promise;
      }
      return handle.write(buffer);
    },
    readInto: (buffer: Uint8Array, position: number) => handle.readInto(buffer, position),
    fstat: () => handle.fstat(),
    fchmod: (mode: number) => handle.fchmod(mode),
    fsync: () => handle.fsync(),
    close: () => handle.close(),
  };
}

/** Fuente que entrega el primer trozo, se envejece en pausa y nunca termina sola. */
export function stalledSource(
  firstChunk: Uint8Array,
  stall: Promise<void>,
): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: async function* (): AsyncIterableIterator<Uint8Array> {
      yield firstChunk;
      await stall;
      throw new Error("La fuente no debía continuar.");
    },
  };
}

export function errorWithCode(code: string): Error {
  const error = new Error(`inyección: ${code}`);
  (error as { code?: string }).code = code;
  return error;
}

/** Nombres regularizados de un directorio, para comparar contenido antes y después. */
export async function listNames(path: string): Promise<string[]> {
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(path));
  return [...entries].sort();
}

/** Instala process.env.APP_ENV para la prueba y devuelve el restaurador. */
export function installTestAppEnv(): () => void {
  const original = process.env["APP_ENV"];
  process.env["APP_ENV"] = TEST_APP_ENV;
  return () => {
    if (original === undefined) {
      delete process.env["APP_ENV"];
    } else {
      process.env["APP_ENV"] = original;
    }
  };
}
