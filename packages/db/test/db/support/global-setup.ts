import type { TestProject } from "vitest/node";
import { loadLocalEnv } from "../../../src/env.js";
import { testAdminTarget } from "../../../src/guards.js";
import { runMigrations } from "../../../src/migrator.js";
import { TemporaryDatabases } from "../../../src/temporary-databases.js";

declare module "vitest" {
  export interface ProvidedContext {
    database: { readonly runId: string; readonly template: string };
  }
}

/**
 * Crea `sc_test_<runId>_template` desde template0, la migra (inicialización desde una base vacía)
 * y la comparte con los archivos de prueba. Al terminar borra solo esa base, por nombre exacto.
 * Sin TEST_DATABASE_URL falla: las pruebas de base nunca se omiten en silencio.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  loadLocalEnv();
  const databases = new TemporaryDatabases(testAdminTarget(process.env));
  const teardown = async (): Promise<void> => {
    await databases.dropAll();
    await databases.close();
  };
  try {
    const template = await databases.create("template");
    const { applied } = await runMigrations({
      target: template,
      applicationName: "sistema-chatbot-test-template",
    });
    if (applied.length === 0) throw new Error("La plantilla de pruebas no aplicó migraciones.");
    project.provide("database", { runId: databases.runId, template: template.database });
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
