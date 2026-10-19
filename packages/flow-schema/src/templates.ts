const VARIABLE_TOKEN = /^[A-Za-z][A-Za-z0-9_]*$/;

export type TemplateParseResult =
  | { readonly ok: true; readonly variables: readonly string[] }
  | { readonly ok: false; readonly position: number };

/**
 * Plantillas limitadas a interpolación `{{nombre}}` (ADR-003). No hay expresiones, filtros ni
 * lógica: cualquier `{{` o `}}` que no forme un marcador válido es un error de sintaxis.
 */
export function parseTemplate(text: string): TemplateParseResult {
  const variables: string[] = [];
  let index = 0;
  for (;;) {
    const open = text.indexOf("{{", index);
    const strayClose = text.indexOf("}}", index);
    if (open === -1) {
      return strayClose === -1 ? { ok: true, variables } : { ok: false, position: strayClose };
    }
    if (strayClose !== -1 && strayClose < open) return { ok: false, position: strayClose };
    const close = text.indexOf("}}", open + 2);
    if (close === -1) return { ok: false, position: open };
    const name = text.slice(open + 2, close);
    if (!VARIABLE_TOKEN.test(name)) return { ok: false, position: open };
    variables.push(name);
    index = close + 2;
  }
}

/** Campos de texto plano, como etiquetas de botones, no admiten marcadores. */
export function containsTemplateSyntax(text: string): boolean {
  return text.includes("{{") || text.includes("}}");
}
