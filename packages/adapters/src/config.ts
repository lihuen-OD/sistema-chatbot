import { isAbsolute, normalize, relative, sep } from "node:path";
import type { LocalAdapterEnvironment } from "./types.js";

// Configuración de los adaptadores locales (plan de P1-T5, §12). Igual que en la API:
// se valida por clave, se informan todos los problemas juntos y ninguna salida incluye el
// valor recibido. Solo comprueba la *forma* declarada por el plan (entornos, rutas como
// texto, límites y plazos, escenario por defecto INCONCLUSIVE); la comprobación real del
// sistema de archivos (recorrido de antecesores, enlaces, dueños y modos) pertenece a la
// construcción de la raíz privada (plan §6), que todavía no está implementada.

/** Escenarios de §10.2 que admite la configuración. `DELAYED` se elige por inyección para las
 * pruebas, no por entorno. El escenario por defecto es INCONCLUSIVE (decisión A2). */
export type ScannerSimulatedScenario =
  | "INCONCLUSIVE"
  | "APPROVED"
  | "REJECTED_MALWARE"
  | "REJECTED_TYPE_MISMATCH"
  | "REJECTED_ENCRYPTED"
  | "UNAVAILABLE";

export const SCANNER_SIMULATED_SCENARIOS: readonly ScannerSimulatedScenario[] = [
  "INCONCLUSIVE",
  "APPROVED",
  "REJECTED_MALWARE",
  "REJECTED_TYPE_MISMATCH",
  "REJECTED_ENCRYPTED",
  "UNAVAILABLE",
];

export const DEFAULT_SCANNER_SIMULATED_SCENARIO: ScannerSimulatedScenario = "INCONCLUSIVE";

/** Plazo por defecto del contenido de una captura (`payload/`), plan §12 y §9.8. */
export const DEFAULT_MAIL_CAPTURE_RETENTION_DAYS = 7;
/** Plazo por defecto del registro sin datos personales, plan §12 y §9.8. */
export const DEFAULT_MAIL_CAPTURE_RECORD_DAYS = 30;
/** Límite de bytes por defecto de un objeto (`MAX_FILE_BYTES`), plan §8.3. */
export const DEFAULT_MAX_FILE_BYTES = 10_485_760;

/** Rutas por defecto, relativas a la raíz del repositorio que le pasa el host; las resuelve
 * la composición (plan §6.1 y §12), que todavía no está implementada. */
export const DEFAULT_IN_REPO_STORAGE_DIR = "storage/documents";
export const DEFAULT_IN_REPO_MAIL_CAPTURE_DIR = "storage/mail-captures";

export type LocalAdaptersConfigProblemCode =
  | "MISSING"
  | "APP_ENV_FORBIDDEN"
  | "INVALID"
  | "OUT_OF_RANGE"
  | "NOT_ABSOLUTE"
  | "NOT_NORMALIZED"
  | "UNSAFE_PATH"
  | "ROOT_DIR_NOT_ALLOWED"
  | "OUTSIDE_REPOSITORY_STORAGE"
  | "RECORD_DAYS_BEFORE_RETENTION";

export interface LocalAdaptersConfigProblem {
  readonly key: string;
  readonly code: LocalAdaptersConfigProblemCode;
}

export interface LocalAdaptersConfig {
  readonly appEnv: LocalAdapterEnvironment;
  /** Ruta declarada, ya validada en su forma (§6.1). Si no está, la composición usa la del
   * plan: `storage/documents`. */
  readonly storageDir?: string;
  /** Ruta declarada, ya validada en su forma (§6.1). Si no está, la composición usa la del
   * plan: `storage/mail-captures`. */
  readonly mailCaptureDir?: string;
  readonly mailCaptureRetentionDays: number;
  readonly mailCaptureRecordDays: number;
  readonly maxFileBytes: number;
  readonly scannerScenario: ScannerSimulatedScenario;
}

export type LocalAdaptersConfigResult =
  | { readonly ok: true; readonly config: LocalAdaptersConfig }
  | { readonly ok: false; readonly problems: readonly LocalAdaptersConfigProblem[] };

type Environment = Readonly<Record<string, string | undefined>>;
type Report = (key: string, code: LocalAdaptersConfigProblemCode) => void;

export interface LocalAdaptersConfigOptions {
  /** Raíz del repositorio. La composición siempre la pasa (plan §6.1 y §12); si falta, no
   * se aplica la regla "dentro del repositorio, debajo de storage/". */
  readonly repoRoot?: string;
}

/**
 * Valida la configuración declarada. Entornos permitidos: exactamente `development` y
 * `test` (plan §5.1): rechaza `staging`, `production`, valores desconocidos y la ausencia
 * de valor. El guardas de construcción y de operación (environment.ts) es el control de
 * ejecución aparte: esta función es pura y no lee `process.env`.
 */
