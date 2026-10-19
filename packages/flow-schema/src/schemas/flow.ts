import { z } from "zod";
import { SUBJECT_MAX_LENGTH } from "../limits.js";
import { lineBreakPosition } from "../templates.js";
import { idSchema, labelSchema, textSchema, valueSchema, variableNameSchema } from "./common.js";

// El asunto termina en una cabecera de correo: CR o LF permitirían inyectar cabeceras.
// `issueCode` hace que parseFlowDefinition informe el código estable en lugar de STRUCTURE_INVALID.
const subjectSchema = z
  .string()
  .min(1)
  .max(SUBJECT_MAX_LENGTH)
  .superRefine((value, ctx) => {
    const position = lineBreakPosition(value);
    if (position !== -1) {
      ctx.addIssue({
        code: "custom",
        message: "El asunto no admite saltos de línea (CR o LF).",
        params: { issueCode: "EMAIL_SUBJECT_LINE_BREAK", position },
      });
    }
  });

// Las salidas son opcionales en la estructura para que la validación semántica informe
// MISSING_TARGET con el nodo y el campo exactos (ADR-003).
const targetSchema = idSchema.optional();

const scalarSchema = z.union([z.string().min(1).max(200), z.boolean()]);

export const variableDefinitionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("enum"), values: z.array(valueSchema) }),
  z.strictObject({ type: z.literal("string") }),
  z.strictObject({ type: z.literal("date") }),
  z.strictObject({ type: z.literal("boolean") }),
  z.strictObject({ type: z.literal("companyRef") }),
  z.strictObject({ type: z.literal("documentTypeRef") }),
  z.strictObject({ type: z.literal("documentRefList") }),
]);

const startNodeSchema = z.strictObject({
  id: idSchema,
  type: z.literal("start"),
  next: targetSchema,
});

const messageNodeSchema = z.strictObject({
  id: idSchema,
  type: z.literal("message"),
  text: textSchema,
  next: targetSchema,
});

const selectionOptionSchema = z.strictObject({
  id: idSchema,
  label: labelSchema,
  value: z.union([valueSchema, z.boolean()]),
  next: targetSchema,
});

const optionsSourceSchema = z.strictObject({
  kind: z.enum(["AUTHORIZED_COMPANIES", "DOCUMENT_TYPES"]),
  companyVariable: variableNameSchema.optional(),
});

const selectionNodeSchema = z.strictObject({
  id: idSchema,
  type: z.literal("selection"),
  text: textSchema,
  variable: variableNameSchema,
  options: z.array(selectionOptionSchema).optional(),
  optionsSource: optionsSourceSchema.optional(),
  maxOptions: z.int().min(1).optional(),
  autoSelectSingle: z.boolean().optional(),
  next: targetSchema,
  onEmpty: targetSchema,
});

const captureNodeSchema = z.strictObject({
  id: idSchema,
  type: z.literal("capture"),
  text: textSchema,
  variable: variableNameSchema,
  maxLength: z.int().min(1).max(1000).optional(),
  next: targetSchema,
});

const predicateSchema = z.strictObject({
  variable: variableNameSchema,
  operator: z.enum(["eq", "neq", "in", "notIn", "exists", "lt", "lte", "gt", "gte"]),
  value: z.union([scalarSchema, z.array(scalarSchema)]).optional(),
});

const conditionBranchSchema = z.strictObject({
  id: idSchema,
  all: z.array(predicateSchema).min(1),
  next: targetSchema,
});

const conditionNodeSchema = z.strictObject({
  id: idSchema,
  type: z.literal("condition"),
  branches: z.array(conditionBranchSchema).min(1),
  else: targetSchema,
});

const reviewSchema = z.strictObject({
  text: textSchema,
  confirmLabel: labelSchema,
  replaceLabel: labelSchema,
  cancelLabel: labelSchema,
});

const fileNodeSchema = z.strictObject({
  id: idSchema,
  type: z.literal("file"),
  text: textSchema,
  variable: variableNameSchema,
  allowedMimeTypes: z.array(z.string().min(1).max(100)).min(1),
  maxBytes: z.int().min(1),
  minCount: z.int().min(0),
  maxCount: z.int().min(0),
  // Opcional en la estructura para informar FILE_REVIEW_MISSING (ADR-014).
  review: reviewSchema.optional(),
  next: targetSchema,
});

const emailNodeSchema = z.strictObject({
  id: idSchema,
  type: z.literal("email"),
  ruleSetId: idSchema,
  contextVariables: z.array(variableNameSchema).min(1),
  subject: subjectSchema,
  body: textSchema,
  documentVariable: variableNameSchema,
  continueOn: z.literal("EMAIL_ACCEPTED"),
  next: targetSchema,
});

const endNodeSchema = z.strictObject({
  id: idSchema,
  type: z.literal("end"),
  reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
});

export const flowNodeSchema = z.discriminatedUnion("type", [
  startNodeSchema,
  messageNodeSchema,
  selectionNodeSchema,
  captureNodeSchema,
  conditionNodeSchema,
  fileNodeSchema,
  emailNodeSchema,
  endNodeSchema,
]);

export const flowDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  flowId: idSchema,
  name: z.string().min(1).max(200),
  variables: z.record(variableNameSchema, variableDefinitionSchema),
  entryNodeId: idSchema,
  nodes: z.array(flowNodeSchema).min(1),
});

export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type VariableDefinition = z.infer<typeof variableDefinitionSchema>;
export type VariableType = VariableDefinition["type"];
export type Predicate = z.infer<typeof predicateSchema>;
