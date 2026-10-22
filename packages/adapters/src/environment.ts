import { LOCAL_ADAPTER_ENVIRONMENTS, type LocalAdapterEnvironment } from "./types.js";

// Guardas de entorno (plan de P1-T5, §5). Los adaptadores locales solo existen en
// `development` y `test`. Cada fábrica pública recibe el entorno explícitamente y exige que
// `process.env.APP_ENV` esté definido y sea igual; las operaciones lo volverán a comprobar
// antes de actuar, para detectar un cambio posterior del entorno. Nadie publica el valor
// recibido ni el de `process.env`.

export { LOCAL_ADAPTER_ENVIRONMENTS };
export type { LocalAdapterEnvironment };

/** Código de error del catálogo de P1-T5 §5. Nunca va acompañado del valor en conflicto. */
export const ADAPTER_ENVIRONMENT_ERROR_CODE = "LOCAL_ADAPTER_FORBIDDEN_ENVIRONMENT" as const;

export type AdapterEnvironmentGuardReason =
  "EXPLICIT_ENVIRONMENT_FORBIDDEN" | "PROCESS_APP_ENV_MISSING" | "PROCESS_APP_ENV_MISMATCH";

export class AdapterEnvironmentError extends Error {
  readonly code: typeof ADAPTER_ENVIRONMENT_ERROR_CODE;
  readonly reason: AdapterEnvironmentGuardReason;

  constructor(reason: AdapterEnvironmentGuardReason) {
    super("Los adaptadores locales exigen un APP_ENV permitido, definido e igual al recibido.");
    this.name = "AdapterEnvironmentError";
    this.reason = reason;
    this.code = ADAPTER_ENVIRONMENT_ERROR_CODE;
  }
}

export function isLocalAdapterEnvironment(value: string): value is LocalAdapterEnvironment {
  return LOCAL_ADAPTER_ENVIRONMENTS.some((candidate) => candidate === value);
}

/**
 * Comprueba el entorno de una construcción o de una operación (plan §5.3 y §5.4):
 * - el valor recibido debe estar en la lista (`development` o `test`); cubre `production`,
 *   `staging`, valores desconocidos, variantes de mayúsculas y la cadena vacía;
 * - `process.env.APP_ENV` debe estar definido y ser igual, de modo que una llamada con
 *   `development` dentro de un proceso con otro entorno falla;
 * - un cambio posterior de `process.env.APP_ENV` lo detecta la llamada siguiente: no depende
 *   de una única comprobación al iniciar.
 */
export function assertLocalAdapterEnvironment(explicitAppEnv: string): LocalAdapterEnvironment {
  if (!isLocalAdapterEnvironment(explicitAppEnv)) {
    throw new AdapterEnvironmentError("EXPLICIT_ENVIRONMENT_FORBIDDEN");
  }
  const processAppEnv = process.env["APP_ENV"]?.trim();
  if (processAppEnv === undefined || processAppEnv === "") {
    throw new AdapterEnvironmentError("PROCESS_APP_ENV_MISSING");
  }
  if (processAppEnv !== explicitAppEnv) {
    throw new AdapterEnvironmentError("PROCESS_APP_ENV_MISMATCH");
  }
  return explicitAppEnv;
}
