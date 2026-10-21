import { afterAll, describe, expect, it } from "vitest";
import { disableAdminUser, setAdminPassword } from "../../src/auth/admin-users.js";
import { fastHasher, gatedHasher } from "../support/fakes.js";
import { Browser } from "../support/http.js";
import {
  apiWith,
  cleanup,
  createUser,
  migratedDatabase,
  PASSWORD,
  sessionsOf,
} from "./support/database.js";

afterAll(cleanup);

// Login concurrente con desactivación o cambio de contraseña (ADR-015). La contraseña se verifica
// con la versión de credenciales leída antes; la base solo inserta la sesión si esa versión sigue
// vigente y el usuario está activo, bloqueando la fila del usuario durante la inserción.

describe("login concurrente con cambios de credenciales", () => {
  it("si el usuario se desactiva mientras se verifica la contraseña, no queda sesión", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db);
    const hasher = gatedHasher();
    const browser = new Browser((await apiWith(db, { hasher })).baseUrl);

    const pending = browser.login("admin@example.com", PASSWORD);
    await hasher.waitForEntered(1);
    expect(await disableAdminUser(db, "admin@example.com")).toEqual({ ok: true });
    hasher.release();

    expect((await pending).status).toBe(401);
    expect(browser.cookie("sc_dev_session")).toBeUndefined();
    expect(await sessionsOf(db, userId)).toEqual([]);
  });

  it("si la contraseña cambia mientras se verifica la anterior, no queda sesión", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db);
    const hasher = gatedHasher();
    const browser = new Browser((await apiWith(db, { hasher })).baseUrl);

    const pending = browser.login("admin@example.com", PASSWORD);
    await hasher.waitForEntered(1);
    const next = `${PASSWORD} cambiada`;
    expect(await setAdminPassword(db, fastHasher, "admin@example.com", next)).toEqual({ ok: true });
    hasher.release();

    expect((await pending).status).toBe(401);
    expect(await sessionsOf(db, userId)).toEqual([]);
    expect((await browser.login("admin@example.com", PASSWORD)).status).toBe(401);
    expect((await browser.login("admin@example.com", next)).status).toBe(200);
  });

  it("si la sesión se creó antes, el cambio la revoca y la sesión deja de servir", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db);
    const browser = new Browser((await apiWith(db)).baseUrl);
    expect((await browser.login("admin@example.com", PASSWORD)).status).toBe(200);

    await setAdminPassword(db, fastHasher, "admin@example.com", `${PASSWORD} cambiada`);
    expect((await browser.me()).status).toBe(401);
    expect((await sessionsOf(db, userId)).map((session) => session.revokeReason)).toEqual([
      "PASSWORD_CHANGED",
    ]);
  });

  it("varios logins concurrentes con una desactivación nunca dejan una sesión activa", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db);
    const hasher = gatedHasher();
    const { baseUrl } = await apiWith(db, { hasher });
    const browsers = Array.from({ length: 4 }, () => new Browser(baseUrl));

    const pending = browsers.map((browser) => browser.login("admin@example.com", PASSWORD));
    await hasher.waitForEntered(2);
    const disabling = disableAdminUser(db, "admin@example.com");
    hasher.release();
    await disabling;
    await Promise.all(pending);

    const active = (await sessionsOf(db, userId)).filter(
      (session) => session.revokeReason === null,
    );
    expect(active).toEqual([]);
    for (const browser of browsers) expect((await browser.me()).status).toBe(401);
  });
});
