// Aplica las migraciones pendientes a la base de desarrollo (DATABASE_URL).
// Uso: pnpm db:migrate
import { loadLocalEnv } from "../env.js";
import { developmentTarget } from "../guards.js";
import { runMigrations } from "../migrator.js";

try {
  loadLocalEnv();
  const { applied } = await runMigrations({ target: developmentTarget(process.env) });
  console.log(
    applied.length === 0
      ? "Sin migraciones pendientes."
      : `Migraciones aplicadas: ${applied.join(", ")}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
}
