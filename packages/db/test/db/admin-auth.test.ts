import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupDatabases,
  connect,
  createTestDatabase,
  expectDatabaseError,
  started,
  waitUntilBlocked,
} from "./support/database.js";

afterAll(cleanupDatabases);

// Migración 0006 (P1-T4, ADR-015): usuarios administrativos, sesiones y límite de intentos.

const HASH = `$argon2id$v=19$m=65536,t=3,p=4$${"A".repeat(22)}$${"B".repeat(43)}`;
const REHASHED = `$argon2id$v=19$m=65536,t=4,p=4$${"C".repeat(22)}$${"D".repeat(43)}`;

async function freshDatabase(): Promise<{
  client: pg.Client;
  target: Awaited<ReturnType<typeof createTestDatabase>>;
}> {
  const target = await createTestDatabase();
  return { client: await connect(target), target };
}

async function insertUser(client: pg.Client, email = "admin@example.com"): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO admin_users (email_normalized, password_hash) VALUES ($1, $2) RETURNING id",
    [email, HASH],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("La inserción no devolvió id.");
  return id;
}

async function credentialVersion(client: pg.Client, userId: string): Promise<number> {
  const { rows } = await client.query<{ credential_version: number }>(
    "SELECT credential_version FROM admin_users WHERE id = $1",
    [userId],
  );
  return rows[0]?.credential_version ?? -1;
}

