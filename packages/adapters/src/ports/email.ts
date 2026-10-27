// Puerto de correo saliente (plan de P1-T5, §9.1). El adaptador local de este bloque captura
// el correo en disco y nunca lo entrega: su resultado es CAPTURED, con `delivered: false`, y
// el emisor declara `deliversExternally: false`. P5 agrega el proveedor real detrás del
// mismo puerto, con sus resultados propios (PROVIDER_ACCEPTED y UNKNOWN, ADR-006).

/** Tipo del emisor local: captura sin entrega. */
export const LOCAL_CAPTURE_KIND = "LOCAL_CAPTURE" as const;

/** Prefijo de 128 bits del SHA-256 de la clave de idempotencia: identifica la captura y su
 * directorio. La clave en claro nunca forma rutas ni se guarda (plan §9.3). */
export const CAPTURE_ID_PATTERN = /^[0-9a-f]{32}$/;

export interface OutgoingAttachment {
  /** Solo un metadato: nunca forma una ruta (plan §9.2). */
  readonly fileName: string;
  readonly mimeType: string;
  readonly content: AsyncIterable<Uint8Array>;
}

export interface OutgoingEmail {
  /** De 1 a 20 direcciones, sin repetidas. */
  readonly to: readonly string[];
  /** Asunto final, ya interpolado: es la comprobación de CR/LF del adaptador (T53). */
  readonly subject: string;
  /** Hasta 64 KiB en UTF-8. */
  readonly textBody: string;
  /** Cero o un adjunto. */
  readonly attachment?: OutgoingAttachment;
}

/** Motivos de `REJECTED` (plan §9.2 y §9.6). Ninguno lleva el valor rechazado. */
export type EmailRejectionReason =
  | "INVALID_MESSAGE"
  | "INVALID_IDEMPOTENCY_KEY"
  | "SUBJECT_EMPTY"
  | "SUBJECT_TOO_LONG"
  | "SUBJECT_LINE_BREAK"
  | "NO_RECIPIENTS"
  | "TOO_MANY_RECIPIENTS"
  | "INVALID_RECIPIENT"
  | "DUPLICATE_RECIPIENT"
  | "BODY_EMPTY"
  | "BODY_TOO_LARGE"
  | "BODY_CONTROL_CHARACTER"
  | "INVALID_ATTACHMENT_NAME"
  | "ATTACHMENT_MIME_NOT_ALLOWED"
  | "ATTACHMENT_TOO_LARGE"
  | "IDEMPOTENCY_CONFLICT";

export interface EmailCapturedResult {
  readonly outcome: "CAPTURED";
  readonly captureId: string;
  /** La misma clave ya tenía una captura con el mismo contenido: no se creó otra. */
  readonly duplicate: boolean;
  /** `false` si el contenido de la captura ya se purgó y solo queda el registro. */
  readonly payloadAvailable: boolean;
  /** Una captura local nunca es un correo enviado ni entregado. */
  readonly delivered: false;
}

export interface EmailRejectedResult {
  readonly outcome: "REJECTED";
  readonly reason: EmailRejectionReason;
  /** Solo con `SUBJECT_LINE_BREAK`: posición del primer CR o LF (`lineBreakPosition`). */
  readonly lineBreakPosition?: number;
  /** Con los motivos de un destinatario: su posición en `to`. */
  readonly recipientIndex?: number;
}

export type EmailSendResult = EmailCapturedResult | EmailRejectedResult;

export interface EmailSender {
  readonly kind: typeof LOCAL_CAPTURE_KIND;
  readonly deliversExternally: false;
  send(idempotencyKey: string, message: OutgoingEmail): Promise<EmailSendResult>;
}

/** Fase de un fallo de escritura de la captura (plan §9.5). `PUBLISH_UNCERTAIN`: el
 * `rename` de publicación falló y la comparación de dev e inodo de la entrada también, así
 * que no se sabe si la captura quedó publicada (precisión del 27/10/2026, como §8.4.1). */
export type CaptureWritePhase = "BEFORE_PUBLISH" | "AFTER_PUBLISH" | "PUBLISH_UNCERTAIN";

/** Fallo de escritura de la captura. Con BEFORE_PUBLISH esta llamada no publicó nada; con
 * AFTER_PUBLISH la captura está publicada y completa, con la durabilidad sin confirmar; con
 * PUBLISH_UNCERTAIN no se sabe. Los dos últimos llevan `captureId`. En todos los casos el
 * host reintenta con la misma clave: como `captureId` es determinista, el reintento
 * encuentra la captura y la verifica, o la publica si no estaba (plan §9.5). */
