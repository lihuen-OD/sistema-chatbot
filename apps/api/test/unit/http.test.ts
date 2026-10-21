import { gzipSync } from "node:zlib";
import { apiErrorResponseSchema, internalIdSchema } from "@sistema-chatbot/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/auth/store.js";
import type { LogEvent } from "../../src/logger.js";
import { fastHasher, SESSION_DURATIONS } from "../support/fakes.js";
import {
  ADMIN_ORIGIN,
  Browser,
  startApi,
  type ApiResponse,
  type StartedApi,
} from "../support/http.js";

// HTTP sin base de datos (plan de P1-T4, §5.10): errores con el contrato, límites del cuerpo y
// cabeceras. La base es un doble que falla en cualquier uso.

const brokenDatabase = new Proxy(
  {},
  {
    get() {
      throw new Error("base no disponible");
    },
  },
) as unknown as Database;

const started: StartedApi[] = [];
afterEach(async () => {
  for (const api of started.splice(0)) await api.close();
});

async function browser(events: LogEvent[] = []): Promise<Browser> {
  const api = await startApi({
    adminOrigin: ADMIN_ORIGIN,
    cookieMode: "local-http",
    db: brokenDatabase,
    hasher: fastHasher,
    dummyHash: await fastHasher.hash("hash ficticio de prueba"),
    sessions: SESSION_DURATIONS,
    expectedMigrations: ["0001_base"],
    logger: (event) => events.push(event),
  });
  started.push(api);
  return new Browser(api.baseUrl);
}

function expectError(response: ApiResponse, status: number, code: string): void {
  expect(response.status, response.text).toBe(status);
  const parsed = apiErrorResponseSchema.safeParse(response.body);
  expect(parsed.success, response.text).toBe(true);
  expect(parsed.data?.error.code).toBe(code);
  expect(parsed.data?.error.requestId).toBe(response.headers.get("x-request-id"));
}

function reasonOf(response: ApiResponse): unknown {
  return (response.body as { error: { details?: { problems: { reason: string }[] } } }).error
    .details?.problems[0]?.reason;
}

describe("health sin base", () => {
  it("live responde sin dependencias, con requestId y cabeceras de seguridad", async () => {
    const client = await browser();
    const response = await client.request("GET", "/health/live");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(internalIdSchema.safeParse(response.headers.get("x-request-id")).success).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("ready responde 503 si la base no está disponible, sin detallar el motivo", async () => {
    const events: LogEvent[] = [];
    const client = await browser(events);
    const response = await client.request("GET", "/health/ready");
    expectError(response, 503, "SERVICE_UNAVAILABLE");
    expect(response.text).not.toContain("DATABASE");
    expect(events).toContainEqual(
      expect.objectContaining({ event: "not_ready", reason: "DATABASE_UNAVAILABLE" }),
    );
  });
});

describe("errores y límites HTTP", () => {
  it("ruta inexistente, método no admitido y preflight: 404 sin CORS", async () => {
    const client = await browser();
    expectError(await client.request("GET", "/no-existe"), 404, "NOT_FOUND");
    expectError(await client.request("PUT", "/health/live", { origin: null }), 404, "NOT_FOUND");
    const preflight = await client.request("OPTIONS", "/api/v1/auth/login", {
      headers: { "Access-Control-Request-Method": "POST" },
    });
    expectError(preflight, 404, "NOT_FOUND");
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("una mutación sin el origen del panel se rechaza antes de leer el cuerpo", async () => {
    const client = await browser();
    const json = { email: "admin@example.com", password: "x" };
    expectError(
      await client.request("POST", "/api/v1/auth/login", { json, origin: null }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await client.request("POST", "/api/v1/auth/login", {
        json,
        origin: "https://otro.example.com",
      }),
      403,
      "FORBIDDEN",
    );
  });

  it("solo JSON: otro tipo, JSON mal formado o comprimido dan 400 sin repetir el contenido", async () => {
    const client = await browser();
    const secret = "contenido-que-no-se-repite";
    const plain = await client.request("POST", "/api/v1/auth/login", {
      body: secret,
      headers: { "Content-Type": "text/plain" },
    });
    expectError(plain, 400, "REQUEST_INVALID");
    expect(reasonOf(plain)).toBe("CONTENT_TYPE");

    const malformed = await client.request("POST", "/api/v1/auth/login", {
      body: `{"email": "${secret}"`,
      headers: { "Content-Type": "application/json" },
    });
    expectError(malformed, 400, "REQUEST_INVALID");
    expect(reasonOf(malformed)).toBe("JSON_INVALID");
    expect(malformed.text).not.toContain(secret);

    const compressed = await client.request("POST", "/api/v1/auth/login", {
      body: gzipSync(JSON.stringify({ email: "admin@example.com", password: "x" })),
      headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    });
    expectError(compressed, 400, "REQUEST_INVALID");
    expect(reasonOf(compressed)).toBe("CONTENT_ENCODING");
  });

  it("un cuerpo de más de 16 KiB da 413", async () => {
    const client = await browser();
    const response = await client.request("POST", "/api/v1/auth/login", {
      json: { email: "admin@example.com", password: "x".repeat(17 * 1024) },
    });
    expectError(response, 413, "PAYLOAD_TOO_LARGE");
  });

  it("un login con forma inválida informa ruta y motivo, no los valores", async () => {
    const client = await browser();
    const response = await client.request("POST", "/api/v1/auth/login", {
      json: { email: "valor-que-no-se-repite@example.com", extra: true },
    });
    expectError(response, 400, "REQUEST_INVALID");
    expect(response.text).not.toContain("valor-que-no-se-repite");
    const problems = (response.body as { error: { details: { problems: unknown[] } } }).error
      .details.problems;
    expect(problems).toContainEqual({ path: ["password"], reason: "invalid_type" });
    expect(problems).toContainEqual({ path: [], reason: "unrecognized_keys" });
  });

  it("un error no previsto da 500 genérico, sin detalle, y queda en el log sin datos", async () => {
    const events: LogEvent[] = [];
    const client = await browser(events);
    const response = await client.request("POST", "/api/v1/auth/login", {
      json: { email: "admin@example.com", password: "una contraseña cualquiera" },
    });
    expectError(response, 500, "INTERNAL_ERROR");
    expect(response.text).not.toMatch(/base no disponible|stack|at /);
    expect(events).toContainEqual(expect.objectContaining({ event: "unhandled_error" }));
    expect(JSON.stringify(events)).not.toContain("admin@example.com");
    expect(JSON.stringify(events)).not.toContain("contraseña");
  });
});
