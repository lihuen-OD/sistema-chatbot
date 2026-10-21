import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { emailKeyHash } from "../../src/auth/email.js";
import {
  createLimiters,
  login,
  LOGIN_LIMITS,
  SESSION_LOCK_TIMEOUT_MS,
  type LoginDependencies,
  type LoginLimits,
} from "../../src/auth/login.js";
import type { Database } from "../../src/auth/store.js";
import { WorkGate } from "../../src/auth/work-gate.js";
import { eventually, fastHasher, gatedHasher, SESSION_DURATIONS } from "../support/fakes.js";
import { Browser, type ApiResponse } from "../support/http.js";
import { apiWith, cleanup, createUser, migratedDatabase, PASSWORD } from "./support/database.js";

afterAll(cleanup);

// Admisión concurrente del login antes del trabajo costoso (plan de P1-T4, §5.9): ráfagas sobre
// la misma clave reciben 429 por los límites; la saturación de Argon2 recibe 503.

const WIDE_NETWORK: LoginLimits = {
  ...LOGIN_LIMITS,
  perNetwork: { limit: 1_000, windowMs: 15 * 60_000 },
};

/** Lanza las peticiones juntas y devuelve una función para esperar a que `count` terminen. */
function burst(requests: (() => Promise<ApiResponse>)[]): {
  all: Promise<ApiResponse[]>;
  settled: (count: number) => Promise<ApiResponse[]>;
} {
  const done: ApiResponse[] = [];
  const waiters: { count: number; resolve: (responses: ApiResponse[]) => void }[] = [];
  const all = Promise.all(
    requests.map(async (request) => {
      const response = await request();
      done.push(response);
      for (const waiter of waiters.filter((candidate) => done.length >= candidate.count)) {
        waiter.resolve([...done]);
      }
      return response;
    }),
  );
  return {
    all,
    settled: (count) =>
      done.length >= count
        ? Promise.resolve([...done])
        : new Promise((resolve) => waiters.push({ count, resolve })),
  };
}

function statuses(responses: readonly ApiResponse[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const { status } of responses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

async function failures(db: Database, email: string): Promise<number | undefined> {
  const row = await db
    .selectFrom("adminLoginThrottle")
    .select("failures")
    .where("keyHash", "=", emailKeyHash(email))
    .executeTakeFirst();
  return row?.failures;
}

describe("ráfagas sobre la misma clave", () => {
  it("de 12 intentos al mismo email, 5 llegan a verificar y 7 reciben 429, sin 503", async () => {
    const db = await migratedDatabase();
    await createUser(db);
    const hasher = gatedHasher();
    const gate = new WorkGate({ maxActive: 2, maxQueued: 8, maxWaitMs: 30_000 });
    const { baseUrl } = await apiWith(db, { hasher, gate, limits: WIDE_NETWORK });
    const browser = new Browser(baseUrl);

    const run = burst(
      Array.from({ length: 12 }, () => () => browser.login("admin@example.com", "incorrecta")),
    );
    const early = await run.settled(7);
    expect(statuses(early)).toEqual({ 429: 7 });
    for (const response of early)
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    // Los 5 admitidos llegan a la compuerta: 2 verifican y 3 esperan. Ninguno recibe 503.
    await eventually(() => gate.active + gate.queued === 5);
    await hasher.waitForEntered(2);
    expect(hasher.entered).toBe(2);

    hasher.release();
    expect(statuses(await run.all)).toEqual({ 401: 5, 429: 7 });
    expect(gate.maxObserved).toBe(2);
    expect(await failures(db, "admin@example.com")).toBe(5);
  });

  it("de 15 emails distintos a la vez, 10 entran a la compuerta y 5 reciben 503", async () => {
    const db = await migratedDatabase();
    const hasher = gatedHasher();
    const gate = new WorkGate({ maxActive: 2, maxQueued: 8, maxWaitMs: 30_000 });
    const { baseUrl } = await apiWith(db, { hasher, gate, limits: WIDE_NETWORK });
    const browser = new Browser(baseUrl);
    const emails = Array.from({ length: 15 }, (_, i) => `persona_${String(i)}@example.com`);

    const run = burst(emails.map((email) => () => browser.login(email, "incorrecta")));
    const early = await run.settled(5);
    expect(statuses(early)).toEqual({ 503: 5 });
    for (const response of early) expect(response.headers.get("retry-after")).toBe("1");
    await hasher.waitForEntered(2);
    expect(hasher.entered).toBe(2);
    expect(gate.queued).toBe(8);

    hasher.release();
    expect(statuses(await run.all)).toEqual({ 401: 10, 503: 5 });
    expect(gate.maxObserved).toBe(2);
    // Los intentos saturados se devolvieron: no cuentan como fallos del email.
    const counted = await Promise.all(emails.map((email) => failures(db, email)));
    expect(counted.filter((value) => value === 1)).toHaveLength(10);
    expect(counted.filter((value) => value === 0)).toHaveLength(5);
  });
});

describe("límite por email compartido entre procesos", () => {
  it("dos instancias de la API comparten el límite, también para un email inexistente", async () => {
    const db = await migratedDatabase();
    const limits: LoginLimits = { ...WIDE_NETWORK, perEmail: { limit: 3, windowMs: 60 * 60_000 } };
    const first = new Browser((await apiWith(db, { limits })).baseUrl);
    const second = new Browser((await apiWith(db, { limits })).baseUrl);

    for (let i = 0; i < 3; i++)
      expect((await first.login("nadie@example.com", "x")).status).toBe(401);
    // La segunda instancia no vio esos intentos en memoria: el 429 viene de la base.
    const limited = await second.login("nadie@example.com", "x");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(3_500);
  });

  function deps(db: Database, dummyHash: string): LoginDependencies {
    return {
      db,
      hasher: fastHasher,
      dummyHash,
      gate: new WorkGate(),
      limits: LOGIN_LIMITS,
      ...createLimiters(LOGIN_LIMITS, () => Date.now()),
      sessions: SESSION_DURATIONS,
      clock: () => new Date(),
      random: randomBytes,
      sessionLockTimeoutMs: SESSION_LOCK_TIMEOUT_MS,
    };
  }

  it("una sola red no bloquea la cuenta para otra; 30 fallos desde varias redes sí", async () => {
    const db = await migratedDatabase();
    await createUser(db);
    const dummyHash = await fastHasher.hash("ficticio");
    const processA = deps(db, dummyHash);
    const processB = deps(db, dummyHash);
    const attempt = (process: LoginDependencies, network: string, password = "incorrecta") =>
      login(process, { email: "admin@example.com", password, network });

    // Desde una red, el par se bloquea a los 5 fallos; la cuenta sigue disponible desde otra.
    for (let i = 0; i < 5; i++)
      expect((await attempt(processA, "red-atacante")).kind).toBe("INVALID");
    expect((await attempt(processA, "red-atacante")).kind).toBe("RATE_LIMITED");
    expect((await attempt(processA, "red-legitima", PASSWORD)).kind).toBe("SUCCESS");

    // Mitigación con límites: 30 fallos repartidos en 6 redes y 2 procesos agotan el límite
    // global, y entonces la cuenta queda bloqueada hasta que termina la ventana, también para
    // quien conoce la contraseña.
    for (let red = 0; red < 6; red++) {
      const process = red % 2 === 0 ? processA : processB;
      for (let i = 0; i < 5; i++) await attempt(process, `red-${String(red)}`);
    }
    expect(await failures(db, "admin@example.com")).toBe(30);
    expect((await attempt(processB, "red-nueva", PASSWORD)).kind).toBe("RATE_LIMITED");
  });
});
