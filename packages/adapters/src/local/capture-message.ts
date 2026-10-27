// Mensaje de una captura local (plan de P1-T5, §9.2 y §9.3): validación previa a escribir,
// formato canónico de `payload/message.json` y de `record.json`, y su validación al
// leerlos. Los límites salen de `flow-schema` (asunto, destinatarios, MIME y la posición
// de CR/LF de T53). Ningún motivo de rechazo lleva el valor rechazado.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  ALLOWED_MIME_TYPES,
  lineBreakPosition,
  RULE_LIMITS,
  SUBJECT_MAX_LENGTH,
} from "@sistema-chatbot/flow-schema";
import {
  CAPTURE_ID_PATTERN,
  type EmailRejectedResult,
  type EmailRejectionReason,
  type OutgoingAttachment,
} from "../ports/email.js";

export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const TEXT_BODY_MAX_BYTES = 64 * 1024;
export const ATTACHMENT_FILE_NAME_MAX_LENGTH = 255;
/** Tope de `record.json` al leerlo (§9.6). */
export const RECORD_MAX_BYTES = 4096;
/** Tope de `message.json` al leerlo: cuerpo de 64 KiB que, escapado en JSON, puede ocupar
 * el doble, más destinatarios, asunto y metadatos. */
export const MESSAGE_MAX_BYTES = 256 * 1024;

export const RECORD_FORMAT = "LOCAL_CAPTURE_RECORD_V1" as const;
export const MESSAGE_FORMAT = "LOCAL_CAPTURE_V1" as const;
export const NOT_SENT = "NOT_SENT_LOCAL_CAPTURE" as const;

/** Forma de email de la especificación HTML (dirección válida), con al menos un punto en
 * el dominio. Es una comprobación de forma: la captura no resuelve ni contacta dominios. */
const EMAIL_SHAPE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const EMAIL_MAX_LENGTH = 254;
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Algún carácter de control C0 (U+0000 a U+001F) o DEL (U+007F), salvo los permitidos. */
function hasControlCharacter(text: string, allowed: readonly number[] = []): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code <= 0x1f || code === 0x7f) && !allowed.includes(code)) return true;
  }
  return false;
}

/** En el cuerpo se admiten tabulador (U+0009) y salto de línea (U+000A); nada más de control. */
const BODY_ALLOWED_CONTROL: readonly number[] = [0x09, 0x0a];

export interface ValidatedEmail {
  readonly to: readonly string[];
  readonly subject: string;
  readonly textBody: string;
  readonly attachment: OutgoingAttachment | null;
}

export type EmailValidation =
  | { readonly ok: true; readonly email: ValidatedEmail }
  | { readonly ok: false; readonly rejection: EmailRejectedResult };

function rejected(
  reason: EmailRejectionReason,
  extra: { lineBreakPosition?: number; recipientIndex?: number } = {},
): EmailValidation {
  return { ok: false, rejection: Object.freeze({ outcome: "REJECTED", reason, ...extra }) };
}

/** Validación de §9.2, antes de escribir nada. También comprueba los tipos en tiempo de
 * ejecución: el tipado del llamador no reemplaza el control. */
