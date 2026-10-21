import { createHash } from "node:crypto";
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  CHECKSUM_TABLE,
  MigrationIntegrityError,
  migrationFile,
  readMigrationFiles,
  runMigrations,
  type MigrationFile,
} from "../../src/migrator.js";
import {
  cleanupDatabases,
  connect,
  createTestDatabase,
  waitUntilBlocked,
} from "./support/database.js";

afterAll(cleanupDatabases);

const file = (name: string, sql: string): MigrationFile => migrationFile(name, Buffer.from(sql));

async function rejection(operation: Promise<unknown>): Promise<MigrationIntegrityError> {
  const error = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(MigrationIntegrityError);
  return error as MigrationIntegrityError;
}

async function tableExists(client: pg.Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [table],
  );
  return rows[0]?.exists === true;
}

async function appliedNames(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    "SELECT name FROM kysely_migration ORDER BY name",
  );
  return rows.map((row) => row.name);
}

describe("inicialización desde una base vacía", () => {
  it("aplica las migraciones del repositorio en orden y registra cada checksum", async () => {
    const target = await createTestDatabase({ migrated: false });
    const files = await readMigrationFiles();

    const first = await runMigrations({ target });
    expect(first.applied).toEqual(files.map((migration) => migration.name));

    const client = await connect(target);
    expect(await appliedNames(client)).toEqual(files.map((migration) => migration.name));
    const { rows } = await client.query<{ name: string; sha256: string }>(
      `SELECT name, sha256 FROM ${CHECKSUM_TABLE} ORDER BY name`,
    );
    expect(rows).toEqual(files.map(({ name, sha256 }) => ({ name, sha256 })));

    const second = await runMigrations({ target });
    expect(second.applied).toEqual([]);
  });

  it("el checksum es el SHA-256 de los bytes del archivo", () => {
    const sql = "CREATE TABLE x (id integer);\n";
    expect(file("0001_x.sql", sql).sha256).toBe(createHash("sha256").update(sql).digest("hex"));
  });
});

