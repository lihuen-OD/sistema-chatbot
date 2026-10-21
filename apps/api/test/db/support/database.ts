import {
  loadLocalEnv,
  openDatabase,
  readMigrationFiles,
  runMigrations,
  TemporaryDatabases,
  testAdminTarget,
  type ConnectionTarget,
} from "@sistema-chatbot/db";
import { inject } from "vitest";
import { createAdminUser } from "../../../src/auth/admin-users.js";
import type { PasswordHasher } from "../../../src/auth/passwords.js";
import type { Database } from "../../../src/auth/store.js";
import type { AppDependencies } from "../../../src/http/app.js";
import { fastHasher, SESSION_DURATIONS } from "../../support/fakes.js";
import { ADMIN_ORIGIN, startApi, type StartedApi } from "../../support/http.js";

// Bases y servidores de un archivo de pruebas. Cada archivo clona sus bases desde la plantilla de
// la ejecución y, al terminar, cierra servidores y conexiones y borra solo las bases que creó.

loadLocalEnv();
const run = inject("database");
let databases: TemporaryDatabases | undefined;
const opened: Database[] = [];
const servers: StartedApi[] = [];

function temporary(): TemporaryDatabases {
  databases ??= new TemporaryDatabases(testAdminTarget(process.env), run.runId);
  return databases;
}

async function open(target: ConnectionTarget): Promise<Database> {
  const db = await openDatabase(target, "sistema-chatbot-api-test");
  opened.push(db);
  return db;
}

/** Base temporal migrada (clon de la plantilla). */
export async function migratedDatabase(): Promise<Database> {
  return open(await temporary().create(undefined, run.template));
}

/** Base temporal migrada que la prueba puede borrar (con FORCE) para simular una base caída. */
export async function droppableDatabase(): Promise<{ db: Database; drop: () => Promise<void> }> {
  const target = await temporary().create(undefined, run.template);
  const db = await open(target);
  return { db, drop: () => temporary().drop(target.database) };
}

/** Base temporal sin la última migración: el esquema no está al día. */
export async function databaseMissingLastMigration(): Promise<Database> {
  const target = await temporary().create(undefined, "template0");
  const files = await readMigrationFiles();
  await runMigrations({ target, files: files.slice(0, -1) });
  return open(target);
}

export async function expectedMigrations(): Promise<string[]> {
  return (await readMigrationFiles()).map((file) => file.name);
}

const dummyHash = fastHasher.hash("hash ficticio de las pruebas");

/** API real sobre la base indicada, con dependencias de prueba que se pueden reemplazar. */
export async function apiWith(
  db: Database,
  overrides: Partial<AppDependencies> = {},
): Promise<StartedApi> {
  const started = await startApi({
    adminOrigin: ADMIN_ORIGIN,
    cookieMode: "local-http",
    db,
    hasher: fastHasher,
    dummyHash: await dummyHash,
    sessions: SESSION_DURATIONS,
    expectedMigrations: await expectedMigrations(),
    ...overrides,
  });
  servers.push(started);
  return started;
}

export const PASSWORD = "contraseña de prueba suficientemente larga";

export async function createUser(
  db: Database,
  email = "admin@example.com",
  password = PASSWORD,
  hasher: PasswordHasher = fastHasher,
): Promise<string> {
  const result = await createAdminUser(db, hasher, email, password);
  if (!result.ok) throw new Error(`No se pudo crear el usuario: ${result.problem}`);
  const user = await db
    .selectFrom("adminUsers")
    .select("id")
    .where("emailNormalized", "=", email)
    .executeTakeFirstOrThrow();
  return user.id;
}

export async function sessionsOf(
  db: Database,
  userId: string,
): Promise<{ revokeReason: string | null; tokenHash: Buffer }[]> {
  return db
    .selectFrom("adminSessions")
    .select(["revokeReason", "tokenHash"])
    .where("userId", "=", userId)
    .orderBy("createdAt")
    .execute();
}

export async function cleanup(): Promise<void> {
  for (const server of servers.splice(0)) await server.close().catch(() => undefined);
  for (const db of opened.splice(0)) await db.destroy().catch(() => undefined);
  await databases?.dropAll();
  await databases?.close();
}