export function loadLocalAdaptersConfig(
  env: Environment,
  options: LocalAdaptersConfigOptions = {},
): LocalAdaptersConfigResult {
  const problems: LocalAdaptersConfigProblem[] = [];
  const problem: Report = (key, code) => {
    problems.push({ key, code });
  };

  const appEnv = readAppEnv(env, problem);
  const storageDir = readPath(env, "LOCAL_STORAGE_DIR", options, problem);
  const mailCaptureDir = readPath(env, "LOCAL_MAIL_CAPTURE_DIR", options, problem);
  const mailCaptureRetentionDays = readInteger(
    env,
    "LOCAL_MAIL_CAPTURE_RETENTION_DAYS",
    DEFAULT_MAIL_CAPTURE_RETENTION_DAYS,
    1,
    30,
    problem,
  );
  const mailCaptureRecordDays = readInteger(
    env,
    "LOCAL_MAIL_CAPTURE_RECORD_DAYS",
    DEFAULT_MAIL_CAPTURE_RECORD_DAYS,
    1,
    365,
    problem,
  );
  if (
    mailCaptureRetentionDays !== undefined &&
    mailCaptureRecordDays !== undefined &&
    mailCaptureRecordDays < mailCaptureRetentionDays
  ) {
    problem("LOCAL_MAIL_CAPTURE_RECORD_DAYS", "RECORD_DAYS_BEFORE_RETENTION");
  }
  const maxFileBytes = readInteger(
    env,
    "MAX_FILE_BYTES",
    DEFAULT_MAX_FILE_BYTES,
    1,
    10_485_760,
    problem,
  );
  const scannerScenario = readScannerScenario(env, problem);

  if (
    problems.length > 0 ||
    appEnv === undefined ||
    mailCaptureRetentionDays === undefined ||
    mailCaptureRecordDays === undefined ||
    maxFileBytes === undefined ||
    scannerScenario === undefined
  ) {
    return { ok: false, problems };
  }
  const config: LocalAdaptersConfig = {
    appEnv,
    mailCaptureRetentionDays,
    mailCaptureRecordDays,
    maxFileBytes,
    scannerScenario,
  };
  let configWithOptions = config;
  if (storageDir !== undefined && mailCaptureDir !== undefined) {
    configWithOptions = { ...config, storageDir, mailCaptureDir };
  } else if (storageDir !== undefined) {
    configWithOptions = { ...config, storageDir };
  } else if (mailCaptureDir !== undefined) {
    configWithOptions = { ...config, mailCaptureDir };
  }
  return { ok: true, config: Object.freeze(configWithOptions) };
}

/** Una línea por problema: clave y código, nunca el valor. */
export function formatLocalAdaptersConfigProblems(
  problems: readonly LocalAdaptersConfigProblem[],
): string {
  return problems.map(({ key, code }) => `- ${key}: ${code}`).join("\n");
}

function readAppEnv(env: Environment, problem: Report): LocalAdapterEnvironment | undefined {
  const value = env["APP_ENV"]?.trim();
  if (value === undefined || value === "") {
    problem("APP_ENV", "MISSING");
    return undefined;
  }
  if (value !== "development" && value !== "test") {
    problem("APP_ENV", "APP_ENV_FORBIDDEN");
    return undefined;
  }
  return value;
}

function readPath(
  env: Environment,
  key: string,
  options: LocalAdaptersConfigOptions,
  problem: Report,
): string | undefined {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === "") return undefined;
  if (hasUnsafePathCharacter(raw)) {
    problem(key, "UNSAFE_PATH");
    return undefined;
  }
  if (!isAbsolute(raw)) {
    problem(key, "NOT_ABSOLUTE");
    return undefined;
  }
  if (normalize(raw) !== raw) {
    problem(key, "NOT_NORMALIZED");
    return undefined;
  }
  if (raw === "/") {
    problem(key, "ROOT_DIR_NOT_ALLOWED");
    return undefined;
  }
  const repoRoot = options.repoRoot;
  if (repoRoot !== undefined && repoRoot !== "") {
    const rel = relative(repoRoot, raw);
    // rel === "" significa que la ruta es el repositorio mismo: está dentro y no debajo
    // de storage/, así que se rechaza igual que sus descendientes con OUTSIDE_REPOSITORY_STORAGE.
    const insideRepo =
      rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    if (insideRepo && rel !== "storage" && !rel.startsWith(`storage${sep}`)) {
      problem(key, "OUTSIDE_REPOSITORY_STORAGE");
      return undefined;
    }
  }
  return raw;
}

function readInteger(
  env: Environment,
  key: string,
  fallback: number,
  min: number,
  max: number,
  problem: Report,
): number | undefined {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^[0-9]{1,10}$/.test(raw)) {
    problem(key, "INVALID");
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    problem(key, "OUT_OF_RANGE");
    return undefined;
  }
  return value;
}

function hasUnsafePathCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    // Byte nulo y caracteres de control (0x00 a 0x1F y 0x7F), incluidos CR y LF.
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function readScannerScenario(
  env: Environment,
  problem: Report,
): ScannerSimulatedScenario | undefined {
  const raw = env["SCANNER_SIMULATED_SCENARIO"]?.trim();
  if (raw === undefined || raw === "") return DEFAULT_SCANNER_SIMULATED_SCENARIO;
  const found = SCANNER_SIMULATED_SCENARIOS.find((candidate) => candidate === raw);
  if (found === undefined) {
    problem("SCANNER_SIMULATED_SCENARIO", "INVALID");
    return undefined;
  }
  return found;
}
