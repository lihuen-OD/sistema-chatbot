// Limpieza manual de bases temporales que quedaron de una ejecución interrumpida.
// Sin argumentos solo lista las bases sc_test_ del rol de pruebas. Para borrar, hay que nombrar
// cada base exacta: pnpm --filter @sistema-chatbot/db run test:cleanup -- --drop <nombre> …
// Solo se borran bases listadas, con nombre de base temporal y cuyo dueño es el rol de pruebas.
import { loadLocalEnv } from "../env.js";
import { assertTemporaryDatabaseName, testAdminTarget, verifyClusterMarker } from "../guards.js";
import { createPool } from "../pool.js";

async function main(): Promise<void> {
  loadLocalEnv();
  const dropIndex = process.argv.indexOf("--drop");
  const requested = dropIndex === -1 ? [] : process.argv.slice(dropIndex + 1);
  const pool = createPool(testAdminTarget(process.env), "sistema-chatbot-test-cleanup", 1);
  try {
    await verifyClusterMarker(pool);
    const result = await pool.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'sc\\_test\\_%' AND pg_get_userbyid(datdba) = current_user ORDER BY datname",
    );
    const owned = new Set(result.rows.map((row) => row.datname));
    if (requested.length === 0) {
      console.log(
        owned.size === 0
          ? "No hay bases temporales del rol de pruebas."
          : `Bases temporales del rol de pruebas:\n${[...owned].join("\n")}`,
      );
      return;
    }
    for (const name of requested) {
      assertTemporaryDatabaseName(name);
      if (!owned.has(name))
        throw new Error(`"${name}" no es una base temporal del rol de pruebas.`);
    }
    for (const name of requested) {
      await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log(`Borrada: ${name}`);
    }
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
}
