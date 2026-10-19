import { describe, expect, it } from "vitest";
import { FLOW_LIMITS, validatePublication, validateRuleSet } from "../src/index.js";
import {
  at,
  expectIssues,
  loadFixtures,
  node,
  ruleSetIssues,
  validate,
  withRoute,
} from "./helpers.js";

describe("variables definidas en todos los caminos", () => {
  it("la salida onEmpty de una selección dinámica no asigna la variable", () => {
    const fixtures = loadFixtures();
    node(fixtures.flow, "company", "selection").onEmpty = "document_type";

    const issues = validate(fixtures).flow.filter(
      (issue) => issue.code === "VARIABLE_POSSIBLY_UNDEFINED",
    );
    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        ["nodes", 3, "review", "text"],
        ["nodes", 4, "body"],
        ["nodes", 4, "contextVariables", 0],
      ]),
    );
    expect(issues.every((issue) => issue.details?.["variable"] === "company")).toBe(true);
  });

  it("exists no exige que la variable esté definida", () => {
    const fixtures = loadFixtures();
    fixtures.flow.variables["note"] = { type: "string" };
    at(withRoute(fixtures).branches, 0).all = [{ variable: "note", operator: "exists" }];

    expect(validate(fixtures).flow).toEqual([]);
  });
});

describe("condiciones", () => {
  it("acepta ramas disjuntas sobre dominios finitos", () => {
    const fixtures = loadFixtures();
    withRoute(fixtures).branches.push({
      id: "b_medical",
      all: [{ variable: "documentType", operator: "eq", value: "medical_certificate" }],
      next: "upload",
    });

    expect(validate(fixtures).flow).toEqual([]);
  });

  it("rechaza ramas que solo pueden distinguirse por variables no finitas", () => {
    const fixtures = loadFixtures();
    fixtures.flow.variables["note"] = { type: "string" };
    const route = withRoute(fixtures);
    at(route.branches, 0).all = [{ variable: "note", operator: "exists" }];
    route.branches.push({
      id: "b_note_any",
      all: [{ variable: "note", operator: "exists" }],
      next: "upload",
    });

    expectIssues(validate(fixtures).flow, [
      { code: "CONDITION_BRANCHES_OVERLAP", path: ["nodes", 9, "branches", 1] },
    ]);
  });
});

describe("transiciones automáticas por evento", () => {
  const chainMessages = (count: number) => {
    const fixtures = loadFixtures();
    node(fixtures.flow, "confirmation", "message").next = "chain_1";
    for (let i = 1; i <= count; i++) {
      fixtures.flow.nodes.push({
        id: `chain_${String(i)}`,
        type: "message",
        text: "Paso",
        next: i === count ? "end" : `chain_${String(i + 1)}`,
      });
    }
    return validate(fixtures).flow;
  };

  it("acepta exactamente el límite", () => {
    // email → confirmation → 18 mensajes → end = 20 transiciones.
    expect(chainMessages(FLOW_LIMITS.automaticTransitionsPerEvent - 2)).toEqual([]);
  });

  it("rechaza una cadena que lo supera", () => {
    expectIssues(chainMessages(FLOW_LIMITS.automaticTransitionsPerEvent - 1), [
      { code: "FLOW_LIMIT_EXCEEDED", path: ["nodes"] },
    ]);
  });
});

describe("opciones dinámicas de tipos documentales", () => {
  const dynamicDocumentTypes = (restrictByCompany: boolean) => {
    const fixtures = loadFixtures();
    const selection = node(fixtures.flow, "document_type", "selection");
    delete selection.options;
    selection.optionsSource = { kind: "DOCUMENT_TYPES", companyVariable: "company" };
    selection.maxOptions = 1;
    selection.next = "upload";
    selection.onEmpty = "no_scope";
    if (restrictByCompany) {
      const [invoice, medical] = fixtures.directory.documentCatalog.documentTypes;
      if (invoice && medical) {
        invoice.companyIds = ["company_a"];
        medical.companyIds = ["company_b"];
      }
    }
    return validate(fixtures).flow;
  };

  it("calcula la cota por empresa cuando los tipos declaran empresas habilitadas", () => {
    expect(dynamicDocumentTypes(true)).toEqual([]);
  });

  it("sin restricción por empresa, la cota supera maxOptions", () => {
    expectIssues(dynamicDocumentTypes(false), [
      { code: "DYNAMIC_OPTIONS_LIMIT_EXCEEDED", path: ["nodes", 2, "maxOptions"] },
    ]);
  });
});

