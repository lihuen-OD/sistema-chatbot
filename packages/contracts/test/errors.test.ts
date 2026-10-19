import { ISSUE_CODES } from "@sistema-chatbot/flow-schema";
import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODES,
  apiErrorResponseSchema,
  apiErrorStatus,
  DELIVERY_BLOCK_REASONS,
  deliveryBlockReasonSchema,
  ENGINE_DIAGNOSTIC_CODES,
  engineDiagnosticSchema,
  type ApiErrorCode,
} from "../src/index.js";
import { expectInvalid, expectValid } from "./samples.js";

const issue = {
  code: "MISSING_TARGET",
  message: "Falta la salida de este paso.",
  document: { type: "FLOW" },
  path: ["nodes", 7, "next"],
  nodeId: "no_scope",
} as const;

const DETAILS: Partial<Record<ApiErrorCode, unknown>> = {
  REQUEST_INVALID: { problems: [{ path: ["revision"], reason: "invalid_type" }] },
  FLOW_INVALID: { issues: [issue], totalIssues: 1, truncated: false },
  DRAFT_REVISION_CONFLICT: { currentRevision: 8 },
};

function errorFor(code: ApiErrorCode, extra: Record<string, unknown> = {}) {
  const details = DETAILS[code];
  return {
    error: {
      code,
      message: "Mensaje para personas.",
      requestId: "req-demo",
      ...(details === undefined ? {} : { details }),
      ...extra,
    },
  };
}

describe("errores de la API", () => {
  it.each(API_ERROR_CODES)("acepta la forma válida de %s", (code) => {
    expectValid(apiErrorResponseSchema, errorFor(code));
  });

  it("mapea cada código a su estado HTTP documentado", () => {
    expect(Object.fromEntries(API_ERROR_CODES.map((code) => [code, apiErrorStatus(code)]))).toEqual(
      {
        REQUEST_INVALID: 400,
        UNAUTHENTICATED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        PAYLOAD_TOO_LARGE: 413,
        RATE_LIMITED: 429,
        SERVICE_UNAVAILABLE: 503,
        FLOW_INVALID: 422,
        DRAFT_REVISION_CONFLICT: 409,
        IDENTITY_CONFLICT: 409,
        SUBMISSION_ALREADY_ACTIVE: 409,
        CLASSIFICATION_RELAX_FORBIDDEN: 403,
        CLASSIFICATION_IMPACT_CHANGED: 409,
      },
    );
  });

  it("no duplica en la API los códigos de validación de flow-schema", () => {
    const overlap = API_ERROR_CODES.filter((code) =>
      (ISSUE_CODES as readonly string[]).includes(code),
    );
    expect(overlap).toEqual([]);
  });

  it("rechaza códigos desconocidos y campos extra", () => {
    expectInvalid(apiErrorResponseSchema, errorFor("NOT_FOUND", { code: "RULE_COVERAGE_GAP" }));
    expectInvalid(apiErrorResponseSchema, errorFor("NOT_FOUND", { stack: "Error: ..." }));
    expectInvalid(apiErrorResponseSchema, { ...errorFor("NOT_FOUND"), trace: "x" });
  });

  it("rechaza details en códigos que no los admiten", () => {
    expectInvalid(
      apiErrorResponseSchema,
      errorFor("IDENTITY_CONFLICT", { details: { employeeId: "emp-2" } }),
    );
    expectInvalid(apiErrorResponseSchema, errorFor("FORBIDDEN", { details: {} }));
    expectInvalid(
      apiErrorResponseSchema,
      errorFor("CLASSIFICATION_IMPACT_CHANGED", { details: { impactHash: "x" } }),
    );
  });

  it("exige y acota los details de los códigos que los llevan", () => {
    expectInvalid(apiErrorResponseSchema, errorFor("FLOW_INVALID", { details: undefined }));
    expectInvalid(
      apiErrorResponseSchema,
      errorFor("DRAFT_REVISION_CONFLICT", { details: { currentRevision: -1 } }),
    );
    expectInvalid(
      apiErrorResponseSchema,
      errorFor("REQUEST_INVALID", { details: { problems: [] } }),
    );
    expectInvalid(
      apiErrorResponseSchema,
      errorFor("REQUEST_INVALID", {
        details: {
          problems: Array.from({ length: 51 }, () => ({ path: ["x"], reason: "invalid_type" })),
        },
      }),
    );
    expectInvalid(
      apiErrorResponseSchema,
      errorFor("REQUEST_INVALID", {
        details: { problems: [{ path: ["x"], reason: "invalid_type", received: "secreto" }] },
      }),
    );
  });

  it("acota message y requestId", () => {
    expectValid(apiErrorResponseSchema, errorFor("NOT_FOUND", { message: "m".repeat(500) }));
    expectInvalid(apiErrorResponseSchema, errorFor("NOT_FOUND", { message: "m".repeat(501) }));
    expectInvalid(apiErrorResponseSchema, errorFor("NOT_FOUND", { message: "" }));
    expectInvalid(apiErrorResponseSchema, errorFor("NOT_FOUND", { requestId: "req demo" }));
  });

  it("rechaza en FLOW_INVALID detalles no permitidos y reportes incoherentes", () => {
    const flowInvalid = (details: unknown) => errorFor("FLOW_INVALID", { details });
    expectInvalid(
      apiErrorResponseSchema,
      flowInvalid({
        issues: [{ ...issue, details: { contactId: "contact_company_a_hr" } }],
        totalIssues: 1,
        truncated: false,
      }),
    );
    expectInvalid(
      apiErrorResponseSchema,
      flowInvalid({
        issues: [{ ...issue, details: { reason: "x".repeat(129) } }],
        totalIssues: 1,
        truncated: false,
      }),
    );
    expectInvalid(
      apiErrorResponseSchema,
      flowInvalid({ issues: [{ ...issue, code: "NOT_A_CODE" }], totalIssues: 1, truncated: false }),
    );
    expectInvalid(
      apiErrorResponseSchema,
      flowInvalid({
        issues: [{ ...issue, path: ["nodes", -1] }],
        totalIssues: 1,
        truncated: false,
      }),
    );
    expectInvalid(
      apiErrorResponseSchema,
      flowInvalid({ issues: [issue], totalIssues: 3, truncated: false }),
    );
    expectInvalid(
      apiErrorResponseSchema,
      flowInvalid({ issues: [issue], totalIssues: 0, truncated: false }),
    );
    expectInvalid(
      apiErrorResponseSchema,
      flowInvalid({
        issues: Array.from({ length: 501 }, () => issue),
        totalIssues: 501,
        truncated: false,
      }),
    );
  });
});

