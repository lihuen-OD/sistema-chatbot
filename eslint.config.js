// @ts-check
import { builtinModules } from "node:module";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

export default defineConfig([
  // Los tipos de la base los genera kysely-codegen y se verifican con `db:types:verify` (ADR-010).
  globalIgnores([
    "**/dist/**",
    "**/coverage/**",
    "docs/**",
    "examples/**",
    "packages/db/src/generated/**",
  ]),
  {
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
  },
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // ADR-001: flow-schema no depende de otros paquetes internos y también se usa en el navegador.
    files: ["packages/flow-schema/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: nodeBuiltins.map((name) => ({
            name,
            message: "flow-schema no usa APIs de Node (ADR-001).",
          })),
          patterns: [
            {
              group: ["@sistema-chatbot/*"],
              message: "flow-schema no depende de otros paquetes internos (ADR-001).",
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-001: contracts depende solo de flow-schema y también se usa en el navegador.
    files: ["packages/contracts/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: nodeBuiltins.map((name) => ({
            name,
            message: "contracts no usa APIs de Node (ADR-001).",
          })),
          patterns: [
            {
              group: ["@sistema-chatbot/*", "!@sistema-chatbot/flow-schema"],
              message: "contracts solo depende de flow-schema (ADR-001).",
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-001 (precisión de P1-T3): db no depende de otros paquetes internos. Usa APIs de Node.
    files: ["packages/db/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@sistema-chatbot/*"],
              message: "db no depende de otros paquetes internos en P1-T3 (ADR-001).",
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-001 (plan de P1-T5 §3): los adaptadores dependen solo de contracts y flow-schema.
    files: ["packages/adapters/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@sistema-chatbot/*",
                "!@sistema-chatbot/contracts",
                "!@sistema-chatbot/flow-schema",
              ],
              message: "adapters solo depende de contracts y flow-schema (ADR-001, plan de P1-T5).",
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-001 (plan de P1-T5 §4): los módulos locales y de mantenimiento no importan módulos
    // de red ni procesos, con o sin prefijo `node:` y con sus submódulos (por ejemplo
    // `dns/promises`). Si cambian de lugar, este bloque deja de cubrirlos y hay que
    // actualizarlo en la misma tarea.
    files: ["packages/adapters/src/local/**/*.ts", "packages/adapters/src/maintenance/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "net",
                "net/**",
                "node:net",
                "node:net/**",
                "tls",
                "tls/**",
                "node:tls",
                "node:tls/**",
                "http",
                "http/**",
                "node:http",
                "node:http/**",
                "https",
                "https/**",
                "node:https",
                "node:https/**",
                "http2",
                "http2/**",
                "node:http2",
                "node:http2/**",
                "dgram",
                "dgram/**",
                "node:dgram",
                "node:dgram/**",
                "dns",
                "dns/**",
                "node:dns",
                "node:dns/**",
                "child_process",
                "child_process/**",
                "node:child_process",
                "node:child_process/**",
              ],
              message: "Los módulos locales no usan red ni procesos (plan de P1-T5 §4).",
            },
            {
              group: [
                "@sistema-chatbot/*",
                "!@sistema-chatbot/contracts",
                "!@sistema-chatbot/flow-schema",
              ],
              message: "adapters solo depende de contracts y flow-schema (ADR-001, plan de P1-T5).",
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-001 (precisión de P1-T4): la API compone contracts y db.
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/auth/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@sistema-chatbot/*", "!@sistema-chatbot/contracts", "!@sistema-chatbot/db"],
              message: "La API solo depende de contracts y db en P1-T4 (ADR-001).",
            },
          ],
        },
      ],
    },
  },
  {
    // Controllers delgados (ADR-001): la autenticación no conoce HTTP.
    files: ["apps/api/src/auth/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["express", "cookie", "helmet"].map((name) => ({
            name,
            message: "src/auth no depende de HTTP: va en src/http (ADR-001).",
          })),
          patterns: [
            {
              group: ["@sistema-chatbot/*", "!@sistema-chatbot/contracts", "!@sistema-chatbot/db"],
              message: "La API solo depende de contracts y db en P1-T4 (ADR-001).",
            },
          ],
        },
      ],
    },
  },
]);