export class CaptureWriteError extends Error {
  readonly phase: CaptureWritePhase;
  readonly captureId?: string;

  constructor(phase: CaptureWritePhase, options: { captureId?: string; cause?: unknown } = {}) {
    super(
      `Escritura de la captura fallida en ${phase}.`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "CaptureWriteError";
    this.phase = phase;
    if (options.captureId !== undefined) this.captureId = options.captureId;
  }
}

/** La clave siguió bloqueada durante toda la espera (plan §9.4). Reintentable. Si persiste,
 * puede indicar un bloqueo abandonado que requiere el mantenimiento de §7.3. */
export class CaptureKeyBusyError extends Error {
  readonly code = "KEY_BUSY" as const;
  readonly captureId: string;

  constructor(captureId: string) {
    super("La clave de la captura siguió bloqueada durante toda la espera.");
    this.name = "CaptureKeyBusyError";
    this.captureId = captureId;
  }
}

/** Motivos de `CaptureIntegrityError`. Ninguno incluye rutas completas ni contenido. */
export type CaptureIntegrityReason =
  | "ENTRY_NOT_PRIVATE_DIRECTORY"
  | "RECORD_MISSING"
  | "RECORD_INVALID"
  | "IDEMPOTENCY_KEY_MISMATCH"
  | "PAYLOAD_INCOMPLETE"
  | "PAYLOAD_MISMATCH"
  | "ENTRY_VANISHED_UNDER_LOCK"
  | "ENTRY_APPEARED_UNDER_LOCK"
  | "STAGED_MISSING"
  | "LOCK_NOT_OWNED";

/** Estado de una entrada que no corresponde al protocolo (plan §9.7). No se reintenta: el
 * host la trata como incierta y queda para un operador. La entrada no se modifica. */
export class CaptureIntegrityError extends Error {
  readonly captureId: string;
  readonly reason: CaptureIntegrityReason;

  constructor(captureId: string, reason: CaptureIntegrityReason) {
    super(`Estado inesperado de la captura (${reason}).`);
    this.name = "CaptureIntegrityError";
    this.captureId = captureId;
    this.reason = reason;
  }
}

/** No hay captura con ese `captureId` (solo `readCapture`). */
export class CaptureNotFoundError extends Error {
  readonly captureId: string;

  constructor(captureId: string) {
    super("No hay una captura con ese identificador.");
    this.name = "CaptureNotFoundError";
    this.captureId = captureId;
  }
}

/** El identificador no tiene el formato de una captura (32 hexadecimales en minúscula). */
export class InvalidCaptureIdError extends Error {
  constructor() {
    super("El identificador de captura no tiene el formato esperado.");
    this.name = "InvalidCaptureIdError";
  }
}

/** La instancia de captura está cerrando o cerrada (plan §7.5). */
export class CaptureClosedError extends Error {
  constructor() {
    super("La captura local de correo está cerrando o cerrada: no admite operaciones nuevas.");
    this.name = "CaptureClosedError";
  }
}

/** Una captura leída con `readCapture` (plan §9.3 y §9.7). Siempre validada contra
 * `contentSha256`: datos íntegros, el registro sin contenido o nada; nunca una mezcla. */
export interface CapturedEmail {
  readonly captureId: string;
  readonly publicationId: string;
  readonly capturedAt: string;
  readonly contentSha256: string;
  readonly delivery: "NOT_SENT_LOCAL_CAPTURE";
  readonly delivered: false;
  readonly payloadAvailable: boolean;
  /** `null` si el contenido se purgó (`payloadAvailable: false`). */
  readonly message: CapturedMessage | null;
}

export interface CapturedMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly textBody: string;
  readonly attachment: {
    readonly fileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly content: Uint8Array;
  } | null;
}

/** Informe de `purgeCaptures()` (plan §9.8): identificadores y cantidades, sin contenido. */
export interface CapturePurgeReport {
  readonly scanned: number;
  readonly payloadsPurged: number;
  readonly entriesPurged: number;
  /** Claves omitidas porque estaban ocupadas (incluido un bloqueo abandonado). */
  readonly skippedBusy: readonly string[];
  /** Claves omitidas porque bajo el bloqueo había otra publicación (otro `publicationId`). */
  readonly skippedRecreated: readonly string[];
  /** Entradas con un problema de integridad (§9.7) que la purga informa y omite. */
  readonly integrityProblems: readonly { captureId: string; reason: CaptureIntegrityReason }[];
  /** Entradas que no se pudieron leer por un error del sistema: no se tratan como ausentes. */
  readonly unreadable: readonly string[];
}
