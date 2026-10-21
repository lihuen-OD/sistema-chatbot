import { defineConfig } from "vitest/config";

// Pruebas sin base de datos: validación de SQL, archivos de migración y guardas. Forman parte de
// `pnpm run check`. Las pruebas contra PostgreSQL están en vitest.db.config.ts (`check:db`).
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
