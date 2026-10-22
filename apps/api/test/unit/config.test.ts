import { describe, expect, it } from "vitest";
import {
  cookieModeFor,
  formatConfigProblems,
  loadConfig,
  SIMULATED_MODES,
  type ConfigProblem,
} from "../../src/config.js";

// Configuración validada (plan de P1-T4, §5.2). Salida de §9: los modos simulados se rechazan en
// producción, cada uno con su propio error.

const SECRET = "valor-secreto-que-no-debe-aparecer-7f3a9c";

function env(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: "development",
    API_HOST: "127.0.0.1",
    API_PORT: "4000",
    ADMIN_ORIGIN: "http://localhost:5173",
    DATABASE_URL: `postgresql://sistema_chatbot_dev:${SECRET}@127.0.0.1:55432/sistema_chatbot_dev`,
    CHANNEL_MODE: "simulator",
    EMAIL_MODE: "capture",
    STORAGE_MODE: "local_private",
    SCANNER_MODE: "fake_development_only",
    ...overrides,
  };
}

function problems(overrides: Record<string, string | undefined>): readonly ConfigProblem[] {
  const result = loadConfig(env(overrides));
  if (result.ok) throw new Error("Se esperaba una configuración inválida.");
  return result.problems;
}

describe("configuración de la API", () => {
  it("acepta una configuración de desarrollo y la congela", () => {
    const result = loadConfig(env());
    if (!result.ok) throw new Error(formatConfigProblems(result.problems));
    expect(result.config).toMatchObject({
      appEnv: "development",
      host: "127.0.0.1",
      port: 4000,
      adminOrigin: "http://localhost:5173",
      cookieMode: "local-http",
      session: { idleMinutes: 30, absoluteHours: 8 },
      modes: SIMULATED_MODES,
    });
    expect(Object.isFrozen(result.config)).toBe(true);
    expect(result.config.database).toMatchObject({ port: 55432, purpose: "development" });
  });

  it("en producción rechaza cada modo simulado con su clave", () => {
    const found = problems({ APP_ENV: "production", ADMIN_ORIGIN: "https://admin.example.com" });
    for (const key of Object.keys(SIMULATED_MODES)) {
      expect(found).toContainEqual({ key, code: "SIMULATED_MODE_IN_PRODUCTION" });
    }
    expect(found).toContainEqual({ key: "APP_ENV", code: "PRODUCTION_NOT_SUPPORTED" });
  });

  it("producción no se habilita en P1 aunque los modos fueran válidos", () => {
    const found = problems({
      APP_ENV: "production",
      ADMIN_ORIGIN: "https://admin.example.com",
      CHANNEL_MODE: undefined,
      EMAIL_MODE: undefined,
      STORAGE_MODE: undefined,
      SCANNER_MODE: undefined,
    });
    expect(found).toContainEqual({ key: "APP_ENV", code: "PRODUCTION_NOT_SUPPORTED" });
    expect(found).toContainEqual({
      key: "DATABASE_URL",
      code: "DATABASE_GUARD",
      reason: "PRODUCTION_ENVIRONMENT",
    });
  });

  it("en staging rechaza los modos locales de almacenamiento, captura y scanner (decisión A1)", () => {
    const found = problems({ APP_ENV: "staging", ADMIN_ORIGIN: "https://admin.example.com" });
    const localModeKeys = ["EMAIL_MODE", "STORAGE_MODE", "SCANNER_MODE"];
    for (const key of localModeKeys) {
      expect(found).toContainEqual({ key, code: "SIMULATED_MODE_OUTSIDE_LOCAL" });
    }
    // CHANNEL_MODE no cambia en staging (decisión A1): su valor simulado sigue siendo el de P1.
    expect(found).not.toContainEqual({
      key: "CHANNEL_MODE",
      code: "SIMULATED_MODE_OUTSIDE_LOCAL",
    });
    expect(found.filter((problem) => problem.code === "SIMULATED_MODE_OUTSIDE_LOCAL")).toHaveLength(
      localModeKeys.length,
    );
  });

  it("en staging no puede arrancar en P1: no hay ningún modo válido para los archivos y el correo", () => {
    // En P1 solo existen los valores simulados para los cuatro modos; los tres locales quedan
    // rechazados desde P1-T5. La ausencia de valor también es problema (MISSING).
    const withValues = problems({ APP_ENV: "staging", ADMIN_ORIGIN: "https://admin.example.com" });
    const withoutValues = problems({
      APP_ENV: "staging",
      ADMIN_ORIGIN: "https://admin.example.com",
      EMAIL_MODE: undefined,
      STORAGE_MODE: undefined,
      SCANNER_MODE: undefined,
    });
    expect(withoutValues).toContainEqual({ key: "EMAIL_MODE", code: "MISSING" });
    expect(withoutValues).toContainEqual({ key: "STORAGE_MODE", code: "MISSING" });
    expect(withoutValues).toContainEqual({ key: "SCANNER_MODE", code: "MISSING" });
    expect(withValues.filter((problem) => problem.code === "MISSING")).toHaveLength(0);
  });

  it("los modos simulados siguen aceptados en development y test, y en staging solo CHANNEL_MODE", () => {
    for (const appEnv of ["development", "test"] as const) {
      const result = loadConfig(env({ APP_ENV: appEnv }));
      if (!result.ok) throw new Error(formatConfigProblems(result.problems));
      expect(result.config.modes).toEqual(SIMULATED_MODES);
    }
    const staging = loadConfig(
      env({ APP_ENV: "staging", ADMIN_ORIGIN: "https://admin.example.com" }),
    );
    expect(staging.ok).toBe(false);
  });

  it.each([
    [{ APP_ENV: undefined }, { key: "APP_ENV", code: "MISSING" }],
    [{ APP_ENV: "prod" }, { key: "APP_ENV", code: "INVALID" }],
    [{ API_HOST: "0.0.0.0" }, { key: "API_HOST", code: "NOT_LOOPBACK" }],
    [{ API_HOST: "localhost" }, { key: "API_HOST", code: "NOT_LOOPBACK" }],
    [{ API_PORT: "80" }, { key: "API_PORT", code: "OUT_OF_RANGE" }],
    [{ API_PORT: "70000" }, { key: "API_PORT", code: "OUT_OF_RANGE" }],
    [{ API_PORT: "cuatro mil" }, { key: "API_PORT", code: "INVALID" }],
    [{ ADMIN_ORIGIN: undefined }, { key: "ADMIN_ORIGIN", code: "MISSING" }],
    [{ ADMIN_ORIGIN: "http://localhost:5173/admin" }, { key: "ADMIN_ORIGIN", code: "INVALID" }],
    [{ ADMIN_ORIGIN: "http://localhost:5173/?x=1" }, { key: "ADMIN_ORIGIN", code: "INVALID" }],
    [{ ADMIN_ORIGIN: "javascript:alert(1)" }, { key: "ADMIN_ORIGIN", code: "INVALID" }],
    [{ ADMIN_ORIGIN: "http://admin.example.com" }, { key: "ADMIN_ORIGIN", code: "HTTPS_REQUIRED" }],
    [
      { APP_ENV: "staging", ADMIN_ORIGIN: "http://localhost:5173" },
      { key: "ADMIN_ORIGIN", code: "HTTPS_REQUIRED" },
    ],
    [{ SESSION_IDLE_MINUTES: "4" }, { key: "SESSION_IDLE_MINUTES", code: "OUT_OF_RANGE" }],
    [{ SESSION_IDLE_MINUTES: "31" }, { key: "SESSION_IDLE_MINUTES", code: "OUT_OF_RANGE" }],
    [{ SESSION_ABSOLUTE_HOURS: "9" }, { key: "SESSION_ABSOLUTE_HOURS", code: "OUT_OF_RANGE" }],
    [{ SESSION_ABSOLUTE_HOURS: "0" }, { key: "SESSION_ABSOLUTE_HOURS", code: "OUT_OF_RANGE" }],
    [{ CHANNEL_MODE: undefined }, { key: "CHANNEL_MODE", code: "MISSING" }],
    [{ EMAIL_MODE: "provider" }, { key: "EMAIL_MODE", code: "INVALID" }],
    [
      { DATABASE_URL: undefined },
      { key: "DATABASE_URL", code: "DATABASE_GUARD", reason: "URL_MISSING" },
    ],
    [
      {
        DATABASE_URL: "postgresql://sistema_chatbot_dev:x@127.0.0.1:5432/sistema_chatbot_dev",
      },
      { key: "DATABASE_URL", code: "DATABASE_GUARD", reason: "PORT_NOT_ALLOWED" },
    ],
  ])("rechaza %o con %o", (overrides, expected) => {
    expect(problems(overrides)).toContainEqual(expected);
  });

  it("informa todos los problemas juntos", () => {
    const found = problems({ APP_ENV: "prod", API_PORT: "1", API_HOST: "10.0.0.1" });
    expect(found.map((problem) => problem.key)).toEqual(
      expect.arrayContaining(["APP_ENV", "API_PORT", "API_HOST"]),
    );
  });

  it("nunca incluye valores en los problemas ni en el texto que se muestra", () => {
    const found = problems({
      APP_ENV: SECRET,
      API_PORT: SECRET,
      ADMIN_ORIGIN: `https://usuario:${SECRET}@admin.example.com/ruta`,
      CHANNEL_MODE: SECRET,
      DATABASE_URL: `postgresql://sistema_chatbot_dev:${SECRET}@127.0.0.1:5432/sistema_chatbot_dev`,
    });
    expect(found.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(found)).not.toContain(SECRET);
    expect(formatConfigProblems(found)).not.toContain(SECRET);
  });

  it("la cookie sin Secure exige entorno local, origen HTTP de loopback y API en loopback", () => {
    const cases: [Parameters<typeof cookieModeFor>[0], string, string, string][] = [
      ["development", "http://localhost:5173", "127.0.0.1", "local-http"],
      ["test", "http://127.0.0.1:5173", "::1", "local-http"],
      ["development", "https://localhost:5173", "127.0.0.1", "secure"],
      ["development", "http://admin.example.com", "127.0.0.1", "secure"],
      ["development", "http://localhost:5173", "10.0.0.1", "secure"],
      ["staging", "http://localhost:5173", "127.0.0.1", "secure"],
      ["production", "http://localhost:5173", "127.0.0.1", "secure"],
    ];
    for (const [appEnv, origin, host, expected] of cases) {
      expect(cookieModeFor(appEnv, new URL(origin), host), `${appEnv} ${origin} ${host}`).toBe(
        expected,
      );
    }
  });
});
