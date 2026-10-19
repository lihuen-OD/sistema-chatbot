import {
  FLOW_LIMITS,
  parseDirectory,
  parseFlowDefinition,
  parseRuleSet,
  validateFlowDefinition,
  validatePublication,
} from "@sistema-chatbot/flow-schema";
import { describe, expect, it } from "vitest";
import {
  flowDraftResponseSchema,
  flowDraftUpdateRequestSchema,
  MAX_DRAFT_JSON_DEPTH,
  MAX_DRAFT_JSON_VALUES,
  toValidationReport,
  validationReportSchema,
} from "../src/index.js";
import { readExample } from "./samples.js";

// Regresiones de la revisión del commit 07b8767 de P1-T2.

/** Objeto con `levels` contenedores anidados (el raíz cuenta como nivel 1), construido iterativamente. */
function nestedObject(levels: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let level = 1; level < levels; level++) value = { child: value };
  return value;
}

function nestedArrayValue(levels: number): Record<string, unknown> {
  let value: unknown = "hoja";
  for (let level = 1; level < levels; level++) value = [value];
  return { items: value };
}

const draftResponse = (definition: unknown, layout?: unknown) => ({
  flowId: "flow-demo-1",
  revision: 1,
  definition,
  ...(layout === undefined ? {} : { layout }),
  updatedAt: "2026-10-19T18:00:00Z",
});

describe("hallazgo 1: profundidad de los borradores", () => {
  it.each([
    [
      "definition",
      (deep: unknown) =>
        flowDraftUpdateRequestSchema.safeParse({ expectedRevision: 0, definition: deep }),
    ],
    [
      "layout",
      (deep: unknown) =>
        flowDraftUpdateRequestSchema.safeParse({
          expectedRevision: 0,
          definition: {},
          layout: deep,
        }),
    ],
    [
      "respuesta de lectura",
      (deep: unknown) => flowDraftResponseSchema.safeParse(draftResponse(deep)),
    ],
  ])("6.000 niveles en %s se rechazan con un resultado controlado", (_where, parse) => {
    const result = parse(nestedObject(6000));
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        code: "custom",
        params: expect.objectContaining({
          reason: "MAX_DEPTH",
          limit: MAX_DRAFT_JSON_DEPTH,
        }) as unknown,
      }),
    );
  });

  it("frontera de profundidad: el límite exacto se acepta y uno más se rechaza", () => {
    for (const build of [nestedObject, nestedArrayValue]) {
      expect(
        flowDraftUpdateRequestSchema.safeParse({
          expectedRevision: 0,
          definition: build(MAX_DRAFT_JSON_DEPTH),
        }).success,
      ).toBe(true);
      expect(
        flowDraftUpdateRequestSchema.safeParse({
          expectedRevision: 0,
          definition: build(MAX_DRAFT_JSON_DEPTH + 1),
        }).success,
      ).toBe(false);
    }
  });

  it("acota la cantidad de valores recorridos", () => {
    const wide = (count: number) => ({ values: Array.from({ length: count - 2 }, () => 1) });
    expect(
      flowDraftUpdateRequestSchema.safeParse({
        expectedRevision: 0,
        definition: wide(MAX_DRAFT_JSON_VALUES),
      }).success,
    ).toBe(true);
    const result = flowDraftUpdateRequestSchema.safeParse({
      expectedRevision: 0,
      definition: wide(MAX_DRAFT_JSON_VALUES + 1),
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.code === "custom" ? issue.params : undefined).toMatchObject({
      reason: "MAX_VALUES",
      limit: MAX_DRAFT_JSON_VALUES,
    });
  });

  it("una definición en los límites de tamaño de FLOW_LIMITS cabe en el borrador", () => {
    const L = FLOW_LIMITS;
    const list = Array.from({ length: L.valuesPerList }, (_, i) => `valor_${String(i)}`);
    const conditions = L.nodes - 2;
    const definition = {
      schemaVersion: 1,
      flowId: "max_flow",
      name: "Flujo en los límites",
      variables: Object.fromEntries(
        Array.from({ length: L.variables }, (_, v) => [
          `v${String(v)}`,
          { type: "enum", values: list },
        ]),
      ),
      entryNodeId: "start",
      nodes: [
        { id: "start", type: "start", next: "c0" },
        ...Array.from({ length: conditions }, (_, n) => ({
          id: `c${String(n)}`,
          type: "condition",
          branches: Array.from({ length: L.conditionBranches }, (_, b) => ({
            id: `b${String(b)}`,
            all: Array.from({ length: L.predicatesPerBranch }, (_, p) => ({
              variable: `v${String(p)}`,
              operator: "in",
              value: list,
            })),
            next: n + 1 < conditions ? `c${String(n + 1)}` : "end",
          })),
          else: "end",
        })),
        { id: "end", type: "end", reason: "DONE" },
      ],
    };
    const parsed = parseFlowDefinition(definition);
    if (!parsed.ok) throw new Error("definición inválida");
    const directory = parseDirectory(readExample("directorio_demo.json"));
    if (!directory.ok) throw new Error("fixture inválido");
    // Solo se excluye la cota de transiciones automáticas, que depende del grafo y no del tamaño.
    const sizeIssues = validateFlowDefinition(parsed.value, {
      directory: directory.value,
      ruleSets: [],
    }).filter(
      (issue) =>
        issue.code === "FLOW_LIMIT_EXCEEDED" &&
        issue.details?.["limit"] !== "automaticTransitionsPerEvent",
    );
    expect(sizeIssues).toEqual([]);
    expect(
      flowDraftUpdateRequestSchema.safeParse({ expectedRevision: 0, definition }).success,
    ).toBe(true);
  });

  it("termina con un objeto cíclico construido en memoria", () => {
    const cyclic: Record<string, unknown> = { name: "ciclo" };
    cyclic["self"] = cyclic;
    expect(
      flowDraftUpdateRequestSchema.safeParse({ expectedRevision: 0, definition: cyclic }).success,
    ).toBe(false);
  });

  it("los borradores incompletos y el flujo de ejemplo se siguen aceptando", () => {
    expect(
      flowDraftUpdateRequestSchema.safeParse({
        expectedRevision: 0,
        definition: { name: "En edición" },
      }).success,
    ).toBe(true);
    expect(
      flowDraftUpdateRequestSchema.safeParse({
        expectedRevision: 3,
        definition: readExample("flujo_documental_demo.json"),
        layout: { nodes: { start: { x: 0, y: 0 } }, zoom: 1 },
      }).success,
    ).toBe(true);
  });

  it("sigue rechazando valores que no son JSON", () => {
    for (const definition of [{ when: new Date(0) }, { n: Number.NaN }, { f: () => 1 }, [1, 2]]) {
      expect(
        flowDraftUpdateRequestSchema.safeParse({ expectedRevision: 0, definition }).success,
      ).toBe(false);
    }
  });
});

