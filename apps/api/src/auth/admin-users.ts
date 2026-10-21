import { sql } from "kysely";
import { emailKeyHash, isValidEmail, normalizeEmail } from "./email.js";
import {
  passwordPolicyProblem,
  type PasswordHasher,
  type PasswordPolicyProblem,
} from "./passwords.js";
import { clearEmailThrottle, constraintOf, type Database } from "./store.js";

// Operaciones del operador local sobre usuarios administrativos (plan de P1-T4, §5.13). Las usa la
// CLI `admin`; no hay registro público ni endpoints para esto en P1. La revocación de sesiones al
// cambiar la contraseña o desactivar la hace la base, en la misma transacción.

export type AdminUserResult =
  | { readonly ok: true; readonly count?: number }
  | {
      readonly ok: false;
      readonly problem: "EMAIL_INVALID" | "EMAIL_TAKEN" | "USER_NOT_FOUND" | PasswordPolicyProblem;
    };

export async function createAdminUser(
  db: Database,
  hasher: PasswordHasher,
  email: string,
  password: string,
): Promise<AdminUserResult> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) return { ok: false, problem: "EMAIL_INVALID" };
  const policy = passwordPolicyProblem(password);
  if (policy !== undefined) return { ok: false, problem: policy };
  try {
    await db
      .insertInto("adminUsers")
      .values({ emailNormalized: normalized, passwordHash: await hasher.hash(password) })
      .execute();
  } catch (error) {
    if (constraintOf(error) === "admin_users_email_unique") {
      return { ok: false, problem: "EMAIL_TAKEN" };
    }
    throw error;
  }
  return { ok: true };
}

/** Cambia la contraseña. La base sube la versión de credenciales y revoca todas las sesiones. */
export async function setAdminPassword(
  db: Database,
  hasher: PasswordHasher,
  email: string,
  password: string,
): Promise<AdminUserResult> {
  const policy = passwordPolicyProblem(password);
  if (policy !== undefined) return { ok: false, problem: policy };
  const passwordHash = await hasher.hash(password);
  const result = await db
    .updateTable("adminUsers")
    .set({ passwordHash, passwordChangedAt: sql<Date>`clock_timestamp()` })
    .where("emailNormalized", "=", normalizeEmail(email))
    .executeTakeFirst();
  return result.numUpdatedRows > 0n ? { ok: true } : { ok: false, problem: "USER_NOT_FOUND" };
}

/** Desactiva el usuario. La base revoca sus sesiones (USER_DISABLED). */
export async function disableAdminUser(db: Database, email: string): Promise<AdminUserResult> {
  const normalized = normalizeEmail(email);
  const result = await db
    .updateTable("adminUsers")
    .set({ status: "DISABLED", disabledAt: sql<Date>`now()` })
    .where("emailNormalized", "=", normalized)
    .where("status", "=", "ACTIVE")
    .executeTakeFirst();
  if (result.numUpdatedRows > 0n) return { ok: true };
  const exists = await db
    .selectFrom("adminUsers")
    .select("id")
    .where("emailNormalized", "=", normalized)
    .executeTakeFirst();
  return exists === undefined ? { ok: false, problem: "USER_NOT_FOUND" } : { ok: true, count: 0 };
}

/** Revoca todas las sesiones activas del usuario (ADMIN_REVOKED). Devuelve cuántas revocó. */
export async function revokeAdminSessions(db: Database, email: string): Promise<AdminUserResult> {
  const user = await db
    .selectFrom("adminUsers")
    .select("id")
    .where("emailNormalized", "=", normalizeEmail(email))
    .executeTakeFirst();
  if (user === undefined) return { ok: false, problem: "USER_NOT_FOUND" };
  const result = await db
    .updateTable("adminSessions")
    .set({ revokedAt: sql<Date>`now()`, revokeReason: "ADMIN_REVOKED" })
    .where("userId", "=", user.id)
    .where("revokedAt", "is", null)
    .executeTakeFirst();
  return { ok: true, count: Number(result.numUpdatedRows) };
}

/**
 * Limpia el límite persistente por email. Los límites en memoria (por red y por par) son del
 * proceso de la API: vencen solos en su ventana o al reiniciarla.
 */
export async function unlockAdminEmail(db: Database, email: string): Promise<AdminUserResult> {
  const cleared = await clearEmailThrottle(db, emailKeyHash(normalizeEmail(email)));
  return { ok: true, count: cleared ? 1 : 0 };
}
