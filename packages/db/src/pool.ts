import pg from "pg";
import { poolConfig, type ConnectionTarget } from "./guards.js";

/**
 * Pool de `pg` con todos los parámetros explícitos (guardas). Registra un manejador de `error`:
 * pg-pool emite ese evento cuando el servidor termina un cliente inactivo, por ejemplo uno que se
 * estaba cerrando cuando se borra una base temporal con `DROP DATABASE … WITH (FORCE)`. Sin
 * manejador, el evento termina el proceso. pg-pool ya descartó ese cliente, y las consultas en
 * curso siguen rechazando con su propio error.
 */
export function createPool(target: ConnectionTarget, applicationName: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ ...poolConfig(target, applicationName), max });
  pool.on("error", () => undefined);
  return pool;
}
