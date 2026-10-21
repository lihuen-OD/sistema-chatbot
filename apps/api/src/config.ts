import {
  DatabaseGuardError,
  developmentTarget,
  type ConnectionTarget,
  type GuardErrorCode,
} from "@sistema-chatbot/db";

// Configuración de la API (plan de P1-T4, §5.2). Se valida una sola vez al arrancar y se congela.
// Los problemas se informan por clave y código, nunca con el valor recibido: una credencial pegada
// en la variable equivocada no debe aparecer en la salida.

export const APP_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/**
 * Valores admitidos por modo. En P1 solo existen los simulados; los reales llegan con sus
 * adaptadores (P5 y P6). No se agregan valores reales vacíos que parezcan implementados.
 */
export const SIMULATED_MODES = {
  CHANNEL_MODE: "simulator",
  EMAIL_MODE: "capture",
  STORAGE_MODE: "local_private",
  SCANNER_MODE: "fake_development_only",
} as const;

export type ModeKey = keyof typeof SIMULATED_MODES;

/** Cookie sin `Secure` solo en local por HTTP; en cualquier otro caso `__Host-` con `Secure`. */
export type CookieMode = "local-http" | "secure";

export interface SessionSettings {
  readonly idleMinutes: number;
  readonly absoluteHours: number;
}

export interface ApiConfig {
  readonly appEnv: AppEnvironment;
  readonly host: string;
  readonly port: number;
  readonly adminOrigin: string;
  readonly database: ConnectionTarget;
  readonly modes: Readonly<Record<ModeKey, string>>;
  readonly session: SessionSettings;
  readonly cookieMode: CookieMode;
}

export type ConfigProblemCode =
  | "MISSING"
  | "INVALID"
  | "OUT_OF_RANGE"
  | "NOT_LOOPBACK"
  | "HTTPS_REQUIRED"
  | "SIMULATED_MODE_IN_PRODUCTION"
  | "PRODUCTION_NOT_SUPPORTED"
  | "DATABASE_GUARD";

export interface ConfigProblem {
  readonly key: string;
  readonly code: ConfigProblemCode;
  /** Código de la guarda de base, si corresponde. Nunca el valor. */
  readonly reason?: GuardErrorCode;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ApiConfig }
  | { readonly ok: false; readonly problems: readonly ConfigProblem[] };

type Environment = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const LOOPBACK_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOCAL_ENVIRONMENTS: ReadonlySet<AppEnvironment> = new Set(["development", "test"]);
const DEFAULT_PORT = 4000;

/** Propuesta inicial del propietario (21/10/2026): 30 minutos de inactividad y 8 horas en total. */
export const DEFAULT_SESSION_SETTINGS: SessionSettings = Object.freeze({
  idleMinutes: 30,
  absoluteHours: 8,
});

export function loadConfig(env: Environment): ConfigResult {
  const problems: ConfigProblem[] = [];
  const problem = (key: string, code: ConfigProblemCode, reason?: GuardErrorCode): void => {
    problems.push(reason === undefined ? { key, code } : { key, code, reason });
  };

  const appEnv = readAppEnv(env, problem);
  if (appEnv === "production") problem("APP_ENV", "PRODUCTION_NOT_SUPPORTED");

  const declaredHost = env["API_HOST"]?.trim();
  const host = declaredHost === undefined || declaredHost === "" ? "127.0.0.1" : declaredHost;
  if (!LOOPBACK_HOSTS.has(host)) problem("API_HOST", "NOT_LOOPBACK");

  const port = readInteger(env, "API_PORT", DEFAULT_PORT, 1024, 65_535, problem);
  const origin = readAdminOrigin(env, appEnv, problem);
  const modes = readModes(env, appEnv, problem);
  const idleMinutes = readInteger(
    env,
    "SESSION_IDLE_MINUTES",
    DEFAULT_SESSION_SETTINGS.idleMinutes,
    5,
    30,
    problem,
  );
  const absoluteHours = readInteger(
    env,
    "SESSION_ABSOLUTE_HOURS",
    DEFAULT_SESSION_SETTINGS.absoluteHours,
    1,
    8,
    problem,
  );
  if (idleMinutes !== undefined && absoluteHours !== undefined) {
    if (absoluteHours * 60 <= idleMinutes) problem("SESSION_ABSOLUTE_HOURS", "OUT_OF_RANGE");
  }

  let database: ConnectionTarget | undefined;
  try {
    database = developmentTarget(env);
  } catch (error) {
    if (!(error instanceof DatabaseGuardError)) throw error;
    problem("DATABASE_URL", "DATABASE_GUARD", error.code);
  }

  if (
    problems.length > 0 ||
    appEnv === undefined ||
    port === undefined ||
    origin === undefined ||
    modes === undefined ||
    idleMinutes === undefined ||
    absoluteHours === undefined ||
    database === undefined
  ) {
    return { ok: false, problems };
  }
  const config: ApiConfig = {
    appEnv,
    host,
    port,
    adminOrigin: origin.origin,
    database,
    modes,
    session: Object.freeze({ idleMinutes, absoluteHours }),
    cookieMode: cookieModeFor(appEnv, origin, host),
  };
  return { ok: true, config: Object.freeze(config) };
}

