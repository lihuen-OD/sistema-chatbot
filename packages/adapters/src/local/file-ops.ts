// Interfaz interna de operaciones de archivos (plan de P1-T5, §4): pasan por acá para que
// las pruebas puedan inyectar fallos o pausas deterministas en cada paso (§13); en
// ejecución normal es `node:fs/promises` sin capas extra. No se exporta por `index.ts`.
// Solo POSIX: los permisos, `O_NOFOLLOW` y los enlaces duros corrosponden a macOS y Linux.
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

export interface FileOps {
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  /** Crea un archivo nuevo con O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW y 0600. */
  openTempForWrite(path: string): Promise<FileOpsHandle>;
  /** Abre un archivo existente con O_RDONLY | O_NOFOLLOW. */
  openObjectForRead(path: string): Promise<FileOpsHandle>;
  link(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  rm(path: string, options: { force?: boolean; recursive?: boolean }): Promise<void>;
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
  mkdir: (path) => fsp.mkdir(path).then(() => undefined),
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
        return handle
          .chmod(0o600)
          .catch((chmodError: unknown) => {
            return handle.close().finally(() => {
              throw chmodError;
            });
          })
          .then(() => new NodeFileOpsHandle(handle));
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
  fsyncDir: async (path) => {
    const handle = await fsp.open(path, fsConstants.O_RDONLY | O_DIRECTORY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};
