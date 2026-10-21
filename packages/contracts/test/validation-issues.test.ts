import {
  parseDirectory,
  parseFlowDefinition,
  parseRuleSet,
  validatePublication,
  type Directory,
  type FlowDefinition,
  type RuleSet,
} from "@sistema-chatbot/flow-schema";
import { describe, expect, it } from "vitest";
import {
  apiErrorResponseSchema,
  MAX_ISSUES_PER_RESPONSE,
  toValidationIssueDto,
  toValidationReport,
  validationIssueDtoSchema,
  validationReportSchema,
} from "../src/index.js";
import { readExample } from "./samples.js";

interface Fixtures {
  flow: FlowDefinition;
  ruleSet: RuleSet;
  directory: Directory;
}

function fixtures(): Fixtures {
  const flow = parseFlowDefinition(readExample("flujo_documental_demo.json"));
  const ruleSet = parseRuleSet(readExample("reglas_distribucion_demo.json"));
  const directory = parseDirectory(readExample("directorio_demo.json"));
  if (!flow.ok || !ruleSet.ok || !directory.ok) throw new Error("fixtures inválidos");
  return { flow: flow.value, ruleSet: ruleSet.value, directory: directory.value };
}

function publication(f: Fixtures) {
  return validatePublication({ flow: f.flow, ruleSets: [f.ruleSet], directory: f.directory });
}

describe("reutilización de los problemas de flow-schema", () => {
  it("los ejemplos válidos producen un informe vacío", () => {
    const report = toValidationReport(publication(fixtures()));
    expect(report).toEqual({ issues: [], totalIssues: 0, truncated: false });
    expect(validationReportSchema.safeParse(report).success).toBe(true);
  });

  it("conserva código, documento, ruta y nodo de un problema del flujo", () => {
    const f = fixtures();
    const noScope = f.flow.nodes.find((node) => node.id === "no_scope");
    if (noScope?.type !== "message") throw new Error("fixture sin no_scope");
    delete noScope.next;

    const result = publication(f);
    const report = toValidationReport(result);
    const missing = report.issues.find((dto) => dto.code === "MISSING_TARGET");
    expect(missing).toEqual({
      code: "MISSING_TARGET",
      message: expect.any(String) as string,
      document: { type: "FLOW" },
      path: ["nodes", 7, "next"],
      nodeId: "no_scope",
    });
    expect(report.totalIssues).toBe(result.flow.length);
    expect(validationReportSchema.safeParse(report).success).toBe(true);
  });

  it("atribuye los problemas de reglas a su conjunto y quita identificadores de contactos", () => {
    const f = fixtures();
    const rule = f.ruleSet.rules[1];
    if (rule === undefined) throw new Error("fixture sin reglas");
    rule.targetGroupIds = ["company_b_hr"];

    const result = publication(f);
    const original = result.ruleSets[0]?.issues.find(
      (issue) => issue.code === "RECIPIENT_NOT_AUTHORIZED",
    );
    expect(original?.details?.["contactId"]).toBe("contact_company_b_hr");

    const report = toValidationReport(result);
    const dto = report.issues.find((issue) => issue.code === "RECIPIENT_NOT_AUTHORIZED");
    expect(dto).toMatchObject({
      document: { type: "RULE_SET", index: 0, ruleSetId: "routing_demo" },
      path: ["rules", 1, "targetGroupIds", 0],
      details: { reason: "COMPANY_MISMATCH", groupId: "company_b_hr" },
    });
    expect(dto?.details).not.toHaveProperty("contactId");
    expect(validationReportSchema.safeParse(report).success).toBe(true);
  });

  it("el límite enumValues de flujo y reglas llega al informe con sus detalles", () => {
    const f = fixtures();
    const values = Array.from({ length: 51 }, (_, i) => `area_${String(i)}`);
    f.flow.variables["area"] = { type: "enum", values };
    f.ruleSet.contextVariables["area"] = { type: "enum", values };

    const report = toValidationReport(publication(f));
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "RULE_LIMIT_EXCEEDED",
        document: { type: "RULE_SET", index: 0, ruleSetId: "routing_demo" },
        path: ["contextVariables", "area", "values"],
        details: { limit: "enumValues", max: 50, actual: 51 },
      }),
      expect.objectContaining({
        code: "FLOW_LIMIT_EXCEEDED",
        document: { type: "FLOW" },
        path: ["variables", "area", "values"],
        details: { limit: "enumValues", max: 50, actual: 51 },
      }),
    ]);
    expect(validationReportSchema.safeParse(report).success).toBe(true);
  });

  it("conserva el código y la ubicación de los problemas estructurales", () => {
    const f = fixtures();
    const upload = f.flow.nodes.find((node) => node.id === "upload");
    if (upload === undefined) throw new Error("fixture sin upload");
    Object.assign(upload, { maxCandidates: 3 });

    const dto = toValidationReport(publication(f)).issues[0];
    expect(dto).toMatchObject({
      code: "STRUCTURE_INVALID",
      path: ["nodes", 3],
      nodeId: "upload",
      details: { reason: "unrecognized_keys" },
    });
  });

  it("descarta un nodeId que no es un identificador válido", () => {
    const dto = toValidationIssueDto(
      { code: "STRUCTURE_INVALID", message: "x", path: ["nodes", 0], nodeId: "Nodo Inválido" },
      { type: "FLOW" },
    );
    expect(dto).not.toHaveProperty("nodeId");
    expect(validationIssueDtoSchema.safeParse(dto).success).toBe(true);
  });

  it("trunca informes grandes e indica el total", () => {
    const f = fixtures();
    for (let i = 0; i < 600; i++) {
      f.directory.companies.push({ id: "company_a", name: "Copia", active: true });
    }
    const result = publication(f);
    expect(result.directory.length).toBe(600);

    const report = toValidationReport(result);
    expect(report.issues).toHaveLength(MAX_ISSUES_PER_RESPONSE);
    expect(report).toMatchObject({ totalIssues: 600, truncated: true });
    expect(
      apiErrorResponseSchema.safeParse({
        error: {
          code: "FLOW_INVALID",
          message: "La definición tiene problemas.",
          requestId: "req-1",
          details: report,
        },
      }).success,
    ).toBe(true);

    expect(toValidationReport(result, 10)).toMatchObject({ totalIssues: 600, truncated: true });
    expect(toValidationReport(result, 10).issues).toHaveLength(10);
  });
});
