// Interfaz interna de operaciones de archivos (plan de P1-T5, §4): pasan por acá para que
// las pruebas puedan inyectar fallos o pausas deterministas en cada paso (§13); en
// ejecución normal es `node:fs/promises` sin capas extra. No se exporta por `index.ts`.
// Solo POSIX: los permisos, `O_NOFOLLOW` y los enlaces duros corresponden a macOS y Linux.
import { constants as fsConstants, promises as fsp, type Stats } from "node:fs";

export type { Stats } from "node:fs";

/** Banderas POSIX que pueden faltar en la plataforma; en macOS y Linux están. */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW;
const O_DIRECTORY = fsConstants.O_DIRECTORY;

export interface FileOpsHandle {
  write(buffer: Uint8Array): Promise<number>;
  readInto(buffer: Uint8Array, position: number): Promise<number>;
  fstat(): Promise<Stats>;
  fchmod(mode: number): Promise<void>;
  fsync(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Escritura completa de un trozo: `write` puede devolver menos bytes que el pedido, así
 * que el bucle avanza con los bytes realmente escritos. Cero progreso y resultados fuera
 * de rango terminan con un error; el llamador decide la fase (§8.4: antes de publicar) y
 * nunca queda un bucle sin progreso.
 */
export async function writeFully(handle: FileOpsHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const written = await handle.write(chunk.subarray(offset));
    const remaining = chunk.byteLength - offset;
    if (!Number.isSafeInteger(written) || written < 0) {
      throw new Error(`Resultado inválido de escritura (${String(written)} bytes).`);
    }
    if (written > remaining) {
      throw new Error(
        `Resultado inválido de escritura (${String(written)} de ${String(remaining)} bytes pendientes).`,
      );
    }
    if (written === 0) {
      throw new Error("Escritura sin progreso: el descriptor no aceptó bytes.");
    }
    offset += written;
  }
}

/** Código POSIX de un error del sistema (`ENOENT`, `EEXIST`, …), si lo tiene. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Archivo nuevo y completo (§6.4, §8.3): `openTempForWrite` (O_EXCL, O_NOFOLLOW, 0600
 * reafirmado), escritura completa y `fsync`. Si la creación falla, no hay nada propio que
 * borrar (EEXIST: la entrada no es de quien llama). Si falla después, se cierra el
 * descriptor y se borra lo recién creado antes de informar el error.
 */
export async function writeNewFile(
  fileOps: FileOps,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const handle = await fileOps.openTempForWrite(path);
  try {
    await writeFully(handle, bytes);
    await handle.fsync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fileOps.unlink(path).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

export interface FileOps {
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  /** Crea UN componente cuyo padre ya existe. Con `mode` pide el modo al sistema, que
   * la umask puede reducir: quien crea vuelve a afirmar el modo con `chmod` (§6.4). */
  mkdir(path: string, mode?: number): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  /** Crea un archivo nuevo con O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW y 0600. Si falla,
   * no deja nada creado por esta llamada: una entrada que ya existía (EEXIST) no se toca,
   * y si falla el `fchmod` posterior, se borra lo recién creado antes de informar. */
  openTempForWrite(path: string): Promise<FileOpsHandle>;
  /** Abre un archivo existente con O_RDONLY | O_NOFOLLOW. */
  openObjectForRead(path: string): Promise<FileOpsHandle>;
  link(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  rm(path: string, options: { force?: boolean; recursive?: boolean }): Promise<void>;
  /** Borra un directorio solo si está vacío: nunca se lleva contenido. */
  rmdir(path: string): Promise<void>;
  /** fsync de un directorio: abre el descriptor del directorio y lo sincroniza. */
  fsyncDir(path: string): Promise<void>;
}

class NodeFileOpsHandle implements FileOpsHandle {
  private readonly handle: fsp.FileHandle;

  constructor(handle: fsp.FileHandle) {
    this.handle = handle;
  }

  write(buffer: Uint8Array): Promise<number> {
    return this.handle.write(buffer).then((result) => result.bytesWritten);
  }

  readInto(buffer: Uint8Array, position: number): Promise<number> {
    return this.handle.read(buffer, 0, buffer.length, position).then((result) => {
      return result.bytesRead;
    });
  }

  fstat(): Promise<Stats> {
    return this.handle.stat();
  }

  fchmod(mode: number): Promise<void> {
    return this.handle.chmod(mode);
  }

  fsync(): Promise<void> {
    return this.handle.sync();
  }

  close(): Promise<void> {
    return this.handle.close();
  }
}

/** Implementación por defecto sobre `node:fs/promises`. Cada prueba la rodea con su
 * propio decorador en vez de modificar este objeto compartido. */
export const nodeFileOps: FileOps = {
  lstat: (path) => fsp.lstat(path),
  realpath: (path) => fsp.realpath(path),
  mkdir: (path, mode) =>
    fsp.mkdir(path, mode === undefined ? undefined : { mode }).then(() => undefined),
  chmod: (path, mode) => fsp.chmod(path, mode).then(() => undefined),
  openTempForWrite: (path) =>
    fsp
      .open(
        path,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW,
        0o600,
      )
      .then((handle) => {
        // La umask no garantiza el modo pedido: se reafirma sobre el descriptor (§6.4).
        // Si falla, el archivo lo creó esta llamada (O_EXCL): se cierra y se borra antes de
        // informar, para que quien llama nunca tenga que borrar algo que no sabe si creó.
        return handle.chmod(0o600).then(
          () => new NodeFileOpsHandle(handle),
          async (chmodError: unknown) => {
            await handle.close().catch(() => undefined);
            await fsp.unlink(path).catch(() => undefined);
            throw chmodError;
          },
        );
      }),
  openObjectForRead: (path) =>
    fsp
      .open(path, fsConstants.O_RDONLY | O_NOFOLLOW)
      .then((handle) => new NodeFileOpsHandle(handle)),
  link: (source, destination) => fsp.link(source, destination).then(() => undefined),
  unlink: (path) => fsp.unlink(path).then(() => undefined),
  rename: (source, destination) => fsp.rename(source, destination).then(() => undefined),
  readdir: (path) => fsp.readdir(path),
  rm: (path, options) => fsp.rm(path, options).then(() => undefined),
  rmdir: (path) => fsp.rmdir(path).then(() => undefined),
  fsyncDir: async (path) => {
    const handle = await fsp.open(path, fsConstants.O_RDONLY | O_DIRECTORY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};
