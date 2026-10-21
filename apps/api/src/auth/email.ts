import { createHash } from "node:crypto";
import { ADMIN_EMAIL_MAX_LENGTH } from "@sistema-chatbot/contracts";

/** Email normalizado: sin espacios en los extremos, en NFC y en minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().normalize("NFC").toLowerCase();
}

/** Forma mínima, la misma que exige la base (`admin_users_email_format`). */
export function isValidEmail(normalized: string): boolean {
  return (
    normalized.length >= 3 &&
    normalized.length <= ADMIN_EMAIL_MAX_LENGTH &&
    /^[^@\s]+@[^@\s]+$/.test(normalized)
  );
}

/** Clave del límite por email: SHA-256 del email normalizado, exista o no la cuenta. */
export function emailKeyHash(normalized: string): Buffer {
  return createHash("sha256").update(normalized, "utf8").digest();
}
