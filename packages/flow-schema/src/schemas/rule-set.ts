import { z } from "zod";
import { idSchema, valueSchema, variableNameSchema } from "./common.js";

// Solo dominios finitos: la cobertura se calcula sobre el producto de los dominios (ADR-012).
const contextVariableSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("companyRef") }),
  z.strictObject({ type: z.literal("documentTypeRef") }),
  z.strictObject({ type: z.literal("enum"), values: z.array(valueSchema) }),
]);

const ruleConditionSchema = z.strictObject({
  variable: variableNameSchema,
  operator: z.enum(["eq", "in"]),
  value: z.union([valueSchema, z.array(valueSchema)]),
});

const ruleSchema = z.strictObject({
  id: idSchema,
  all: z.array(ruleConditionSchema).min(1),
  targetGroupIds: z.array(idSchema).min(1),
});

export const ruleSetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ruleSetId: idSchema,
  version: z.int().min(1),
  contextVariables: z.record(variableNameSchema, contextVariableSchema),
  // V1 solo admite revisión ante falta de coincidencia: nunca un grupo genérico (ADR-012).
  defaultBehavior: z.literal("REQUIRES_REVIEW"),
  reviewOnly: z.array(z.record(variableNameSchema, valueSchema)),
  rules: z.array(ruleSchema),
});

export type RuleSet = z.infer<typeof ruleSetSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type ContextVariableDefinition = z.infer<typeof contextVariableSchema>;
