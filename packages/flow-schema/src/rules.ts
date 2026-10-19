import { indexDirectory, type DirectoryIndex } from "./directory.js";
import { createIssue, type IssuePath, type ValidationIssue } from "./issues.js";
import { RULE_LIMITS } from "./limits.js";
import type { Directory } from "./schemas/directory.js";
import type { ContextVariableDefinition, Rule, RuleSet } from "./schemas/rule-set.js";

export type Combination = Readonly<Record<string, string>>;

export interface CoverageEntry {
  readonly combination: Combination;
  readonly outcome: "RULE" | "REVIEW_ONLY";
  readonly ruleId?: string;
}

export interface CoverageReport {
  readonly combinations: number;
  readonly entries: readonly CoverageEntry[];
}

export interface RuleSetValidation {
  readonly issues: readonly ValidationIssue[];
  /** Presente cuando el dominio pudo recorrerse completo. */
  readonly coverage?: CoverageReport;
}

/**
 * Valida un conjunto de reglas contra el directorio vigente: dominio, límites de complejidad,
 * cobertura exhaustiva (huecos y solapamientos) y destinatarios compatibles con la empresa y la
 * clasificación de cada combinación (ADR-012).
 */
export function validateRuleSet(ruleSet: RuleSet, directory: Directory): RuleSetValidation {
  const dir = indexDirectory(directory);
  const issues = new IssueCollector();
  const contextNames = Object.keys(ruleSet.contextVariables);
  let blocking = false;

  if (contextNames.length > RULE_LIMITS.contextVariables) {
    issues.limit(["contextVariables"], "contextVariables", contextNames.length);
  }

  const namesOfType = (type: ContextVariableDefinition["type"]): string[] =>
    contextNames.filter((name) => contextVariable(ruleSet, name)?.type === type);
  const companyVariables = namesOfType("companyRef");
  const documentTypeVariables = namesOfType("documentTypeRef");
  if (companyVariables.length !== 1) {
    blocking = true;
    issues.add(
      "RULE_CONTEXT_INVALID",
      "El conjunto de reglas debe declarar exactamente una variable companyRef.",
      ["contextVariables"],
      { reason: "COMPANY_REF_COUNT", actual: companyVariables.length },
    );
  }
  if (documentTypeVariables.length !== 1) {
    blocking = true;
    issues.add(
      "RULE_CONTEXT_INVALID",
      "El conjunto de reglas debe declarar exactamente una variable documentTypeRef.",
      ["contextVariables"],
      { reason: "DOCUMENT_TYPE_REF_COUNT", actual: documentTypeVariables.length },
    );
  }
  for (const name of contextNames) {
    const definition = contextVariable(ruleSet, name);
    if (definition?.type === "enum" && !validEnumValues(definition.values)) {
      blocking = true;
      issues.add(
        "ENUM_VALUES_INVALID",
        "La enumeración debe tener valores no vacíos y sin repetir.",
        ["contextVariables", name, "values"],
      );
    }
  }

  const domains = new Map<string, readonly string[]>(
    contextNames.map((name) => [name, activeDomain(contextVariable(ruleSet, name), dir)]),
  );

  if (ruleSet.rules.length > RULE_LIMITS.rules) {
    issues.limit(["rules"], "rules", ruleSet.rules.length);
  }
  const seenRuleIds = new Set<string>();
  ruleSet.rules.forEach((rule, i) => {
    if (seenRuleIds.has(rule.id)) {
      issues.add("DUPLICATE_ID", `El identificador "${rule.id}" está repetido.`, [
        "rules",
        i,
        "id",
      ]);
    }
    seenRuleIds.add(rule.id);
    validateRule(ruleSet, rule, i, dir, issues);
  });

  const reviewKeys = new Map<string, number>();
  ruleSet.reviewOnly.forEach((entry, i) => {
    const path = ["reviewOnly", i];
    const keys = Object.keys(entry);
    const sameKeys =
      keys.length === contextNames.length &&
      contextNames.every((name) => Object.hasOwn(entry, name));
    if (!sameKeys) {
      issues.add(
        "REVIEW_ONLY_INVALID",
        "Cada combinación de revisión debe nombrar exactamente las variables de contexto.",
        path,
        { reason: "KEYS" },
      );
      return;
    }
    const outOfDomain = contextNames.find(
      (name) => !(domains.get(name) ?? []).includes(entry[name] ?? ""),
    );
    if (outOfDomain !== undefined) {
      issues.add(
        "REVIEW_ONLY_INVALID",
        "La combinación de revisión usa un valor fuera del dominio vigente.",
        [...path, outOfDomain],
        { reason: "VALUE_OUT_OF_DOMAIN" },
      );
      return;
    }
    const key = combinationKey(contextNames, entry);
    if (reviewKeys.has(key)) {
      issues.add("REVIEW_ONLY_INVALID", "La combinación de revisión está repetida.", path, {
        reason: "DUPLICATE",
      });
      return;
    }
    reviewKeys.set(key, i);
  });

  if (blocking) return { issues: issues.list };

  const combinationCount = contextNames.reduce(
    (product, name) => product * (domains.get(name)?.length ?? 0),
    1,
  );
  if (combinationCount > RULE_LIMITS.combinations) {
    issues.limit(["contextVariables"], "combinations", combinationCount);
    return { issues: issues.list };
  }

  const companyVariable = companyVariables[0] ?? "";
  const documentTypeVariable = documentTypeVariables[0] ?? "";
  const entries: CoverageEntry[] = [];

  for (const combination of enumerate(contextNames, domains)) {
    const matching = ruleSet.rules
      .map((rule, i) => ({ rule, i }))
      .filter(({ rule }) => ruleMatches(ruleSet, rule, combination));
    const reviewIndex = reviewKeys.get(combinationKey(contextNames, combination));

    const [match] = matching;
    if (match === undefined) {
      if (reviewIndex === undefined) {
        issues.add(
          "RULE_COVERAGE_GAP",
          "Ninguna regla cubre esta combinación y no figura en reviewOnly.",
          ["rules"],
          { combination },
        );
      } else {
        entries.push({ combination, outcome: "REVIEW_ONLY" });
      }
      continue;
    }
    if (matching.length > 1) {
      issues.add("RULE_OVERLAP", "Más de una regla coincide con esta combinación.", ["rules"], {
        combination,
        ruleIds: matching.map(({ rule }) => rule.id),
      });
      continue;
    }
    if (reviewIndex !== undefined) {
      issues.add(
        "REVIEW_ONLY_INVALID",
        "La combinación figura en reviewOnly pero también la cubre una regla.",
        ["reviewOnly", reviewIndex],
        { reason: "COVERED_BY_RULE", ruleId: match.rule.id },
      );
    }
    entries.push({ combination, outcome: "RULE", ruleId: match.rule.id });
    checkRecipients(
      match.rule,
      match.i,
      combination[companyVariable] ?? "",
      combination[documentTypeVariable] ?? "",
      combination,
      dir,
      issues,
    );
  }

  return { issues: issues.list, coverage: { combinations: combinationCount, entries } };
}

