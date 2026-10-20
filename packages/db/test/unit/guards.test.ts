import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalEnv } from "../../src/env.js";
import {
  CLUSTER_MARKER,
  DatabaseGuardError,
  developmentTarget,
  poolConfig,
  temporaryDatabaseName,
  temporaryTarget,
  testAdminTarget,
  verifyClusterMarker,
  type GuardErrorCode,
} from "../../src/guards.js";
import { TemporaryDatabases } from "../../src/temporary-databases.js";

const TEST_URL = "postgresql://sistema_chatbot_test:secreta@127.0.0.1:55432/sistema_chatbot_test";
const DEV_URL = "postgresql://sistema_chatbot_dev:secreta@127.0.0.1:55432/sistema_chatbot_dev";

function guardCode(operation: () => unknown): GuardErrorCode {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseGuardError);
    return (error as DatabaseGuardError).code;
  }
  throw new Error("se esperaba un rechazo");
}

describe("conexiones accidentales a Postgres.app u otras bases", () => {
  it("acepta solo el contenedor local con el rol y la base de cada uso", () => {
    expect(testAdminTarget({ TEST_DATABASE_URL: TEST_URL })).toMatchObject({
      purpose: "test-admin",
      host: "127.0.0.1",
      port: 55432,
      user: "sistema_chatbot_test",
      database: "sistema_chatbot_test",
    });
    expect(developmentTarget({ DATABASE_URL: DEV_URL }).purpose).toBe("development");
  });

  it.each<[string, string, GuardErrorCode]>([
    ["sin variable", "", "URL_MISSING"],
    ["Postgres.app en el puerto 5432", TEST_URL.replace("55432", "5432"), "PORT_NOT_ALLOWED"],
    ["puerto por defecto", TEST_URL.replace(":55432", ""), "PORT_NOT_ALLOWED"],
    ["host remoto", TEST_URL.replace("127.0.0.1", "db.example.com"), "HOST_NOT_LOOPBACK"],
    ["socket por parámetro", `${TEST_URL}?host=/tmp`, "URL_INVALID"],
    ["otro protocolo", TEST_URL.replace("postgresql:", "mysql:"), "URL_INVALID"],
    ["sin contraseña", TEST_URL.replace(":secreta", ""), "CREDENTIALS_MISSING"],
    ["rol de desarrollo", DEV_URL, "ROLE_NOT_ALLOWED"],
    [
      "otra base con el rol de pruebas",
      TEST_URL.replace(/\/sistema_chatbot_test$/, "/postgres"),
      "DATABASE_NOT_ALLOWED",
    ],
  ])("rechaza la URL de pruebas: %s", (_case, url, code) => {
    expect(guardCode(() => testAdminTarget({ TEST_DATABASE_URL: url }))).toBe(code);
  });

  it("la URL de desarrollo no sirve para pruebas ni la de pruebas para desarrollo", () => {
    expect(guardCode(() => testAdminTarget({ TEST_DATABASE_URL: DEV_URL }))).toBe(
      "ROLE_NOT_ALLOWED",
    );
    expect(guardCode(() => developmentTarget({ DATABASE_URL: TEST_URL }))).toBe("ROLE_NOT_ALLOWED");
  });

  it("rechaza APP_ENV=production", () => {
    expect(
      guardCode(() => testAdminTarget({ TEST_DATABASE_URL: TEST_URL, APP_ENV: "production" })),
    ).toBe("PRODUCTION_ENVIRONMENT");
  });

  it("pasa todos los parámetros a pg, sin depender de PGHOST, PGPORT ni pgpass", () => {
    const config = poolConfig(testAdminTarget({ TEST_DATABASE_URL: TEST_URL }), "prueba");
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 55432,
      user: "sistema_chatbot_test",
      password: "secreta",
      database: "sistema_chatbot_test",
      ssl: false,
      application_name: "prueba",
    });
  });

  it("la marca del contenedor distingue al servidor del proyecto", async () => {
    const server = (clusterName: string) => ({
      query: () => Promise.resolve({ rows: [{ cluster_name: clusterName }] }),
    });
    await expect(verifyClusterMarker(server(CLUSTER_MARKER))).resolves.toBeUndefined();
    for (const other of ["", "postgres_app", "otro"]) {
      await expect(verifyClusterMarker(server(other))).rejects.toMatchObject({
        code: "CLUSTER_MARKER_MISMATCH",
      });
    }
  });
});

describe("nombres de bases temporales", () => {
  const admin = testAdminTarget({ TEST_DATABASE_URL: TEST_URL });

  it("siguen el formato sc_test_<runId>_<n>", () => {
    expect(temporaryDatabaseName("0123456789ab", 7)).toBe("sc_test_0123456789ab_7");
    expect(temporaryDatabaseName("0123456789ab", "template")).toBe("sc_test_0123456789ab_template");
    expect(temporaryTarget(admin, "sc_test_0123456789ab_7").purpose).toBe("test-temporary");
  });

  it.each([
    "sistema_chatbot_dev",
    "postgres",
    "sc_test_xyz_1",
    "sc_test_0123456789ab_0",
    "sc_test_0123456789ab_1;drop",
  ])("rechaza %s como base temporal", (name) => {
    expect(guardCode(() => temporaryTarget(admin, name))).toBe("DATABASE_NOT_ALLOWED");
  });

  it("las bases temporales solo se abren con la conexión de administración de pruebas", () => {
    const development = developmentTarget({ DATABASE_URL: DEV_URL });
    expect(guardCode(() => temporaryTarget(development, "sc_test_0123456789ab_1"))).toBe(
      "ROLE_NOT_ALLOWED",
    );
    expect(guardCode(() => new TemporaryDatabases(development))).toBe("ROLE_NOT_ALLOWED");
  });

  it("no borra una base que no creó, sin llegar a conectarse", async () => {
    const databases = new TemporaryDatabases(admin, "0123456789ab");
    for (const name of [
      "sistema_chatbot_dev",
      "sc_test_0123456789ab_1",
      "sc_test_0123456789ab_template",
    ]) {
      await expect(databases.drop(name)).rejects.toMatchObject({ code: "DATABASE_NOT_ALLOWED" });
    }
    await databases.close();
  });
});

describe(".env local", () => {
  it("completa variables faltantes sin pisar las del entorno", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sc-env-"));
    try {
      const file = join(directory, ".env");
      await writeFile(file, "TEST_DATABASE_URL=desde-archivo\nOTRA=valor\n");
      const env: NodeJS.ProcessEnv = { TEST_DATABASE_URL: "desde-entorno" };
      loadLocalEnv(env, file);
      expect(env).toEqual({ TEST_DATABASE_URL: "desde-entorno", OTRA: "valor" });
      const empty: NodeJS.ProcessEnv = {};
      loadLocalEnv(empty, join(directory, "no-existe"));
      expect(empty).toEqual({});
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
