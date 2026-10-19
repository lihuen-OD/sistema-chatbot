import { describe, expect, it } from "vitest";
import {
  FLOW_LIMITS,
  RULE_LIMITS,
  parseFlowDefinition,
  validateFlowDefinition,
  validatePublication,
  validateRuleSet,
  type FlowDefinition,
  type FlowNode,
  type Rule,
} from "../src/index.js";
import { expectIssues, loadFixtures, node, validate, type Fixtures } from "./helpers.js";

// Regresiones de la revisión del commit f0d056f de P1-T1.

/** start → (total - 2) nodos intermedios → end. */
function linearFlow(total: number, middle: "messages" | "alternating"): FlowDefinition {
  const nodes: FlowNode[] = [{ id: "start", type: "start", next: "n_1" }];
  for (let i = 1; i <= total - 2; i++) {
    const id = `n_${String(i)}`;
    const next = i === total - 2 ? "end" : `n_${String(i + 1)}`;
    nodes.push(
      middle === "alternating" && i % 2 === 1
        ? { id, type: "capture", text: "Dato", variable: "note", next }
        : { id, type: "message", text: "Paso", next },
    );
  }
  nodes.push({ id: "end", type: "end", reason: "COMPLETED" });
  return {
    schemaVersion: 1,
    flowId: "linear_flow",
    name: "Flujo lineal",
    variables: { note: { type: "string" } },
    entryNodeId: "start",
    nodes,
  };
}

function semantic(fixtures: Fixtures, flow: FlowDefinition = fixtures.flow) {
  return validateFlowDefinition(flow, {
    directory: fixtures.directory,
    ruleSets: [fixtures.ruleSet],
  });
}