export function validateOutgoingEmail(idempotencyKey: unknown, message: unknown): EmailValidation {
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !PRINTABLE_ASCII.test(idempotencyKey)
  ) {
    return rejected("INVALID_IDEMPOTENCY_KEY");
  }
  if (typeof message !== "object" || message === null) return rejected("INVALID_MESSAGE");
  const { to, subject, textBody, attachment } = message as Record<string, unknown>;
  if (!Array.isArray(to) || typeof subject !== "string" || typeof textBody !== "string") {
    return rejected("INVALID_MESSAGE");
  }

  if (subject.length === 0) return rejected("SUBJECT_EMPTY");
  const position = lineBreakPosition(subject);
  if (position >= 0) return rejected("SUBJECT_LINE_BREAK", { lineBreakPosition: position });
  if (subject.length > SUBJECT_MAX_LENGTH) return rejected("SUBJECT_TOO_LONG");

  if (to.length === 0) return rejected("NO_RECIPIENTS");
  if (to.length > RULE_LIMITS.recipientsPerDelivery) return rejected("TOO_MANY_RECIPIENTS");
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const [recipientIndex, recipient] of to.entries()) {
    if (
      typeof recipient !== "string" ||
      recipient.length > EMAIL_MAX_LENGTH ||
      hasControlCharacter(recipient) ||
      !EMAIL_SHAPE.test(recipient)
    ) {
      return rejected("INVALID_RECIPIENT", { recipientIndex });
    }
    const normalized = recipient.toLowerCase();
    if (seen.has(normalized)) return rejected("DUPLICATE_RECIPIENT", { recipientIndex });
    seen.add(normalized);
    recipients.push(recipient);
  }

  if (textBody.length === 0) return rejected("BODY_EMPTY");
  if (Buffer.byteLength(textBody, "utf8") > TEXT_BODY_MAX_BYTES) return rejected("BODY_TOO_LARGE");
  if (hasControlCharacter(textBody, BODY_ALLOWED_CONTROL))
    return rejected("BODY_CONTROL_CHARACTER");

  let validatedAttachment: OutgoingAttachment | null = null;
  if (attachment !== undefined) {
    if (typeof attachment !== "object" || attachment === null) return rejected("INVALID_MESSAGE");
    const { fileName, mimeType, content } = attachment as Record<string, unknown>;
    if (
      typeof fileName !== "string" ||
      fileName.length < 1 ||
      fileName.length > ATTACHMENT_FILE_NAME_MAX_LENGTH ||
      hasControlCharacter(fileName) ||
      fileName.includes("/") ||
      fileName.includes("\\")
    ) {
      return rejected("INVALID_ATTACHMENT_NAME");
    }
    if (typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return rejected("ATTACHMENT_MIME_NOT_ALLOWED");
    }
    if (
      typeof content !== "object" ||
      content === null ||
      typeof (content as Partial<AsyncIterable<Uint8Array>>)[Symbol.asyncIterator] !== "function"
    ) {
      return rejected("INVALID_MESSAGE");
    }
    validatedAttachment = { fileName, mimeType, content: content as AsyncIterable<Uint8Array> };
  }
  return {
    ok: true,
    email: Object.freeze({
      to: Object.freeze(recipients),
      subject,
      textBody,
      attachment: validatedAttachment,
    }),
  };
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `captureId` (§9.3): los primeros 32 hexadecimales del SHA-256 de la clave. */
export function captureIdentity(idempotencyKey: string): {
  captureId: string;
  idempotencyKeySha256: string;
} {
  const idempotencyKeySha256 = sha256Hex(idempotencyKey);
  return { captureId: idempotencyKeySha256.slice(0, 32), idempotencyKeySha256 };
}

