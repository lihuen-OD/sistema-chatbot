// Puerto de almacenamiento (plan de P1-T5, §8.1). ADR-001 ubica los puertos en
// `adapters` hasta que exista `domain` (addendum), porque manejan flujos de bytes y
// `contracts` no usa APIs ni tipos de Node. El motor nunca depende de este paquete.

/** Formato de la raíz privada implementada: cada objeto es un archivo único bajo
 * `<raíz>/objects/<clave>`, sin subdirectorios. */
export const LOCAL_PRIVATE_FOLDER_KIND = "LOCAL_PRIVATE_FOLDER" as const;

/** Clave opaca de este bloque: 32 hexadecimales en minúscula (128 bits aleatorios).
 * Ningún dato del llamador forma la clave ni la ruta (plan §8.2). */
export const OBJECT_KEY_PATTERN = /^[0-9a-f]{32}$/;

export interface StoredObject {
  readonly key: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface OpenedObject {
  readonly sizeBytes: number;
  /** Lectura por trozos desde el descriptor: no carga el archivo en memoria. Si quien
   * consume interrumpe el recorrido (break, throw o return), el descriptor se cierra. */
  readonly stream: AsyncIterable<Uint8Array>;
}

export interface PutObjectOptions {
  /** Límite de bytes aplicado durante la escritura (sobre los bytes recibidos).
   * Si falta, toma el máximo configurado del adaptador (`MAX_FILE_BYTES`); siempre queda
   * acotado por ese máximo, que no supera 10485760 (plan §8.3). */
  readonly maxBytes?: number;
  /** Cancelación: se aplica mientras se reciben bytes y hasta justo antes de publicar.
   * Después de un `link` exitoso se ignora: la operación termina los pasos restantes. */
  readonly signal?: AbortSignal;
}

/** Resultado de conciliar una publicación incierta (plan §8.4.1):
 * - `WITHDRAWN`: bajo la clave estaba el objeto de esta publicación (mismo dev e inodo que
 *   la prueba retenida) y se retiró;
 * - `NOT_PUBLISHED`: la clave está vacía; el enlace no llegó a crearse o ya se retiró;
 * - `KEY_HELD_BY_OTHER`: bajo la clave hay otra entrada, que no se tocó;
 * - `NOT_RETAINED`: la instancia no tiene una publicación incierta con esa clave (por
 *   ejemplo, porque ya se concilió); no hay efectos. */
export type UncertainPublicationResolution =
  "WITHDRAWN" | "NOT_PUBLISHED" | "KEY_HELD_BY_OTHER" | "NOT_RETAINED";

export interface ObjectStorage {
  readonly kind: typeof LOCAL_PRIVATE_FOLDER_KIND;
  put(content: AsyncIterable<Uint8Array>, options: PutObjectOptions): Promise<StoredObject>;
  open(key: string): Promise<OpenedObject>;
  /** Dos borrados concurrentes de la misma clave dan un DELETED y un ALREADY_ABSENT, también
   * entre instancias o procesos sobre la misma raíz (plan §8.5). */
  delete(key: string): Promise<"DELETED" | "ALREADY_ABSENT">;
  /** Conciliación de huérfanos (P2). Lista solo las claves con el formato propio y
   * archivos regulares del usuario del proceso, en orden determinista. */
  listObjects(): AsyncIterable<{ key: string; sizeBytes: number }>;
  /** Única recuperación de un `UncertainPublicationError` (plan §8.4.1): comprueba la
   * pertenencia antes de retirar nada. Nunca se recupera con `delete`. */
  resolveUncertainPublication(key: string): Promise<UncertainPublicationResolution>;
}

/** Motivos internos de StorageIntegrityError (plan §8.1): raíz, tipo, dueño o enlace
 * inesperado. Ninguno incluye rutas completas. */
export type StorageIntegrityReason =
  | "ROOT_PATH_SHAPE"
  | "PATH_COMPONENT_NOT_DIRECTORY"
  | "ANCESTOR_SYMLINK"
  | "ANCESTOR_OWNER"
  | "ANCESTOR_WRITABLE"
  | "ANCESTOR_OTHERS_WRITABLE_STICKY"
  | "ROOT_SYMLINK"
  | "ROOT_NOT_DIRECTORY"
  | "ROOT_OWNER"
  | "ROOT_MODE"
  | "SUBDIRECTORY_OWNER"
  | "SUBDIRECTORY_MODE"
  | "ROOT_REPLACED"
  | "SUBDIRECTORY_REPLACED"
  | "HARD_LINK_UNSUPPORTED"
  | "KEY_COLLISION"
  | "TARGET_TYPE"
  | "TARGET_OWNER"
  | "TARGET_MODE"
  | "TARGET_SYMLINK"
  /** La entrada bajo la clave cambió, o no se pudo verificar, entre la comprobación y el
   * retiro exclusivo (plan §8.5): se restituyó, o quedó retenida sin borrarse. */
  | "TARGET_CHANGED"
  | "UNEXPECTED_ENTRY_TYPE";

export class StorageIntegrityError extends Error {
  readonly reason: StorageIntegrityReason;

