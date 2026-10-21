import { emailKeyHash, normalizeEmail } from "./email.js";
import { FixedWindowLimiter, type WindowLimit } from "./limiters.js";
import type { PasswordHasher } from "./passwords.js";
import {
  createSession,
  findUserByEmail,
  refundEmailAttempt,
  reserveEmailAttempt,
  StaleCredentialsError,
  updatePasswordHash,
  type Database,
} from "./store.js";
import { csrfTokenFor, newSessionToken, tokenHash, type RandomBytes } from "./tokens.js";
import { WorkGate, WorkGateSaturatedError } from "./work-gate.js";

// Login administrativo (plan de P1-T4, §5.9; ADR-015).
//
// Admisión, antes de cualquier trabajo costoso y en este orden:
//   1. límite por red (memoria);
//   2. límite por par email-red (memoria);
//   3. límite por email, exista o no la cuenta (PostgreSQL, compartido entre procesos);
//   4. lugar en la compuerta de Argon2.
// Cada límite reserva el intento antes de evaluarlo, así que una ráfaga sobre la misma clave no
// pasa entera por la comprobación. Si un paso posterior rechaza, se devuelven las reservas de los
// límites que no llegaron a evaluarse. El límite por red cuenta todo intento.
//
// Resultados: 429 si un límite rechaza (RATE_LIMITED) y 503 si la compuerta está saturada
// (SATURATED). Incorrecto, inexistente y desactivado son el mismo INVALID, con una sola
// verificación de Argon2 en cada caso.

export interface LoginLimits {
  readonly perNetwork: WindowLimit;
  readonly perPair: WindowLimit;
  readonly perEmail: WindowLimit;
}

/** Valores iniciales aprobados por el propietario (21/10/2026). */
export const LOGIN_LIMITS: LoginLimits = Object.freeze({
  perNetwork: { limit: 20, windowMs: 15 * 60_000 },
  perPair: { limit: 5, windowMs: 15 * 60_000 },
  perEmail: { limit: 30, windowMs: 60 * 60_000 },
});

export interface SessionDurations {
  readonly idleMs: number;
  readonly absoluteMs: number;
}

export interface LoginDependencies {
  readonly db: Database;
  readonly hasher: PasswordHasher;
  /** Hash ficticio con los parámetros vigentes, calculado al arrancar. */
  readonly dummyHash: string;
  readonly gate: WorkGate;
  readonly limits: LoginLimits;
  readonly networkLimiter: FixedWindowLimiter;
  readonly pairLimiter: FixedWindowLimiter;
  readonly sessions: SessionDurations;
  readonly clock: () => Date;
  readonly random: RandomBytes;
}

export interface LoginAttempt {
  readonly email: string;
  readonly password: string;
  /** Dirección del cliente, tal como la ve el socket (sin proxy en P1). */
  readonly network: string;
  /** Token de la sesión que traía la petición, si había una. */
  readonly previousToken?: Buffer;
}

export type LoginOutcome =
  | {
      readonly kind: "SUCCESS";
      readonly token: Buffer;
      readonly csrfToken: string;
      readonly userId: string;
      readonly email: string;
    }
  | { readonly kind: "INVALID" }
  | { readonly kind: "RATE_LIMITED"; readonly retryAfterSeconds: number }
  | { readonly kind: "SATURATED" };

export function createLimiters(
  limits: LoginLimits,
  now: () => number,
): { networkLimiter: FixedWindowLimiter; pairLimiter: FixedWindowLimiter } {
  return {
    networkLimiter: new FixedWindowLimiter(limits.perNetwork, now),
    pairLimiter: new FixedWindowLimiter(limits.perPair, now),
  };
}

export async function login(deps: LoginDependencies, attempt: LoginAttempt): Promise<LoginOutcome> {
  const email = normalizeEmail(attempt.email);
  const pairKey = `${email}\u0000${attempt.network}`;

  const network = deps.networkLimiter.reserve(attempt.network);
  if (!network.admitted)
    return { kind: "RATE_LIMITED", retryAfterSeconds: network.retryAfterSeconds };

  const pair = deps.pairLimiter.reserve(pairKey);
  if (!pair.admitted) return { kind: "RATE_LIMITED", retryAfterSeconds: pair.retryAfterSeconds };

  const emailKey = emailKeyHash(email);
  const perEmail = await reserveEmailAttempt(deps.db, emailKey, deps.clock(), deps.limits.perEmail);
  if (!perEmail.admitted) {
    deps.pairLimiter.refund(pairKey);
    return { kind: "RATE_LIMITED", retryAfterSeconds: perEmail.retryAfterSeconds };
  }

  let verified: VerifiedUser | undefined;
  try {
    verified = await deps.gate.run(() => verifyCredentials(deps, email, attempt.password));
  } catch (error) {
    if (!(error instanceof WorkGateSaturatedError)) throw error;
    deps.pairLimiter.refund(pairKey);
    await refundEmailAttempt(deps.db, emailKey, perEmail.windowStartedAt);
    return { kind: "SATURATED" };
  }
  if (verified === undefined) return { kind: "INVALID" };

  const token = newSessionToken(deps.random);
  try {
    await createSession(deps.db, {
      userId: verified.id,
      credentialVersion: verified.credentialVersion,
      tokenHash: tokenHash(token),
      now: deps.clock(),
      idleMs: deps.sessions.idleMs,
      absoluteMs: deps.sessions.absoluteMs,
      ...(attempt.previousToken === undefined
        ? {}
        : { replacedTokenHash: tokenHash(attempt.previousToken) }),
    });
  } catch (error) {
    // La contraseña o el estado cambiaron mientras se verificaba: no hay sesión.
    if (error instanceof StaleCredentialsError) return { kind: "INVALID" };
    throw error;
  }
  deps.pairLimiter.reset(pairKey);
  await refundEmailAttempt(deps.db, emailKey, perEmail.windowStartedAt);
  return {
    kind: "SUCCESS",
    token,
    csrfToken: csrfTokenFor(token),
    userId: verified.id,
    email: verified.email,
  };
}

interface VerifiedUser {
  readonly id: string;
  readonly email: string;
  readonly credentialVersion: number;
}

/**
 * Una verificación de Argon2 por intento: contra el hash del usuario activo o, si no existe o
 * está desactivado, contra el hash ficticio. Así el trabajo no revela si la cuenta existe.
 */
async function verifyCredentials(
  deps: LoginDependencies,
  email: string,
  password: string,
): Promise<VerifiedUser | undefined> {
  const user = await findUserByEmail(deps.db, email);
  const active = user?.status === "ACTIVE" ? user : undefined;
  const check = await deps.hasher.verify(active?.passwordHash ?? deps.dummyHash, password);
  if (active === undefined || !check.valid) return undefined;
  if (check.needsRehash) {
    await updatePasswordHash(
      deps.db,
      active.id,
      active.passwordHash,
      await deps.hasher.hash(password),
    );
  }
  return { id: active.id, email: active.email, credentialVersion: active.credentialVersion };
}
