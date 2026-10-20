import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./generated/database.js";
import { poolConfig, verifyClusterMarker, type ConnectionTarget } from "./guards.js";

/**
 * Abre una conexión tipada con las guardas aplicadas: comprueba la marca del contenedor antes de
 * devolverla. Las columnas `snake_case` se exponen en camelCase, como en los tipos generados.
 */
export async function openDatabase(
  target: ConnectionTarget,
  applicationName: string,
): Promise<Kysely<DB>> {
  const pool = new pg.Pool(poolConfig(target, applicationName));
  try {
    await verifyClusterMarker(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });
}
