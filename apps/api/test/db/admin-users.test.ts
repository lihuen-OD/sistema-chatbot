import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  createAdminUser,
  disableAdminUser,
  revokeAdminSessions,
  setAdminPassword,
  unlockAdminEmail,
} from "../../src/auth/admin-users.js";
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

afterAll(cleanup);

// Operaciones de la CLI de usuarios locales contra una base temporal (plan de P1-T4, §5.13).

describe("usuarios locales", () => {
  it("create: normaliza el email, aplica la política y rechaza duplicados", async () => {
    const db = await migratedDatabase();
    expect(await createAdminUser(db, fastHasher, "corta@example.com", "a".repeat(14))).toEqual({
      ok: false,
      problem: "TOO_SHORT",
    });
    expect(await createAdminUser(db, fastHasher, "larga@example.com", "a".repeat(129))).toEqual({
      ok: false,
      problem: "TOO_LONG",
    });
    expect(await createAdminUser(db, fastHasher, "sin-arroba", PASSWORD)).toEqual({
      ok: false,
      problem: "EMAIL_INVALID",
    });
    expect(await createAdminUser(db, fastHasher, " Admin@Example.com ", PASSWORD)).toEqual({
      ok: true,
    });
    expect(await createAdminUser(db, fastHasher, "admin@example.com", PASSWORD)).toEqual({
      ok: false,
      problem: "EMAIL_TAKEN",
    });
    const stored = await db.selectFrom("adminUsers").select("emailNormalized").execute();
    expect(stored).toEqual([{ emailNormalized: "admin@example.com" }]);
  });

  it("set-password, disable y revoke-sessions sobre un usuario inexistente", async () => {
    const db = await migratedDatabase();
    const missing = { ok: false, problem: "USER_NOT_FOUND" };
    expect(await setAdminPassword(db, fastHasher, "nadie@example.com", PASSWORD)).toEqual(missing);
    expect(await disableAdminUser(db, "nadie@example.com")).toEqual(missing);
    expect(await revokeAdminSessions(db, "nadie@example.com")).toEqual(missing);
  });

  it("revoke-sessions revoca todas las sesiones activas y dice cuántas", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db);
    const { baseUrl } = await apiWith(db);
    for (let i = 0; i < 3; i++) await new Browser(baseUrl).login("admin@example.com", PASSWORD);
    expect(await revokeAdminSessions(db, "admin@example.com")).toEqual({ ok: true, count: 3 });
    expect((await sessionsOf(db, userId)).map((session) => session.revokeReason)).toEqual([
      "ADMIN_REVOKED",
      "ADMIN_REVOKED",
      "ADMIN_REVOKED",
    ]);
    expect(await revokeAdminSessions(db, "admin@example.com")).toEqual({ ok: true, count: 0 });
  });

  it("disable impide el login; repetirlo no cambia nada", async () => {
    const db = await migratedDatabase();
    await createUser(db);
    const browser = new Browser((await apiWith(db)).baseUrl);
    expect(await disableAdminUser(db, "admin@example.com")).toEqual({ ok: true });
    expect(await disableAdminUser(db, "admin@example.com")).toEqual({ ok: true, count: 0 });
    expect((await browser.login("admin@example.com", PASSWORD)).status).toBe(401);
  });

  it("unlock limpia el límite persistente por email", async () => {
    const db = await migratedDatabase();
    await createUser(db);
    const limits = {
      perNetwork: { limit: 100, windowMs: 900_000 },
      perPair: { limit: 100, windowMs: 900_000 },
      perEmail: { limit: 2, windowMs: 3_600_000 },
    };
    const browser = new Browser((await apiWith(db, { limits })).baseUrl);
    await browser.login("admin@example.com", "incorrecta");
    await browser.login("admin@example.com", "incorrecta");
    expect((await browser.login("admin@example.com", PASSWORD)).status).toBe(429);
    expect(await unlockAdminEmail(db, "admin@example.com")).toEqual({ ok: true, count: 1 });
    expect((await browser.login("admin@example.com", PASSWORD)).status).toBe(200);
    expect(await unlockAdminEmail(db, "otro@example.com")).toEqual({ ok: true, count: 0 });
  });
});

describe("proceso de la CLI", () => {
  const cli = fileURLToPath(new URL("../../dist/cli/admin.js", import.meta.url));

  function runCli(
    args: string[],
    env: Record<string, string>,
  ): { status: number | null; stderr: string } {
    const result = spawnSync(process.execPath, [cli, ...args], {
      env: { PATH: process.env["PATH"] ?? "", ...env },
      encoding: "utf8",
      input: "",
      timeout: 15_000,
    });
    return { status: result.status, stderr: result.stderr };
  }

  it("rechaza APP_ENV=production antes de conectarse", () => {
    const result = runCli(["create", "--email", "admin@example.com"], { APP_ENV: "production" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("APP_ENV=production");
  });

  it("rechaza la contraseña como argumento", () => {
    const result = runCli(["create", "--email", "admin@example.com", "--password", PASSWORD], {
      APP_ENV: "development",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no se acepta como argumento");
    expect(result.stderr).not.toContain(PASSWORD);
  });
});
