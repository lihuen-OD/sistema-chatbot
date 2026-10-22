import { describe, expect, it } from "vitest";
import { decodeToken } from "../../src/auth/tokens.js";
import { withOneBitChanged, withOneCharacterChanged } from "../support/tampering.js";

// Alteraciones de prueba de las sesiones: siempre producen un valor distinto del original,
// con la misma longitud y forma, incluso cuando el original termina en A o en AA (los casos
// exactos donde el reemplazo por sufijo era una operación nula).

const TOKEN = "TkYSb5zMP-fjZKQoXRLE9qad1mr0mWdJia3Rp8zBR0A"; // 43 caracteres base64url

describe("alteración de un carácter del token", () => {
  it("conserva longitud y alfabeto y difiere del original, también con finales en A y AA", () => {
    for (const original of [
      "tokA",
      `${"A".repeat(42)}AB`,
      "tok_-9",
      TOKEN,
      `${"z3kQ".repeat(10)}AA`,
    ]) {
      const tampered = withOneCharacterChanged(original);
      expect(tampered.length, original).toBe(original.length);
      expect(tampered, original).not.toBe(original);
      expect(tampered, original).toMatch(/^[A-Za-z0-9_-]*$/);
    }
  });

  it("el reemplazo es determinista en cada final de interés", () => {
    expect(withOneCharacterChanged("tokA")).toBe("tokB");
    expect(withOneCharacterChanged(`${"A".repeat(41)}AA`)).toBe(`${"A".repeat(41)}AB`);
    expect(withOneCharacterChanged("x")).toBe("y");
  });
});

describe("alteración de la cookie por bits", () => {
  it("decodifica, cambia un bit del primer byte y recodifica: mismos largos y bytes distintos", () => {
    const original = TOKEN;
    const bytes = Buffer.from(original, "base64url");
    const tampered = withOneBitChanged(original);
    expect(tampered).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const tamperedBytes = Buffer.from(tampered, "base64url");
    expect(tamperedBytes).toHaveLength(bytes.length);
    expect(tamperedBytes.equals(bytes)).toBe(false);
  });

  it("no se limita a los bits de relleno: un reemplazo que solo los cambia mantiene los bytes", () => {
    // El último símbolo tiene 2 bits sin datos: 'A' y 'B' decodifican lo mismo.
    expect(
      Buffer.from(`${TOKEN.slice(0, -1)}B`, "base64url").equals(Buffer.from(TOKEN, "base64url")),
    ).toBe(true);
    // La alteración por bits sí cambia los bytes que la base guarda como hash de la sesión.
    const decoded = decodeToken(withOneBitChanged(TOKEN));
    expect(decoded?.equals(Buffer.from(TOKEN, "base64url"))).toBe(false);
    expect(decoded).toHaveLength(32);
  });
});
