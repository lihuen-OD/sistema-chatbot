import { validateDirectory } from "./directory.js";
import { validateFlowDefinition } from "./flow.js";
import { createIssue, type ValidationIssue } from "./issues.js";
import { parseDirectory, parseFlowDefinition, parseRuleSet } from "./parse.js";
import { validateRuleSet, type CoverageReport } from "./rules.js";
import type { RuleSet } from "./schemas/rule-set.js";

export interface PublicationInput {
  readonly flow: unknown;
  readonly ruleSets: readonly unknown[];
  readonly directory: unknown;
}

export interface RuleSetResult {
  readonly index: number;
  readonly ruleSetId?: string;
  readonly issues: readonly ValidationIssue[];
  readonly coverage?: CoverageReport;
}

export interface PublicationValidation {
  readonly valid: boolean;
  readonly directory: readonly ValidationIssue[];
  readonly ruleSets: readonly RuleSetResult[];
  readonly flow: readonly ValidationIssue[];
}

/**
 * Valida en conjunto lo que se publicaría: directorio y catálogo, conjuntos de reglas y flujo.
 * Si el directorio tiene problemas, las reglas y el flujo solo se validan estructuralmente,
 * para no informar errores derivados de referencias rotas.
 */
export function validatePublication(input: PublicationInput): PublicationValidation {
  const parsedDirectory = parseDirectory(input.directory);
  const directoryIssues = parsedDirectory.ok
    ? validateDirectory(parsedDirectory.value)
    : [...parsedDirectory.issues];
  const directory =
    parsedDirectory.ok && directoryIssues.length === 0 ? parsedDirectory.value : undefined;

  // El flujo se contrasta con todo conjunto estructuralmente válido; los problemas propios de cada
  // conjunto (cobertura, destinatarios) se informan en su resultado, no como RULE_SET_NOT_FOUND.
  const parsedRuleSets: RuleSet[] = [];
  const seenRuleSetIds = new Set<string>();
  const ruleSets = input.ruleSets.map((raw, index): RuleSetResult => {
    const parsed = parseRuleSet(raw);
    if (!parsed.ok) return { index, issues: parsed.issues };

    const ruleSetId = parsed.value.ruleSetId;
    if (seenRuleSetIds.has(ruleSetId)) {
      return {
        index,
        ruleSetId,
        issues: [
          createIssue("DUPLICATE_ID", `El conjunto de reglas "${ruleSetId}" está repetido.`, [
            "ruleSetId",
          ]),
        ],
      };
    }
    seenRuleSetIds.add(ruleSetId);
    parsedRuleSets.push(parsed.value);
    if (directory === undefined) return { index, ruleSetId, issues: [] };

    const result = validateRuleSet(parsed.value, directory);
    return {
      index,
      ruleSetId,
      issues: result.issues,
      ...(result.coverage === undefined ? {} : { coverage: result.coverage }),
    };
  });

  const parsedFlow = parseFlowDefinition(input.flow);
  const flow = !parsedFlow.ok
    ? parsedFlow.issues
    : directory === undefined
      ? []
      : validateFlowDefinition(parsedFlow.value, { directory, ruleSets: parsedRuleSets });

  const valid =
    directory !== undefined &&
    parsedFlow.ok &&
    flow.length === 0 &&
    ruleSets.every((result) => result.issues.length === 0);

  return { valid, directory: directoryIssues, ruleSets, flow };
}
