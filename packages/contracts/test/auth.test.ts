import { describe, expect, it } from "vitest";
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  apiErrorResponseSchema,
  loginRequestSchema,
  passwordLength,
  sessionResponseSchema,
} from "../src/index.js";
import { expectInvalid, expectValid } from "./samples.js";

describe("DTO de autenticación administrativa", () => {
  it("login: email y contraseña de 1 a 128 caracteres, sin campos extra", () => {
    expectValid(loginRequestSchema, { email: "admin@example.com", password: "x" });
    expectValid(loginRequestSchema, {
      email: "admin@example.com",
      password: "a".repeat(ADMIN_PASSWORD_MAX_LENGTH),
    });
    expectInvalid(loginRequestSchema, { email: "admin@example.com", password: "" });
    expectInvalid(loginRequestSchema, {
      email: "admin@example.com",
      password: "a".repeat(ADMIN_PASSWORD_MAX_LENGTH + 1),
    });
    expectInvalid(loginRequestSchema, { email: "a".repeat(255), password: "x" });
    expectInvalid(loginRequestSchema, { email: "admin@example.com" });
    expectInvalid(loginRequestSchema, {
      email: "admin@example.com",
      password: "x",
      remember: true,
    });
  });

  it("la longitud de la contraseña se cuenta en puntos de código después de NFKC", () => {
    // Cada emoji ocupa dos unidades UTF-16 y cuenta como un carácter.
    const emojis = "😀".repeat(ADMIN_PASSWORD_MAX_LENGTH);
    expect(emojis.length).toBe(ADMIN_PASSWORD_MAX_LENGTH * 2);
    expect(passwordLength(emojis)).toBe(ADMIN_PASSWORD_MAX_LENGTH);
    expectValid(loginRequestSchema, { email: "admin@example.com", password: emojis });
    // La ligadura "ﬁ" se normaliza a "fi": dos caracteres.
    expect(passwordLength("ﬁ")).toBe(2);
  });

  it("respuesta de sesión: usuario, permisos y token CSRF", () => {
    const session = {
      user: { id: "0199f6f2-6a3c-7d1e-9b5f-3a2b1c0d9e8f", email: "admin@example.com" },
      permissions: [],
      csrfToken: "A".repeat(43),
    };
    expectValid(sessionResponseSchema, session);
    expectInvalid(sessionResponseSchema, { ...session, csrfToken: "corto" });
    expectInvalid(sessionResponseSchema, { ...session, token: "no se publica" });
    expectInvalid(sessionResponseSchema, { ...session, user: { ...session.user, id: "x" } });
  });

  it("INTERNAL_ERROR no lleva detalles", () => {
    const error = { code: "INTERNAL_ERROR", message: "Error interno.", requestId: "req-demo" };
    expectValid(apiErrorResponseSchema, { error });
    expectInvalid(apiErrorResponseSchema, { error: { ...error, details: { stack: "..." } } });
  });
});
