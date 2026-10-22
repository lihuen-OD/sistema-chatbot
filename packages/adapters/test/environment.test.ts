import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADAPTER_ENVIRONMENT_ERROR_CODE,
  AdapterEnvironmentError,
  assertLocalAdapterEnvironment,
  isLocalAdapterEnvironment,
} from "../src/environment.js";

// Guardas de entorno (plan de P1-T5, §5). Salida de docs/15 §9: los adaptadores locales no se
// pueden construir ni usar con `APP_ENV=production`. Sin valores en los errores.

const SECRET = "valor-que-no-debe-aparecer-5b21cd";

let originalAppEnv: string | undefined;

beforeEach(() => {
  originalAppEnv = process.env["APP_ENV"];
});

afterEach(() => {
  if (originalAppEnv === undefined) {
    delete process.env["APP_ENV"];
  } else {
    process.env["APP_ENV"] = originalAppEnv;
  }
});

describe("assertLocalAdapterEnvironment", () => {
  it("acepta development y test con process.env APP_ENV igual", () => {
    for (const appEnv of ["development", "test"] as const) {
      process.env["APP_ENV"] = appEnv;
      expect(assertLocalAdapterEnvironment(appEnv)).toBe(appEnv);
    }
  });

  it.each(["production", "staging", "Production", "DEVELOPMENT", "development ", "qa"])(
    "rechaza %j como entorno explícito y no lo publica",
    (appEnv) => {
      process.env["APP_ENV"] = "development";
      expect(() => assertLocalAdapterEnvironment(appEnv)).toThrow(AdapterEnvironmentError);
      const error = attempt(appEnv);
      expect(error.code).toBe(ADAPTER_ENVIRONMENT_ERROR_CODE);
      expect(error.reason).toBe("EXPLICIT_ENVIRONMENT_FORBIDDEN");
      expect(error.message).not.toContain(appEnv);
      expect(JSON.stringify(error)).not.toContain(SECRET);
    },
  );

  it("rechaza la cadena vacía como entorno explícito", () => {
    process.env["APP_ENV"] = "development";
    expect(attempt("").reason).toBe("EXPLICIT_ENVIRONMENT_FORBIDDEN");
  });

  it("rechaza un entorno explícito prohibido sin revelarlo aun cuando sea largo", () => {
    process.env["APP_ENV"] = "development";
    const error = attempt(SECRET);
    expect(error.reason).toBe("EXPLICIT_ENVIRONMENT_FORBIDDEN");
    expect(error.message).not.toContain(SECRET);
  });

  it("rechaza si process.env APP_ENV falta, aunque el explícito sea válido", () => {
    delete process.env["APP_ENV"];
    const error = attempt("development");
    expect(error.reason).toBe("PROCESS_APP_ENV_MISSING");
    expect(error.message).not.toContain("development");
  });

  it("rechaza process.env APP_ENV vacío", () => {
    process.env["APP_ENV"] = "   ";
    const error = attempt("development");
    expect(error.reason).toBe("PROCESS_APP_ENV_MISSING");
  });

  it.each(["production", "staging", "qa", "test"])(
    "rechaza el discordante: explícito development con process.env=%j",
    (processAppEnv) => {
      process.env["APP_ENV"] = processAppEnv;
      const error = attempt("development");
      expect(error.reason).toBe("PROCESS_APP_ENV_MISMATCH");
      expect(error.message).not.toContain(processAppEnv);
    },
  );

  it("trims process.env APP_ENV y admite espacios alrededor", () => {
    process.env["APP_ENV"] = " development ";
    expect(assertLocalAdapterEnvironment("development")).toBe("development");
  });

  it("comprueba de nuevo en cada llamada: detecta un cambio posterior del entorno", () => {
    process.env["APP_ENV"] = "development";
    expect(assertLocalAdapterEnvironment("development")).toBe("development");

    // El host (o el entorno) cambia después de construir: la operación siguiente
    // (que vuelve a llamar a la guarda) falla aunque antes hubiera pasado.
    process.env["APP_ENV"] = "production";
    const error = attempt("development");
    expect(error.reason).toBe("PROCESS_APP_ENV_MISMATCH");

    // Un cambio de production a otra cosa tampoco habilita retroactivamente.
    process.env["APP_ENV"] = "staging";
    expect(attempt("development").reason).toBe("PROCESS_APP_ENV_MISMATCH");
  });

  it("no depende de una única comprobación inicial: vuelve a fallar tras un valor válido", () => {
    process.env["APP_ENV"] = "test";
    expect(assertLocalAdapterEnvironment("test")).toBe("test");
    delete process.env["APP_ENV"];
    expect(attempt("test").reason).toBe("PROCESS_APP_ENV_MISSING");
  });
});

describe("isLocalAdapterEnvironment", () => {
  it("reconoce los dos entornos permitidos y rechaza el resto", () => {
    expect(isLocalAdapterEnvironment("development")).toBe(true);
    expect(isLocalAdapterEnvironment("test")).toBe(true);
    expect(isLocalAdapterEnvironment("staging")).toBe(false);
    expect(isLocalAdapterEnvironment("production")).toBe(false);
    expect(isLocalAdapterEnvironment("qa")).toBe(false);
    expect(isLocalAdapterEnvironment("")).toBe(false);
  });
});

function attempt(appEnv: string): AdapterEnvironmentError {
  try {
    assertLocalAdapterEnvironment(appEnv);
  } catch (error) {
    if (!(error instanceof AdapterEnvironmentError)) throw error;
    return error;
  }
  throw new Error("Se esperaba AdapterEnvironmentError.");
}
