import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

/** `.env` de la raíz del repositorio (desde `src/` o `dist/` de este paquete). */
export const ROOT_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

/**
 * Completa `env` con las variables del `.env` local que todavía no estén definidas. Las definidas
 * en el entorno, como las de la CI, tienen prioridad. Las guardas validan el resultado.
 */
export function loadLocalEnv(env: NodeJS.ProcessEnv = process.env, file = ROOT_ENV_FILE): void {
  if (!existsSync(file)) return;
  const values = parseEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (env[key] === undefined && value !== undefined) env[key] = value;
  }
}
