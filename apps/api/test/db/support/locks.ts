import { sql, type RawBuilder } from "kysely";
import type { Database } from "../../../src/auth/store.js";

// Bloqueos controlados para pruebas de concurrencia deterministas: una transacción que retiene
// filas hasta que la prueba la libera, y una espera sin pausas fijas hasta que haya N
// conexiones de la base esperando un bloqueo.

/** Abre una transacción, ejecuta `statement` y retiene sus bloqueos hasta `release()`. */
export async function holdLocks(
  db: Database,
  statement: RawBuilder<unknown>,
): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const acquired = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const done = db.connection().execute(async (connection) => {
    await sql`BEGIN`.execute(connection);
    await statement.execute(connection);
    ready();
    await released;
    await sql`ROLLBACK`.execute(connection);
  });
  await acquired;
  return {
    release: async () => {
      release();
      await done;
    },
  };
}

/** Espera a que `count` conexiones de esta base estén esperando un bloqueo. */
export async function waitForLockWaiters(
  db: Database,
  count: number,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await sql<{ waiting: number }>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`.execute(db);
    if ((rows[0]?.waiting ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`No hubo ${String(count)} esperas de bloqueo.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
