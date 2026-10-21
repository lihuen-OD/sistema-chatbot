import { randomBytes } from "node:crypto";
import {
  DatabaseGuardError,
  loadLocalEnv,
  openDatabase,
  readMigrationFiles,
} from "@sistema-chatbot/db";
import { createArgon2Hasher } from "./auth/passwords.js";
import { formatConfigProblems, loadConfig } from "./config.js";
import { createApp } from "./http/app.js";
import { stdoutLogger } from "./logger.js";
import { startServer } from "./server.js";

// Arranque de la API (plan de P1-T4, §5.2 y §5.15). En desarrollo y pruebas completa el entorno
// con el .env local; con APP_ENV ya definido como staging o production no lo lee.

const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const declared = process.env["APP_ENV"];
  if (declared === undefined || declared === "development" || declared === "test") loadLocalEnv();

  const loaded = loadConfig(process.env);
  if (!loaded.ok) {
    process.stderr.write(`Configuración inválida:\n${formatConfigProblems(loaded.problems)}\n`);
    process.exitCode = 1;
    return;
  }
  const { config } = loaded;

  const db = await openDatabase(config.database, "sistema-chatbot-api");
  const expectedMigrations = (await readMigrationFiles()).map((file) => file.name);
  const hasher = createArgon2Hasher();
  const dummyHash = await hasher.hash(randomBytes(32).toString("base64url"));

  const api = createApp({
    adminOrigin: config.adminOrigin,
    cookieMode: config.cookieMode,
    db,
    hasher,
    dummyHash,
    sessions: {
      idleMs: config.session.idleMinutes * 60_000,
      absoluteMs: config.session.absoluteHours * 3_600_000,
    },
    expectedMigrations,
    logger: stdoutLogger,
  });
  const running = await startServer(api.app, config.host, config.port);
  stdoutLogger({
    event: "listening",
    host: config.host,
    port: running.port,
    cookieMode: config.cookieMode,
  });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    stdoutLogger({ event: "shutdown_started", signal });
    api.beginShutdown();
    void running
      .close(SHUTDOWN_GRACE_MS)
      .then(() => db.destroy())
      .then(() => {
        stdoutLogger({ event: "shutdown_completed" });
      });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

main().catch((error: unknown) => {
  // Solo el nombre o el código de la guarda: un error de conexión podría citar la URL.
  const detail =
    error instanceof DatabaseGuardError
      ? error.code
      : error instanceof Error
        ? error.name
        : "error desconocido";
  process.stderr.write(`No se pudo iniciar la API: ${detail}\n`);
  process.exitCode = 1;
});
