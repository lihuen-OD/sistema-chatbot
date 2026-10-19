import { z } from "zod";

/**
 * Diagnósticos del motor ante entradas (docs/05, ADR-014). No son respuestas HTTP: van al
 * trace del simulador, al timeline del trámite y determinan el mensaje al empleado.
 */
export const ENGINE_DIAGNOSTIC_CODES = [
  "PROMPT_STALE",
  "CONFIRMATION_STALE",
  "CONFIRMATION_ALREADY_USED",
  "DISPATCH_ALREADY_STARTED",
  "CANDIDATE_LIMIT_REACHED",
  "CANDIDATE_NOT_SELECTABLE",
  "FILE_NOT_CORRELATED",
  "FILE_OUT_OF_STEP",
  "UNSUPPORTED_MESSAGE_TYPE",
  "UNEXPECTED_INPUT_LIMIT_REACHED",
  "CHANGE_LIMIT_REACHED",
  "CORRECTION_NOT_ALLOWED",
] as const;

export type EngineDiagnosticCode = (typeof ENGINE_DIAGNOSTIC_CODES)[number];

/** Motivos de FILE_NOT_CORRELATED (ADR-014 §12). */
export const FILE_NOT_CORRELATED_REASONS = [
  "MISSING_PROVIDER_TIMESTAMP",
  "NOT_AFTER_FILE_REQUEST_ANCHOR",
] as const;

const codesWithoutReason = ENGINE_DIAGNOSTIC_CODES.filter(
  (code): code is Exclude<EngineDiagnosticCode, "FILE_NOT_CORRELATED"> =>
    code !== "FILE_NOT_CORRELATED",
);

export const engineDiagnosticSchema = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("FILE_NOT_CORRELATED"),
    reason: z.enum(FILE_NOT_CORRELATED_REASONS),
  }),
  z.strictObject({ code: z.enum(codesWithoutReason) }),
]);

export type EngineDiagnostic = z.infer<typeof engineDiagnosticSchema>;

/**
 * Motivos de bloqueo de una entrega (ADR-012). Son el `blockReason` de Delivery, no respuestas
 * HTTP.
 */
export const DELIVERY_BLOCK_REASONS = [
  "RULE_NOT_MATCHED",
  "RULES_AMBIGUOUS",
  "RECIPIENTS_MISSING",
  "RECIPIENT_NOT_AUTHORIZED",
  "RECIPIENT_BLOCKED",
  "RECIPIENTS_LIMIT_EXCEEDED",
  "EMPLOYEE_SCOPE_REVOKED",
] as const;

export type DeliveryBlockReason = (typeof DELIVERY_BLOCK_REASONS)[number];

export const deliveryBlockReasonSchema = z.enum(DELIVERY_BLOCK_REASONS);
