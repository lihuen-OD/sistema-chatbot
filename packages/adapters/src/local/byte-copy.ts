// Copia de un flujo de bytes a un descriptor (plan de P1-T5, §8.3 y §9.5), compartida por
// el almacenamiento y la captura de correo: escritura completa de cada trozo, conteo de
// bytes y SHA-256 sobre lo realmente escrito, límite aplicado sobre los bytes recibidos (deja
// de leer al superarlo) y cancelación sin esperar a una fuente que no responde. Cada
// adaptador decide qué error tipado usa para el límite y la cancelación; cualquier otro
// fallo (de la fuente o de la escritura) se propaga tal cual para que el llamador lo
// clasifique en su fase.
import { createHash } from "node:crypto";
import { writeFully, type FileOpsHandle } from "./file-ops.js";

export interface CopyLimits {
  readonly maxBytes: number;
  readonly signal?: AbortSignal | undefined;
}

export interface CopyErrors {
  /** El trozo recibido haría superar `maxBytes`: la copia se detiene sin leer más. */
  tooLarge(limitBytes: number, receivedBytes: number): Error;
  cancelled(): Error;
}

/**
 * Copia el flujo al descriptor. La fuente se recibe ya iterada (`iterator`): quien llama
 * decide qué hacer si crear el iterador falla. Al agotarse la fuente no se llama a
 * `return()` (protocolo de iteración); ante una salida anticipada se le pide cerrar, sin
 * esperarla. No hace `fsync`: es del llamador.
 */
export async function copyIntoHandle(
  handle: FileOpsHandle,
  iterator: AsyncIterator<Uint8Array>,
  limits: CopyLimits,
  errors: CopyErrors,
): Promise<{ sizeBytes: number; sha256: string }> {
  const digest = createHash("sha256");
  let sizeBytes = 0;
  const { maxBytes, signal } = limits;
  try {
    for (;;) {
      if (signal?.aborted === true) throw errors.cancelled();
      let chunkResult: IteratorResult<Uint8Array>;
      if (signal === undefined) {
        chunkResult = await iterator.next();
      } else {
        // `Promise.resolve`: `for await` también acepta un `next()` que no devuelve
        // promesa. Si gana la cancelación, el rechazo tardío de la espera abandonada no
        // debe quedar sin manejar.
        const nextPromise = Promise.resolve(iterator.next());
        nextPromise.catch(() => undefined);
        chunkResult = await raceWithAbort(nextPromise, signal, () => errors.cancelled());
      }
      if (chunkResult.done === true) break;
      const chunk = asUint8Array(chunkResult.value);
      const received = sizeBytes + chunk.byteLength;
      if (received > maxBytes) {
        // Límite sobre los bytes recibidos: deja de leer de inmediato (§8.3).
        throw errors.tooLarge(maxBytes, received);
      }
      // `write` puede escribir menos de lo pedido (§8.3): la escritura completa avanza
      // con los bytes realmente escritos; cero progreso o un resultado inválido termina
      // la copia. El SHA-256 y el tamaño se actualizan solo con el trozo ya escrito entero.
      await writeFully(handle, chunk);
      digest.update(chunk);
      sizeBytes = received;
    }
  } catch (error) {
    // Salida anticipada (cancelación, límite, fallo de escritura o de la fuente): se le
    // pide a la fuente que cierre, sin esperarla.
    abandonSource(iterator);
    throw error;
  }
  return { sizeBytes, sha256: digest.digest("hex") };
}

function asUint8Array(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** Espera el próximo trozo o la cancelación, lo que ocurra primero. */
async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onAbort: () => Error,
): Promise<T> {
  if (signal.aborted) throw onAbort();
  let abortListener: (() => void) | undefined;
  const cancelledPromise = new Promise<never>((_, reject) => {
    abortListener = () => {
      reject(onAbort());
    };
    signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([promise, cancelledPromise]);
  } finally {
    if (abortListener !== undefined) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}

/**
 * Salida anticipada de la copia: se le pide a la fuente que cierre (`return()`), sin
 * esperarla. Una fuente que no coopera (un `return()` que nunca responde, que lanza, que
 * rechaza o que no devuelve una promesa) no puede posponer el rechazo ni dejar un rechazo
 * sin manejar. Límite: el adaptador no puede obligarla a liberar lo que tenga abierto; su
 * espera pendiente queda abandonada y nada la vuelve a consumir.
 */
export function abandonSource(iterator: AsyncIterator<Uint8Array>): void {
  try {
    Promise.resolve(iterator.return?.(undefined)).catch(() => undefined);
  } catch {
    // `return()` lanzó en forma síncrona: la operación ya falló por su propia causa.
  }
}
