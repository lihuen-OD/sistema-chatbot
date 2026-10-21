import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Pruebas contra PostgreSQL real aislado (`pnpm run check:db`). Requieren TEST_DATABASE_URL hacia
// el contenedor del proyecto: sin ella fallan, nunca se omiten en silencio. El globalSetup crea y
// migra una plantilla `sc_test_<runId>_template`; cada archivo clona sus propias bases y las borra
// al terminar, por nombre exacto (guardas de packages/db).
const conditions = ["@sistema-chatbot/source", ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ["test/db/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/db/support/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
