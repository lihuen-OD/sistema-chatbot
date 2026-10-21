import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Tokens de sesión y CSRF (ADR-015).
// - Token de sesión: 32 bytes aleatorios en base64url. Solo viaja en la cookie HttpOnly; la base
//   guarda su SHA-256.
// - Token CSRF: HMAC-SHA256 del token de sesión con una etiqueta fija. Es estable durante toda la
//   sesión, así que una recarga o varias pestañas obtienen el mismo valor con GET /auth/me sin
//   invalidarse entre sí, y cambia cuando cambia la sesión (login, cambio de contraseña). Sin la
//   cookie no sirve de nada, y no se guarda en ningún lado.

export const SESSION_TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CSRF_LABEL = "sistema-chatbot/csrf/v1";

export type RandomBytes = (size: number) => Buffer;

export function newSessionToken(random: RandomBytes): Buffer {
  const token = random(SESSION_TOKEN_BYTES);
  if (token.length !== SESSION_TOKEN_BYTES) throw new Error("Token de sesión de largo inválido.");
  return token;
}

export function encodeToken(token: Buffer): string {
  return token.toString("base64url");
}

/** Decodifica el valor de la cookie; cualquier otra forma no es un token. */
export function decodeToken(value: string | undefined): Buffer | undefined {
  if (value === undefined || !TOKEN_PATTERN.test(value)) return undefined;
  const token = Buffer.from(value, "base64url");
  return token.length === SESSION_TOKEN_BYTES ? token : undefined;
}

export function tokenHash(token: Buffer): Buffer {
  return createHash("sha256").update(token).digest();
}

export function csrfTokenFor(token: Buffer): string {
  return createHmac("sha256", token).update(CSRF_LABEL).digest("base64url");
}

/** Compara en tiempo constante el token CSRF presentado con el de la sesión. */
export function csrfMatches(token: Buffer, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  const expected = Buffer.from(csrfTokenFor(token), "utf8");
  const received = Buffer.from(presented, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
