// Lectura de archivos propios de una raíz privada (plan de P1-T5, §6.4, §9.6 y §9.7): abre
// con O_RDONLY | O_NOFOLLOW y comprueba con `fstat` sobre el descriptor, no sobre la ruta,
// que sea un archivo regular del usuario del proceso con modo exactamente 0600 y dentro del
// tamaño esperado. Solo ENOENT es ausencia; EACCES, EIO y los demás errores del sistema se
// propagan tal cual: nunca se interpretan como "no está".
import { createHash } from "node:crypto";
import { errorCode, type FileOps, type FileOpsHandle, type Stats } from "./file-ops.js";

/** Resultado de leer un archivo propio. `INVALID`: existe, pero no es un archivo regular
 * propio con modo 0600 o no cumple el tamaño esperado. */
export type OwnFileRead<T> =
  | { readonly kind: "OK"; readonly value: T }
  | { readonly kind: "MISSING" }
  | { readonly kind: "INVALID" };

const READ_CHUNK_BYTES = 64 * 1024;

/** Un directorio privado propio (§6.4): no enlace, del usuario del proceso, modo 0700. */
export function isOwnPrivateDirectory(stat: Stats, processUid: number): boolean {
  return (
    !stat.isSymbolicLink() &&
    stat.isDirectory() &&
    stat.uid === processUid &&
    (stat.mode & 0o7777) === 0o700
  );
}

/** Lee entero un archivo propio de hasta `maxBytes`. */
export async function readOwnSmallFile(
  fileOps: FileOps,
  path: string,
  processUid: number,
  maxBytes: number,
): Promise<OwnFileRead<Uint8Array>> {
  return withOwnFile(fileOps, path, processUid, async (handle, stat) => {
    if (stat.size > maxBytes) return { kind: "INVALID" };
    const bytes = await readAll(handle, maxBytes);
    return bytes === null ? { kind: "INVALID" } : { kind: "OK", value: bytes };
  });
}

/** Lee un archivo propio por trozos y calcula su SHA-256; con `keepContent` además devuelve
 * los bytes. Su tamaño tiene que ser exactamente `expectedSizeBytes`. */
export async function readOwnFileHashed(
  fileOps: FileOps,
  path: string,
  processUid: number,
  expectedSizeBytes: number,
  keepContent: boolean,
): Promise<OwnFileRead<{ sha256: string; content: Uint8Array | null }>> {
  return withOwnFile(fileOps, path, processUid, async (handle, stat) => {
    if (stat.size !== expectedSizeBytes) return { kind: "INVALID" };
    const digest = createHash("sha256");
    const kept = keepContent ? new Uint8Array(expectedSizeBytes) : null;
    const buffer = new Uint8Array(Math.min(READ_CHUNK_BYTES, Math.max(expectedSizeBytes, 1)));
    let position = 0;
    for (;;) {
      const read = await handle.readInto(buffer, position);
      if (read === 0) break;
      if (position + read > expectedSizeBytes) return { kind: "INVALID" };
      const chunk = buffer.subarray(0, read);
      digest.update(chunk);
      kept?.set(chunk, position);
      position += read;
    }
    if (position !== expectedSizeBytes) return { kind: "INVALID" };
    return { kind: "OK", value: { sha256: digest.digest("hex"), content: kept } };
  });
}

async function withOwnFile<T>(
  fileOps: FileOps,
  path: string,
  processUid: number,
  read: (handle: FileOpsHandle, stat: Stats) => Promise<OwnFileRead<T>>,
): Promise<OwnFileRead<T>> {
  let handle: FileOpsHandle;
  try {
    handle = await fileOps.openObjectForRead(path);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return { kind: "MISSING" };
    // Un enlace en el último componente (O_NOFOLLOW) o una entrada que no se abre como
    // archivo: existe, pero no es un archivo propio.
    if (code === "ELOOP" || code === "ENXIO" || code === "ENODEV" || code === "EOPNOTSUPP") {
      return { kind: "INVALID" };
    }
    throw error;
  }
  try {
    const stat = await handle.fstat();
    if (!stat.isFile() || stat.uid !== processUid || (stat.mode & 0o7777) !== 0o600) {
      return { kind: "INVALID" };
    }
    return await read(handle, stat);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Lee hasta el final; `null` si supera `maxBytes` (el archivo creció después del `fstat`). */
async function readAll(handle: FileOpsHandle, maxBytes: number): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const buffer = new Uint8Array(READ_CHUNK_BYTES);
    const read = await handle.readInto(buffer, total);
    if (read === 0) break;
    total += read;
    if (total > maxBytes) return null;
    chunks.push(buffer.subarray(0, read));
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
