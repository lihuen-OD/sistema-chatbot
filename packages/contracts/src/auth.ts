import { z } from "zod";

// DTO de la autenticación administrativa local (P1-T4, ADR-015): login, sesión y logout.
// Las contraseñas se cuentan en puntos de código después de normalizar con NFKC, igual que en la
// API. El login acepta de 1 a 128 para que un cambio de política no deje afuera a nadie; el alta
// y el cambio de contraseña exigen el mínimo de la política.

export const ADMIN_EMAIL_MAX_LENGTH = 254;
export const ADMIN_PASSWORD_MIN_LENGTH = 15;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

/** Puntos de código de una contraseña, después de la normalización NFKC. */
export function passwordLength(password: string): number {
  // Array.from recorre puntos de código: un emoji fuera del plano básico cuenta como uno.
  return Array.from(password.normalize("NFKC")).length;
}

export const loginRequestSchema = z.strictObject({
  email: z.string().trim().min(3).max(ADMIN_EMAIL_MAX_LENGTH),
  // El máximo en unidades UTF-16 acota el trabajo antes de contar puntos de código.
  password: z
    .string()
    .min(1)
    .max(ADMIN_PASSWORD_MAX_LENGTH * 4)
    .refine((value) => passwordLength(value) <= ADMIN_PASSWORD_MAX_LENGTH, {
      message: `La contraseña admite hasta ${String(ADMIN_PASSWORD_MAX_LENGTH)} caracteres.`,
    }),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Token CSRF de la sesión: HMAC-SHA256 en base64url, sin relleno (ADR-015). */
export const csrfTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const sessionResponseSchema = z.strictObject({
  user: z.strictObject({
    id: z.uuid(),
    email: z.string().min(3).max(ADMIN_EMAIL_MAX_LENGTH),
  }),
  /** Permisos efectivos. Vacíos hasta que P4 defina roles y alcances. */
  permissions: z.array(z.string().min(1).max(64)).max(200),
  csrfToken: csrfTokenSchema,
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** Cabecera con la que el panel envía el token CSRF en toda mutación. */
export const CSRF_HEADER = "X-CSRF-Token";
