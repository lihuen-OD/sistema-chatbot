import { describe, expect, it } from "vitest";
import { containsTemplateSyntax, parseTemplate } from "../src/index.js";

describe("parseTemplate", () => {
  it.each([
    ["texto sin marcadores", []],
    ["Hola {{company}}", ["company"]],
    ["{{a}} y {{b_2}}", ["a", "b_2"]],
    ["llaves simples { } se permiten", []],
  ])("acepta %j", (text, variables) => {
    expect(parseTemplate(text)).toEqual({ ok: true, variables });
  });

  it.each([
    ["Hola {{company", 5],
    ["Hola company}}", 12],
    ["{{ company }}", 0],
    ["{{{company}}}", 0],
    ["{{company.name}}", 0],
    ["{{}}", 0],
  ])("rechaza %j en la posición %i", (text, position) => {
    expect(parseTemplate(text)).toEqual({ ok: false, position });
  });
});

describe("containsTemplateSyntax", () => {
  it("detecta marcadores en campos de texto plano", () => {
    expect(containsTemplateSyntax("Confirmar")).toBe(false);
    expect(containsTemplateSyntax("Confirmar {{x}}")).toBe(true);
    expect(containsTemplateSyntax("cierre }}")).toBe(true);
  });
});
