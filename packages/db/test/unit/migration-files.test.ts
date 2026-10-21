import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MigrationIntegrityError, migrationFile, readMigrationFiles } from "../../src/migrator.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function directoryWith(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sc-migraciones-"));
  directories.push(directory);
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(directory, name), contents);
  }
  return directory;
}

async function integrityError(operation: Promise<unknown>): Promise<MigrationIntegrityError> {
  const error = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(MigrationIntegrityError);
  return error as MigrationIntegrityError;
}

describe("archivos de migración", () => {
  it("las migraciones del repositorio, con triggers PL/pgSQL, pasan la validación", async () => {
    const files = await readMigrationFiles();
    expect(files.map((file) => file.name)).toEqual([
      "0001_base",
      "0002_versions",
      "0003_submissions",
      "0004_effects",
      "0005_candidates_no_delete",
      "0006_admin_auth",
    ]);
    expect(files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true);
  });

  it("calcula el checksum sobre los bytes del archivo", () => {
    const contents = Buffer.from("CREATE TABLE a (id integer);\r\n");
    expect(migrationFile("0001_a.sql", contents).sha256).toBe(
      createHash("sha256").update(contents).digest("hex"),
    );
  });

  it("exige nombres NNNN_descripcion.sql", () => {
    for (const name of ["1_a.sql", "0001-a.sql", "0001_A.sql", "0001_a.SQL"]) {
      let code: string | undefined;
      try {
        migrationFile(name, Buffer.from("SELECT 1;"));
      } catch (error) {
        code = error instanceof MigrationIntegrityError ? error.code : undefined;
      }
      expect(code, name).toBe("INVALID_FILE_NAME");
    }
  });

  it("rechaza números de versión repetidos", async () => {
    const directory = await directoryWith({
      "0001_a.sql": "SELECT 1;",
      "0001_b.sql": "SELECT 2;",
    });
    expect((await integrityError(readMigrationFiles(directory))).code).toBe("DUPLICATE_VERSION");
  });

  it("rechaza un archivo con control de transacciones e indica archivo y línea", async () => {
    const directory = await directoryWith({
      "0001_a.sql": "CREATE TABLE a (id integer);\nCOMMIT;\n",
    });
    const error = await integrityError(readMigrationFiles(directory));
    expect(error.code).toBe("INVALID_SQL");
    expect(error.message).toContain("0001_a.sql");
    expect(error.message).toContain("Línea 2");
  });

  it("ignora archivos que no son .sql", async () => {
    const directory = await directoryWith({ "0001_a.sql": "SELECT 1;", "LEEME.md": "notas" });
    expect((await readMigrationFiles(directory)).map((file) => file.name)).toEqual(["0001_a"]);
  });
});
