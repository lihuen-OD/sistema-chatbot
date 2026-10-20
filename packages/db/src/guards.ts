import type { PoolConfig } from "pg";

// Guardas de conexión (plan de P1-T3, §5.7). Cada uso exige una URL explícita que apunte al
// contenedor local del proyecto. Así se excluyen Postgres.app (puerto 5432) y cualquier otra base:
// - host loopback y puerto LOCAL_DATABASE_PORT;
// - rol y base esperados para cada uso (desarrollo, administración de pruebas o base temporal);
// - APP_ENV distinto de production;
// - después de conectar y antes de escribir, la marca `cluster_name` que fija el contenedor.
// Todos los parámetros se pasan explícitamente a `pg`, que así no completa valores con PGHOST,
// PGPORT, PGUSER, PGDATABASE ni con un archivo pgpass.

export const LOCAL_DATABASE_PORT = 55432;
export const CLUSTER_MARKER = "sistema_chatbot_local";
export const DEVELOPMENT_ROLE = "sistema_chatbot_dev";
export const DEVELOPMENT_DATABASE = "sistema_chatbot_dev";
export const TEST_ROLE = "sistema_chatbot_test";
export const TEST_ADMIN_DATABASE = "sistema_chatbot_test";

/** Bases temporales de una ejecución: `sc_test_<runId>_<n>` y su plantilla `sc_test_<runId>_template`. */
export const TEMPORARY_DATABASE_PATTERN = /^sc_test_([0-9a-f]{12})_(template|[1-9][0-9]{0,5})$/;
const RUN_ID_PATTERN = /^[0-9a-f]{12}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export type ConnectionPurpose = "development" | "test-admin" | "test-temporary";

export interface ConnectionTarget {
  readonly purpose: ConnectionPurpose;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export type GuardErrorCode =
  | "URL_MISSING"
  | "URL_INVALID"
  | "HOST_NOT_LOOPBACK"
  | "PORT_NOT_ALLOWED"
  | "CREDENTIALS_MISSING"
  | "ROLE_NOT_ALLOWED"
  | "DATABASE_NOT_ALLOWED"
  | "PRODUCTION_ENVIRONMENT"
  | "CLUSTER_MARKER_MISMATCH";

export class DatabaseGuardError extends Error {
  readonly code: GuardErrorCode;

  constructor(code: GuardErrorCode, message: string) {
    super(message);
    this.name = "DatabaseGuardError";
    this.code = code;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

/** Conexión de desarrollo, desde `DATABASE_URL`. */
export function developmentTarget(env: Environment): ConnectionTarget {
  return parseTarget(env, "DATABASE_URL", "development");
}

/** Conexión con la que las pruebas crean y borran sus bases temporales, desde `TEST_DATABASE_URL`. */
export function testAdminTarget(env: Environment): ConnectionTarget {
  return parseTarget(env, "TEST_DATABASE_URL", "test-admin");
}

/** Conexión a una base temporal, con las credenciales del rol de pruebas. */
export function temporaryTarget(admin: ConnectionTarget, database: string): ConnectionTarget {
  if (admin.purpose !== "test-admin") {
    throw new DatabaseGuardError(
      "ROLE_NOT_ALLOWED",
      "Las bases temporales solo se abren con la conexión de administración de pruebas.",
    );
  }
  assertTemporaryDatabaseName(database);
  return { ...admin, purpose: "test-temporary", database };
}

export function temporaryDatabaseName(runId: string, suffix: number | "template"): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new DatabaseGuardError("DATABASE_NOT_ALLOWED", "Identificador de ejecución inválido.");
  }
  const name = `sc_test_${runId}_${String(suffix)}`;
  assertTemporaryDatabaseName(name);
  return name;
}

export function assertTemporaryDatabaseName(name: string): void {
  if (!TEMPORARY_DATABASE_PATTERN.test(name)) {
    throw new DatabaseGuardError(
      "DATABASE_NOT_ALLOWED",
      `"${name}" no es el nombre de una base temporal de pruebas (sc_test_<runId>_<n>).`,
    );
  }
}

/** Configuración de `pg` con todos los parámetros explícitos. */
export function poolConfig(target: ConnectionTarget, applicationName: string): PoolConfig {
  return {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    ssl: false,
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
  };
}

interface Queryable {
  query(text: string): Promise<{ rows: unknown[] }>;
}

/** Comprueba la marca del contenedor antes de cualquier escritura. */
export async function verifyClusterMarker(connection: Queryable): Promise<void> {
  const result = await connection.query("SELECT current_setting('cluster_name') AS cluster_name");
  const row = result.rows[0] as { cluster_name?: unknown } | undefined;
  if (row?.cluster_name !== CLUSTER_MARKER) {
    throw new DatabaseGuardError(
      "CLUSTER_MARKER_MISMATCH",
      `El servidor no es el contenedor local del proyecto: cluster_name debe ser "${CLUSTER_MARKER}".`,
    );
  }
}

function parseTarget(
  env: Environment,
  variable: string,
  purpose: "development" | "test-admin",
): ConnectionTarget {
  if (env["APP_ENV"] === "production") {
    throw new DatabaseGuardError(
      "PRODUCTION_ENVIRONMENT",
      "P1 no habilita conexiones con APP_ENV=production.",
    );
  }
  const raw = env[variable];
  if (raw === undefined || raw.trim() === "") {
    throw new DatabaseGuardError("URL_MISSING", `Falta ${variable}. Ver .env.example.`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DatabaseGuardError("URL_INVALID", `${variable} no es una URL válida.`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new DatabaseGuardError("URL_INVALID", `${variable} debe usar postgresql://.`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new DatabaseGuardError(
      "URL_INVALID",
      `${variable} no admite parámetros: podrían cambiar el host o el socket.`,
    );
  }

  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new DatabaseGuardError("HOST_NOT_LOOPBACK", `${variable} debe apuntar a 127.0.0.1.`);
  }
  if (url.port !== String(LOCAL_DATABASE_PORT)) {
    throw new DatabaseGuardError(
      "PORT_NOT_ALLOWED",
      `${variable} debe usar el puerto ${String(LOCAL_DATABASE_PORT)} del contenedor del proyecto.`,
    );
  }

  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user === "" || password === "") {
    throw new DatabaseGuardError(
      "CREDENTIALS_MISSING",
      `${variable} debe incluir usuario y contraseña.`,
    );
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));

  const expected =
    purpose === "development"
      ? { role: DEVELOPMENT_ROLE, database: DEVELOPMENT_DATABASE }
      : { role: TEST_ROLE, database: TEST_ADMIN_DATABASE };
  if (user !== expected.role) {
    throw new DatabaseGuardError(
      "ROLE_NOT_ALLOWED",
      `${variable} debe usar el rol ${expected.role}.`,
    );
  }
  if (database !== expected.database) {
    throw new DatabaseGuardError(
      "DATABASE_NOT_ALLOWED",
      `${variable} debe apuntar a la base ${expected.database}.`,
    );
  }
  return { purpose, host, port: LOCAL_DATABASE_PORT, user, password, database };
}
