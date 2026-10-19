import { z } from "zod";
import { internalIdSchema, revisionSchema } from "./primitives.js";
import { issuePathSchema, validationReportSchema } from "./validation-issues.js";

/**
 * Códigos de error HTTP de la API y su estado (docs/05). Los problemas de validación de
 * definiciones no son códigos HTTP propios: viajan dentro de FLOW_INVALID con los códigos de
 * flow-schema.
 */
export const API_ERROR_STATUS = {
  REQUEST_INVALID: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  FLOW_INVALID: 422,
  DRAFT_REVISION_CONFLICT: 409,
  IDENTITY_CONFLICT: 409,
  SUBMISSION_ALREADY_ACTIVE: 409,
  CLASSIFICATION_RELAX_FORBIDDEN: 403,
  CLASSIFICATION_IMPACT_CHANGED: 409,
} as const satisfies Record<string, number>;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export const API_ERROR_CODES = Object.keys(API_ERROR_STATUS) as readonly ApiErrorCode[];

export const MAX_ERROR_MESSAGE_LENGTH = 500;
export const MAX_REQUEST_PROBLEMS = 50;

const errorBase = {
  message: z.string().min(1).max(MAX_ERROR_MESSAGE_LENGTH),
  requestId: internalIdSchema,
};

/** Problemas de una solicitud mal formada: ruta y motivo, sin repetir valores recibidos. */
export const requestProblemSchema = z.strictObject({
  path: issuePathSchema,
  reason: z.string().min(1).max(64),
});

export type RequestProblem = z.infer<typeof requestProblemSchema>;

type CodesWithoutDetails = Exclude<
  ApiErrorCode,
  "REQUEST_INVALID" | "FLOW_INVALID" | "DRAFT_REVISION_CONFLICT"
>;

const codesWithoutDetails = (Object.keys(API_ERROR_STATUS) as ApiErrorCode[]).filter(
  (code): code is CodesWithoutDetails =>
    code !== "REQUEST_INVALID" && code !== "FLOW_INVALID" && code !== "DRAFT_REVISION_CONFLICT",
);

/**
 * Error público: code, message, requestId y details tipados por código. Solo tres códigos
 * llevan details; el resto los rechaza, para no publicar datos arbitrarios.
 */
export const apiErrorSchema = z.discriminatedUnion("code", [
  z.strictObject({
    ...errorBase,
    code: z.literal("REQUEST_INVALID"),
    details: z.strictObject({
      problems: z.array(requestProblemSchema).min(1).max(MAX_REQUEST_PROBLEMS),
    }),
  }),
  z.strictObject({
    ...errorBase,
    code: z.literal("FLOW_INVALID"),
    details: validationReportSchema,
  }),
  z.strictObject({
    ...errorBase,
    code: z.literal("DRAFT_REVISION_CONFLICT"),
    details: z.strictObject({ currentRevision: revisionSchema }),
  }),
  z.strictObject({ ...errorBase, code: z.enum(codesWithoutDetails) }),
]);

export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiErrorResponseSchema = z.strictObject({ error: apiErrorSchema });

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export function apiErrorStatus(code: ApiErrorCode): number {
  return API_ERROR_STATUS[code];
}
