import { describe, expect, it } from "vitest";
import {
  DEFAULT_IN_REPO_MAIL_CAPTURE_DIR,
  DEFAULT_IN_REPO_STORAGE_DIR,
  DEFAULT_MAIL_CAPTURE_RECORD_DAYS,
  DEFAULT_MAIL_CAPTURE_RETENTION_DAYS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_SCANNER_SIMULATED_SCENARIO,
  formatLocalAdaptersConfigProblems,
  loadLocalAdaptersConfig,
  type LocalAdaptersConfigProblem,
  type LocalAdaptersConfigResult,
} from "../src/config.js";

// Configuración validada (plan de P1-T5, §12). Igual que la API: por clave, sin valores y
// con todos los problemas juntos. Solo la forma declarada; la comprobación del sistema de
// archivos pertenece a la construcción de la raíz (§6), que se implementa en el próximo
// bloque. El escenario del scanner por defecto es INCONCLUSIVE (decisión A2).

const SECRET = "valor-secreto-que-no-debe-aparecer-41fa7e";
const IN_REPO_BASE = "/mi/proyecto/sistema-chatbot";
const INSIDE_REPO = `${IN_REPO_BASE}/storage/documents`;
const OUTSIDE_REPO_ABSOLUTE = "/var/tmp/sistema-chatbot/storage/documents";

function env(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return { APP_ENV: "development", ...overrides };
}

function load(
  overrides: Record<string, string | undefined>,
  options: { repoRoot?: string } = {},
): LocalAdaptersConfigResult {
  return loadLocalAdaptersConfig(env(overrides), options);
}

function expectOk(
  result: LocalAdaptersConfigResult,
): asserts result is Extract<LocalAdaptersConfigResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(formatLocalAdaptersConfigProblems(result.problems));
  }
}

function problems(
  overrides: Record<string, string | undefined>,
  options: { repoRoot?: string } = {},
): readonly LocalAdaptersConfigProblem[] {
  const result = load(overrides, options);
  if (result.ok) throw new Error("Se esperaba una configuración inválida.");
  return result.problems;
}

