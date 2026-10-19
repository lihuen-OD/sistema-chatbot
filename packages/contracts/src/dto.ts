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
 * Profundidad máxima de contenedores de un borrador (definición o layout, cada uno por separado).
 * El objeto raíz es el nivel 1. Una definición de la DSL v1 llega como máximo a 8 niveles.
 */
export const MAX_DRAFT_JSON_DEPTH = 32;

/**
 * Cantidad máxima de valores JSON (contenedores y primitivos) por borrador, cada campo por
 * separado. Una definición en los límites de tamaño de FLOW_LIMITS tiene unos 218.000 valores:
 * este máximo la admite para que todo flujo publicable se pueda guardar como borrador.
 */
export const MAX_DRAFT_JSON_VALUES = 250_000;

interface DraftJsonProblem {
  readonly reason: "MAX_DEPTH" | "MAX_VALUES";
  readonly limit: number;
}

/**
 * Recorrido iterativo y acotado, previo a la validación recursiva de z.json: se detiene en cuanto
 * supera la profundidad o la cantidad de valores. Comprueba el largo de cada arreglo antes de
 * recorrerlo y corta la iteración de un objeto al superar el máximo.
 */
function draftJsonProblem(root: unknown): DraftJsonProblem | undefined {
  const pending: [unknown, number][] = [[root, 1]];
  let seen = 1;
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const [value, depth] = entry;
    if (typeof value !== "object" || value === null) continue;
    if (depth > MAX_DRAFT_JSON_DEPTH) return { reason: "MAX_DEPTH", limit: MAX_DRAFT_JSON_DEPTH };
    if (Array.isArray(value)) {
      seen += value.length;
      if (seen > MAX_DRAFT_JSON_VALUES)
        return { reason: "MAX_VALUES", limit: MAX_DRAFT_JSON_VALUES };
      for (const child of value) pending.push([child, depth + 1]);
      continue;
    }
    const record = value as Record<string, unknown>;
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      seen++;
      if (seen > MAX_DRAFT_JSON_VALUES)
        return { reason: "MAX_VALUES", limit: MAX_DRAFT_JSON_VALUES };
      pending.push([record[key], depth + 1]);
    }
  }
  return undefined;
}

/**
 * Objeto JSON del borrador. Un borrador puede estar incompleto: su estructura y semántica se
 * validan con flow-schema al validar o publicar. Primero se acotan profundidad y cantidad de
 * valores (resultado controlado, sin RangeError); después se valida que sea JSON. El límite de
 * bytes del cuerpo HTTP (413) sigue siendo necesario y no lo reemplaza.
 */
export const jsonObjectSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const problem = draftJsonProblem(value);
    if (problem === undefined) return;
    ctx.addIssue({
      code: "custom",
      message:
        problem.reason === "MAX_DEPTH"
          ? `El borrador supera la profundidad máxima de ${String(problem.limit)} niveles.`
          : `El borrador supera la cantidad máxima de ${String(problem.limit)} valores.`,
      params: { reason: problem.reason, limit: problem.limit },
    });
  })
  .pipe(z.record(z.string(), z.json()));

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
