import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { expect, inject } from "vitest";
import { loadLocalEnv } from "../../../src/env.js";
import {
  poolConfig,
  testAdminTarget,
  verifyClusterMarker,
  type ConnectionTarget,
} from "../../../src/guards.js";
import { TemporaryDatabases } from "../../../src/temporary-databases.js";

// Bases y conexiones de un archivo de pruebas. Cada archivo clona sus bases desde la plantilla de
// la ejecución y, en afterAll, cierra sus conexiones y borra solo las bases que creó.

loadLocalEnv();
const run = inject("database");
const clients: pg.Client[] = [];
let databases: TemporaryDatabases | undefined;

/** Base `sc_test_<runId>_<n>` migrada (clon de la plantilla) o vacía (desde template0). */
export async function createTestDatabase(
  options: { readonly migrated?: boolean } = {},
): Promise<ConnectionTarget> {
  databases ??= new TemporaryDatabases(testAdminTarget(process.env), run.runId);
  return databases.create(undefined, options.migrated === false ? "template0" : run.template);
}

export async function connect(
  target: ConnectionTarget,
  applicationName = "sistema-chatbot-test",
): Promise<pg.Client> {
  const client = new pg.Client(poolConfig(target, applicationName));
  await client.connect();
  clients.push(client);
  await verifyClusterMarker(client);
  return client;
}

export async function cleanupDatabases(): Promise<void> {
  for (const client of clients.splice(0)) {
    await client.end().catch(() => undefined);
  }
  await databases?.dropAll();
  await databases?.close();
}

/**
 * Inicia una operación que va a quedar bloqueada. Marca su rechazo como manejado para que la
 * prueba pueda comprobarlo después, cuando libere el bloqueo.
 */
export function started<T>(operation: Promise<T>): Promise<T> {
  operation.catch(() => undefined);
  return operation;
}

/** Espera, sin pausas fijas, a que alguna conexión con ese nombre quede bloqueada. */
export async function waitUntilBlocked(
  observer: pg.Client,
  applicationName: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await observer.query<{ blocked: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock') AS blocked",
      [applicationName],
    );
    if (rows[0]?.blocked === true) return;
    if (Date.now() > deadline) throw new Error(`${applicationName} no quedó esperando un bloqueo.`);
    await delay(20);
  }
}

export interface ExpectedDatabaseError {
  /** SQLSTATE: 23505 único, 23514 CHECK, 23503 clave foránea, 23502 NOT NULL, 23000 trigger. */
  readonly code: string;
  readonly constraint?: string;
}

/** La operación falla con ese SQLSTATE y esa restricción. */
export async function expectDatabaseError(
  operation: Promise<unknown>,
  expected: ExpectedDatabaseError,
): Promise<void> {
  const error = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, "se esperaba un error de la base").toBeInstanceOf(pg.DatabaseError);
  const { code, constraint } = error as pg.DatabaseError;
  expect({ code, constraint }).toEqual({
    code: expected.code,
    constraint: expected.constraint ?? constraint,
  });
}