function validateRule(
  ruleSet: RuleSet,
  rule: Rule,
  i: number,
  dir: DirectoryIndex,
  issues: IssueCollector,
): void {
  const base = ["rules", i];
  if (rule.all.length > RULE_LIMITS.conditionsPerRule) {
    issues.limit([...base, "all"], "conditionsPerRule", rule.all.length);
  }
  rule.all.forEach((condition, j) => {
    const path = [...base, "all", j];
    const definition = contextVariable(ruleSet, condition.variable);
    if (definition === undefined) {
      issues.add(
        "RULE_CONDITION_INVALID",
        `La variable "${condition.variable}" no está declarada en el contexto.`,
        [...path, "variable"],
        { reason: "UNKNOWN_VARIABLE" },
      );
      return;
    }
    const isList = Array.isArray(condition.value);
    if ((condition.operator === "in") !== isList) {
      issues.add(
        "RULE_CONDITION_INVALID",
        "El valor no corresponde al operador (eq usa un valor; in, una lista).",
        [...path, "value"],
        { reason: "VALUE_SHAPE" },
      );
      return;
    }
    const values = typeof condition.value === "string" ? [condition.value] : condition.value;
    if (values.length > RULE_LIMITS.valuesPerList) {
      issues.limit([...path, "value"], "valuesPerList", values.length);
    }
    values.forEach((value, k) => {
      if (!existsInDomain(definition, value, dir)) {
        issues.add(
          "RULE_CONDITION_INVALID",
          `El valor "${value}" no existe en el dominio de "${condition.variable}".`,
          isList ? [...path, "value", k] : [...path, "value"],
          { reason: "VALUE_OUT_OF_DOMAIN" },
        );
      }
    });
  });

  if (rule.targetGroupIds.length > RULE_LIMITS.groupsPerRule) {
    issues.limit([...base, "targetGroupIds"], "groupsPerRule", rule.targetGroupIds.length);
  }
  rule.targetGroupIds.forEach((groupId, k) => {
    if (!dir.groups.has(groupId)) {
      issues.add("RECIPIENT_GROUP_NOT_FOUND", `El grupo "${groupId}" no existe en el directorio.`, [
        ...base,
        "targetGroupIds",
        k,
      ]);
    }
  });
}