export interface AttachmentMetadata {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface CaptureMessageDocument {
  readonly format: typeof MESSAGE_FORMAT;
  readonly delivered: false;
  readonly to: readonly string[];
  readonly subject: string;
  readonly textBody: string;
  readonly attachment: AttachmentMetadata | null;
}

/** `payload/message.json` canónico (§9.3): orden de claves fijo, los destinatarios en el
 * orden recibido. `contentSha256` es el SHA-256 de exactamente estos bytes, que incluyen el
 * SHA-256 del adjunto: dos envíos con la misma clave tienen el mismo contenido si y solo si
 * producen los mismos bytes. */
export function serializeMessage(
  email: ValidatedEmail,
  attachment: AttachmentMetadata | null,
): Uint8Array {
  const document: CaptureMessageDocument = {
    format: MESSAGE_FORMAT,
    delivered: false,
    to: email.to,
    subject: email.subject,
    textBody: email.textBody,
    attachment:
      attachment === null
        ? null
        : {
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            sha256: attachment.sha256,
          },
  };
  return new TextEncoder().encode(`${JSON.stringify(document)}\n`);
}

export interface CaptureRecordDocument {
  readonly format: typeof RECORD_FORMAT;
  readonly captureId: string;
  readonly publicationId: string;
  readonly idempotencyKeySha256: string;
  readonly contentSha256: string;
  readonly capturedAt: string;
  readonly delivery: typeof NOT_SENT;
  readonly delivered: false;
}

/** `record.json` (§9.3): solo hashes, identificadores aleatorios, fechas y constantes. Sin
 * destinatarios, asunto, cuerpo, nombre de archivo ni la clave en claro. */
export function serializeRecord(
  record: Omit<CaptureRecordDocument, "format" | "delivery" | "delivered">,
): Uint8Array {
  const document: CaptureRecordDocument = {
    format: RECORD_FORMAT,
    captureId: record.captureId,
    publicationId: record.publicationId,
    idempotencyKeySha256: record.idempotencyKeySha256,
    contentSha256: record.contentSha256,
    capturedAt: record.capturedAt,
    delivery: NOT_SENT,
    delivered: false,
  };
  return new TextEncoder().encode(`${JSON.stringify(document)}\n`);
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Valida `record.json` leído de disco; `null` si no cumple el esquema o es de otra
 * captura. */
export function parseRecord(bytes: Uint8Array, captureId: string): CaptureRecordDocument | null {
  const value = parseJsonObject(bytes);
  if (value === null) return null;
  const keys = [
    "format",
    "captureId",
    "publicationId",
    "idempotencyKeySha256",
    "contentSha256",
    "capturedAt",
    "delivery",
    "delivered",
  ];
  if (!hasExactlyKeys(value, keys)) return null;
  const { capturedAt } = value;
  if (
    value["format"] !== RECORD_FORMAT ||
    value["captureId"] !== captureId ||
    typeof value["publicationId"] !== "string" ||
    !CAPTURE_ID_PATTERN.test(value["publicationId"]) ||
    typeof value["idempotencyKeySha256"] !== "string" ||
    !SHA256_HEX.test(value["idempotencyKeySha256"]) ||
    typeof value["contentSha256"] !== "string" ||
    !SHA256_HEX.test(value["contentSha256"]) ||
    typeof capturedAt !== "string" ||
    Number.isNaN(Date.parse(capturedAt)) ||
    value["delivery"] !== NOT_SENT ||
    value["delivered"] !== false
  ) {
    return null;
  }
  return value as unknown as CaptureRecordDocument;
}

/** Valida `message.json` leído de disco (cuyos bytes ya coincidieron con `contentSha256`);
 * `null` si no cumple el esquema. */
export function parseMessage(bytes: Uint8Array): CaptureMessageDocument | null {
  const value = parseJsonObject(bytes);
  if (value === null) return null;
  if (!hasExactlyKeys(value, ["format", "delivered", "to", "subject", "textBody", "attachment"])) {
    return null;
  }
  const { to, attachment } = value;
  if (
    value["format"] !== MESSAGE_FORMAT ||
    value["delivered"] !== false ||
    !Array.isArray(to) ||
    !to.every((recipient) => typeof recipient === "string") ||
    typeof value["subject"] !== "string" ||
    typeof value["textBody"] !== "string"
  ) {
    return null;
  }
  if (attachment !== null) {
    if (typeof attachment !== "object" || Array.isArray(attachment)) return null;
    const metadata = attachment as Record<string, unknown>;
    if (
      !hasExactlyKeys(metadata, ["fileName", "mimeType", "sizeBytes", "sha256"]) ||
      typeof metadata["fileName"] !== "string" ||
      typeof metadata["mimeType"] !== "string" ||
      typeof metadata["sizeBytes"] !== "number" ||
      !Number.isSafeInteger(metadata["sizeBytes"]) ||
      metadata["sizeBytes"] < 0 ||
      typeof metadata["sha256"] !== "string" ||
      !SHA256_HEX.test(metadata["sha256"])
    ) {
      return null;
    }
  }
  return value as unknown as CaptureMessageDocument;
}