describe("hallazgo 2: el informe convertido cumple su propio esquema", () => {
  const issue = {
    code: "STRUCTURE_INVALID",
    message: "La estructura del documento no es válida.",
    path: ["defaultBehavior"],
    details: { reason: "invalid_value" },
  } as const;

  it("un problema en ruleSets[1000] conserva su índice y pasa el esquema", () => {
    const report = toValidationReport({
      valid: false,
      directory: [],
      flow: [],
      ruleSets: [{ index: 1000, ruleSetId: "routing_extra", issues: [issue] }],
    });
    expect(report.issues[0]?.document).toEqual({
      type: "RULE_SET",
      index: 1000,
      ruleSetId: "routing_extra",
    });
    const parsed = validationReportSchema.safeParse(report);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("de punta a punta: 1.001 conjuntos con el último inválido", () => {
    const ruleSet = parseRuleSet(readExample("reglas_distribucion_demo.json"));
    if (!ruleSet.ok) throw new Error("fixture inválido");
    const ruleSets: unknown[] = Array.from({ length: 1000 }, (_, i) =>
      i === 0 ? ruleSet.value : { ...ruleSet.value, ruleSetId: `routing_demo_${String(i)}` },
    );
    ruleSets.push({
      ...ruleSet.value,
      ruleSetId: "routing_broken",
      defaultBehavior: "FALLBACK_GROUP",
    });

    const result = validatePublication({
      flow: readExample("flujo_documental_demo.json"),
      ruleSets,
      directory: readExample("directorio_demo.json"),
    });
    const report = toValidationReport(result);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "STRUCTURE_INVALID",
        document: { type: "RULE_SET", index: 1000 },
        path: ["defaultBehavior"],
      }),
    ]);
    expect(validationReportSchema.safeParse(report).success).toBe(true);
  });

  it("el índice sigue siendo un entero seguro no negativo", () => {
    const withIndex = (index: number) => ({
      issues: [
        {
          code: "STRUCTURE_INVALID",
          message: "x",
          document: { type: "RULE_SET", index },
          path: [],
        },
      ],
      totalIssues: 1,
      truncated: false,
    });
    expect(validationReportSchema.safeParse(withIndex(Number.MAX_SAFE_INTEGER)).success).toBe(true);
    for (const index of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validationReportSchema.safeParse(withIndex(index)).success).toBe(false);
    }
  });
});
