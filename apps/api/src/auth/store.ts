import type { DB } from "@sistema-chatbot/db";
import { sql, type Kysely } from "kysely";
import type { Admission, WindowLimit } from "./limiters.js";

// Acceso a la base de la autenticación administrativa (migración 0006). Las invariantes viven en
// la base: revocación al desactivar o cambiar la contraseña, y sesiones solo con credenciales
// vigentes de un usuario activo.

export type Database = Kysely<DB>;

export type RevokeReason =
  "LOGOUT" | "LOGIN_REPLACED" | "PASSWORD_CHANGED" | "USER_DISABLED" | "ADMIN_REVOKED";

export interface StoredUser {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly status: string;
  readonly credentialVersion: number;
}

export async function findUserByEmail(
  db: Database,
  email: string,
): Promise<StoredUser | undefined> {
  return db
    .selectFrom("adminUsers")
    .select(["id", "emailNormalized as email", "passwordHash", "status", "credentialVersion"])
    .where("emailNormalized", "=", email)
    .executeTakeFirst();
}

/** Las credenciales cambiaron (o el usuario se desactivó) después de verificarse la contraseña. */
export class StaleCredentialsError extends Error {
  constructor() {
    super("Las credenciales cambiaron durante el login.");
    this.name = "StaleCredentialsError";
  }
}

export interface NewSession {
  readonly userId: string;
  readonly credentialVersion: number;
  readonly tokenHash: Buffer;
  readonly now: Date;
  readonly idleMs: number;
  readonly absoluteMs: number;
  /** Sesión que traía la petición: se revoca en la misma transacción (LOGIN_REPLACED). */
  readonly replacedTokenHash?: Buffer;
  /** Espera máxima por bloqueos dentro de la transacción (`lock_timeout`). */
  readonly lockTimeoutMs: number;
}

/** La transacción no obtuvo sus bloqueos dentro del plazo: no se creó la sesión. */
export class SessionLockTimeoutError extends Error {
  constructor() {
    super("No se obtuvieron los bloqueos de la sesión a tiempo.");
    this.name = "SessionLockTimeoutError";
  }
}

/**
 * Crea la sesión en una transacción con un orden de bloqueos fijo (ADR-015), el mismo que usan la
 * desactivación y el cambio de contraseña: primero las filas de admin_users y después las de
 * admin_sessions.
 *   1. Bloquea con FOR SHARE, en orden de id, al usuario que inicia sesión y, si la cookie previa
 *      es de otro usuario, también a ese. Comprueba que las credenciales verificadas sigan
 *      vigentes antes de tocar sesiones.
 *   2. Revoca la sesión previa (LOGIN_REPLACED), si sigue activa.
 *   3. Inserta la sesión nueva. El trigger vuelve a comprobar al usuario con FOR SHARE, que ya
 *      tiene tomado.
 * Con el orden inverso, el login retenía la sesión previa mientras esperaba al usuario, y una
 * desactivación concurrente retenía al usuario mientras esperaba esa sesión: deadlock.
 */
