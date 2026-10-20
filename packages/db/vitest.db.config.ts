import { defineConfig } from "vitest/config";

// Pruebas contra PostgreSQL real aislado (plan de P1-T3, §5.7 y §7). Requieren TEST_DATABASE_URL
// hacia el contenedor del proyecto: sin ella fallan, nunca se omiten en silencio.
// El globalSetup crea y migra una plantilla `sc_test_<runId>_template`; cada archivo clona sus
// propias bases `sc_test_<runId>_<n>` y las borra al terminar, por nombre exacto.
export default defineConfig({
  test: {
    include: ["test/db/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/db/support/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
