// Gancho de resolución para correr las fuentes TypeScript en un proceso hijo de prueba con el
// soporte de tipos de Node (type stripping), sin compilar: las importaciones relativas usan
// `.js`, como exige `module: nodenext`, y acá se resuelven al `.ts` que existe. Solo lo usan
// las pruebas entre procesos (plan de P1-T5, §9.4).
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" &&
      relative &&
      specifier.endsWith(".js") &&
      context.parentURL?.endsWith(".ts")
    ) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
