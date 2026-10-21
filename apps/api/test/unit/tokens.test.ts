import { randomBytes } from "node:crypto";
import { csrfTokenSchema } from "@sistema-chatbot/contracts";
import { describe, expect, it } from "vitest";
import {
  csrfMatches,
  csrfTokenFor,
  decodeToken,
  encodeToken,
  newSessionToken,
  tokenHash,
} from "../../src/auth/tokens.js";
import { parseArguments, PASSWORD_ARGUMENT_REJECTED, USAGE } from "../../src/cli/arguments.js";

// Tokens de sesión y CSRF (ADR-015).

describe("tokens de sesión", () => {
  it("32 bytes aleatorios, 43 caracteres base64url y hash SHA-256 distinto del token", () => {
    const token = newSessionToken(randomBytes);
    expect(token).toHaveLength(32);
    const encoded = encodeToken(token);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(decodeToken(encoded)?.equals(token)).toBe(true);
    expect(tokenHash(token)).toHaveLength(32);
    expect(tokenHash(token).equals(token)).toBe(false);
  });

  it("cualquier otra forma no es un token", () => {
    for (const value of [
      undefined,
      "",
      "corto",
      `${"A".repeat(43)}=`,
      "*".repeat(43),
      "A".repeat(44),
    ]) {
      expect(decodeToken(value), String(value)).toBeUndefined();
    }
  });

  it("rechaza un generador que no entrega 32 bytes", () => {
    expect(() => newSessionToken(() => Buffer.alloc(16))).toThrow();
  });
});

describe("token CSRF derivado de la sesión", () => {
  it("es estable para la misma sesión y distinto entre sesiones", () => {
    const token = newSessionToken(randomBytes);
    const csrf = csrfTokenFor(token);
    expect(csrfTokenSchema.safeParse(csrf).success).toBe(true);
    expect(csrfTokenFor(Buffer.from(token))).toBe(csrf);
    expect(csrfTokenFor(newSessionToken(randomBytes))).not.toBe(csrf);
  });

  it("solo coincide el token de la misma sesión", () => {
    const token = newSessionToken(randomBytes);
    expect(csrfMatches(token, csrfTokenFor(token))).toBe(true);
    expect(csrfMatches(token, csrfTokenFor(newSessionToken(randomBytes)))).toBe(false);
    expect(csrfMatches(token, undefined)).toBe(false);
    expect(csrfMatches(token, "")).toBe(false);
    expect(csrfMatches(token, `${csrfTokenFor(token)}x`)).toBe(false);
  });
});

describe("argumentos de la CLI admin", () => {
  it("acepta un comando y --email", () => {
    expect(parseArguments(["create", "--email", "admin@example.com"])).toEqual({
      command: "create",
      email: "admin@example.com",
    });
    expect(parseArguments(["unlock", "--email", "admin@example.com"])).toEqual({
      command: "unlock",
      email: "admin@example.com",
    });
    // Separador que agregan pnpm y npm.
    expect(parseArguments(["--", "disable", "--email", "admin@example.com"])).toEqual({
      command: "disable",
      email: "admin@example.com",
    });
  });

  it("nunca acepta la contraseña como argumento", () => {
    for (const argv of [
      ["create", "--email", "admin@example.com", "--password", "x"],
      ["create", "--password=x", "--email", "admin@example.com"],
      ["--password", "x"],
    ]) {
      expect(parseArguments(argv)).toBe(PASSWORD_ARGUMENT_REJECTED);
    }
  });

  it("rechaza comandos desconocidos y argumentos de más o de menos", () => {
    for (const argv of [
      [],
      ["delete", "--email", "a@example.com"],
      ["create"],
      ["create", "--email"],
    ]) {
      expect(parseArguments(argv)).toBe(USAGE);
    }
    expect(parseArguments(["create", "--email", "a@example.com", "extra"])).toBe(USAGE);
  });
});