describe("diagnósticos del motor", () => {
  it.each(ENGINE_DIAGNOSTIC_CODES.filter((code) => code !== "FILE_NOT_CORRELATED"))(
    "acepta %s",
    (code) => {
      expectValid(engineDiagnosticSchema, { code });
    },
  );

  it("FILE_NOT_CORRELATED exige un motivo documentado y los demás no lo admiten", () => {
    expectValid(engineDiagnosticSchema, {
      code: "FILE_NOT_CORRELATED",
      reason: "NOT_AFTER_FILE_REQUEST_ANCHOR",
    });
    expectInvalid(engineDiagnosticSchema, { code: "FILE_NOT_CORRELATED" });
    expectInvalid(engineDiagnosticSchema, { code: "FILE_NOT_CORRELATED", reason: "LATE" });
    expectInvalid(engineDiagnosticSchema, {
      code: "PROMPT_STALE",
      reason: "MISSING_PROVIDER_TIMESTAMP",
    });
    expectInvalid(engineDiagnosticSchema, { code: "FLOW_INVALID" });
  });
});

describe("motivos de bloqueo de entrega", () => {
  it("acepta los siete motivos de ADR-012 y nada más", () => {
    expect(DELIVERY_BLOCK_REASONS).toHaveLength(7);
    for (const reason of DELIVERY_BLOCK_REASONS) expectValid(deliveryBlockReasonSchema, reason);
    expectInvalid(deliveryBlockReasonSchema, "FALLBACK_GROUP_USED");
  });

  it("son un catálogo distinto de los errores de la API y de los diagnósticos", () => {
    const apiAndDiagnostics = new Set<string>([...API_ERROR_CODES, ...ENGINE_DIAGNOSTIC_CODES]);
    expect(DELIVERY_BLOCK_REASONS.filter((reason) => apiAndDiagnostics.has(reason))).toEqual([]);
  });
});