async function insertSession(
  client: pg.Client,
  userId: string,
  version: number,
  options: { tokenHash?: Buffer; revoked?: boolean } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO admin_sessions (user_id, token_hash, credential_version, created_at, last_seen_at,
       idle_expires_at, absolute_expires_at, revoked_at, revoke_reason)
     VALUES ($1, $2, $3, now(), now(), now() + interval '30 minutes', now() + interval '8 hours',
       CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN 'LOGOUT' END)
     RETURNING id`,
    [userId, options.tokenHash ?? randomBytes(32), version, options.revoked ?? false],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("La inserción no devolvió id.");
  return id;
}

async function sessionState(
  client: pg.Client,
  sessionId: string,
): Promise<{ revoked: boolean; reason: string | null }> {
  const { rows } = await client.query<{ revoked: boolean; revoke_reason: string | null }>(
    "SELECT revoked_at IS NOT NULL AS revoked, revoke_reason FROM admin_sessions WHERE id = $1",
    [sessionId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("No existe la sesión.");
  return { revoked: row.revoked, reason: row.revoke_reason };
}

describe("admin_users", () => {
  it("email normalizado único, con forma válida y sin mayúsculas", async () => {
    const { client } = await freshDatabase();
    await insertUser(client, "admin@example.com");
    await expectDatabaseError(insertUser(client, "admin@example.com"), {
      code: "23505",
      constraint: "admin_users_email_unique",
    });
    for (const email of ["Admin@example.com", "sin-arroba", "a b@example.com", "x@"]) {
      await expectDatabaseError(insertUser(client, email), {
        code: "23514",
        constraint: "admin_users_email_format",
      });
    }
  });

  it("el hash de la contraseña es una cadena PHC de Argon2id", async () => {
    const { client } = await freshDatabase();
    for (const hash of ["texto-plano", HASH.replace("argon2id", "argon2i"), "$argon2id$v=19$"]) {
      await expectDatabaseError(
        client.query("INSERT INTO admin_users (email_normalized, password_hash) VALUES ($1, $2)", [
          "admin@example.com",
          hash,
        ]),
        { code: "23514", constraint: "admin_users_password_hash_format" },
      );
    }
  });

  it("un usuario no se borra ni se vacía la tabla", async () => {
    const { client } = await freshDatabase();
    const userId = await insertUser(client);
    await expectDatabaseError(client.query("DELETE FROM admin_users WHERE id = $1", [userId]), {
      code: "23000",
      constraint: "admin_users_no_delete",
    });
    await expectDatabaseError(client.query("TRUNCATE admin_users CASCADE"), {
      code: "23000",
      constraint: "admin_users_no_delete",
    });
  });

  it("estado y fecha de desactivación coherentes; el email no cambia", async () => {
    const { client } = await freshDatabase();
    const userId = await insertUser(client);
    await expectDatabaseError(
      client.query("UPDATE admin_users SET status = 'DISABLED' WHERE id = $1", [userId]),
      { code: "23514", constraint: "admin_users_disabled_coherent" },
    );
    await expectDatabaseError(
      client.query("UPDATE admin_users SET email_normalized = 'otro@example.com' WHERE id = $1", [
        userId,
      ]),
      { code: "23000", constraint: "admin_users_fixed_columns" },
    );
  });

  it("la versión de credenciales sube con la contraseña o el estado, no con un rehash", async () => {
    const { client } = await freshDatabase();
    const userId = await insertUser(client);
    expect(await credentialVersion(client, userId)).toBe(1);

    await client.query("UPDATE admin_users SET password_hash = $2 WHERE id = $1", [
      userId,
      REHASHED,
    ]);
    expect(await credentialVersion(client, userId)).toBe(1);

    await client.query(
      "UPDATE admin_users SET password_hash = $2, password_changed_at = now() + interval '1 second' WHERE id = $1",
      [userId, HASH],
    );
    expect(await credentialVersion(client, userId)).toBe(2);

    await client.query(
      "UPDATE admin_users SET status = 'DISABLED', disabled_at = now() WHERE id = $1",
      [userId],
    );
    expect(await credentialVersion(client, userId)).toBe(3);

    await expectDatabaseError(
      client.query("UPDATE admin_users SET credential_version = 10 WHERE id = $1", [userId]),
      { code: "23000", constraint: "admin_users_credential_version_managed" },
    );
  });
});

describe("admin_sessions", () => {
  it("desactivar revoca las sesiones activas con USER_DISABLED", async () => {
    const { client } = await freshDatabase();
    const userId = await insertUser(client);
    const other = await insertUser(client, "otro@example.com");
    const first = await insertSession(client, userId, 1);
    const second = await insertSession(client, userId, 1);
    const unrelated = await insertSession(client, other, 1);

    await client.query(
      "UPDATE admin_users SET status = 'DISABLED', disabled_at = now() WHERE id = $1",
      [userId],
    );
    expect(await sessionState(client, first)).toEqual({ revoked: true, reason: "USER_DISABLED" });
    expect(await sessionState(client, second)).toEqual({ revoked: true, reason: "USER_DISABLED" });
    expect(await sessionState(client, unrelated)).toEqual({ revoked: false, reason: null });
  });

  it("cambiar la contraseña revoca con PASSWORD_CHANGED; un rehash no revoca", async () => {
    const { client } = await freshDatabase();
    const userId = await insertUser(client);
    const session = await insertSession(client, userId, 1);

    await client.query("UPDATE admin_users SET password_hash = $2 WHERE id = $1", [
      userId,
      REHASHED,
    ]);
    expect(await sessionState(client, session)).toEqual({ revoked: false, reason: null });

    await client.query(
      "UPDATE admin_users SET password_changed_at = now() + interval '1 second' WHERE id = $1",
      [userId],
    );
    expect(await sessionState(client, session)).toEqual({
      revoked: true,
      reason: "PASSWORD_CHANGED",
    });
  });

  it("una sesión nace activa, de un usuario activo y con la versión vigente", async () => {
    const { client } = await freshDatabase();
    const userId = await insertUser(client);
    await expectDatabaseError(insertSession(client, userId, 1, { revoked: true }), {
      code: "23000",
      constraint: "admin_sessions_insert_active",
    });
    await expectDatabaseError(insertSession(client, userId, 2), {
      code: "23000",
      constraint: "admin_sessions_credentials_current",
    });
    await client.query(
      "UPDATE admin_users SET status = 'DISABLED', disabled_at = now() WHERE id = $1",
      [userId],
    );
    await expectDatabaseError(insertSession(client, userId, 2), {
      code: "23000",
      constraint: "admin_sessions_user_active",
    });
  });

  it("token único de 32 bytes, vencimientos ordenados y motivo de revocación válido", async () => {
    const { client } = await freshDatabase();
    const userId = await insertUser(client);
    const tokenHash = randomBytes(32);
    await insertSession(client, userId, 1, { tokenHash });
    await expectDatabaseError(insertSession(client, userId, 1, { tokenHash }), {
      code: "23505",
      constraint: "admin_sessions_token_hash_unique",
    });
    await expectDatabaseError(insertSession(client, userId, 1, { tokenHash: randomBytes(16) }), {
      code: "23514",
      constraint: "admin_sessions_token_hash_length",
    });
    await expectDatabaseError(
      client.query(
        `INSERT INTO admin_sessions (user_id, token_hash, credential_version, created_at,
           last_seen_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, 1, now(), now(), now() + interval '9 hours', now() + interval '8 hours')`,
        [userId, randomBytes(32)],
      ),
      { code: "23514", constraint: "admin_sessions_expiry_order" },
    );
    const session = await insertSession(client, userId, 1);
    await expectDatabaseError(
      client.query(
        "UPDATE admin_sessions SET revoked_at = now(), revoke_reason = 'OTRO' WHERE id = $1",
        [session],
      ),
      { code: "23514", constraint: "admin_sessions_revoke_reason_check" },
    );
  });

  it("columnas fijas; una sesión revocada no se modifica", async () => {
    const { client } = await freshDatabase();
    const userId = await insertUser(client);
    const session = await insertSession(client, userId, 1);
    await expectDatabaseError(
      client.query("UPDATE admin_sessions SET token_hash = $2 WHERE id = $1", [
        session,
        randomBytes(32),
      ]),
      { code: "23000", constraint: "admin_sessions_fixed_columns" },
    );
    await client.query(
      "UPDATE admin_sessions SET revoked_at = now(), revoke_reason = 'LOGOUT' WHERE id = $1",
      [session],
    );
    for (const change of [
      "revoked_at = NULL, revoke_reason = NULL",
      "revoke_reason = 'ADMIN_REVOKED'",
      "last_seen_at = last_seen_at + interval '1 second'",
    ]) {
      await expectDatabaseError(
        client.query(`UPDATE admin_sessions SET ${change} WHERE id = $1`, [session]),
        { code: "23000", constraint: "admin_sessions_revoked_final" },
      );
    }
  });
});

describe("login concurrente con desactivación o cambio de contraseña", () => {
  it("la desactivación espera a la sesión en curso y después la revoca", async () => {
    const { client, target } = await freshDatabase();
    const userId = await insertUser(client);
    const login = await connect(target, "test-admin-login");
    const admin = await connect(target, "test-admin-disable");

    await login.query("BEGIN");
    const session = await insertSession(login, userId, 1);
    const disabling = started(
      admin.query("UPDATE admin_users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [
        userId,
      ]),
    );
    await waitUntilBlocked(client, "test-admin-disable");
    await login.query("COMMIT");
    await disabling;

    expect(await sessionState(client, session)).toEqual({ revoked: true, reason: "USER_DISABLED" });
  });

  it("un login que verificó antes de una desactivación confirmada no crea la sesión", async () => {
    const { client, target } = await freshDatabase();
    const userId = await insertUser(client);
    const verifiedVersion = await credentialVersion(client, userId);
    const login = await connect(target, "test-admin-login");
    const admin = await connect(target, "test-admin-disable");

    await admin.query("BEGIN");
    await admin.query(
      "UPDATE admin_users SET status = 'DISABLED', disabled_at = now() WHERE id = $1",
      [userId],
    );
    const inserting = started(insertSession(login, userId, verifiedVersion));
    await waitUntilBlocked(client, "test-admin-login");
    await admin.query("COMMIT");

    await expectDatabaseError(inserting, {
      code: "23000",
      constraint: "admin_sessions_user_active",
    });
    const { rows } = await client.query("SELECT 1 FROM admin_sessions WHERE user_id = $1", [
      userId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("un login que verificó la contraseña anterior no crea la sesión después del cambio", async () => {
    const { client, target } = await freshDatabase();
    const userId = await insertUser(client);
    const verifiedVersion = await credentialVersion(client, userId);
    const login = await connect(target, "test-admin-login");
    const admin = await connect(target, "test-admin-password");

    await admin.query("BEGIN");
    await admin.query(
      "UPDATE admin_users SET password_hash = $2, password_changed_at = now() + interval '1 second' WHERE id = $1",
      [userId, REHASHED],
    );
    const inserting = started(insertSession(login, userId, verifiedVersion));
    await waitUntilBlocked(client, "test-admin-login");
    await admin.query("COMMIT");

    await expectDatabaseError(inserting, {
      code: "23000",
      constraint: "admin_sessions_credentials_current",
    });
  });
});

describe("admin_login_throttle", () => {
  it("clave de 32 bytes y contador no negativo", async () => {
    const { client } = await freshDatabase();
    await expectDatabaseError(
      client.query(
        "INSERT INTO admin_login_throttle (key_hash, failures, window_started_at) VALUES ($1, 1, now())",
        [randomBytes(31)],
      ),
      { code: "23514", constraint: "admin_login_throttle_key_length" },
    );
    await expectDatabaseError(
      client.query(
        "INSERT INTO admin_login_throttle (key_hash, failures, window_started_at) VALUES ($1, -1, now())",
        [randomBytes(32)],
      ),
      { code: "23514", constraint: "admin_login_throttle_failures_check" },
    );
  });
});
