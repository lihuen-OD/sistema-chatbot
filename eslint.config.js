// @ts-check
import { builtinModules } from "node:module";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

export default defineConfig([
  globalIgnores(["**/dist/**", "**/coverage/**", "docs/**", "examples/**"]),
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
]);
