import { describe, expect, it } from "vitest";
import {
  FLOW_LIMITS,
  RULE_LIMITS,
  validateFlowDefinition,
  validateRuleSet,
  type ValidationIssue,
} from "../src/index.js";
import {
  EXAMPLE_FILES,
  loadFixtures,
  node,
  readExample,
  ruleSetIssues,
  validate,
  type Fixtures,
} from "./helpers.js";

// Límite enumValues (addenda de ADR-003 y ADR-012, 21/10/2026). El criterio de corrección es que
// una lista excedida se rechace antes del análisis semántico y sin recorrerla. Las pruebas lo
// comprueban contando lecturas de la lista, no midiendo tiempo, para que la CI no dependa de la
// velocidad del runner.

function enumValues(count: number, prefix = "v"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}_${String(i)}`);
}

/** Lista que cuenta las lecturas de sus elementos. Leer `length` no cuenta. */
function countingList(values: string[]): { list: string[]; reads: () => number } {
  let reads = 0;
  const list = new Proxy(values, {
    get(target, property, receiver): unknown {
      if (property !== "length") reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  return { list, reads: () => reads };
}

/** Variable `area` en el flujo y en el conjunto de reglas, usada como contexto del correo. */
function withArea(fixtures: Fixtures, flowValues: string[], ruleValues = flowValues): void {
  fixtures.flow.variables["area"] = { type: "enum", values: flowValues };
  fixtures.ruleSet.contextVariables["area"] = { type: "enum", values: ruleValues };
  node(fixtures.flow, "email", "email").contextVariables.push("area");
}

function semanticFlow(fixtures: Fixtures): ValidationIssue[] {
  return validateFlowDefinition(fixtures.flow, {
    directory: fixtures.directory,
    ruleSets: [fixtures.ruleSet],
  });
}

function enumLimitIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.details?.["limit"] === "enumValues");
}

describe("límite de valores de enum: frontera", () => {
  it("el límite es 50 en flujos y en reglas, igual que valuesPerList", () => {
    expect(FLOW_LIMITS.enumValues).toBe(50);
    expect(RULE_LIMITS.enumValues).toBe(50);
    expect(FLOW_LIMITS.enumValues).toBe(FLOW_LIMITS.valuesPerList);
    expect(RULE_LIMITS.enumValues).toBe(RULE_LIMITS.valuesPerList);
  });

  it("flujo: 1 y 50 valores no superan el límite; 51 sí, con ruta y detalles estables", () => {
    for (const count of [1, FLOW_LIMITS.enumValues]) {
      const fixtures = loadFixtures();
      fixtures.flow.variables["area"] = { type: "enum", values: enumValues(count) };
      expect(enumLimitIssues(semanticFlow(fixtures)), `${String(count)} valores`).toEqual([]);
    }

    const fixtures = loadFixtures();
    fixtures.flow.variables["area"] = { type: "enum", values: enumValues(51) };
    expect(semanticFlow(fixtures)).toEqual([
      expect.objectContaining({
        code: "FLOW_LIMIT_EXCEEDED",
        path: ["variables", "area", "values"],
        details: { limit: "enumValues", max: 50, actual: 51 },
      }),
    ]);
  });

  it("reglas: 1 y 50 valores no superan el límite; 51 sí, con ruta y detalles estables", () => {
    for (const count of [1, RULE_LIMITS.enumValues]) {
      const { ruleSet, directory } = loadFixtures();
      ruleSet.contextVariables["area"] = { type: "enum", values: enumValues(count) };
      const result = validateRuleSet(ruleSet, directory);
      expect(enumLimitIssues(result.issues), `${String(count)} valores`).toEqual([]);
    }

    const { ruleSet, directory } = loadFixtures();
    ruleSet.contextVariables["area"] = { type: "enum", values: enumValues(51) };
    const result = validateRuleSet(ruleSet, directory);
    expect(result.coverage).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "RULE_LIMIT_EXCEEDED",
        path: ["contextVariables", "area", "values"],
        details: { limit: "enumValues", max: 50, actual: 51 },
      }),
    ]);
  });

  it("con 50 valores el flujo es válido y el conjunto de reglas cubre el dominio", () => {
    const fixtures = loadFixtures();
    const values = enumValues(FLOW_LIMITS.enumValues);
    withArea(fixtures, values);
    // Una selección asigna `area` antes del correo, con una opción por valor posible del canal.
    fixtures.flow.nodes.splice(2, 0, {
      id: "area",
      type: "selection",
      text: "Área",
      variable: "area",
      options: values.slice(0, FLOW_LIMITS.staticOptions).map((value) => ({
        id: `opt_${value}`,
        label: value,
        value,
        next: "document_type",
      })),
    });
    node(fixtures.flow, "company", "selection").next = "area";

    const result = validate(fixtures);
    expect(result.flow).toEqual([]);
    expect(ruleSetIssues(result)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("un problema por variable excedida, en el orden de declaración", () => {
    const fixtures = loadFixtures();
    fixtures.flow.variables["area"] = { type: "enum", values: enumValues(51, "a") };
    fixtures.flow.variables["zone"] = { type: "enum", values: enumValues(60, "z") };
    expect(semanticFlow(fixtures).map((issue) => [issue.path, issue.details])).toEqual([
      [["variables", "area", "values"], { limit: "enumValues", max: 50, actual: 51 }],
      [["variables", "zone", "values"], { limit: "enumValues", max: 50, actual: 60 }],
    ]);

    const { ruleSet, directory } = loadFixtures();
    ruleSet.contextVariables["area"] = { type: "enum", values: enumValues(51, "a") };
    ruleSet.contextVariables["zone"] = { type: "enum", values: enumValues(60, "z") };
    expect(validateRuleSet(ruleSet, directory).issues.map((issue) => issue.path)).toEqual([
      ["contextVariables", "area", "values"],
      ["contextVariables", "zone", "values"],
    ]);
  });

  it("vacía o con repetidos dentro del límite sigue siendo ENUM_VALUES_INVALID", () => {
    for (const values of [[], ["a", "a"], [...enumValues(49), "v_0"]]) {
      const fixtures = loadFixtures();
      fixtures.flow.variables["area"] = { type: "enum", values };
      expect(semanticFlow(fixtures).map((issue) => issue.code)).toContain("ENUM_VALUES_INVALID");
      expect(enumLimitIssues(semanticFlow(fixtures))).toEqual([]);

      const { ruleSet, directory } = loadFixtures();
      ruleSet.contextVariables["area"] = { type: "enum", values };
      const codes = validateRuleSet(ruleSet, directory).issues.map((issue) => issue.code);
      expect(codes).toContain("ENUM_VALUES_INVALID");
    }
  });

  it("51 valores con repetidos devuelven solo el límite, porque se comprueba antes", () => {
    const values = [...enumValues(50), "v_0"];
    const fixtures = loadFixtures();
    fixtures.flow.variables["area"] = { type: "enum", values };
    expect(semanticFlow(fixtures).map((issue) => issue.code)).toEqual(["FLOW_LIMIT_EXCEEDED"]);

    const { ruleSet, directory } = loadFixtures();
    ruleSet.contextVariables["area"] = { type: "enum", values };
    expect(validateRuleSet(ruleSet, directory).issues.map((issue) => issue.code)).toEqual([
      "RULE_LIMIT_EXCEEDED",
    ]);
  });
});

describe("límite de valores de enum: entradas excesivas", () => {
  it("flujo: una lista de 120.000 valores se rechaza sin leer sus elementos", () => {
    const fixtures = loadFixtures();
    const flowList = countingList(enumValues(120_000));
    const ruleList = countingList(enumValues(120_000));
    withArea(fixtures, flowList.list, ruleList.list);

    const issues = semanticFlow(fixtures);
    expect(issues.map((issue) => [issue.code, issue.details?.["limit"]])).toEqual([
      ["FLOW_LIMIT_EXCEEDED", "enumValues"],
    ]);
    // Ni la comparación con el conjunto de reglas (O(n·m) antes de la corrección) ni ninguna otra
    // comprobación llegan a recorrer las listas.
    expect(flowList.reads()).toBe(0);
    expect(ruleList.reads()).toBe(0);
  });

  it("reglas: una lista de 120.000 valores se rechaza sin leer sus elementos", () => {
    const { ruleSet, directory } = loadFixtures();
    const list = countingList(enumValues(120_000));
    ruleSet.contextVariables["area"] = { type: "enum", values: list.list };

    const result = validateRuleSet(ruleSet, directory);
    expect(result.issues.map((issue) => [issue.code, issue.details?.["limit"]])).toEqual([
      ["RULE_LIMIT_EXCEEDED", "enumValues"],
    ]);
    expect(list.reads()).toBe(0);
  });

  it("publicación con 120.000 y con 250.000 valores: solo los límites, sin análisis semántico", () => {
    // 250.000 es el máximo de valores de un borrador según contracts (MAX_DRAFT_JSON_VALUES).
    for (const count of [120_000, 250_000]) {
      const fixtures = loadFixtures();
      withArea(fixtures, enumValues(count));
      const result = validate(fixtures);
      expect(result.valid).toBe(false);
      expect(result.flow.map((issue) => issue.details)).toEqual([
        { limit: "enumValues", max: 50, actual: count },
      ]);
      expect(ruleSetIssues(result).map((issue) => issue.details)).toEqual([
        { limit: "enumValues", max: 50, actual: count },
      ]);
    }
  });

  it("dentro del límite, el mismo flujo sí llega al análisis semántico", () => {
    // Contraste del caso anterior: sin una selección que asigne `area`, el análisis semántico
    // informa la variable posiblemente indefinida. Con la lista excedida, ese análisis no corre.
    const fixtures = loadFixtures();
    withArea(fixtures, enumValues(FLOW_LIMITS.enumValues));
    expect(validate(fixtures).flow.map((issue) => issue.code)).toContain(
      "VARIABLE_POSSIBLY_UNDEFINED",
    );
  });

  it("un límite de totales se informa primero, sin leer la lista excedida", () => {
    const fixtures = loadFixtures();
    for (let i = 0; i < FLOW_LIMITS.variables; i++) {
      fixtures.flow.variables[`note_${String(i)}`] = { type: "string" };
    }
    const list = countingList(enumValues(120_000));
    fixtures.flow.variables["area"] = { type: "enum", values: list.list };

    expect(semanticFlow(fixtures).map((issue) => [issue.path, issue.details?.["limit"]])).toEqual([
      [["variables"], "variables"],
    ]);
    expect(list.reads()).toBe(0);
  });
});

describe("límite de valores de enum: semántica conservada", () => {
  it("una opción fuera del enum sigue siendo VALUE_OUT_OF_DOMAIN con NOT_IN_ENUM", () => {
    const fixtures = loadFixtures();
    fixtures.flow.variables["priority"] = { type: "enum", values: ["low", "high"] };
    fixtures.flow.nodes.splice(2, 0, {
      id: "priority",
      type: "selection",
      text: "Prioridad",
      variable: "priority",
      options: [
        { id: "opt_low", label: "Baja", value: "low", next: "document_type" },
        { id: "opt_urgent", label: "Urgente", value: "urgent", next: "document_type" },
      ],
    });
    node(fixtures.flow, "company", "selection").next = "priority";

    expect(semanticFlow(fixtures)).toEqual([
      expect.objectContaining({
        code: "VALUE_OUT_OF_DOMAIN",
        path: ["nodes", 2, "options", 1, "value"],
        details: { reason: "NOT_IN_ENUM", value: "urgent" },
      }),
    ]);
  });

  it("valores del correo fuera del dominio de las reglas siguen siendo EMAIL_CONTEXT_MISMATCH", () => {
    const fixtures = loadFixtures();
    withArea(fixtures, ["north", "south", "east"], ["north", "south"]);
    expect(semanticFlow(fixtures)).toContainEqual(
      expect.objectContaining({
        code: "EMAIL_CONTEXT_MISMATCH",
        details: { reason: "ENUM_VALUES", variable: "area" },
      }),
    );

    const same = loadFixtures();
    withArea(same, ["north", "south"], ["south", "north"]);
    expect(semanticFlow(same).map((issue) => issue.code)).not.toContain("EMAIL_CONTEXT_MISMATCH");
  });

  it("una condición de regla fuera del enum sigue siendo RULE_CONDITION_INVALID", () => {
    const { ruleSet, directory } = loadFixtures();
    ruleSet.contextVariables["area"] = { type: "enum", values: ["north", "south"] };
    const rule = ruleSet.rules[0];
    if (rule === undefined) throw new Error("El ejemplo no tiene reglas.");
    rule.all.push({ variable: "area", operator: "eq", value: "west" });

    expect(validateRuleSet(ruleSet, directory).issues).toContainEqual(
      expect.objectContaining({
        code: "RULE_CONDITION_INVALID",
        path: ["rules", 0, "all", 2, "value"],
        details: { reason: "VALUE_OUT_OF_DOMAIN" },
      }),
    );
  });
});

describe("límite de valores de enum: compatibilidad con los ejemplos", () => {
  it("los ejemplos no declaran enum por encima del límite y siguen siendo válidos", () => {
    const flow = readExample(EXAMPLE_FILES.flow) as {
      variables: Record<string, { type: string; values?: unknown[] }>;
    };
    const ruleSet = readExample(EXAMPLE_FILES.ruleSet) as {
      contextVariables: Record<string, { type: string; values?: unknown[] }>;
    };
    const declared = [
      ...Object.values(flow.variables).map(
        (variable) => [variable, FLOW_LIMITS.enumValues] as const,
      ),
      ...Object.values(ruleSet.contextVariables).map(
        (variable) => [variable, RULE_LIMITS.enumValues] as const,
      ),
    ];
    for (const [variable, max] of declared) {
      if (variable.type === "enum") expect(variable.values?.length ?? 0).toBeLessThanOrEqual(max);
    }

    const result = validate(loadFixtures());
    expect(result.valid).toBe(true);
  });
});

describe("conjuntos de enum: sin datos de una validación anterior", () => {
  // Regresión de la revisión: una caché global por array devolvía el conjunto viejo cuando quien
  // llama modificaba el mismo array entre dos validaciones.

  /** Selección de prioridad con una única opción `option`, sobre el array `values`. */
  function withPriority(values: string[], option: string): Fixtures {
    const fixtures = loadFixtures();
    fixtures.flow.variables["priority"] = { type: "enum", values };
    fixtures.flow.nodes.splice(2, 0, {
      id: "priority",
      type: "selection",
      text: "Prioridad",
      variable: "priority",
      options: [{ id: "opt", label: "Opción", value: option, next: "document_type" }],
    });
    node(fixtures.flow, "company", "selection").next = "priority";
    return fixtures;
  }

  const outOfDomain = (fixtures: Fixtures): boolean =>
    semanticFlow(fixtures).some((issue) => issue.code === "VALUE_OUT_OF_DOMAIN");

  it("flujo: agregar, eliminar y reemplazar valores en el mismo array", () => {
    const values = ["low", "high"];
    const fixtures = withPriority(values, "urgent");
    expect(outOfDomain(fixtures)).toBe(true);

    values.push("urgent");
    expect(outOfDomain(fixtures)).toBe(false);

    values.splice(values.indexOf("urgent"), 1);
    expect(outOfDomain(fixtures)).toBe(true);

    values[1] = "urgent";
    expect(outOfDomain(fixtures)).toBe(false);
    values[1] = "high";
    expect(outOfDomain(fixtures)).toBe(true);
  });

  it("flujo: el contexto del correo usa los valores actuales del enum de las reglas", () => {
    const fixtures = loadFixtures();
    const ruleValues = ["north", "south"];
    withArea(fixtures, ["north", "south", "east"], ruleValues);
    const mismatch = (): boolean =>
      semanticFlow(fixtures).some((issue) => issue.code === "EMAIL_CONTEXT_MISMATCH");
    expect(mismatch()).toBe(true);
    ruleValues.push("east");
    expect(mismatch()).toBe(false);
    ruleValues.splice(0, 1);
    expect(mismatch()).toBe(true);
  });

  it("reglas: agregar, eliminar y reemplazar valores en el mismo array", () => {
    const { ruleSet, directory } = loadFixtures();
    const values = ["north", "south"];
    ruleSet.contextVariables["area"] = { type: "enum", values };
    const rule = ruleSet.rules[0];
    if (rule === undefined) throw new Error("El ejemplo no tiene reglas.");
    rule.all.push({ variable: "area", operator: "eq", value: "west" });
    const invalid = (): boolean =>
      validateRuleSet(ruleSet, directory).issues.some(
        (issue) => issue.code === "RULE_CONDITION_INVALID",
      );
    expect(invalid()).toBe(true);

    values.push("west");
    expect(invalid()).toBe(false);

    values.splice(values.indexOf("west"), 1);
    expect(invalid()).toBe(true);

    values[0] = "west";
    expect(invalid()).toBe(false);
    values[0] = "north";
    expect(invalid()).toBe(true);
  });

  it("el límite de 50 y el corte temprano se evalúan sobre el array actual", () => {
    const values = enumValues(FLOW_LIMITS.enumValues);
    const fixtures = withPriority(values, "v_0");
    expect(enumLimitIssues(semanticFlow(fixtures))).toEqual([]);

    values.push("extra");
    expect(semanticFlow(fixtures).map((issue) => [issue.code, issue.details?.["limit"]])).toEqual([
      ["FLOW_LIMIT_EXCEEDED", "enumValues"],
    ]);

    values.pop();
    expect(enumLimitIssues(semanticFlow(fixtures))).toEqual([]);

    const { ruleSet, directory } = loadFixtures();
    const ruleValues = enumValues(RULE_LIMITS.enumValues);
    ruleSet.contextVariables["area"] = { type: "enum", values: ruleValues };
    expect(enumLimitIssues(validateRuleSet(ruleSet, directory).issues)).toEqual([]);
    ruleValues.push("extra");
    expect(validateRuleSet(ruleSet, directory).issues.map((issue) => issue.code)).toEqual([
      "RULE_LIMIT_EXCEEDED",
    ]);
  });
});