describe("loadLocalAdaptersConfig", () => {
  it("acepta el entorno y usa los valores por defecto del plan", () => {
    const result = load({});
    expectOk(result);
    expect(result.config).toMatchObject({
      appEnv: "development",
      mailCaptureRetentionDays: DEFAULT_MAIL_CAPTURE_RETENTION_DAYS,
      mailCaptureRecordDays: DEFAULT_MAIL_CAPTURE_RECORD_DAYS,
      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
      scannerScenario: DEFAULT_SCANNER_SIMULATED_SCENARIO,
    });
    // Las rutas por defecto las resuelve la composición a partir de la raíz del repositorio.
    expect("storageDir" in result.config).toBe(false);
    expect("mailCaptureDir" in result.config).toBe(false);
    expect(DEFAULT_IN_REPO_STORAGE_DIR).toBe("storage/documents");
    expect(DEFAULT_IN_REPO_MAIL_CAPTURE_DIR).toBe("storage/mail-captures");
    expect(Object.isFrozen(result.config)).toBe(true);
  });

  it("acepta test, recorta espacios y congela la configuración", () => {
    const result = load({ APP_ENV: "  test  " });
    expectOk(result);
    expect(result.config.appEnv).toBe("test");
    expect(Object.isFrozen(result.config)).toBe(true);
  });

  it("acepta rutas absolutas declaradas, dentro y fuera del repositorio", () => {
    const result = load(
      { LOCAL_STORAGE_DIR: OUTSIDE_REPO_ABSOLUTE, LOCAL_MAIL_CAPTURE_DIR: INSIDE_REPO },
      { repoRoot: IN_REPO_BASE },
    );
    expectOk(result);
    expect(result.config.storageDir).toBe(OUTSIDE_REPO_ABSOLUTE);
    expect(result.config.mailCaptureDir).toBe(INSIDE_REPO);
  });

  it("admite la raíz del repositorio como raíz de almacenamiento (debajo de storage/)", () => {
    const result = load(
      {
        LOCAL_STORAGE_DIR: `${IN_REPO_BASE}/storage`,
        LOCAL_MAIL_CAPTURE_DIR: `${IN_REPO_BASE}/storage/mail-captures`,
      },
      { repoRoot: IN_REPO_BASE },
    );
    expectOk(result);
  });

  it("sin opciones de raíz, valida la forma de la ruta sin la regla del repositorio", () => {
    const result = load({ LOCAL_STORAGE_DIR: OUTSIDE_REPO_ABSOLUTE });
    expectOk(result);
  });

  it("admite rutas temporales legítimas con mkdtemp de os.tmpdir()", () => {
    const tmpRoot = `/private/var/folders/pruebas`; // forma absoluta, como devuelve mkdtemp
    const result = load({ LOCAL_STORAGE_DIR: tmpRoot, LOCAL_MAIL_CAPTURE_DIR: tmpRoot });
    expectOk(result);
  });

  it.each(["production", "staging", "qa", "DESARROLLO"])(
    "rechaza APP_ENV=%j sin publicarlo",
    (appEnv) => {
      const found = problems({ APP_ENV: appEnv });
      expect(found).toContainEqual({ key: "APP_ENV", code: "APP_ENV_FORBIDDEN" });
      expect(JSON.stringify(found)).not.toContain(appEnv);
      expect(formatLocalAdaptersConfigProblems(found)).not.toContain(appEnv);
    },
  );

  it("rechaza APP_ENV ausente: no hay valor por defecto que habilite", () => {
    const found = problems({ APP_ENV: undefined });
    expect(found).toContainEqual({ key: "APP_ENV", code: "MISSING" });
  });

  it.each([
    [{ LOCAL_STORAGE_DIR: "storage/documents" }, "NOT_ABSOLUTE"],
    [{ LOCAL_STORAGE_DIR: `${IN_REPO_BASE}/storage/../storage/documents` }, "NOT_NORMALIZED"],
    [{ LOCAL_STORAGE_DIR: `${IN_REPO_BASE}//storage/documents` }, "NOT_NORMALIZED"],
    [{ LOCAL_STORAGE_DIR: "/storage/./documents" }, "NOT_NORMALIZED"],
    [{ LOCAL_STORAGE_DIR: "objetos\u0000esta!" }, "UNSAFE_PATH"],
    [{ LOCAL_STORAGE_DIR: `/storage\tobjetos` }, "UNSAFE_PATH"],
    [{ LOCAL_STORAGE_DIR: "/" }, "ROOT_DIR_NOT_ALLOWED"],
    [{ LOCAL_MAIL_CAPTURE_DIR: "storage/mail-captures" }, "NOT_ABSOLUTE"],
    [{ LOCAL_MAIL_CAPTURE_DIR: "/mi/proyecto//mail-captures" }, "NOT_NORMALIZED"],
  ])("rechaza %o con el código %s en la clave correspondiente", (overrides, code) => {
    const found = problems(overrides);
    const failingKey = Object.keys(overrides)[0];
    expect(found).toContainEqual({ key: failingKey, code });
  });

  it("una ruta dentro del repositorio fuera de storage/ se rechaza", () => {
    const found = problems(
      { LOCAL_STORAGE_DIR: `${IN_REPO_BASE}/public/adjuntos` },
      { repoRoot: IN_REPO_BASE },
    );
    expect(found).toContainEqual({ key: "LOCAL_STORAGE_DIR", code: "OUTSIDE_REPOSITORY_STORAGE" });
  });

  it("una ruta fuera del repositorio valida la forma sin la regla de storage/", () => {
    const result = load({ LOCAL_STORAGE_DIR: "/otra/ruta/privada" }, { repoRoot: IN_REPO_BASE });
    expectOk(result);
  });

  it.each([
    [{ LOCAL_MAIL_CAPTURE_RETENTION_DAYS: "0" }, "OUT_OF_RANGE"],
    [{ LOCAL_MAIL_CAPTURE_RETENTION_DAYS: "31" }, "OUT_OF_RANGE"],
    [{ LOCAL_MAIL_CAPTURE_RECORD_DAYS: "0" }, "OUT_OF_RANGE"],
    [{ LOCAL_MAIL_CAPTURE_RECORD_DAYS: "366" }, "OUT_OF_RANGE"],
    [{ LOCAL_MAIL_CAPTURE_RECORD_DAYS: "siete" }, "INVALID"],
    [{ LOCAL_MAIL_CAPTURE_RETENTION_DAYS: "7.5" }, "INVALID"],
  ])("rechaza %o con %s en la clave correspondiente", (overrides, code) => {
    const found = problems(overrides);
    const failingKey = Object.keys(overrides)[0];
    expect(found).toContainEqual({ key: failingKey, code });
  });

  it("el plazo del registro no puede ser menor que el del contenido (§9.8)", () => {
    const found = problems({
      LOCAL_MAIL_CAPTURE_RETENTION_DAYS: "30",
      LOCAL_MAIL_CAPTURE_RECORD_DAYS: "29",
    });
    expect(found).toContainEqual({
      key: "LOCAL_MAIL_CAPTURE_RECORD_DAYS",
      code: "RECORD_DAYS_BEFORE_RETENTION",
    });
  });

  it("los valores límite de los plazos se aceptan (retención 30 ≤ registro 30/365)", () => {
    const result = load({
      LOCAL_MAIL_CAPTURE_RETENTION_DAYS: "30",
      LOCAL_MAIL_CAPTURE_RECORD_DAYS: "30",
    });
    expectOk(result);
    expect(result.config.mailCaptureRetentionDays).toBe(30);
    expect(result.config.mailCaptureRecordDays).toBe(30);
  });

  it.each(["DELAYED", "inconclusive", "APROBADO", "SCAN_INCONCLUSIVE"])(
    "rechaza SCANNER_SIMULATED_SCENARIO=%j: solo los de §10.2 salvo DELAYED",
    (scenario) => {
      const found = problems({ SCANNER_SIMULATED_SCENARIO: scenario });
      expect(found).toContainEqual({ key: "SCANNER_SIMULATED_SCENARIO", code: "INVALID" });
      expect(JSON.stringify(found)).not.toContain(scenario);
    },
  );

  it("sin valor, el escenario del scanner es INCONCLUSIVE y APPROVED debe elegirse explícitamente", () => {
    const byDefault = load({});
    expectOk(byDefault);
    expect(byDefault.config.scannerScenario).toBe("INCONCLUSIVE");
    const chosen = load({ SCANNER_SIMULATED_SCENARIO: " APPROVED " });
    expectOk(chosen);
    expect(chosen.config.scannerScenario).toBe("APPROVED");
  });

  it("cada escenario válido, salvo DELAYED, se acepta", () => {
    for (const scenario of [
      "INCONCLUSIVE",
      "APPROVED",
      "REJECTED_MALWARE",
      "REJECTED_TYPE_MISMATCH",
      "REJECTED_ENCRYPTED",
      "UNAVAILABLE",
    ] as const) {
      const result = load({ SCANNER_SIMULATED_SCENARIO: scenario });
      expectOk(result);
      expect(result.config.scannerScenario).toBe(scenario);
    }
  });

  it.each([
    [{ MAX_FILE_BYTES: "0" }, "OUT_OF_RANGE"],
    [{ MAX_FILE_BYTES: "2147483648" }, "OUT_OF_RANGE"],
    [{ MAX_FILE_BYTES: "diez" }, "INVALID"],
  ])("rechaza MAX_FILE_BYTES %o con %s (por defecto 10485760, ADR-007)", (overrides, code) => {
    const found = problems(overrides);
    expect(found).toContainEqual({ key: "MAX_FILE_BYTES", code });
  });

  it("MAX_FILE_BYTES en el límite superior del rango de configuración se acepta", () => {
    const result = load({ MAX_FILE_BYTES: "2147483647" });
    expectOk(result);
    expect(result.config.maxFileBytes).toBe(2147483647);
  });

  it("informa todos los problemas juntos", () => {
    const found = problems({
      APP_ENV: "staging",
      LOCAL_STORAGE_DIR: "relativa",
      LOCAL_MAIL_CAPTURE_RETENTION_DAYS: "0",
      SCANNER_SIMULATED_SCENARIO: "APROBADO",
    });
    expect(found.map((problem) => problem.key)).toEqual(
      expect.arrayContaining([
        "APP_ENV",
        "LOCAL_STORAGE_DIR",
        "LOCAL_MAIL_CAPTURE_RETENTION_DAYS",
        "SCANNER_SIMULATED_SCENARIO",
      ]),
    );
  });

  it("nunca incluye valores en los problemas ni en el texto que se muestra", () => {
    const found = problems({
      APP_ENV: SECRET,
      LOCAL_STORAGE_DIR: SECRET,
      LOCAL_MAIL_CAPTURE_DIR: SECRET,
      LOCAL_MAIL_CAPTURE_RETENTION_DAYS: SECRET,
      LOCAL_MAIL_CAPTURE_RECORD_DAYS: SECRET,
      SCANNER_SIMULATED_SCENARIO: SECRET,
      MAX_FILE_BYTES: SECRET,
    });
    expect(found.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(found)).not.toContain(SECRET);
    expect(formatLocalAdaptersConfigProblems(found)).not.toContain(SECRET);
  });
});
