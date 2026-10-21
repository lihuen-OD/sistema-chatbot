import { afterAll, describe, expect, it, inject } from "vitest";
import {
  CLUSTER_MARKER,
  DatabaseGuardError,
  DEVELOPMENT_DATABASE,
  TEST_ROLE,
  testAdminTarget,
} from "../../src/guards.js";
import { TemporaryDatabases } from "../../src/temporary-databases.js";
import { cleanupDatabases, connect, createTestDatabase } from "./support/database.js";

afterAll(cleanupDatabases);

// Protecciones del plan (§5.7) contra el servidor real: marca del contenedor, rol de pruebas sin
// privilegios para borrar bases ajenas y borrado solo por nombres exactos de la misma ejecución.

describe("protecciones contra el contenedor real", () => {
  it("el servidor tiene la marca del contenedor del proyecto", async () => {
    const client = await connect(await createTestDatabase());
    const { rows } = await client.query<{ cluster_name: string }>(
      "SELECT current_setting('cluster_name') AS cluster_name",
    );
    expect(rows).toEqual([{ cluster_name: CLUSTER_MARKER }]);
  });

  it("el rol de pruebas solo puede crear bases y no es dueño de la de desarrollo", async () => {
    const client = await connect(await createTestDatabase());
    const role = await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user",
    );
    expect(role.rows).toEqual([
      { rolname: TEST_ROLE, rolsuper: false, rolcreaterole: false, rolcreatedb: true },
    ]);
    // PostgreSQL solo deja borrar una base a su dueño o a un superusuario.
    const owner = await client.query<{ owner: string }>(
      "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1",
      [DEVELOPMENT_DATABASE],
    );
    expect(owner.rows.length).toBe(1);
    expect(owner.rows[0]?.owner).not.toBe(TEST_ROLE);
  });

  it("las bases temporales usan el nombre sc_test_<runId>_<n> de la ejecución", async () => {
    const target = await createTestDatabase();
    const { runId } = inject("database");
    expect(target.database).toMatch(new RegExp(`^sc_test_${runId}_[1-9][0-9]{0,5}$`));
  });

  it("una instancia solo borra las bases que creó, por nombre exacto", async () => {
    const { runId, template } = inject("database");
    const databases = new TemporaryDatabases(testAdminTarget(process.env), runId);
    try {
      for (const name of [template, DEVELOPMENT_DATABASE, `sc_test_${runId}_999999`]) {
        await expect(databases.drop(name)).rejects.toBeInstanceOf(DatabaseGuardError);
      }
      const created = await databases.create();
      await databases.drop(created.database);
      expect(databases.created).toEqual([]);
    } finally {
      await databases.dropAll();
      await databases.close();
    }
  });

  it("no clona plantillas de otra ejecución", async () => {
    const { runId } = inject("database");
    const databases = new TemporaryDatabases(testAdminTarget(process.env), runId);
    try {
      await expect(databases.create(undefined, "sc_test_ffffffffffff_template")).rejects.toThrow(
        DatabaseGuardError,
      );
      await expect(databases.create(undefined, DEVELOPMENT_DATABASE)).rejects.toThrow(
        DatabaseGuardError,
      );
    } finally {
      await databases.close();
    }
  });
});