describe("dos ejecutores concurrentes", () => {
  it("sobre una base vacía, cada migración se aplica y se registra una sola vez", async () => {
    const target = await createTestDatabase({ migrated: false });
    const files = await readMigrationFiles();

    const [a, b] = await Promise.all([
      runMigrations({ target, applicationName: "test-concurrente-a" }),
      runMigrations({ target, applicationName: "test-concurrente-b" }),
    ]);

    expect([...a.applied, ...b.applied].sort()).toEqual(files.map((migration) => migration.name));
    expect(a.applied.length === 0 || b.applied.length === 0).toBe(true);
    const client = await connect(target);
    expect(await appliedNames(client)).toEqual(files.map((migration) => migration.name));
    const { rows } = await client.query<{ total: string }>(
      `SELECT count(*) AS total FROM ${CHECKSUM_TABLE}`,
    );
    expect(Number(rows[0]?.total)).toBe(files.length);
  });

  it("la verificación definitiva de checksums ocurre con el bloqueo de migración tomado", async () => {
    const target = await createTestDatabase({ migrated: false });
    const first = file("0001_primera.sql", "CREATE TABLE primera (id integer);");
    // Mientras el ejecutor A aplica esta migración, mantiene el bloqueo de migraciones.
    const waits = file("0002_espera.sql", "SELECT pg_advisory_xact_lock(424242);");
    await runMigrations({ target, files: [first] });

    const observer = await connect(target, "test-observador");
    await observer.query("SELECT pg_advisory_lock(424242)");
    const runA = runMigrations({
      target,
      files: [first, waits],
      applicationName: "test-ejecutor-a",
    });
    await waitUntilBlocked(observer, "test-ejecutor-a");

    // B empieza después y espera el bloqueo de migraciones que tiene A.
    const runB = runMigrations({
      target,
      files: [first, waits],
      applicationName: "test-ejecutor-b",
    }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    await waitUntilBlocked(observer, "test-ejecutor-b");

    // Con B esperando, cambia el checksum registrado de una migración ya aplicada.
    await observer.query(
      `UPDATE ${CHECKSUM_TABLE} SET sha256 = repeat('0', 64) WHERE name = '0001_primera'`,
    );
    await observer.query("SELECT pg_advisory_unlock(424242)");

    await expect(runA).resolves.toEqual({ applied: ["0002_espera"] });
    const errorB = await runB;
    expect(errorB).toBeInstanceOf(MigrationIntegrityError);
    expect((errorB as MigrationIntegrityError).code).toBe("CHECKSUM_MISMATCH");
  });
});

describe("integridad de las migraciones aplicadas", () => {
  it("un archivo aplicado que cambió detiene la ejecución sin aplicar las pendientes", async () => {
    const target = await createTestDatabase({ migrated: false });
    await runMigrations({ target, files: [file("0001_a.sql", "CREATE TABLE a (id integer);")] });

    const error = await rejection(
      runMigrations({
        target,
        files: [
          file("0001_a.sql", "CREATE TABLE a (id bigint);"),
          file("0002_b.sql", "CREATE TABLE b (id integer);"),
        ],
      }),
    );
    expect(error.code).toBe("CHECKSUM_MISMATCH");
    const client = await connect(target);
    expect(await tableExists(client, "b")).toBe(false);
  });

  it("una migración aplicada sin archivo detiene la ejecución", async () => {
    const target = await createTestDatabase({ migrated: false });
    const a = file("0001_a.sql", "CREATE TABLE a (id integer);");
    await runMigrations({ target, files: [a, file("0002_b.sql", "CREATE TABLE b (id integer);")] });

    expect((await rejection(runMigrations({ target, files: [a] }))).code).toBe("FILE_MISSING");
  });

  it("una migración nueva ordenada antes de la última aplicada no se aplica", async () => {
    const target = await createTestDatabase({ migrated: false });
    const a = file("0001_a.sql", "CREATE TABLE a (id integer);");
    const c = file("0003_c.sql", "CREATE TABLE c (id integer);");
    await runMigrations({ target, files: [a, c] });

    const error = await rejection(
      runMigrations({ target, files: [a, file("0002_b.sql", "CREATE TABLE b (id integer);"), c] }),
    );
    expect(error.code).toBe("OUT_OF_ORDER");
    const client = await connect(target);
    expect(await tableExists(client, "b")).toBe(false);
  });

  it("un checksum sin migración aplicada detiene la ejecución", async () => {
    const target = await createTestDatabase({ migrated: false });
    const a = file("0001_a.sql", "CREATE TABLE a (id integer);");
    await runMigrations({ target, files: [a] });
    const client = await connect(target);
    await client.query(`INSERT INTO ${CHECKSUM_TABLE} (name, sha256) VALUES ('0002_b', $1)`, [
      "c".repeat(64),
    ]);

    expect((await rejection(runMigrations({ target, files: [a] }))).code).toBe(
      "CHECKSUM_WITHOUT_MIGRATION",
    );
  });
});

describe("sin migraciones aplicadas a medias", () => {
  it("si una migración falla, no queda nada de esa ejecución", async () => {
    const target = await createTestDatabase({ migrated: false });
    const error = await rejection(
      runMigrations({
        target,
        files: [
          file("0001_a.sql", "CREATE TABLE a (id integer);"),
          file("0002_b.sql", "CREATE TABLE b (id integer);\nSELECT 1 / 0;"),
        ],
      }),
    );
    expect(error.code).toBe("MIGRATION_FAILED");
    expect(error.message).toContain("0002_b");

    const client = await connect(target);
    expect(await tableExists(client, "a")).toBe(false);
    expect(await tableExists(client, "b")).toBe(false);
    expect(await appliedNames(client)).toEqual([]);
    const { rows } = await client.query<{ total: string }>(
      `SELECT count(*) AS total FROM ${CHECKSUM_TABLE}`,
    );
    expect(Number(rows[0]?.total)).toBe(0);
  });

  it("un COMMIT dentro de un bloque DO no cierra la transacción del ejecutor", async () => {
    const target = await createTestDatabase({ migrated: false });
    // El validador acepta el archivo: el COMMIT está dentro de la cadena con dólar del DO.
    const doBlock = file(
      "0001_do.sql",
      "CREATE TABLE antes_del_do (id integer);\nDO $$ BEGIN COMMIT; END $$;",
    );
    const error = await rejection(runMigrations({ target, files: [doBlock] }));
    expect(error.code).toBe("MIGRATION_FAILED");
    expect((error.cause as pg.DatabaseError).code).toBe("2D000");

    const client = await connect(target);
    expect(await tableExists(client, "antes_del_do")).toBe(false);
    expect(await appliedNames(client)).toEqual([]);
  });

  it("defensa adicional: detecta una migración que cerró la transacción", async () => {
    const target = await createTestDatabase({ migrated: false });
    // Se arma sin migrationFile, que la rechazaría: simula una falla del validador.
    const sql = "CREATE TABLE escapada (id integer);\nCOMMIT;\nCREATE TABLE despues (id integer);";
    const escaped: MigrationFile = {
      name: "0001_escapada",
      sql,
      sha256: createHash("sha256").update(sql).digest("hex"),
    };
    expect((await rejection(runMigrations({ target, files: [escaped] }))).code).toBe(
      "TRANSACTION_ESCAPED",
    );
  });
});
