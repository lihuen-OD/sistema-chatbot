import type { z } from "zod";
import { createIssue, isIssueCode, type IssuePath, type ValidationIssue } from "./issues.js";
import { directorySchema, type Directory } from "./schemas/directory.js";
import { flowDefinitionSchema, type FlowDefinition } from "./schemas/flow.js";
import { ruleSetSchema, type RuleSet } from "./schemas/rule-set.js";

export const SUPPORTED_SCHEMA_VERSION = 1;

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** Validación estructural de una definición de flujo. No evalúa reglas semánticas. */
export function parseFlowDefinition(input: unknown): ParseResult<FlowDefinition> {
  return parseWith(flowDefinitionSchema, input, nodeIdFromPath);
}

/** Validación estructural de un conjunto de reglas. */
export function parseRuleSet(input: unknown): ParseResult<RuleSet> {
  return parseWith(ruleSetSchema, input);
}

/** Validación estructural del directorio y catálogo documental. */
export function parseDirectory(input: unknown): ParseResult<Directory> {
  return parseWith(directorySchema, input);
}

function parseWith<T>(
  schema: z.ZodType<T>,
  input: unknown,
  locateNode?: (input: unknown, path: IssuePath) => string | undefined,
): ParseResult<T> {
  if (isRecord(input) && "schemaVersion" in input) {
    const version = input["schemaVersion"];
    if (version !== SUPPORTED_SCHEMA_VERSION) {
      return {
        ok: false,
        issues: [
          createIssue(
            "SCHEMA_VERSION_UNSUPPORTED",
            `La versión de esquema no es compatible; se esperaba ${String(SUPPORTED_SCHEMA_VERSION)}.`,
            ["schemaVersion"],
            { details: { supported: SUPPORTED_SCHEMA_VERSION } },
          ),
        ],
      };
    }
  }

  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };

  return {
    ok: false,
    issues: result.error.issues.map((zodIssue) => {
      const path = zodIssue.path.map((segment) =>
        typeof segment === "number" ? segment : String(segment),
      );
      const nodeId = locateNode?.(input, path);
      // Los refinamientos propios declaran su código estable en params.issueCode.
      if (zodIssue.code === "custom") {
        const params: Readonly<Record<string, unknown>> = zodIssue.params ?? {};
        const issueCode = params["issueCode"];
        if (isIssueCode(issueCode)) {
          const details = Object.fromEntries(
            Object.entries(params).filter(([key]) => key !== "issueCode"),
          );
          return createIssue(issueCode, zodIssue.message, path, { nodeId, details });
        }
      }
      return createIssue("STRUCTURE_INVALID", "La estructura del documento no es válida.", path, {
        nodeId,
        details: { reason: zodIssue.code, description: zodIssue.message },
      });
    }),
  };
}

function nodeIdFromPath(input: unknown, path: IssuePath): string | undefined {
  if (path[0] !== "nodes" || typeof path[1] !== "number" || !isRecord(input)) return undefined;
  const nodes = input["nodes"];
  if (!Array.isArray(nodes)) return undefined;
  const node: unknown = nodes[path[1]];
  if (!isRecord(node)) return undefined;
  const id = node["id"];
  return typeof id === "string" ? id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
