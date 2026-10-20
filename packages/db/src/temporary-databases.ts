import { randomBytes, randomInt } from "node:crypto";
import pg from "pg";
import {
  assertTemporaryDatabaseName,
  DatabaseGuardError,
  poolConfig,
  temporaryDatabaseName,
  temporaryTarget,
  verifyClusterMarker,
  type ConnectionTarget,
} from "./guards.js";

// Bases temporales de pruebas y de generación de tipos (plan de P1-T3, §5.7).
// - Se crean con el rol de pruebas, que no es superusuario: PostgreSQL solo le deja borrar las
//   bases de las que es dueño.
// - Cada instancia recuerda los nombres que creó y borra solo esos, por nombre exacto. Nunca borra
//   a partir de un listado del catálogo.

export function newRunId(): string {
  return randomBytes(6).toString("hex");
}

export class TemporaryDatabases {
  readonly runId: string;
  readonly #admin: ConnectionTarget;
  readonly #created = new Set<string>();
  #pool: pg.Pool | undefined;

  constructor(admin: ConnectionTarget, runId: string = newRunId()) {
    if (admin.purpose !== "test-admin") {
      throw new DatabaseGuardError(
        "ROLE_NOT_ALLOWED",
        "Las bases temporales solo se crean con la conexión de administración de pruebas.",
      );
    }
    temporaryDatabaseName(runId, "template");
    this.#admin = admin;
    this.runId = runId;
  }

  /** Crea `sc_test_<runId>_<n>` (o la plantilla de la ejecución) y devuelve su conexión. */
  async create(
    suffix: number | "template" = randomInt(1, 1_000_000),
    template = "template0",
  ): Promise<ConnectionTarget> {
    const name = temporaryDatabaseName(this.runId, suffix);
    if (template !== "template0") this.#assertOwnRun(template);
    const pool = await this.#adminPool();
    await pool.query(`CREATE DATABASE ${quote(name)} TEMPLATE ${quote(template)}`);
    this.#created.add(name);
    return temporaryTarget(this.#admin, name);
  }

  /** Borra una base creada por esta instancia. Cualquier otro nombre se rechaza. */
  async drop(name: string): Promise<void> {
    if (!this.#created.has(name)) {
      throw new DatabaseGuardError(
        "DATABASE_NOT_ALLOWED",
        `No se borra "${name}": no la creó esta ejecución.`,
      );
    }
    this.#assertOwnRun(name);
    const pool = await this.#adminPool();
    await pool.query(`DROP DATABASE ${quote(name)} WITH (FORCE)`);
    this.#created.delete(name);
  }

  async dropAll(): Promise<void> {
    for (const name of [...this.#created]) await this.drop(name);
  }

  async close(): Promise<void> {
    await this.#pool?.end();
    this.#pool = undefined;
  }

  get created(): readonly string[] {
    return [...this.#created];
  }

  #assertOwnRun(name: string): void {
    assertTemporaryDatabaseName(name);
    if (!name.startsWith(`sc_test_${this.runId}_`)) {
      throw new DatabaseGuardError(
        "DATABASE_NOT_ALLOWED",
        `"${name}" pertenece a otra ejecución de pruebas.`,
      );
    }
  }

  async #adminPool(): Promise<pg.Pool> {
    if (this.#pool === undefined) {
      const pool = new pg.Pool({
        ...poolConfig(this.#admin, "sistema-chatbot-test-admin"),
        max: 1,
      });
      try {
        await verifyClusterMarker(pool);
      } catch (error) {
        await pool.end();
        throw error;
      }
      this.#pool = pool;
    }
    return this.#pool;
  }
}

/** Los nombres ya pasaron por TEMPORARY_DATABASE_PATTERN o son `template0`. */
function quote(name: string): string {
  return `"${name}"`;
}
