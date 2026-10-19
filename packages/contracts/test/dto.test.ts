import { describe, it } from "vitest";
import {
  flowDraftResponseSchema,
  flowDraftUpdateRequestSchema,
  flowDraftUpdateResponseSchema,
  flowPublishRequestSchema,
  flowPublishResponseSchema,
  flowValidationRequestSchema,
  flowValidationResponseSchema,
} from "../src/index.js";
import { expectInvalid, expectValid, readExample, withChanges } from "./samples.js";

const hash = "a".repeat(64);
const definition = readExample("flujo_documental_demo.json");
const issue = {
  code: "MISSING_TARGET",
  message: "Falta la salida de este paso.",
  document: { type: "FLOW" },
  path: ["nodes", 7, "next"],
  nodeId: "no_scope",
};

describe("borrador con revisión optimista", () => {
  const draft = {
    flowId: "flow-demo-1",
    revision: 7,
    definition,
    layout: { nodes: { start: { x: 0, y: 0 } }, zoom: 1 },
    updatedAt: "2026-10-19T18:00:00Z",
  };

  it("acepta el borrador y su actualización", () => {
    expectValid(flowDraftResponseSchema, draft);
    expectValid(flowDraftUpdateRequestSchema, { expectedRevision: 7, definition });
    expectValid(flowDraftUpdateResponseSchema, { flowId: "flow-demo-1", revision: 8 });
  });

  it("un borrador incompleto se puede guardar: se valida al validar o publicar", () => {
    expectValid(flowDraftUpdateRequestSchema, {
      expectedRevision: 0,
      definition: { name: "En edición" },
    });
  });

  it.each([
    ["sin revisión esperada", { definition }],
    ["revisión negativa", { expectedRevision: -1, definition }],
    ["definición que no es objeto", { expectedRevision: 1, definition: [definition] }],
    ["definición nula", { expectedRevision: 1, definition: null }],
    ["campo extra", { expectedRevision: 1, definition, publish: true }],
  ])("rechaza la actualización %s", (_name, value) => {
    expectInvalid(flowDraftUpdateRequestSchema, value);
  });

  it("rechaza respuestas sin fecha válida o sin revisión", () => {
    expectInvalid(flowDraftResponseSchema, { ...draft, updatedAt: "ayer" });
    expectInvalid(flowDraftResponseSchema, withChanges(draft, { revision: undefined }));
  });
});

describe("validación del flujo", () => {
  const report = { issues: [issue], totalIssues: 1, truncated: false };

  it("acepta la solicitud y respuestas coherentes", () => {
    expectValid(flowValidationRequestSchema, { revision: 7 });
    expectValid(flowValidationResponseSchema, {
      flowId: "flow-demo-1",
      revision: 7,
      valid: false,
      report,
    });
    expectValid(flowValidationResponseSchema, {
      flowId: "flow-demo-1",
      revision: 7,
      valid: true,
      report: { issues: [], totalIssues: 0, truncated: false },
    });
  });

  it("rechaza respuestas incoherentes", () => {
    expectInvalid(flowValidationResponseSchema, {
      flowId: "flow-demo-1",
      revision: 7,
      valid: true,
      report,
    });
    expectInvalid(flowValidationResponseSchema, {
      flowId: "flow-demo-1",
      revision: 7,
      valid: false,
      report: { issues: [], totalIssues: 0, truncated: false },
    });
    expectInvalid(flowValidationRequestSchema, { revision: 1.5 });
  });
});

describe("publicación", () => {
  it("acepta la solicitud y la respuesta", () => {
    expectValid(flowPublishRequestSchema, { revision: 7, contentHash: hash });
    expectValid(flowPublishResponseSchema, {
      flowId: "flow-demo-1",
      version: 3,
      revision: 7,
      contentHash: hash,
      publishedAt: "2026-10-19T18:05:00Z",
    });
  });

  it.each([
    ["hash en mayúsculas", { revision: 7, contentHash: "A".repeat(64) }],
    ["hash corto", { revision: 7, contentHash: "a".repeat(63) }],
    ["sin hash", { revision: 7 }],
    ["sin revisión", { contentHash: hash }],
  ])("rechaza la solicitud con %s", (_name, value) => {
    expectInvalid(flowPublishRequestSchema, value);
  });

  it("rechaza versiones menores que 1", () => {
    expectInvalid(flowPublishResponseSchema, {
      flowId: "flow-demo-1",
      version: 0,
      revision: 7,
      contentHash: hash,
      publishedAt: "2026-10-19T18:05:00Z",
    });
  });
});
