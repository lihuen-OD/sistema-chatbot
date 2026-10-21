import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { disableAdminUser, setAdminPassword } from "../../src/auth/admin-users.js";
import { fastHasher } from "../support/fakes.js";
import { Browser } from "../support/http.js";
import {
  apiWith,
  cleanup,
  createUser,
  migratedDatabase,
  PASSWORD,
  sessionsOf,
} from "./support/database.js";
import { holdLocks, waitForLockWaiters } from "./support/locks.js";

afterAll(cleanup);

// Orden de bloqueos entre el login con cookie previa y la desactivación o el cambio de contraseña
// (revisión del 21/10/2026). Todas las transacciones toman primero las filas de admin_users y
// después las de admin_sessions. Las pruebas fuerzan el cruce: una transacción retiene la fila del
// usuario, la desactivación (o el cambio de contraseña) queda primera en la cola y el login con la
// cookie previa llega después. Con el orden invertido, el login retenía la sesión previa mientras
// esperaba al usuario, y la desactivación esperaba esa sesión: deadlock.

const EMAIL = "admin@example.com";

async function activeSessions(db: Awaited<ReturnType<typeof migratedDatabase>>, userId: string) {
  return (await sessionsOf(db, userId)).filter((session) => session.revokeReason === null);
}

describe("login con cookie previa concurrente con cambios de credenciales", () => {
  it("con la desactivación: termina sin deadlock, el login falla y no queda sesión", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db, EMAIL);
    const browser = new Browser((await apiWith(db)).baseUrl);
    expect((await browser.login(EMAIL, PASSWORD)).status).toBe(200);

    const blocker = await holdLocks(
      db,
      sql`SELECT 1 FROM admin_users WHERE id = ${userId} FOR UPDATE`,
    );
    const disabling = disableAdminUser(db, EMAIL);
    await waitForLockWaiters(db, 1);
    const login = browser.login(EMAIL, PASSWORD);
    await waitForLockWaiters(db, 2);
    await blocker.release();

    await expect(disabling).resolves.toEqual({ ok: true });
    expect((await login).status).toBe(401);
    expect(await activeSessions(db, userId)).toEqual([]);
    expect((await browser.me()).status).toBe(401);
  });

  it("con el cambio de contraseña: termina sin deadlock, el login falla y no queda sesión", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db, EMAIL);
    const browser = new Browser((await apiWith(db)).baseUrl);
    expect((await browser.login(EMAIL, PASSWORD)).status).toBe(200);

    const blocker = await holdLocks(
      db,
      sql`SELECT 1 FROM admin_users WHERE id = ${userId} FOR UPDATE`,
    );
    const changing = setAdminPassword(db, fastHasher, EMAIL, `${PASSWORD} nueva`);
    await waitForLockWaiters(db, 1);
    const login = browser.login(EMAIL, PASSWORD);
    await waitForLockWaiters(db, 2);
    await blocker.release();

    await expect(changing).resolves.toEqual({ ok: true });
    expect((await login).status).toBe(401);
    expect(await activeSessions(db, userId)).toEqual([]);
  });

  it("la cookie previa de otro usuario que se desactiva: el login sigue y esa sesión queda revocada", async () => {
    const db = await migratedDatabase();
    const userA = await createUser(db, "a@example.com");
    const userB = await createUser(db, "b@example.com");
    const browser = new Browser((await apiWith(db)).baseUrl);
    expect((await browser.login("b@example.com", PASSWORD)).status).toBe(200);

    const blocker = await holdLocks(
      db,
      sql`SELECT 1 FROM admin_users WHERE id = ${userB} FOR UPDATE`,
    );
    const disabling = disableAdminUser(db, "b@example.com");
    await waitForLockWaiters(db, 1);
    const login = browser.login("a@example.com", PASSWORD);
    await blocker.release();

    await expect(disabling).resolves.toEqual({ ok: true });
    expect((await login).status).toBe(200);
    expect(await activeSessions(db, userB)).toEqual([]);
    expect(await activeSessions(db, userA)).toHaveLength(1);
    expect((await browser.me()).body).toMatchObject({ user: { email: "a@example.com" } });
  });

  it("si la fila del usuario sigue bloqueada, el login termina con 503 y sin sesión", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db, EMAIL);
    const browser = new Browser((await apiWith(db, { sessionLockTimeoutMs: 300 })).baseUrl);

    const blocker = await holdLocks(
      db,
      sql`SELECT 1 FROM admin_users WHERE id = ${userId} FOR UPDATE`,
    );
    const response = await browser.login(EMAIL, PASSWORD);
    await blocker.release();

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(await sessionsOf(db, userId)).toEqual([]);
    expect((await browser.login(EMAIL, PASSWORD)).status).toBe(200);
  });
});
