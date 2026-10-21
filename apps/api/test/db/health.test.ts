import { afterAll, describe, expect, it } from "vitest";
import { gatedHasher } from "../support/fakes.js";
import { Browser } from "../support/http.js";
import {
  apiWith,
  cleanup,
  createUser,
  databaseMissingLastMigration,
  droppableDatabase,
  migratedDatabase,
  PASSWORD,
} from "./support/database.js";

afterAll(cleanup);

// Health y apagado ordenado (plan de P1-T4, §5.3 y §5.15).

describe("health", () => {
  it("ready responde 200 con la base migrada; live no depende de la base", async () => {
    const db = await migratedDatabase();
    const browser = new Browser((await apiWith(db)).baseUrl);
    const ready = await browser.request("GET", "/health/ready");
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: "ready" });
    expect((await browser.request("GET", "/health/live")).body).toEqual({ status: "ok" });
  });

  it("ready responde 503 si falta la última migración", async () => {
    const db = await databaseMissingLastMigration();
    const browser = new Browser((await apiWith(db)).baseUrl);
    expect((await browser.request("GET", "/health/ready")).status).toBe(503);
  });

  it("ready responde 503 si la base deja de existir; live sigue en 200", async () => {
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
