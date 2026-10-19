import { readFileSync } from "node:fs";
import { expect } from "vitest";
import {
  parseDirectory,
  parseFlowDefinition,
  parseRuleSet,
  validatePublication,
  type Directory,
  type FlowDefinition,
  type FlowNode,
  type IssueCode,
  type IssuePath,
  type PublicationValidation,
  type RuleSet,
  type ValidationIssue,
} from "../src/index.js";

const EXAMPLES = new URL("../../../examples/", import.meta.url);

export const EXAMPLE_FILES = {
  flow: "flujo_documental_demo.json",
  ruleSet: "reglas_distribucion_demo.json",
  directory: "directorio_demo.json",
} as const;

export function readExample(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, EXAMPLES), "utf8")) as unknown;
}

export interface Fixtures {
  flow: FlowDefinition;
  ruleSet: RuleSet;
  directory: Directory;
}

/** Los tres JSON de examples/, validados estructuralmente y listos para mutar en cada caso. */
export function loadFixtures(): Fixtures {
  const flow = parseFlowDefinition(readExample(EXAMPLE_FILES.flow));
  const ruleSet = parseRuleSet(readExample(EXAMPLE_FILES.ruleSet));
  const directory = parseDirectory(readExample(EXAMPLE_FILES.directory));
  if (!flow.ok || !ruleSet.ok || !directory.ok) {
    throw new Error("Los fixtures de examples/ no son estructuralmente válidos.");
  }
  return { flow: flow.value, ruleSet: ruleSet.value, directory: directory.value };
}

export function validate(fixtures: Fixtures): PublicationValidation {
  return validatePublication({
    flow: fixtures.flow,
    ruleSets: [fixtures.ruleSet],
    directory: fixtures.directory,
  });
}

export function node<T extends FlowNode["type"]>(
  flow: FlowDefinition,
  id: string,
  type: T,
): Extract<FlowNode, { type: T }> {
  const found = flow.nodes.find((candidate) => candidate.id === id);
  if (found?.type !== type) throw new Error(`No existe el nodo "${id}" de tipo ${type}.`);
  return found as Extract<FlowNode, { type: T }>;
}

export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No existe el elemento ${String(index)}.`);
  return item;
}

/** Inserta un nodo condition entre la selección del tipo documental y el paso documental. */
export function withRoute(fixtures: Fixtures): Extract<FlowNode, { type: "condition" }> {
  for (const option of node(fixtures.flow, "document_type", "selection").options ?? []) {
    option.next = "route";
  }
  const route: Extract<FlowNode, { type: "condition" }> = {
    id: "route",
    type: "condition",
    branches: [
      {
        id: "b_invoice",
        all: [{ variable: "documentType", operator: "eq", value: "invoice" }],
        next: "upload",
      },
    ],
    else: "upload",
  };
  fixtures.flow.nodes.push(route);
  return route;
}

export interface ExpectedIssue {
  readonly code: IssueCode;
  readonly path?: IssuePath;
  readonly nodeId?: string;
}

/** Exige exactamente esos códigos y, para cada esperado, un problema con su ruta y nodo. */
export function expectIssues(
  actual: readonly ValidationIssue[],
  expected: readonly ExpectedIssue[],
): void {
  expect(new Set(actual.map((issue) => issue.code))).toEqual(
    new Set(expected.map((issue) => issue.code)),
  );
  for (const wanted of expected) {
    const found = actual.some(
      (issue) =>
        issue.code === wanted.code &&
        (wanted.path === undefined || JSON.stringify(issue.path) === JSON.stringify(wanted.path)) &&
        (wanted.nodeId === undefined || issue.nodeId === wanted.nodeId),
    );
    expect(found, `falta ${wanted.code} en ${JSON.stringify(wanted.path)}`).toBe(true);
  }
}

export function ruleSetIssues(result: PublicationValidation): readonly ValidationIssue[] {
  return result.ruleSets.flatMap((ruleSet) => ruleSet.issues);
}
