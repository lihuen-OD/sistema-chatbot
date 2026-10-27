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

export interface ObjectStorage {
  readonly kind: typeof LOCAL_PRIVATE_FOLDER_KIND;
  put(content: AsyncIterable<Uint8Array>, options: PutObjectOptions): Promise<StoredObject>;
  open(key: string): Promise<OpenedObject>;
  delete(key: string): Promise<"DELETED" | "ALREADY_ABSENT">;
  /** Conciliación de huérfanos (P2). Lista solo las claves con el formato propio y
   * archivos regulares del usuario del proceso, en orden determinista. */
  listObjects(): AsyncIterable<{ key: string; sizeBytes: number }>;
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

/** Estado del objeto en un AFTER_PUBLISH: retirado (`WITHDRAWN`, plan §8.4) o no
 * retirado (`LEFT_IN_PLACE`): el retiro falló, o un error del sistema impidió comprobar
 * si el `link` creó el objeto. En los dos casos el host registra la clave y la borra
 * con `delete` (P2), que da `ALREADY_ABSENT` si el objeto no estaba. */
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

/** Señala si el error de escritura corresponde a un paso anterior a publicar. */
export function isBeforePublishWrite(error: unknown): boolean {
  return error instanceof StorageWriteError && error.phase === "BEFORE_PUBLISH";
}
