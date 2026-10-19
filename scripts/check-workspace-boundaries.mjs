// Verifica las dependencias entre paquetes internos según ADR-001.
// Uso: node scripts/check-workspace-boundaries.mjs [raíz-del-repositorio]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const INTERNAL_SCOPE = "@sistema-chatbot/";

// Dependencias internas permitidas por paquete (ADR-001). Todo paquete nuevo debe declararse acá,
// en la misma tarea que lo crea, con la regla que indique el ADR.
const ALLOWED_INTERNAL_DEPENDENCIES = {
  "@sistema-chatbot/flow-schema": [],
  "@sistema-chatbot/contracts": ["@sistema-chatbot/flow-schema"],
};

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const root = resolve(process.argv[2] ?? ".");
const errors = [];

for (const group of ["apps", "packages"]) {
  const groupDir = join(root, group);
  if (!existsSync(groupDir)) continue;
  for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(groupDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const name = manifest.name;
    const location = `${group}/${entry.name}`;

    if (typeof name !== "string" || !name.startsWith(INTERNAL_SCOPE)) {
      errors.push(`${location}: el nombre debe empezar con ${INTERNAL_SCOPE}`);
      continue;
    }
    const allowed = ALLOWED_INTERNAL_DEPENDENCIES[name];
    if (allowed === undefined) {
      errors.push(`${location}: ${name} no está declarado en la matriz de ADR-001`);
      continue;
    }
    for (const field of DEPENDENCY_FIELDS) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        if (dependency.startsWith(INTERNAL_SCOPE) && !allowed.includes(dependency)) {
          errors.push(
            `${location}: ${name} no puede depender de ${dependency} (${field}, ADR-001)`,
          );
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Límites entre paquetes incumplidos:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("Límites entre paquetes: correctos.");
