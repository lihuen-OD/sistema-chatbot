import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Pruebas sin base de datos (`pnpm run check`). Usan las fuentes de los paquetes internos
// (condición @sistema-chatbot/source), sin depender de un build previo.
const conditions = ["@sistema-chatbot/source", ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