/** Modo de cookie: sin `Secure` solo si el entorno es local, el origen es HTTP de loopback y la
 * API escucha en loopback. */
export function cookieModeFor(appEnv: AppEnvironment, origin: URL, host: string): CookieMode {
  return LOCAL_ENVIRONMENTS.has(appEnv) &&
    origin.protocol === "http:" &&
    LOOPBACK_ORIGIN_HOSTS.has(origin.hostname) &&
    LOOPBACK_HOSTS.has(host)
    ? "local-http"
    : "secure";
}

/** Una línea por problema: clave, código y motivo. Sin valores. */
export function formatConfigProblems(problems: readonly ConfigProblem[]): string {
  return problems
    .map(
      ({ key, code, reason }) => `- ${key}: ${code}${reason === undefined ? "" : ` (${reason})`}`,
    )
    .join("\n");
}

type Report = (key: string, code: ConfigProblemCode, reason?: GuardErrorCode) => void;

function readAppEnv(env: Environment, problem: Report): AppEnvironment | undefined {
  const value = env["APP_ENV"]?.trim();
  if (value === undefined || value === "") {
    problem("APP_ENV", "MISSING");
    return undefined;
  }
  const found = APP_ENVIRONMENTS.find((candidate) => candidate === value);
  if (found === undefined) problem("APP_ENV", "INVALID");
  return found;
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
  if (!/^[0-9]{1,6}$/.test(raw)) {
    problem(key, "INVALID");
    return undefined;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    problem(key, "OUT_OF_RANGE");
    return undefined;
  }
  return value;
}

function readAdminOrigin(
  env: Environment,
  appEnv: AppEnvironment | undefined,
  problem: Report,
): URL | undefined {
  const raw = env["ADMIN_ORIGIN"]?.trim();
  if (raw === undefined || raw === "") {
    problem("ADMIN_ORIGIN", "MISSING");
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problem("ADMIN_ORIGIN", "INVALID");
    return undefined;
  }
  // Solo un origen: esquema, host y puerto, sin ruta, credenciales, consulta ni fragmento.
  const isOrigin =
    (url.protocol === "http:" || url.protocol === "https:") &&
    (raw === url.origin || raw === `${url.origin}/`);
  if (!isOrigin) {
    problem("ADMIN_ORIGIN", "INVALID");
    return undefined;
  }
  if (url.protocol === "http:") {
    const localHttp =
      appEnv !== undefined &&
      LOCAL_ENVIRONMENTS.has(appEnv) &&
      LOOPBACK_ORIGIN_HOSTS.has(url.hostname);
    if (!localHttp) {
      problem("ADMIN_ORIGIN", "HTTPS_REQUIRED");
      return undefined;
    }
  }
  return url;
}

function readModes(
  env: Environment,
  appEnv: AppEnvironment | undefined,
  problem: Report,
): Record<ModeKey, string> | undefined {
  const modes: Partial<Record<ModeKey, string>> = {};
  let valid = true;
  for (const [key, simulated] of Object.entries(SIMULATED_MODES) as [ModeKey, string][]) {
    const value = env[key]?.trim();
    if (value === undefined || value === "") {
      problem(key, "MISSING");
      valid = false;
      continue;
    }
    if (value !== simulated) {
      problem(key, "INVALID");
      valid = false;
      continue;
    }
    if (appEnv === "production") {
      problem(key, "SIMULATED_MODE_IN_PRODUCTION");
      valid = false;
      continue;
    }
    modes[key] = value;
  }
  return valid ? (modes as Record<ModeKey, string>) : undefined;
}