describe("hallazgo 1: definiciones que superan límites se rechazan antes del análisis costoso", () => {
  it("entrada pública: un flujo lineal de 6.000 nodos devuelve solo el límite de nodos", () => {
    const { ruleSet, directory } = loadFixtures();
    const result = validatePublication({
      flow: linearFlow(6000, "messages"),
      ruleSets: [ruleSet],
      directory,
    });
    expect(result.valid).toBe(false);
    expectIssues(result.flow, [{ code: "FLOW_LIMIT_EXCEEDED", path: ["nodes"] }]);
    expect(result.flow[0]?.details).toMatchObject({ limit: "nodes", max: 100, actual: 6000 });
  });

  it("función semántica exportada: el mismo flujo devuelve solo el límite de nodos", () => {
    const fixtures = loadFixtures();
    const issues = semantic(fixtures, linearFlow(6000, "messages"));
    expectIssues(issues, [{ code: "FLOW_LIMIT_EXCEEDED", path: ["nodes"] }]);
  });

  it("frontera de nodos: 100 es válido y 101 se rechaza solo por el límite", () => {
    const fixtures = loadFixtures();
    expect(semantic(fixtures, linearFlow(FLOW_LIMITS.nodes, "alternating"))).toEqual([]);
    expectIssues(semantic(fixtures, linearFlow(FLOW_LIMITS.nodes + 1, "alternating")), [
      { code: "FLOW_LIMIT_EXCEEDED", path: ["nodes"] },
    ]);
  });

  it("frontera de variables: 30 es válido", () => {
    const fixtures = loadFixtures();
    for (let i = 1; i <= FLOW_LIMITS.variables - 3; i++) {
      fixtures.flow.variables[`extra${String(i)}`] = { type: "string" };
    }
    expect(semantic(fixtures)).toEqual([]);
  });

  it("una selección con 5.000 opciones devuelve solo el límite de opciones", () => {
    const fixtures = loadFixtures();
    const selection = node(fixtures.flow, "document_type", "selection");
    selection.options = Array.from({ length: 5000 }, (_, i) => ({
      id: `opt_${String(i)}`,
      label: "Factura",
      value: "invoice",
      next: "upload",
    }));
    expectIssues(semantic(fixtures), [
      { code: "FLOW_LIMIT_EXCEEDED", path: ["nodes", 2, "options"] },
    ]);
  });

  it("frontera de opciones: 10 opciones válidas se aceptan", () => {
    const fixtures = loadFixtures();
    const values = Array.from({ length: FLOW_LIMITS.staticOptions }, (_, i) => `p_${String(i)}`);
    fixtures.flow.variables["priority"] = { type: "enum", values };
    fixtures.flow.nodes.splice(2, 0, {
      id: "priority",
      type: "selection",
      text: "Prioridad",
      variable: "priority",
      options: values.map((value) => ({
        id: `opt_${value}`,
        label: value,
        value,
        next: "document_type",
      })),
    });
    const company = node(fixtures.flow, "company", "selection");
    company.next = "priority";
    expect(semantic(fixtures)).toEqual([]);
  });

  it("una condición con 400 ramas devuelve solo el límite de ramas", () => {
    const fixtures = loadFixtures();
    fixtures.flow.variables["note"] = { type: "string" };
    node(fixtures.flow, "upload", "file").next = "route";
    fixtures.flow.nodes.push({
      id: "route",
      type: "condition",
      branches: Array.from({ length: 400 }, (_, i) => ({
        id: `b_${String(i)}`,
        all: [{ variable: "note", operator: "exists" as const }],
        next: "email",
      })),
      else: "email",
    });
    expectIssues(semantic(fixtures), [
      { code: "FLOW_LIMIT_EXCEEDED", path: ["nodes", 9, "branches"] },
    ]);
  });

  it("frontera de ramas: 10 ramas disjuntas se aceptan", () => {
    const fixtures = loadFixtures();
    const values = Array.from(
      { length: FLOW_LIMITS.conditionBranches },
      (_, i) => `p_${String(i)}`,
    );
    fixtures.flow.variables["priority"] = { type: "enum", values };
    fixtures.flow.nodes.splice(2, 0, {
      id: "priority",
      type: "selection",
      text: "Prioridad",
      variable: "priority",
      options: [{ id: "opt_p", label: "P", value: "p_0", next: "route" }],
    });
    node(fixtures.flow, "company", "selection").next = "priority";
    fixtures.flow.nodes.push({
      id: "route",
      type: "condition",
      branches: values.map((value) => ({
        id: `b_${value}`,
        all: [{ variable: "priority", operator: "eq" as const, value }],
        next: "document_type",
      })),
      else: "document_type",
    });
    expect(semantic(fixtures)).toEqual([]);
  });

  it("predicados y listas muy por encima del límite devuelven solo el límite", () => {
    const fixtures = loadFixtures();
    node(fixtures.flow, "upload", "file").next = "route";
    fixtures.flow.nodes.push({
      id: "route",
      type: "condition",
      branches: [
        {
          id: "b_many",
          all: [
            {
              variable: "documentType",
              operator: "in" as const,
              value: Array.from({ length: 5000 }, () => "invoice"),
            },
            ...Array.from({ length: 4999 }, () => ({
              variable: "documentType",
              operator: "eq" as const,
              value: "invoice",
            })),
          ],
          next: "email",
        },
      ],
      else: "email",
    });
    expectIssues(semantic(fixtures), [
      { code: "FLOW_LIMIT_EXCEEDED", path: ["nodes", 9, "branches", 0, "all"] },
      { code: "FLOW_LIMIT_EXCEEDED", path: ["nodes", 9, "branches", 0, "all", 0, "value"] },
    ]);
  });

  it("un directorio con 200.000 empresas no rompe la cota de opciones dinámicas", () => {
    const fixtures = loadFixtures();
    for (let i = 0; i < 200_000; i++) {
      fixtures.directory.companies.push({ id: `bulk_${String(i)}`, name: "Empresa", active: true });
    }
    const types = node(fixtures.flow, "document_type", "selection");
    delete types.options;
    types.optionsSource = { kind: "DOCUMENT_TYPES", companyVariable: "company" };
    types.maxOptions = 10;
    types.next = "upload";
    types.onEmpty = "no_scope";

    expectIssues(semantic(fixtures), [
      { code: "DYNAMIC_OPTIONS_LIMIT_EXCEEDED", path: ["nodes", 1, "maxOptions"] },
    ]);
  });

  const ruleFor = (company: string, documentType: string, channel: string, n: number): Rule => ({
    id: `rule_${String(n)}`,
    all: [
      { variable: "company", operator: "eq", value: company },
      { variable: "documentType", operator: "eq", value: documentType },
      { variable: "channel", operator: "eq", value: channel },
    ],
    targetGroupIds: [`${company}_${documentType === "invoice" ? "accounting" : "hr"}`],
  });

  /** 2 empresas × 2 tipos × 50 canales = 200 combinaciones, una regla por combinación. */
  function rulesAtBoundary(fixtures: Fixtures): void {
    const channels = Array.from({ length: 50 }, (_, i) => `ch_${String(i)}`);
    fixtures.ruleSet.contextVariables["channel"] = { type: "enum", values: channels };
    const rules: Rule[] = [];
    for (const company of ["company_a", "company_b"]) {
      for (const documentType of ["invoice", "medical_certificate"]) {
        for (const channel of channels)
          rules.push(ruleFor(company, documentType, channel, rules.length));
      }
    }
    fixtures.ruleSet.rules = rules;
  }

  it("frontera de reglas: 200 reglas que cubren 200 combinaciones se aceptan", () => {
    const fixtures = loadFixtures();
    rulesAtBoundary(fixtures);
    const result = validateRuleSet(fixtures.ruleSet, fixtures.directory);
    expect(result.issues).toEqual([]);
    expect(result.coverage?.combinations).toBe(RULE_LIMITS.rules);
  });

  it("201 reglas devuelven solo el límite y no calculan cobertura", () => {
    const fixtures = loadFixtures();
    rulesAtBoundary(fixtures);
    fixtures.ruleSet.rules.push(ruleFor("company_a", "invoice", "ch_0", 9999));
    const result = validateRuleSet(fixtures.ruleSet, fixtures.directory);
    expectIssues(result.issues, [{ code: "RULE_LIMIT_EXCEEDED", path: ["rules"] }]);
    expect(result.coverage).toBeUndefined();
  });

  it("6.000 reglas devuelven solo el límite de reglas", () => {
    const { ruleSet, directory } = loadFixtures();
    const template = ruleSet.rules[0];
    if (!template) throw new Error("fixture sin reglas");
    ruleSet.rules = Array.from({ length: 6000 }, (_, i) => ({
      ...template,
      id: `rule_${String(i)}`,
    }));
    const result = validateRuleSet(ruleSet, directory);
    expectIssues(result.issues, [{ code: "RULE_LIMIT_EXCEEDED", path: ["rules"] }]);
    expect(result.coverage).toBeUndefined();
  });

  it("6.000 variables de contexto devuelven solo el límite, sin recorrer el dominio", () => {
    const { ruleSet, directory } = loadFixtures();
    for (let i = 0; i < 6000; i++) {
      ruleSet.contextVariables[`v${String(i)}`] = { type: "enum", values: ["x"] };
    }
    const result = validateRuleSet(ruleSet, directory);
    expectIssues(result.issues, [{ code: "RULE_LIMIT_EXCEEDED", path: ["contextVariables"] }]);
    expect(result.coverage).toBeUndefined();
  });
});