function checkRecipients(
  rule: Rule,
  ruleIndex: number,
  companyId: string,
  documentTypeId: string,
  combination: Combination,
  dir: DirectoryIndex,
  issues: IssueCollector,
): void {
  const classification = dir.documentTypes.get(documentTypeId)?.classification;
  if (classification === undefined) return;
  const recipients = new Set<string>();

  rule.targetGroupIds.forEach((groupId, k) => {
    const group = dir.groups.get(groupId);
    if (group === undefined) return;
    const path = ["rules", ruleIndex, "targetGroupIds", k];
    if (group.companyId !== companyId) {
      issues.add(
        "RECIPIENT_GROUP_NOT_AUTHORIZED",
        "El grupo destino no pertenece a la empresa de la combinación.",
        path,
        { reason: "COMPANY_MISMATCH", groupId, combination },
      );
    }
    if (!group.allowedClassifications.includes(classification)) {
      issues.add(
        "RECIPIENT_GROUP_NOT_AUTHORIZED",
        "El grupo destino no admite la clasificación del tipo documental.",
        path,
        { reason: "CLASSIFICATION_NOT_ALLOWED", groupId, classification, combination },
      );
    }
    const activeMembers = group.memberContactIds
      .map((contactId) => dir.contacts.get(contactId))
      .filter((contact) => contact?.active === true);
    if (activeMembers.length === 0) {
      issues.add("RECIPIENT_GROUP_EMPTY", "El grupo destino no tiene miembros activos.", path, {
        groupId,
        combination,
      });
    }
    for (const contact of activeMembers) {
      if (contact === undefined) continue;
      const reason =
        contact.companyId !== companyId
          ? "COMPANY_MISMATCH"
          : contact.allowedClassifications.includes(classification)
            ? undefined
            : "CLASSIFICATION_NOT_ALLOWED";
      if (reason !== undefined) {
        issues.add(
          "RECIPIENT_NOT_AUTHORIZED",
          "Un miembro activo del grupo no está autorizado para esta combinación.",
          path,
          { reason, groupId, contactId: contact.id, combination },
        );
      }
      recipients.add(contact.email.toLowerCase());
    }
  });

  if (recipients.size > RULE_LIMITS.recipientsPerDelivery) {
    issues.limit(["rules", ruleIndex, "targetGroupIds"], "recipientsPerDelivery", recipients.size);
  }
}

function ruleMatches(ruleSet: RuleSet, rule: Rule, combination: Combination): boolean {
  return rule.all.every((condition) => {
    if (contextVariable(ruleSet, condition.variable) === undefined) return false;
    const actual = combination[condition.variable];
    if (actual === undefined) return false;
    return typeof condition.value === "string"
      ? condition.operator === "eq" && actual === condition.value
      : condition.operator === "in" && condition.value.includes(actual);
  });
}

function contextVariable(ruleSet: RuleSet, name: string): ContextVariableDefinition | undefined {
  return Object.hasOwn(ruleSet.contextVariables, name) ? ruleSet.contextVariables[name] : undefined;
}

function activeDomain(
  definition: ContextVariableDefinition | undefined,
  dir: DirectoryIndex,
): readonly string[] {
  switch (definition?.type) {
    case "companyRef":
      return dir.activeCompanyIds;
    case "documentTypeRef":
      return dir.activeDocumentTypeIds;
    case "enum":
      return [...new Set(definition.values)];
    case undefined:
      return [];
  }
}

function existsInDomain(
  definition: ContextVariableDefinition,
  value: string,
  dir: DirectoryIndex,
): boolean {
  switch (definition.type) {
    case "companyRef":
      return dir.companies.has(value);
    case "documentTypeRef":
      return dir.documentTypes.has(value);
    case "enum":
      return definition.values.includes(value);
  }
}

function validEnumValues(values: readonly string[]): boolean {
  return values.length > 0 && new Set(values).size === values.length;
}

function* enumerate(
  names: readonly string[],
  domains: ReadonlyMap<string, readonly string[]>,
): Generator<Combination> {
  const [first, ...rest] = names;
  if (first === undefined) {
    yield {};
    return;
  }
  for (const value of domains.get(first) ?? []) {
    for (const tail of enumerate(rest, domains)) yield { [first]: value, ...tail };
  }
}

function combinationKey(names: readonly string[], combination: Combination): string {
  return names.map((name) => combination[name] ?? "").join("\u0000");
}

/** Evita repetir el mismo problema por cada combinación: conserva la primera. */
class IssueCollector {
  readonly list: ValidationIssue[] = [];
  private readonly seen = new Set<string>();

  add(
    code: ValidationIssue["code"],
    message: string,
    path: IssuePath,
    details?: Readonly<Record<string, unknown>>,
  ): void {
    const identity = Object.entries(details ?? {}).filter(([key]) => key !== "combination");
    const key = JSON.stringify([code, path, identity]);
    if (code !== "RULE_COVERAGE_GAP" && code !== "RULE_OVERLAP") {
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    this.list.push(createIssue(code, message, path, { details }));
  }

  limit(path: IssuePath, limit: keyof typeof RULE_LIMITS, actual: number): void {
    this.add("RULE_LIMIT_EXCEEDED", `Se supera el límite "${limit}".`, path, {
      limit,
      max: RULE_LIMITS[limit],
      actual,
    });
  }
}
