import { afterAll, describe, expect, it } from "vitest";
import { gatedHasher } from "../support/fakes.js";
import { Browser } from "../support/http.js";
import type { Database } from "../../src/auth/store.js";
import type { LogEvent } from "../../src/logger.js";
import {
  apiWith,
  cleanup,
  createUser,
  databaseMissingLastMigration,
  droppableDatabase,
  expectedMigrations,
  migratedDatabase,
  PASSWORD,
} from "./support/database.js";

afterAll(cleanup);

// Health y apagado ordenado (plan de P1-T4, §5.3 y §5.15).

describe("health", () => {
  // Política de P1 (plan §5.3): `ready` exige exactamente las migraciones esperadas por la API.
  async function readiness(
    db: Database,
    expected?: readonly string[],
  ): Promise<{ ready: number; live: number; reasons: unknown[] }> {
    const events: LogEvent[] = [];
    const browser = new Browser(
      (
        await apiWith(db, {
          logger: (event) => events.push(event),
          ...(expected === undefined ? {} : { expectedMigrations: expected }),
        })
      ).baseUrl,
    );
    const ready = (await browser.request("GET", "/health/ready")).status;
    const live = (await browser.request("GET", "/health/live")).status;
    const reasons = events
      .filter((event) => event["event"] === "not_ready")
      .map((event) => event["reason"]);
    return { ready, live, reasons };
  }

  it("esquema exacto: ready 200 y live 200", async () => {
    const db = await migratedDatabase();
    expect(await readiness(db)).toEqual({ ready: 200, live: 200, reasons: [] });
    const browser = new Browser((await apiWith(db)).baseUrl);
    expect((await browser.request("GET", "/health/ready")).body).toEqual({ status: "ready" });
  });

  it("migración faltante: ready 503 y live 200", async () => {
    const db = await databaseMissingLastMigration();
    expect(await readiness(db)).toEqual({
      ready: 503,
      live: 200,
      reasons: ["MIGRATIONS_PENDING"],
    });
  });

  it("migración adicional (API más vieja que la base): ready 503 y live 200", async () => {
    const db = await migratedDatabase();
    const older = (await expectedMigrations()).slice(0, -1);
    expect(await readiness(db, older)).toEqual({
      ready: 503,
      live: 200,
      reasons: ["MIGRATIONS_UNEXPECTED"],
    });
  });

  it("base que deja de existir: ready 503 y live 200", async () => {
    const { db, drop } = await droppableDatabase();
    const browser = new Browser((await apiWith(db)).baseUrl);
    expect((await browser.request("GET", "/health/ready")).status).toBe(200);
    await drop();
    expect((await browser.request("GET", "/health/ready")).status).toBe(503);
    expect((await browser.request("GET", "/health/live")).status).toBe(200);
  });
});

describe("apagado ordenado", () => {
  it("ready pasa a 503, termina la petición en curso y rechaza conexiones nuevas", async () => {
    const db = await migratedDatabase();
    await createUser(db);
    const hasher = gatedHasher();
    const started = await apiWith(db, { hasher });
    const browser = new Browser(started.baseUrl);

    const inFlight = browser.login("admin@example.com", PASSWORD);
    await hasher.waitForEntered(1);
    started.api.beginShutdown();
    expect((await browser.request("GET", "/health/ready")).status).toBe(503);

    const closing = started.close(10_000);
    await expect(browser.request("GET", "/health/live")).rejects.toThrow();
    hasher.release();
    expect((await inFlight).status).toBe(200);
    await closing;
  });
});
