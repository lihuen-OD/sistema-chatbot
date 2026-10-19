import { z } from "zod";
import { idSchema, labelSchema } from "./common.js";

// V1 define estas clasificaciones; agregar otra requiere actualizar ADR-012.
const classificationCodeSchema = z.enum(["GENERAL", "SENSITIVE_HR"]);

const identityStatusSchema = z.enum(["PENDING_VERIFICATION", "ACTIVE", "REVOKED"]);
const linkMethodSchema = z.enum(["DIRECTORY_ENROLLMENT", "PROVIDER_ASSERTED", "ADMIN_APPROVED"]);

// Identidades de canal con su ámbito (ADR-011). El BSUID es un valor opaco.
const channelIdentitySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    provider: z.literal("WHATSAPP"),
    kind: z.literal("PHONE_E164"),
    scopeType: z.literal("E164"),
    scopeId: z.literal("global"),
    normalizedValue: z.string().regex(/^\+[1-9]\d{6,14}$/),
    status: identityStatusSchema,
    linkMethod: linkMethodSchema,
  }),
  z.strictObject({
    provider: z.literal("WHATSAPP"),
    kind: z.literal("WHATSAPP_BSUID"),
    scopeType: z.literal("BUSINESS"),
    scopeId: idSchema,
    normalizedValue: z.string().min(1).max(128),
    status: identityStatusSchema,
    linkMethod: linkMethodSchema,
  }),
]);

export const directorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  organization: z.strictObject({ id: idSchema, name: labelSchema }),
  companies: z.array(z.strictObject({ id: idSchema, name: labelSchema, active: z.boolean() })),
  classifications: z.array(
    z.strictObject({ code: classificationCodeSchema, sensitive: z.boolean() }),
  ),
  documentCatalog: z.strictObject({
    catalogId: idSchema,
    version: z.int().min(1),
    documentTypes: z.array(
      z.strictObject({
        id: idSchema,
        label: labelSchema,
        classification: classificationCodeSchema,
        active: z.boolean(),
        companyIds: z.array(idSchema).optional(),
      }),
    ),
  }),
  employees: z.array(
    z.strictObject({
      id: idSchema,
      employeeNumber: z.string().min(1).max(64),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      companyScopes: z.array(idSchema),
      identities: z.array(channelIdentitySchema),
    }),
  ),
  contacts: z.array(
    z.strictObject({
      id: idSchema,
      companyId: idSchema,
      email: z.email(),
      allowedClassifications: z.array(classificationCodeSchema),
      active: z.boolean(),
    }),
  ),
  recipientGroups: z.array(
    z.strictObject({
      id: idSchema,
      companyId: idSchema,
      allowedClassifications: z.array(classificationCodeSchema),
      memberContactIds: z.array(idSchema),
    }),
  ),
});

export type Directory = z.infer<typeof directorySchema>;
export type Company = Directory["companies"][number];
export type DocumentType = Directory["documentCatalog"]["documentTypes"][number];
export type Contact = Directory["contacts"][number];
export type RecipientGroup = Directory["recipientGroups"][number];