  constructor(reason: StorageIntegrityReason) {
    super(`Estado inesperado de la raíz privada o del objeto (${reason}).`);
    this.name = "StorageIntegrityError";
    this.reason = reason;
  }
}

export class InvalidObjectKeyError extends Error {
  constructor() {
    super("La clave no tiene el formato del adaptador: 32 hexadecimales en minúscula.");
    this.name = "InvalidObjectKeyError";
  }
}

export class ObjectTooLargeError extends Error {
  readonly limitBytes: number;
  readonly receivedBytes: number;

  constructor(limitBytes: number, receivedBytes: number) {
    super("El objeto supera el límite de bytes aplicado durante la escritura.");
    this.name = "ObjectTooLargeError";
    this.limitBytes = limitBytes;
    this.receivedBytes = receivedBytes;
  }
}

export class EmptyObjectError extends Error {
  constructor() {
    super("Un objeto vacío se rechaza.");
    this.name = "EmptyObjectError";
  }
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("No hay un objeto publicado con esa clave.");
    this.name = "ObjectNotFoundError";
  }
}

export const STORAGE_WRITE_PHASES = [
  "BEFORE_PUBLISH",
  "AFTER_PUBLISH",
  "BEFORE_REMOVE",
  "AFTER_REMOVE",
] as const;

export type StorageWritePhase = (typeof STORAGE_WRITE_PHASES)[number];

/** Estado del objeto en un AFTER_PUBLISH, donde el objeto es propio (confirmado por el
 * `link` o por dev e inodo): retirado (`WITHDRAWN`, plan §8.4) o dejado en el lugar cuando
 * el retiro también falló (`LEFT_IN_PLACE`; el host registra la clave para borrarla en
 * P2). Una publicación cuyo resultado no se pudo determinar no es AFTER_PUBLISH: es
 * `UncertainPublicationError`. */
export type PublishedObjectState = "WITHDRAWN" | "LEFT_IN_PLACE";

export class StorageWriteError extends Error {
  readonly phase: StorageWritePhase;
  /** AFTER_PUBLISH, BEFORE_REMOVE y AFTER_REMOVE llevan la clave; BEFORE_PUBLISH no,
   * porque la clave nunca llegó a publicarse. */
  readonly key?: string;
  /** Solo AFTER_PUBLISH. */
  readonly objectState?: PublishedObjectState;
  /** Detalle adicional: CANCELLED anota la cancelación recibida antes de publicar. */
  readonly failureReason?: "CANCELLED";

  constructor(
    phase: StorageWritePhase,
    options: {
      key?: string;
      objectState?: PublishedObjectState;
      failureReason?: "CANCELLED";
      cause?: unknown;
    } = {},
  ) {
    super(
      `Escritura del almacenamiento fallida en ${phase}.`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "StorageWriteError";
    this.phase = phase;
    if (options.key !== undefined) this.key = options.key;
    if (options.objectState !== undefined) this.objectState = options.objectState;
    if (options.failureReason !== undefined) this.failureReason = options.failureReason;
  }
}

/**
 * Publicación cuyo resultado no se pudo determinar (plan §8.4.1): el `link` falló y la
 * comparación de dev e inodo también. Bajo `key` puede no haber nada, estar el objeto de
 * esta publicación o un objeto anterior. No es un objeto propio confirmado ni autoriza
 * borrar la clave: se concilia con `resolveUncertainPublication(key)`, que comprueba la
 * pertenencia con la prueba que conserva el adaptador. `delete(key)` también rechaza con
 * este error mientras la conciliación esté pendiente.
 */
export class UncertainPublicationError extends Error {
  readonly key: string;

  constructor(key: string, options: { cause?: unknown } = {}) {
    super(
      "No se pudo determinar si la publicación quedó bajo la clave; se concilia con resolveUncertainPublication.",
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "UncertainPublicationError";
    this.key = key;
  }
}

/** La instancia está cerrando o cerrada (plan §7.5): no admite operaciones nuevas. */
export class StorageClosedError extends Error {
  constructor() {
    super("El almacenamiento local está cerrando o cerrado: no admite operaciones nuevas.");
    this.name = "StorageClosedError";
  }
}

/** Señala si el error de escritura corresponde a un paso anterior a publicar. */
export function isBeforePublishWrite(error: unknown): boolean {
  return error instanceof StorageWriteError && error.phase === "BEFORE_PUBLISH";
}
