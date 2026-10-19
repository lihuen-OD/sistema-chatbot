import { describe, expect, it } from "vitest";
import { ISSUE_CODES, type IssueCode } from "../src/index.js";
import {
  at,
  expectIssues,
  loadFixtures,
  node,
  ruleSetIssues,
  validate,
  withRoute,
  type ExpectedIssue,
  type Fixtures,
} from "./helpers.js";

interface NegativeCase {
  readonly name: string;
  readonly mutate: (fixtures: Fixtures) => void;
  readonly flow?: readonly ExpectedIssue[];
  readonly ruleSet?: readonly ExpectedIssue[];
  readonly directory?: readonly ExpectedIssue[];
}

// Índices de nodos del flujo de ejemplo: 0 start, 1 company, 2 document_type, 3 upload, 4 email,
// 5 confirmation, 6 end, 7 no_scope, 8 end_no_scope. Los nodos agregados empiezan en 9.
const CASES: readonly NegativeCase[] = [
  // --- Estructura ---
  {
    name: "una clave desconocida es un error estructural (el cupo de candidatos no se configura en el flujo)",
    mutate: (f) => Object.assign(node(f.flow, "upload", "file"), { maxCandidates: 3 }),
    flow: [{ code: "STRUCTURE_INVALID", path: ["nodes", 3], nodeId: "upload" }],
  },
  {
    name: "una versión de esquema distinta de 1 no se acepta",
    mutate: (f) => Object.assign(f.flow, { schemaVersion: 2 }),
    flow: [{ code: "SCHEMA_VERSION_UNSUPPORTED", path: ["schemaVersion"] }],
  },
  {
    name: "una regla con grupo genérico de respaldo no es estructuralmente válida",
    mutate: (f) => Object.assign(f.ruleSet, { defaultBehavior: "FALLBACK_GROUP" }),
    ruleSet: [{ code: "STRUCTURE_INVALID", path: ["defaultBehavior"] }],
    flow: [{ code: "RULE_SET_NOT_FOUND", path: ["nodes", 4, "ruleSetId"] }],
  },
  {
    name: "una clasificación que no define ADR-012 es un error estructural del directorio",
    mutate: (f) => Object.assign(at(f.directory.classifications, 0), { code: "SECRET" }),
    directory: [{ code: "STRUCTURE_INVALID", path: ["classifications", 0, "code"] }],
  },
  // --- Ids, inicio y salidas ---
  {
    name: "ids de nodo repetidos",
    mutate: (f) => f.flow.nodes.push({ id: "end", type: "end", reason: "COMPLETED" }),
    flow: [{ code: "DUPLICATE_ID", path: ["nodes", 9, "id"] }],
  },
  {
    name: "ids de opción repetidos en una selección",
    mutate: (f) => {
      at(node(f.flow, "document_type", "selection").options ?? [], 1).id = "opt_invoice";
    },
    flow: [{ code: "DUPLICATE_ID", path: ["nodes", 2, "options", 1, "id"] }],
  },
  {
    name: "sin nodo de inicio",
    mutate: (f) => {
      f.flow.nodes.splice(0, 1);
      f.flow.entryNodeId = "company";
    },
    flow: [
      { code: "START_NODE_MISSING", path: ["nodes"] },
      { code: "ENTRY_NODE_INVALID", path: ["entryNodeId"] },
    ],
  },
  {
    name: "más de un nodo de inicio",
    mutate: (f) => f.flow.nodes.push({ id: "start_2", type: "start", next: "company" }),
    flow: [
      { code: "START_NODE_DUPLICATE", path: ["nodes", 9] },
      { code: "UNREACHABLE_NODE", path: ["nodes", 9] },
    ],
  },
  {
    name: "entryNodeId que no existe",
    mutate: (f) => {
      f.flow.entryNodeId = "missing_node";
    },
    flow: [{ code: "ENTRY_NODE_INVALID", path: ["entryNodeId"] }],
  },
  {
    name: "salida faltante",
    mutate: (f) => {
      delete node(f.flow, "no_scope", "message").next;
    },
    flow: [
      { code: "MISSING_TARGET", path: ["nodes", 7, "next"], nodeId: "no_scope" },
      { code: "UNREACHABLE_NODE", path: ["nodes", 8] },
    ],
  },
  {
    name: "salida hacia un nodo inexistente",
    mutate: (f) => {
      node(f.flow, "no_scope", "message").next = "nowhere";
    },
    flow: [
      { code: "UNKNOWN_TARGET", path: ["nodes", 7, "next"] },
      { code: "UNREACHABLE_NODE", path: ["nodes", 8] },
    ],
  },
  {
    name: "nodo inalcanzable",
    mutate: (f) => f.flow.nodes.push({ id: "orphan", type: "message", text: "Hola", next: "end" }),
    flow: [{ code: "UNREACHABLE_NODE", path: ["nodes", 9], nodeId: "orphan" }],
  },
  {
    name: "ciclo en el recorrido",
    mutate: (f) => {
      node(f.flow, "no_scope", "message").next = "company";
    },
    flow: [
      { code: "CYCLE_DETECTED", path: ["nodes", 1], nodeId: "company" },
      { code: "UNREACHABLE_NODE", path: ["nodes", 8] },
    ],
  },
  // --- Variables y tipos ---
  {
    name: "variable no declarada",
    mutate: (f) => {
      node(f.flow, "email", "email").documentVariable = "attachments";
    },
    flow: [{ code: "UNDECLARED_VARIABLE", path: ["nodes", 4, "documentVariable"] }],
  },
  {
    name: "nombre de variable reservado",
    mutate: (f) => {
      f.flow.variables["fileName"] = { type: "string" };
    },
    flow: [{ code: "VARIABLE_NAME_RESERVED", path: ["variables", "fileName"] }],
  },
  {
    name: "tipos incompatibles entre la variable y el paso",
    mutate: (f) => {
      f.flow.variables["documents"] = { type: "string" };
    },
    flow: [
      { code: "VARIABLE_TYPE_MISMATCH", path: ["nodes", 3, "variable"] },
      { code: "VARIABLE_TYPE_MISMATCH", path: ["nodes", 4, "documentVariable"] },
    ],
  },
  {
    name: "variable usada sin definirse en todos los caminos",
    mutate: (f) => {
      f.flow.variables["note"] = { type: "string" };
      node(f.flow, "email", "email").body = "Nota: {{note}}";
    },
    flow: [{ code: "VARIABLE_POSSIBLY_UNDEFINED", path: ["nodes", 4, "body"] }],
  },
  {
    name: "enumeración con valores repetidos",
    mutate: (f) => {
      f.flow.variables["priority"] = { type: "enum", values: ["low", "low"] };
    },
    flow: [{ code: "ENUM_VALUES_INVALID", path: ["variables", "priority", "values"] }],
  },
  {
    name: "valor de opción fuera del catálogo",
    mutate: (f) => {
      at(node(f.flow, "document_type", "selection").options ?? [], 0).value = "passport";
    },
    flow: [{ code: "VALUE_OUT_OF_DOMAIN", path: ["nodes", 2, "options", 0, "value"] }],
  },
  // --- Opciones dinámicas y límites ---
  {
    name: "selección con options y optionsSource a la vez",
    mutate: (f) => {
      node(f.flow, "company", "selection").options = [
        { id: "opt_a", label: "Empresa A", value: "company_a", next: "document_type" },
      ];
    },
    flow: [{ code: "SELECTION_OPTIONS_INVALID", path: ["nodes", 1] }],
  },
  {
    name: "fuente dinámica incompatible con el tipo de la variable",
    mutate: (f) => {
      const source = node(f.flow, "company", "selection").optionsSource;
      if (source) source.kind = "DOCUMENT_TYPES";
    },
    flow: [{ code: "DYNAMIC_SOURCE_INVALID", path: ["nodes", 1, "optionsSource", "kind"] }],
  },
  {
    name: "maxOptions por encima del límite del canal",
    mutate: (f) => {
      node(f.flow, "company", "selection").maxOptions = 11;
    },
    flow: [{ code: "DYNAMIC_OPTIONS_LIMIT_EXCEEDED", path: ["nodes", 1, "maxOptions"] }],
  },
  {
    name: "el catálogo vigente puede producir más opciones que maxOptions",
    mutate: (f) => {
      node(f.flow, "company", "selection").maxOptions = 1;
    },
    flow: [{ code: "DYNAMIC_OPTIONS_LIMIT_EXCEEDED", path: ["nodes", 1, "maxOptions"] }],
  },
  {
    name: "más variables que el límite del flujo",
    mutate: (f) => {
      for (let i = 1; i <= 28; i++) f.flow.variables[`extra${String(i)}`] = { type: "string" };
    },
    flow: [{ code: "FLOW_LIMIT_EXCEEDED", path: ["variables"] }],
  },
  // --- Condiciones ---
  {
    name: "operador de orden sobre una variable que no es fecha",
    mutate: (f) => {
      at(at(withRoute(f).branches, 0).all, 0).operator = "lt";
    },
    flow: [
      {
        code: "CONDITION_OPERATOR_INVALID",
        path: ["nodes", 9, "branches", 0, "all", 0, "operator"],
      },
    ],
  },
  {
    name: "ramas que pueden coincidir",
    mutate: (f) => {
      withRoute(f).branches.push({
        id: "b_any",
        all: [
          { variable: "documentType", operator: "in", value: ["invoice", "medical_certificate"] },
        ],
        next: "upload",
      });
    },
    flow: [{ code: "CONDITION_BRANCHES_OVERLAP", path: ["nodes", 9, "branches", 1] }],
  },
  // --- Paso documental (ADR-014) ---
  {
    name: "paso documental sin revisión",
    mutate: (f) => {
      delete node(f.flow, "upload", "file").review;
    },
    flow: [{ code: "FILE_REVIEW_MISSING", path: ["nodes", 3, "review"] }],
  },
  {
    name: "más de un adjunto por envío (3 es el cupo de candidatos, no de adjuntos)",
    mutate: (f) => {
      node(f.flow, "upload", "file").maxCount = 3;
    },
    flow: [{ code: "FILE_ATTACHMENT_COUNT_INVALID", path: ["nodes", 3, "maxCount"] }],
  },
  {
    name: "formato no admitido",
    mutate: (f) => node(f.flow, "upload", "file").allowedMimeTypes.push("application/msword"),
    flow: [{ code: "FILE_FORMAT_NOT_ALLOWED", path: ["nodes", 3, "allowedMimeTypes", 3] }],
  },
  {
    name: "tamaño máximo por encima de 10 MB",
    mutate: (f) => {
      node(f.flow, "upload", "file").maxBytes = 20_971_520;
    },
    flow: [{ code: "FILE_SIZE_LIMIT_EXCEEDED", path: ["nodes", 3, "maxBytes"] }],
  },
  {
    name: "captura de datos entre el paso documental y el correo",
    mutate: (f) => {
      f.flow.variables["note"] = { type: "string" };
      node(f.flow, "upload", "file").next = "extra_note";
      f.flow.nodes.push({
        id: "extra_note",
        type: "capture",
        text: "¿Algún comentario?",
        variable: "note",
        next: "email",
      });
    },
    flow: [{ code: "CAPTURE_BETWEEN_FILE_AND_EMAIL", path: ["nodes", 9], nodeId: "extra_note" }],
  },
  // --- Correo ---
  {
    name: "conjunto de reglas inexistente",
    mutate: (f) => {
      node(f.flow, "email", "email").ruleSetId = "other_rules";
    },
    flow: [{ code: "RULE_SET_NOT_FOUND", path: ["nodes", 4, "ruleSetId"] }],
  },
  {
    name: "contexto del correo incompleto respecto de las reglas",
    mutate: (f) => {
      node(f.flow, "email", "email").contextVariables = ["company"];
    },
    flow: [{ code: "EMAIL_CONTEXT_MISMATCH", path: ["nodes", 4, "contextVariables"] }],
  },
  // --- Plantillas ---
  {
    name: "plantilla mal formada",
    mutate: (f) => {
      node(f.flow, "confirmation", "message").text = "Hola {{company";
    },
    flow: [{ code: "TEMPLATE_SYNTAX_INVALID", path: ["nodes", 5, "text"] }],
  },
  {
    name: "plantilla con variable no declarada",
    mutate: (f) => {
      node(f.flow, "confirmation", "message").text = "Hola {{missing}}";
    },
    flow: [{ code: "TEMPLATE_VARIABLE_UNKNOWN", path: ["nodes", 5, "text"] }],
  },
  {
    name: "plantilla con una variable que no se puede mostrar",
    mutate: (f) => {
      node(f.flow, "email", "email").body = "Adjunto: {{documents}}";
    },
    flow: [{ code: "TEMPLATE_VARIABLE_NOT_RENDERABLE", path: ["nodes", 4, "body"] }],
  },
  {
    name: "variable reservada de revisión fuera del texto de revisión",
    mutate: (f) => {
      node(f.flow, "email", "email").body = "Archivo {{fileName}}";
    },
    flow: [{ code: "TEMPLATE_RESERVED_VARIABLE_MISUSE", path: ["nodes", 4, "body"] }],
  },
  {
    name: "plantilla en una etiqueta de botón",
    mutate: (f) => {
      const review = node(f.flow, "upload", "file").review;
      if (review) review.confirmLabel = "Confirmar {{company}}";
    },
    flow: [{ code: "TEMPLATE_NOT_ALLOWED", path: ["nodes", 3, "review", "confirmLabel"] }],
  },
  // --- Reglas y cobertura (ADR-012) ---
  {
    name: "reglas sin exactamente una variable companyRef",
    mutate: (f) => {
      f.ruleSet.contextVariables["otherCompany"] = { type: "companyRef" };
    },
    ruleSet: [{ code: "RULE_CONTEXT_INVALID", path: ["contextVariables"] }],
    flow: [{ code: "EMAIL_CONTEXT_MISMATCH", path: ["nodes", 4, "contextVariables"] }],
  },
  {
    name: "condición con un valor fuera del dominio",
    mutate: (f) => {
      at(at(f.ruleSet.rules, 0).all, 0).value = "company_z";
    },
    ruleSet: [
      { code: "RULE_CONDITION_INVALID", path: ["rules", 0, "all", 0, "value"] },
      { code: "RULE_COVERAGE_GAP", path: ["rules"] },
    ],
  },
  {
    name: "más condiciones por regla que el límite",
    mutate: (f) => {
      const rule = at(f.ruleSet.rules, 0);
      const first = at(rule.all, 0);
      rule.all.push({ ...first }, { ...first }, { ...first });
    },
    ruleSet: [{ code: "RULE_LIMIT_EXCEEDED", path: ["rules", 0, "all"] }],
  },
  {
    name: "combinación sin regla",
    mutate: (f) => {
      f.ruleSet.rules.splice(3, 1);
    },
    ruleSet: [{ code: "RULE_COVERAGE_GAP", path: ["rules"] }],
  },
  {
    name: "dos reglas para la misma combinación",
    mutate: (f) =>
      f.ruleSet.rules.push({
        id: "rule_any_invoice",
        all: [{ variable: "documentType", operator: "eq", value: "invoice" }],
        targetGroupIds: ["company_a_accounting"],
      }),
    ruleSet: [{ code: "RULE_OVERLAP", path: ["rules"] }],
  },
  {
    name: "combinación en reviewOnly que también cubre una regla",
    mutate: (f) => {
      f.ruleSet.reviewOnly = [{ company: "company_a", documentType: "invoice" }];
    },
    ruleSet: [{ code: "REVIEW_ONLY_INVALID", path: ["reviewOnly", 0] }],
  },
  {
    name: "grupo destino inexistente",
    mutate: (f) => {
      at(f.ruleSet.rules, 0).targetGroupIds = ["ghost_group"];
    },
    ruleSet: [{ code: "RECIPIENT_GROUP_NOT_FOUND", path: ["rules", 0, "targetGroupIds", 0] }],
  },
  {
    name: "grupo destino de otra empresa",
    mutate: (f) => {
      at(f.ruleSet.rules, 1).targetGroupIds = ["company_b_hr"];
    },
    ruleSet: [
      { code: "RECIPIENT_GROUP_NOT_AUTHORIZED", path: ["rules", 1, "targetGroupIds", 0] },
      { code: "RECIPIENT_NOT_AUTHORIZED", path: ["rules", 1, "targetGroupIds", 0] },
    ],
  },
  {
    name: "grupo destino sin la clasificación del tipo documental",
    mutate: (f) => {
      at(f.ruleSet.rules, 1).targetGroupIds = ["company_a_accounting"];
    },
    ruleSet: [
      { code: "RECIPIENT_GROUP_NOT_AUTHORIZED", path: ["rules", 1, "targetGroupIds", 0] },
      { code: "RECIPIENT_NOT_AUTHORIZED", path: ["rules", 1, "targetGroupIds", 0] },
    ],
  },
  {
    name: "grupo destino sin miembros activos",
    mutate: (f) => {
      const contact = f.directory.contacts.find((c) => c.id === "contact_company_a_hr");
      if (contact) contact.active = false;
    },
    ruleSet: [{ code: "RECIPIENT_GROUP_EMPTY", path: ["rules", 1, "targetGroupIds", 0] }],
  },
  {
    name: "miembro activo no autorizado para la clasificación",
    mutate: (f) => {
      const group = f.directory.recipientGroups.find((g) => g.id === "company_a_hr");
      group?.memberContactIds.push("contact_company_a_accounting");
    },
    ruleSet: [{ code: "RECIPIENT_NOT_AUTHORIZED", path: ["rules", 1, "targetGroupIds", 0] }],
  },
  // --- Directorio ---
  {
    name: "empresa repetida en el directorio",
    mutate: (f) => f.directory.companies.push({ id: "company_a", name: "Copia", active: true }),
    directory: [{ code: "DUPLICATE_ID", path: ["companies", 2, "id"] }],
  },
  {
    name: "contacto con empresa inexistente",
    mutate: (f) => {
      at(f.directory.contacts, 0).companyId = "company_z";
    },
    directory: [{ code: "DIRECTORY_REFERENCE_INVALID", path: ["contacts", 0, "companyId"] }],
  },
  {
    name: "identidad activa repetida entre empleados",
    mutate: (f) => {
      at(at(f.directory.employees, 1).identities, 0).normalizedValue = "+12025550101";
    },
    directory: [{ code: "IDENTITY_ACTIVE_DUPLICATE", path: ["employees", 1, "identities", 0] }],
  },
];

describe("casos negativos", () => {
  it.each(CASES)("$name", (testCase) => {
    const fixtures = loadFixtures();
    testCase.mutate(fixtures);
    const result = validate(fixtures);

    expect(result.valid).toBe(false);
    expectIssues(result.flow, testCase.flow ?? []);
    expectIssues(ruleSetIssues(result), testCase.ruleSet ?? []);
    expectIssues(result.directory, testCase.directory ?? []);
  });

  it("cada código de error tiene al menos un caso negativo", () => {
    const covered = new Set<IssueCode>(
      CASES.flatMap((testCase) =>
        [...(testCase.flow ?? []), ...(testCase.ruleSet ?? []), ...(testCase.directory ?? [])].map(
          (expected) => expected.code,
        ),
      ),
    );
    expect([...ISSUE_CODES].filter((code) => !covered.has(code))).toEqual([]);
  });
});