describe("selecciones estáticas", () => {
  it("una opción de una empresa inactiva queda fuera del dominio vigente", () => {
    const fixtures = loadFixtures();
    const company = node(fixtures.flow, "company", "selection");
    delete company.optionsSource;
    delete company.maxOptions;
    delete company.autoSelectSingle;
    delete company.next;
    delete company.onEmpty;
    company.options = [
      { id: "opt_a", label: "Empresa A", value: "company_a", next: "document_type" },
      { id: "opt_b", label: "Empresa B", value: "company_b", next: "document_type" },
    ];
    fixtures.flow.nodes = fixtures.flow.nodes.filter(
      (candidate) => candidate.id !== "no_scope" && candidate.id !== "end_no_scope",
    );
    const companyB = fixtures.directory.companies.find((c) => c.id === "company_b");
    if (companyB) companyB.active = false;
    fixtures.ruleSet.rules = fixtures.ruleSet.rules.filter((rule) => !rule.id.includes("_b_"));

    const result = validate(fixtures);
    expect(ruleSetIssues(result)).toEqual([]);
    expectIssues(result.flow, [
      { code: "VALUE_OUT_OF_DOMAIN", path: ["nodes", 1, "options", 1, "value"] },
    ]);
    expect(result.flow[0]?.details?.["reason"]).toBe("INACTIVE");
  });
});

describe("cobertura de reglas", () => {
  it("una combinación sin regla es válida si figura explícitamente en reviewOnly", () => {
    const { ruleSet, directory } = loadFixtures();
    ruleSet.rules.splice(3, 1);
    ruleSet.reviewOnly = [{ company: "company_b", documentType: "medical_certificate" }];

    const result = validateRuleSet(ruleSet, directory);
    expect(result.issues).toEqual([]);
    expect(result.coverage?.entries).toContainEqual({
      combination: { company: "company_b", documentType: "medical_certificate" },
      outcome: "REVIEW_ONLY",
    });
  });

  it("rechaza un dominio con más combinaciones que el límite sin recorrerlo", () => {
    const { ruleSet, directory } = loadFixtures();
    ruleSet.contextVariables["channel"] = {
      type: "enum",
      values: Array.from({ length: 300 }, (_, i) => `channel_${String(i)}`),
    };

    const result = validateRuleSet(ruleSet, directory);
    expect(result.coverage).toBeUndefined();
    expectIssues(result.issues, [{ code: "RULE_LIMIT_EXCEEDED", path: ["contextVariables"] }]);
    expect(result.issues[0]?.details).toMatchObject({ limit: "combinations", actual: 1200 });
  });

  it("los destinatarios se cuentan sin repetir y respetan el máximo por envío", () => {
    const { ruleSet, directory } = loadFixtures();
    const group = directory.recipientGroups.find((g) => g.id === "company_a_accounting");
    for (let i = 0; i < 21; i++) {
      const id = `contact_extra_${String(i)}`;
      directory.contacts.push({
        id,
        companyId: "company_a",
        email: `extra_${String(i)}@example.com`,
        allowedClassifications: ["GENERAL"],
        active: true,
      });
      group?.memberContactIds.push(id);
    }

    expectIssues(validateRuleSet(ruleSet, directory).issues, [
      { code: "RULE_LIMIT_EXCEEDED", path: ["rules", 0, "targetGroupIds"] },
    ]);
  });
});

describe("validación de publicación", () => {
  it("con el directorio inválido no informa errores derivados en reglas ni flujo", () => {
    const fixtures = loadFixtures();
    at(fixtures.directory.contacts, 0).companyId = "company_z";

    const result = validate(fixtures);
    expect(result.valid).toBe(false);
    expect(result.directory).not.toEqual([]);
    expect(result.flow).toEqual([]);
    expect(ruleSetIssues(result)).toEqual([]);
  });

  it("informa ids repetidos entre conjuntos de reglas", () => {
    const { flow, ruleSet, directory } = loadFixtures();
    const result = validatePublication({ flow, ruleSets: [ruleSet, ruleSet], directory });
    expect(result.valid).toBe(false);
    expectIssues(at(result.ruleSets, 1).issues, [{ code: "DUPLICATE_ID", path: ["ruleSetId"] }]);
  });

  it("produce el mismo resultado ante la misma entrada", () => {
    const first = loadFixtures();
    const second = loadFixtures();
    for (const fixtures of [first, second]) {
      fixtures.ruleSet.rules.splice(3, 1);
      node(fixtures.flow, "confirmation", "message").text = "{{missing}}";
    }
    expect(validate(first)).toEqual(validate(second));
  });

  it("rechaza entradas que no son objetos", () => {
    const result = validatePublication({ flow: null, ruleSets: ["x"], directory: [] });
    expect(result.valid).toBe(false);
    expect(result.flow.map((issue) => issue.code)).toEqual(["STRUCTURE_INVALID"]);
    expect(result.directory.map((issue) => issue.code)).toEqual(["STRUCTURE_INVALID"]);
  });
});
