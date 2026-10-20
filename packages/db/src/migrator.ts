import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Kysely,
  PostgresAdapter,
  PostgresDialect,
  sql,
  type DialectAdapter,
  type MigrationLockOptions,
  type PostgresDialectConfig,
} from "kysely";
import { Migrator, type Migration } from "kysely/migration";
import { verifyClusterMarker, type ConnectionTarget } from "./guards.js";
import { createPool } from "./pool.js";
import { MigrationSqlError, validateMigrationSql } from "./sql-validation.js";

// Ejecutor de migraciones (ADR-010; plan de P1-T3, §5.2 y §5.7): Migrator de Kysely más una
// verificación de checksums.
// - Kysely toma un pg_advisory_lock de sesión, comprueba orden y faltantes y aplica todas las
//   migraciones pendientes en una sola transacción.
// - Cada migración guarda su checksum en `schema_migration_checksums`, dentro de esa transacción.
// - La verificación definitiva de checksums corre en `acquireMigrationLock`, después de obtener el
//   bloqueo y antes de que Kysely lea el estado. Si falla, Kysely libera el bloqueo en su `finally`.

export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../migrations/", import.meta.url));
export const CHECKSUM_TABLE = "schema_migration_checksums";
/** Tablas de control de migraciones (Kysely y checksums). No forman parte del modelo. */
export const MIGRATION_CONTROL_TABLES = [
  "kysely_migration",
  "kysely_migration_lock",
  CHECKSUM_TABLE,
] as const;

const MIGRATION_FILE_NAME = /^([0-9]{4})_[a-z][a-z0-9_]*\.sql$/;

export interface MigrationFile {
  /** Nombre sin extensión, por ejemplo `0001_base`. Es el nombre que registra Kysely. */
  readonly name: string;
  readonly sql: string;
  /** SHA-256 en hexadecimal de los bytes del archivo. */
  readonly sha256: string;
}

export type MigrationIntegrityCode =
  | "INVALID_FILE_NAME"
  | "INVALID_SQL"
  | "DUPLICATE_VERSION"
  | "FILE_MISSING"
  | "OUT_OF_ORDER"
  | "CHECKSUM_MISSING"
  | "CHECKSUM_MISMATCH"
  | "CHECKSUM_WITHOUT_MIGRATION"
  | "TRANSACTION_ESCAPED"
  | "MIGRATION_FAILED";

export class MigrationIntegrityError extends Error {
  readonly code: MigrationIntegrityCode;

  constructor(code: MigrationIntegrityCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MigrationIntegrityError";
    this.code = code;
  }
}

