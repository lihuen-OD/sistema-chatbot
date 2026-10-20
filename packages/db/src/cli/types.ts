// Genera o verifica los tipos de la base (ADR-010; plan de P1-T3, §5.8).
// Migra una base temporal vacía, la introspecciona con kysely-codegen y compara o escribe
// src/generated/database.ts. La conexión pasa por las guardas: kysely-codegen recibe una instancia
// de Kysely, no una URL, así que no lee DATABASE_URL ni el `.env`.
// Uso: pnpm db:types (escribe) y pnpm db:types:verify (falla si el archivo versionado difiere).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Kysely, PostgresDialect } from "kysely";
import { generate, PostgresDialect as CodegenPostgresDialect } from "kysely-codegen";
import pg from "pg";
import { loadLocalEnv } from "../env.js";
import { poolConfig, testAdminTarget, verifyClusterMarker } from "../guards.js";
import { MIGRATION_CONTROL_TABLES, runMigrations } from "../migrator.js";
import { TemporaryDatabases } from "../temporary-databases.js";

const GENERATED_FILE = fileURLToPath(new URL("../../src/generated/database.ts", import.meta.url));
const verify = process.argv.includes("--verify");

async function generatedTypes(): Promise<string> {
  const databases = new TemporaryDatabases(testAdminTarget(process.env));
  try {
    const target = await databases.create(1);
    await runMigrations({ target, applicationName: "sistema-chatbot-types" });
    const pool = new pg.Pool(poolConfig(target, "sistema-chatbot-types"));
    const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    try {
      await verifyClusterMarker(pool);
      return await generate({
        db,
        dialect: new CodegenPostgresDialect(),
        camelCase: true,
        excludePattern: `{${MIGRATION_CONTROL_TABLES.join(",")}}`,
        outFile: null,
      });
    } finally {
      await db.destroy();
    }
  } finally {
    await databases.dropAll();
    await databases.close();
  }
}

try {
  loadLocalEnv();
  const output = await generatedTypes();
  if (verify) {
    const current = await readFile(GENERATED_FILE, "utf8").catch(() => "");
    if (current === output) {
      console.log("Tipos de la base al día.");
    } else {
      console.error(
        "src/generated/database.ts no coincide con el esquema migrado. Ejecutá pnpm db:types.",
      );
      console.error(`----- salida de kysely-codegen -----\n${output}\n----- fin -----`);
      process.exitCode = 1;
    }
  } else {
    await writeFile(GENERATED_FILE, output);
    console.log(`Tipos generados en ${GENERATED_FILE}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
}