export async function createSession(db: Database, input: NewSession): Promise<string> {
  const absolute = new Date(input.now.getTime() + input.absoluteMs);
  const idle = new Date(Math.min(input.now.getTime() + input.idleMs, absolute.getTime()));
  try {
    return await db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('lock_timeout', ${`${String(input.lockTimeoutMs)}ms`}, true)`.execute(
        trx,
      );
      const previous =
        input.replacedTokenHash === undefined
          ? undefined
          : await trx
              .selectFrom("adminSessions")
              .select("userId")
              .where("tokenHash", "=", input.replacedTokenHash)
              .executeTakeFirst();
      const userIds = [...new Set([input.userId, previous?.userId ?? input.userId])].sort();
      for (const id of userIds) {
        const user = await trx
          .selectFrom("adminUsers")
          .select(["status", "credentialVersion"])
          .where("id", "=", id)
          .forShare()
          .executeTakeFirst();
        if (
          id === input.userId &&
          (user?.status !== "ACTIVE" || user.credentialVersion !== input.credentialVersion)
        ) {
          throw new StaleCredentialsError();
        }
      }
      if (previous !== undefined && input.replacedTokenHash !== undefined) {
        await trx
          .updateTable("adminSessions")
          .set({ revokedAt: sql<Date>`now()`, revokeReason: "LOGIN_REPLACED" })
          .where("tokenHash", "=", input.replacedTokenHash)
          .where("revokedAt", "is", null)
          .execute();
      }
      const row = await trx
        .insertInto("adminSessions")
        .values({
          userId: input.userId,
          tokenHash: input.tokenHash,
          credentialVersion: input.credentialVersion,
          createdAt: input.now,
          lastSeenAt: input.now,
          idleExpiresAt: idle,
          absoluteExpiresAt: absolute,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    });
  } catch (error) {
    if (error instanceof StaleCredentialsError) throw error;
    if (
      constraintOf(error) === "admin_sessions_credentials_current" ||
      constraintOf(error) === "admin_sessions_user_active"
    ) {
      throw new StaleCredentialsError();
    }
    if (sqlStateOf(error) === LOCK_NOT_AVAILABLE) throw new SessionLockTimeoutError();
    throw error;
  }
}

/** SQLSTATE de `lock_timeout` vencido. */
const LOCK_NOT_AVAILABLE = "55P03";

export interface ActiveSession {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly lastSeenAt: Date;
  readonly absoluteExpiresAt: Date;
}

/**
 * Sesión válida en `now`: token conocido, sin revocar, con los dos vencimientos posteriores,
 * usuario activo y la misma versión de credenciales. Una sola consulta y sin caché, así que una
 * revocación surte efecto en la petición siguiente.
 */
export async function findActiveSession(
  db: Database,
  tokenHash: Buffer,
  now: Date,
): Promise<ActiveSession | undefined> {
  return db
    .selectFrom("adminSessions as s")
    .innerJoin("adminUsers as u", "u.id", "s.userId")
    .select([
      "s.id",
      "s.userId",
      "u.emailNormalized as email",
      "s.lastSeenAt",
      "s.absoluteExpiresAt",
    ])
    .where("s.tokenHash", "=", tokenHash)
    .where("s.revokedAt", "is", null)
    .where("s.idleExpiresAt", ">", now)
    .where("s.absoluteExpiresAt", ">", now)
    .where("u.status", "=", "ACTIVE")
    .whereRef("s.credentialVersion", "=", "u.credentialVersion")
    .executeTakeFirst();
}

/** Extiende la inactividad sin pasar el vencimiento absoluto; como mucho una escritura por minuto. */
export async function touchSession(
  db: Database,
  sessionId: string,
  now: Date,
  idleMs: number,
): Promise<void> {
  await db
    .updateTable("adminSessions")
    .set({
      lastSeenAt: now,
      idleExpiresAt: sql<Date>`least(${new Date(now.getTime() + idleMs)}, ${sql.ref("absoluteExpiresAt")})`,
    })
    .where("id", "=", sessionId)
    .where("revokedAt", "is", null)
    .where("lastSeenAt", "<=", new Date(now.getTime() - TOUCH_INTERVAL_MS))
    .execute();
}

export const TOUCH_INTERVAL_MS = 60_000;

export async function revokeSession(
  db: Database,
  sessionId: string,
  reason: RevokeReason,
): Promise<void> {
  await db
    .updateTable("adminSessions")
    .set({ revokedAt: sql<Date>`now()`, revokeReason: reason })
    .where("id", "=", sessionId)
    .where("revokedAt", "is", null)
    .execute();
}

/** Guarda un hash recalculado con parámetros nuevos, si nadie cambió la contraseña entretanto. */
export async function updatePasswordHash(
  db: Database,
  userId: string,
  previousHash: string,
  nextHash: string,
): Promise<void> {
  await db
    .updateTable("adminUsers")
    .set({ passwordHash: nextHash })
    .where("id", "=", userId)
    .where("passwordHash", "=", previousHash)
    .execute();
}

export type EmailAdmission =
  | { readonly admitted: true; readonly windowStartedAt: Date }
  | Extract<Admission, { admitted: false }>;

/**
 * Reserva un intento en el límite por email, de forma atómica: el INSERT … ON CONFLICT solo
 * actualiza si la ventana venció o quedan lugares. El intento cuenta como fallo hasta que un
 * login correcto lo devuelve.
 */
export async function reserveEmailAttempt(
  db: Database,
  keyHash: Buffer,
  now: Date,
  limit: WindowLimit,
): Promise<EmailAdmission> {
  const expiredBefore = new Date(now.getTime() - limit.windowMs);
  const reserved = await sql<{ windowStartedAt: Date }>`
    INSERT INTO admin_login_throttle AS t (key_hash, failures, window_started_at)
    VALUES (${keyHash}, 1, ${now})
    ON CONFLICT (key_hash) DO UPDATE SET
      failures = CASE WHEN t.window_started_at <= ${expiredBefore} THEN 1 ELSE t.failures + 1 END,
      window_started_at = CASE
        WHEN t.window_started_at <= ${expiredBefore} THEN ${now} ELSE t.window_started_at END
    WHERE t.window_started_at <= ${expiredBefore} OR t.failures < ${limit.limit}
    RETURNING t.window_started_at AS "windowStartedAt"`.execute(db);
  const row = reserved.rows[0];
  if (row !== undefined) return { admitted: true, windowStartedAt: row.windowStartedAt };

  const current = await db
    .selectFrom("adminLoginThrottle")
    .select("windowStartedAt")
    .where("keyHash", "=", keyHash)
    .executeTakeFirst();
  const endsAt = (current?.windowStartedAt.getTime() ?? now.getTime()) + limit.windowMs;
  return {
    admitted: false,
    retryAfterSeconds: Math.max(1, Math.ceil((endsAt - now.getTime()) / 1000)),
  };
}

/** Devuelve un intento reservado: login correcto o intento que no llegó a evaluarse. */
export async function refundEmailAttempt(
  db: Database,
  keyHash: Buffer,
  windowStartedAt: Date,
): Promise<void> {
  await db
    .updateTable("adminLoginThrottle")
    .set((eb) => ({ failures: eb("failures", "-", 1) }))
    .where("keyHash", "=", keyHash)
    .where("windowStartedAt", "=", windowStartedAt)
    .where("failures", ">", 0)
    .execute();
}

export async function clearEmailThrottle(db: Database, keyHash: Buffer): Promise<boolean> {
  const result = await db
    .deleteFrom("adminLoginThrottle")
    .where("keyHash", "=", keyHash)
    .executeTakeFirst();
  return result.numDeletedRows > 0n;
}

/** SQLSTATE de un error de PostgreSQL, si lo tiene. */
export function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

/** Nombre de la restricción de un error de PostgreSQL, si lo tiene. */
export function constraintOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("constraint" in error)) return undefined;
  const { constraint } = error as { constraint?: unknown };
  return typeof constraint === "string" ? constraint : undefined;
}