/** Crea una migración desde su archivo, después de validar nombre y SQL. */
export function migrationFile(fileName: string, contents: Buffer): MigrationFile {
  if (!MIGRATION_FILE_NAME.test(fileName)) {
    throw new MigrationIntegrityError(
      "INVALID_FILE_NAME",
      `${fileName}: el nombre debe ser NNNN_descripcion.sql (minúsculas y guiones bajos).`,
    );
  }
  const text = contents.toString("utf8");
  try {
    validateMigrationSql(text);
  } catch (error) {
    if (error instanceof MigrationSqlError) {
      throw new MigrationIntegrityError("INVALID_SQL", `${fileName}: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
  return {
    name: fileName.replace(/\.sql$/, ""),
    sql: text,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

/** Lee y valida los archivos `.sql` del directorio, ordenados por nombre. */
export async function readMigrationFiles(
  directory: string = MIGRATIONS_DIRECTORY,
): Promise<MigrationFile[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const versions = new Set<string>();
  const files: MigrationFile[] = [];
  for (const name of names) {
    const file = migrationFile(name, await readFile(join(directory, name)));
    const version = name.slice(0, 4);
    if (versions.has(version)) {
      throw new MigrationIntegrityError("DUPLICATE_VERSION", `Hay dos migraciones ${version}.`);
    }
    versions.add(version);
    files.push(file);
  }
  return files;
}

export interface MigrationRunOptions {
  readonly target: ConnectionTarget;
  /** Archivos a aplicar. Por defecto, los de `migrations/`. */
  readonly files?: readonly MigrationFile[];
  readonly applicationName?: string;
}

export interface MigrationRunResult {
  /** Migraciones aplicadas en esta ejecución, en orden. */
  readonly applied: readonly string[];
}

/**
 * Aplica las migraciones pendientes. Si una falla, la transacción del lote se revierte completa y
 * no queda aplicada ninguna migración de esta ejecución.
 */
export async function runMigrations(options: MigrationRunOptions): Promise<MigrationRunResult> {
  const files = options.files ?? (await readMigrationFiles());
  const pool = createPool(options.target, options.applicationName ?? "sistema-chatbot-migrate", 3);
  const db = new Kysely<unknown>({
    dialect: new MigrationDialect({ pool }, new ChecksumVerifyingAdapter(files)),
  });
  try {
    await verifyClusterMarker(pool);
    const migrations = Object.fromEntries(files.map((file) => [file.name, toMigration(file)]));
    const migrator = new Migrator({
      db,
      provider: { getMigrations: () => Promise.resolve(migrations) },
    });
    const { error, results = [] } = await migrator.migrateToLatest();
    if (error !== undefined) {
      if (error instanceof MigrationIntegrityError) throw error;
      const failed = results.find((result) => result.status === "Error")?.migrationName;
      throw new MigrationIntegrityError(
        "MIGRATION_FAILED",
        failed === undefined
          ? "No se pudieron aplicar las migraciones."
          : `Falló la migración ${failed}. No se aplicó ninguna migración de esta ejecución.`,
        { cause: error },
      );
    }
    return {
      applied: results
        .filter((result) => result.status === "Success")
        .map((result) => result.migrationName),
    };
  } finally {
    await db.destroy();
  }
}

function toMigration(file: MigrationFile): Migration {
  return {
    async up(db) {
      const before = await currentTransactionId(db);
      await sql.raw(file.sql).execute(db);
      // Defensa adicional a la validación del archivo: la transacción del lote debe seguir abierta.
      if ((await currentTransactionId(db)) !== before) {
        throw new MigrationIntegrityError(
          "TRANSACTION_ESCAPED",
          `${file.name} cerró la transacción del ejecutor.`,
        );
      }
      await sql`INSERT INTO ${sql.table(CHECKSUM_TABLE)} (name, sha256) VALUES (${file.name}, ${file.sha256})`.execute(
        db,
      );
    },
  };
}

async function currentTransactionId(db: Kysely<unknown>): Promise<string> {
  const result = await sql<{ id: string }>`SELECT pg_current_xact_id()::text AS id`.execute(db);
  return result.rows[0]?.id ?? "";
}

/** Verificación definitiva, con el bloqueo de migraciones tomado. No escribe datos. */
async function verifyAppliedChecksums(
  db: Kysely<unknown>,
  files: readonly MigrationFile[],
): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql.table(CHECKSUM_TABLE)} (
      name varchar(255) PRIMARY KEY,
      sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      recorded_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  const executed = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db);
  const stored = await sql<{
    name: string;
    sha256: string;
  }>`SELECT name, sha256 FROM ${sql.table(CHECKSUM_TABLE)}`.execute(db);

  const fileByName = new Map(files.map((file) => [file.name, file]));
  const storedByName = new Map(stored.rows.map((row) => [row.name, row.sha256]));
  const executedNames = executed.rows.map((row) => row.name).sort();

  for (const name of executedNames) {
    const file = fileByName.get(name);
    if (file === undefined) {
      throw new MigrationIntegrityError(
        "FILE_MISSING",
        `La migración aplicada ${name} no tiene archivo.`,
      );
    }
    const checksum = storedByName.get(name);
    if (checksum === undefined) {
      throw new MigrationIntegrityError(
        "CHECKSUM_MISSING",
        `La migración aplicada ${name} no tiene checksum registrado.`,
      );
    }
    if (checksum !== file.sha256) {
      throw new MigrationIntegrityError(
        "CHECKSUM_MISMATCH",
        `${name} cambió después de aplicarse. Las migraciones aplicadas no se editan: se corrigen con una nueva.`,
      );
    }
  }
  for (const name of storedByName.keys()) {
    if (!executedNames.includes(name)) {
      throw new MigrationIntegrityError(
        "CHECKSUM_WITHOUT_MIGRATION",
        `Hay un checksum de ${name}, pero la migración no figura como aplicada.`,
      );
    }
  }
  const expectedPrefix = files.slice(0, executedNames.length).map((file) => file.name);
  if (expectedPrefix.join("\n") !== executedNames.join("\n")) {
    throw new MigrationIntegrityError(
      "OUT_OF_ORDER",
      "Hay migraciones nuevas ordenadas antes de la última aplicada.",
    );
  }
}

class ChecksumVerifyingAdapter extends PostgresAdapter {
  readonly #files: readonly MigrationFile[];

  constructor(files: readonly MigrationFile[]) {
    super();
    this.#files = files;
  }

  override async acquireMigrationLock(
    db: Kysely<unknown>,
    options: MigrationLockOptions,
  ): Promise<void> {
    await super.acquireMigrationLock(db, options);
    // Desde acá y hasta que Kysely libere el bloqueo, ningún otro ejecutor aplica migraciones.
    await verifyAppliedChecksums(db, this.#files);
  }
}

class MigrationDialect extends PostgresDialect {
  readonly #adapter: DialectAdapter;

  constructor(config: PostgresDialectConfig, adapter: DialectAdapter) {
    super(config);
    this.#adapter = adapter;
  }

  override createAdapter(): DialectAdapter {
    return this.#adapter;
  }
}
