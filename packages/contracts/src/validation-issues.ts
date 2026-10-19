import {
  idSchema,
  ISSUE_CODES,
  type PublicationValidation,
  type ValidationIssue,
} from "@sistema-chatbot/flow-schema";
import { z } from "zod";

// Problemas de validación de definiciones (flow-schema) tal como viajan por la API. Conservan
// código, documento, ruta y nodo. `details` pasa por una lista permitida con tipos y tamaños
// acotados: lo que no está permitido se descarta al convertir y el esquema lo rechaza.

export const MAX_ISSUES_PER_RESPONSE = 500;
export const MAX_PATH_SEGMENTS = 16;
export const MAX_ISSUE_MESSAGE_LENGTH = 500;

const pathSegmentSchema = z.union([z.string().max(128), z.int().min(0)]);
export const issuePathSchema = z.array(pathSegmentSchema).max(MAX_PATH_SEGMENTS);

const shortText = z.string().max(128);
const detailScalar = z.union([z.string().max(200), z.number(), z.boolean()]);
const detailList = z.array(z.string().max(128)).max(20);

/**
 * Claves permitidas en `details`. Quedan fuera, a propósito, identificadores de personas o de
 * otros ámbitos que emite flow-schema: `contactId`, `ownerEmployeeId` y `scopeId`. La API (P4)
 * decidirá según permisos si expone más información.
 */
export const validationIssueDetailsSchema = z.strictObject({
  reason: shortText.optional(),
  description: z.string().max(200).optional(),
  limit: shortText.optional(),
  max: z.number().optional(),
  actual: detailScalar.optional(),
  expected: detailScalar.optional(),
  supported: z.number().optional(),
  position: z.int().min(0).optional(),
  upperBound: z.int().min(0).optional(),
  maxOptions: z.int().min(0).optional(),
  combinations: z.number().optional(),
  value: detailScalar.optional(),
  variable: shortText.optional(),
  type: shortText.optional(),
  kind: shortText.optional(),
  target: shortText.optional(),
  entryNodeId: shortText.optional(),
  overlapsWith: shortText.optional(),
  from: shortText.optional(),
  documentVariable: shortText.optional(),
  previousEmailNodeId: shortText.optional(),
  fileNodeId: shortText.optional(),
  emailNodeId: shortText.optional(),
  ruleSetId: shortText.optional(),
  ruleId: shortText.optional(),
  groupId: shortText.optional(),
  classification: shortText.optional(),
  mimeType: shortText.optional(),
  fields: detailList.optional(),
  allowed: detailList.optional(),
  ruleIds: detailList.optional(),
  combination: z
    .record(z.string().max(64), z.string().max(64))
    .refine((value) => Object.keys(value).length <= 8, { message: "Demasiadas variables." })
    .optional(),
});

export type ValidationIssueDetails = z.infer<typeof validationIssueDetailsSchema>;

export const issueDocumentSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("FLOW") }),
  z.strictObject({
    type: z.literal("RULE_SET"),
    // Sin máximo propio: validatePublication no limita la cantidad de conjuntos y el índice es la
    // ubicación real del problema. El tamaño del informe ya está acotado (MAX_ISSUES_PER_RESPONSE).
    index: z.int().min(0),
    ruleSetId: idSchema.optional(),
  }),
  z.strictObject({ type: z.literal("DIRECTORY") }),
]);

export type IssueDocument = z.infer<typeof issueDocumentSchema>;

export const validationIssueDtoSchema = z.strictObject({
  code: z.enum(ISSUE_CODES),
  message: z.string().min(1).max(MAX_ISSUE_MESSAGE_LENGTH),
  document: issueDocumentSchema,
  path: issuePathSchema,
  nodeId: idSchema.optional(),
  details: validationIssueDetailsSchema.optional(),
});

export type ValidationIssueDto = z.infer<typeof validationIssueDtoSchema>;

/** Informe acotado de problemas: compartido por la validación y por el error FLOW_INVALID. */
export const validationReportSchema = z
  .strictObject({
    issues: z.array(validationIssueDtoSchema).max(MAX_ISSUES_PER_RESPONSE),
    totalIssues: z.int().min(0),
    truncated: z.boolean(),
  })
  .refine((report) => report.totalIssues >= report.issues.length, {
    message: "totalIssues no puede ser menor que la cantidad de problemas incluidos.",
    path: ["totalIssues"],
  })
  .refine((report) => report.truncated === report.totalIssues > report.issues.length, {
    message: "truncated debe indicar si se omitieron problemas.",
    path: ["truncated"],
  });

export type ValidationReport = z.infer<typeof validationReportSchema>;

/** Convierte un problema de flow-schema sin perder código, ruta ni nodo. */
export function toValidationIssueDto(
  issue: ValidationIssue,
  document: IssueDocument,
): ValidationIssueDto {
  const details = allowedDetails(issue.details);
  const nodeId =
    issue.nodeId !== undefined && idSchema.safeParse(issue.nodeId).success
      ? issue.nodeId
      : undefined;
  return {
    code: issue.code,
    message: truncate(issue.message, MAX_ISSUE_MESSAGE_LENGTH) || issue.code,
    document,
    path: issue.path
      .slice(0, MAX_PATH_SEGMENTS)
      .map((segment) => (typeof segment === "number" ? segment : truncate(segment, 128))),
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(details === undefined ? {} : { details }),
  };
}

/** Informe de una validación de publicación, con el documento de cada problema. */
export function toValidationReport(
  result: PublicationValidation,
  limit = MAX_ISSUES_PER_RESPONSE,
): ValidationReport {
  const all: ValidationIssueDto[] = [
    ...result.directory.map((issue) => toValidationIssueDto(issue, { type: "DIRECTORY" })),
    ...result.ruleSets.flatMap((ruleSet) =>
      ruleSet.issues.map((issue) =>
        toValidationIssueDto(issue, {
          type: "RULE_SET",
          index: ruleSet.index,
          ...(ruleSet.ruleSetId === undefined ? {} : { ruleSetId: ruleSet.ruleSetId }),
        }),
      ),
    ),
    ...result.flow.map((issue) => toValidationIssueDto(issue, { type: "FLOW" })),
  ];
  const maxIssues = Math.min(Math.max(0, limit), MAX_ISSUES_PER_RESPONSE);
  const issues = all.slice(0, maxIssues);
  return { issues, totalIssues: all.length, truncated: all.length > issues.length };
}

function allowedDetails(
  details: Readonly<Record<string, unknown>> | undefined,
): ValidationIssueDetails | undefined {
  if (details === undefined) return undefined;
  const shape = validationIssueDetailsSchema.shape;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!Object.hasOwn(shape, key)) continue;
    const field = shape[key as keyof typeof shape];
    if (field.safeParse(value).success) kept[key] = value;
  }
  if (Object.keys(kept).length === 0) return undefined;
  return validationIssueDetailsSchema.parse(kept);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