describe("hallazgo 2: una confirmación no habilita dos envíos", () => {
  const secondEmail = (fixtures: Fixtures, id: string, next: string): FlowNode => ({
    ...node(fixtures.flow, "email", "email"),
    id,
    next,
  });

  it("rechaza dos correos consecutivos con el mismo documento", () => {
    const fixtures = loadFixtures();
    node(fixtures.flow, "email", "email").next = "email_again";
    fixtures.flow.nodes.push(secondEmail(fixtures, "email_again", "confirmation"));

    expectIssues(validate(fixtures).flow, [
      { code: "CONFIRMATION_REUSED", path: ["nodes", 9], nodeId: "email_again" },
    ]);
  });

  it("rechaza el mismo caso con nodos intermedios", () => {
    const fixtures = loadFixtures();
    node(fixtures.flow, "email", "email").next = "notice";
    fixtures.flow.nodes.push(
      { id: "notice", type: "message", text: "Enviamos una copia más.", next: "email_again" },
      secondEmail(fixtures, "email_again", "confirmation"),
    );

    expectIssues(validate(fixtures).flow, [
      { code: "CONFIRMATION_REUSED", path: ["nodes", 10], nodeId: "email_again" },
    ]);
  });

  it("acepta ramas alternativas con un solo envío por recorrido", () => {
    const fixtures = loadFixtures();
    node(fixtures.flow, "upload", "file").next = "route_send";
    fixtures.flow.nodes.push(
      {
        id: "route_send",
        type: "condition",
        branches: [
          {
            id: "b_invoice",
            all: [{ variable: "documentType", operator: "eq", value: "invoice" }],
            next: "email",
          },
        ],
        else: "email_alt",
      },
      secondEmail(fixtures, "email_alt", "confirmation"),
    );

    expect(validate(fixtures).flow).toEqual([]);
  });
});

describe("hallazgo 3: el asunto del correo no admite CR ni LF", () => {
  const subjects = {
    CRLF: "Documento\r\nBcc: otra@example.com",
    CR: "Documento\rBcc: otra@example.com",
    LF: "Documento\nBcc: otra@example.com",
  };

  it.each(Object.entries(subjects))("entrada pública: rechaza %s", (_name, subject) => {
    const fixtures = loadFixtures();
    node(fixtures.flow, "email", "email").subject = subject;
    expectIssues(validate(fixtures).flow, [
      { code: "EMAIL_SUBJECT_LINE_BREAK", path: ["nodes", 4, "subject"], nodeId: "email" },
    ]);
    const parsed = parseFlowDefinition(fixtures.flow);
    expect(parsed.ok).toBe(false);
  });

  it.each(Object.entries(subjects))("función semántica exportada: rechaza %s", (_name, subject) => {
    const fixtures = loadFixtures();
    node(fixtures.flow, "email", "email").subject = subject;
    expectIssues(semantic(fixtures), [
      { code: "EMAIL_SUBJECT_LINE_BREAK", path: ["nodes", 4, "subject"], nodeId: "email" },
    ]);
  });

  it("conserva asuntos válidos con plantillas y saltos de línea en el cuerpo", () => {
    const fixtures = loadFixtures();
    const email = node(fixtures.flow, "email", "email");
    email.subject = 'Recepción: {{documentType}} — {{company}} (ñ, tildes y comillas "ok")';
    email.body = "Línea 1\r\nLínea 2\nSe recibió un documento para {{company}}.";
    expect(validate(fixtures).flow).toEqual([]);
  });
});
