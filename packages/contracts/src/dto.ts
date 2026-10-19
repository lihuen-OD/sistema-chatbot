import { z } from "zod";
import {
  internalIdSchema,
  revisionSchema,
  sha256HexSchema,
  utcDateTimeSchema,
} from "./primitives.js";
import { validationReportSchema } from "./validation-issues.js";

// DTO iniciales acordados (docs/05): borrador con revisión optimista, validación y publicación
// de flujos. Los recursos administrativos restantes quedan pendientes (README del paquete).

/**
 * Objeto JSON del borrador. Un borrador puede estar incompleto: su estructura y semántica se
 * validan con flow-schema al validar o publicar. El tamaño del cuerpo lo limita la API (413).
 */
export const jsonObjectSchema = z.record(z.string(), z.json());

/** GET /flows/:id/draft */
export const flowDraftResponseSchema = z.strictObject({
  flowId: internalIdSchema,
  revision: revisionSchema,
  definition: jsonObjectSchema,
  layout: jsonObjectSchema.optional(),
  updatedAt: utcDateTimeSchema,
});

/** PUT /flows/:id/draft. Con otra revisión vigente responde DRAFT_REVISION_CONFLICT (409). */
export const flowDraftUpdateRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  definition: jsonObjectSchema,
  layout: jsonObjectSchema.optional(),
});

export const flowDraftUpdateResponseSchema = z.strictObject({
  flowId: internalIdSchema,
  revision: revisionSchema,
});

/** POST /flows/:id/validate: valida exactamente esa revisión del borrador. */
export const flowValidationRequestSchema = z.strictObject({
  revision: revisionSchema,
});

export const flowValidationResponseSchema = z
  .strictObject({
    flowId: internalIdSchema,
    revision: revisionSchema,
    valid: z.boolean(),
    report: validationReportSchema,
  })
  .refine((response) => response.valid === (response.report.totalIssues === 0), {
    message: "valid debe coincidir con la ausencia de problemas.",
    path: ["valid"],
  });

/**
 * POST /flows/:id/publish: publica exactamente la revisión y el hash revisados. Con problemas
 * responde FLOW_INVALID (422); con otra revisión vigente, DRAFT_REVISION_CONFLICT (409).
 */
export const flowPublishRequestSchema = z.strictObject({
  revision: revisionSchema,
  contentHash: sha256HexSchema,
});

export const flowPublishResponseSchema = z.strictObject({
  flowId: internalIdSchema,
  version: z.int().min(1),
  revision: revisionSchema,
  contentHash: sha256HexSchema,
  publishedAt: utcDateTimeSchema,
});

export type FlowDraftResponse = z.infer<typeof flowDraftResponseSchema>;
export type FlowDraftUpdateRequest = z.infer<typeof flowDraftUpdateRequestSchema>;
export type FlowDraftUpdateResponse = z.infer<typeof flowDraftUpdateResponseSchema>;
export type FlowValidationRequest = z.infer<typeof flowValidationRequestSchema>;
export type FlowValidationResponse = z.infer<typeof flowValidationResponseSchema>;
export type FlowPublishRequest = z.infer<typeof flowPublishRequestSchema>;
export type FlowPublishResponse = z.infer<typeof flowPublishResponseSchema>;
