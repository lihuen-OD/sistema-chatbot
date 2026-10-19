import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Las pruebas usan las fuentes de los paquetes internos (condición @sistema-chatbot/source),
// sin depender de un build previo de flow-schema.
const conditions = ["@sistema-chatbot/source", ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
