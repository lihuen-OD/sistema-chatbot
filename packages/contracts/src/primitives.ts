import { bsuidValueSchema, e164PhoneSchema, idSchema } from "@sistema-chatbot/flow-schema";
import { z } from "zod";

/** Identificadores internos opacos (UUID, ULID u otros generados por el sistema). */
export const internalIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);

/** Identificadores asignados por un proveedor externo: ASCII imprimible, sin espacios. */
export const providerIdSchema = z.string().regex(/^[\x21-\x7E]{1,256}$/);

/** Instantes ISO 8601 en UTC con sufijo Z (docs/05). */
export const utcDateTimeSchema = z.iso.datetime();

export const MAX_INT32 = 2_147_483_647;

/** Revisiones (de contexto o de borrador): enteros no negativos. */
export const revisionSchema = z.int().min(0).max(MAX_INT32);

/** Generación de un trámite por empleado y número (ADR-014 §12): empieza en 1. */
export const generationSchema = z.int().min(1).max(MAX_INT32);

/** Tamaños en bytes: enteros seguros no negativos. El host decide si superan los límites. */
export const byteSizeSchema = z.int().min(0);

export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Tipo MIME declarado (tipo/subtipo, sin parámetros). Se valida contra los permitidos en el host. */
export const mimeTypeSchema = z
  .string()
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/);

/** Nombre de archivo declarado por el empleado: dato no confiable, sin caracteres de control. */
export const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !hasControlCharacter(value), {
    message: "El nombre de archivo no admite caracteres de control.",
  });

/**
 * Identidad del remitente tal como la normaliza el adaptador, con su ámbito (ADR-011).
 * Es un dato a resolver por el host: no prueba identidad laboral ni permisos.
 */
export const senderIdentitySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    provider: z.literal("WHATSAPP"),
    kind: z.literal("PHONE_E164"),
    scopeType: z.literal("E164"),
    scopeId: z.literal("global"),
    value: e164PhoneSchema,
  }),
  z.strictObject({
    provider: z.literal("WHATSAPP"),
    kind: z.literal("WHATSAPP_BSUID"),
    scopeType: z.literal("BUSINESS"),
    scopeId: idSchema,
    value: bsuidValueSchema,
  }),
]);

export const MAX_SENDER_IDENTITIES = 4;

export const senderIdentitiesSchema = z
  .array(senderIdentitySchema)
  .min(1)
  .max(MAX_SENDER_IDENTITIES)
  .refine(
    (identities) =>
      new Set(identities.map((identity) => identityKey(identity))).size === identities.length,
    { message: "Identidades repetidas en el mismo evento." },
  );

export type SenderIdentity = z.infer<typeof senderIdentitySchema>;

function identityKey(identity: SenderIdentity): string {
  return [
    identity.provider,
    identity.kind,
    identity.scopeType,
    identity.scopeId,
    identity.value,
  ].join("\u0000");
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
