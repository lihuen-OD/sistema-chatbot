import { afterEach, describe, expect, it, vi } from "vitest";
import { FixedWindowLimiter } from "../../src/auth/limiters.js";
import { WorkGate, WorkGateSaturatedError } from "../../src/auth/work-gate.js";

// Piezas de la admisión del login (plan de P1-T4, §5.5 y §5.9), con reloj controlado.

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("compuerta de trabajo costoso", () => {
  it("como mucho 2 activas y 8 en cola; el resto se rechaza enseguida", async () => {
    const gate = new WorkGate({ maxActive: 2, maxQueued: 8, maxWaitMs: 60_000 });
    const release = deferred();
    const started: number[] = [];
    const results = Array.from({ length: 12 }, (_, i) =>
      gate
        .run(async () => {
          started.push(i);
          await release.promise;
          return i;
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({
            ok: false as const,
            saturated: error instanceof WorkGateSaturatedError,
          }),
        ),
    );
    await Promise.resolve();
    expect(gate.active).toBe(2);
    expect(gate.queued).toBe(8);
    expect(started).toEqual([0, 1]);

    release.resolve();
    const settled = await Promise.all(results);
    expect(settled.filter((result) => result.ok)).toHaveLength(10);
    expect(settled.slice(10)).toEqual([
      { ok: false, saturated: true },
      { ok: false, saturated: true },
    ]);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(gate.maxObserved).toBe(2);
    expect(gate.active).toBe(0);
  });

  it("una espera que vence el plazo se rechaza y libera su lugar en la cola", async () => {
    vi.useFakeTimers();
    const gate = new WorkGate({ maxActive: 1, maxQueued: 1, maxWaitMs: 2_000 });
    const release = deferred();
    const holding = gate.run(() => release.promise);
    const waiting = gate.run(() => Promise.resolve("tarde"));
    const rejected = expect(waiting).rejects.toBeInstanceOf(WorkGateSaturatedError);
    expect(gate.queued).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
    expect(gate.queued).toBe(0);
    release.resolve();
    await holding;
    expect(gate.active).toBe(0);
  });

  it("libera el lugar aunque el trabajo falle", async () => {
    const gate = new WorkGate({ maxActive: 1, maxQueued: 0, maxWaitMs: 10 });
    await expect(gate.run(() => Promise.reject(new Error("falla")))).rejects.toThrow("falla");
    await expect(gate.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});

describe("límite por ventana fija", () => {
  it("admite el límite, rechaza con Retry-After y vuelve a admitir al vencer la ventana", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ limit: 5, windowMs: 15 * 60_000 }, () => now);
    for (let i = 0; i < 5; i++) expect(limiter.reserve("clave")).toEqual({ admitted: true });
    now = 60_000;
    expect(limiter.reserve("clave")).toEqual({ admitted: false, retryAfterSeconds: 14 * 60 });
    expect(limiter.reserve("otra")).toEqual({ admitted: true });
    now = 15 * 60_000;
    expect(limiter.reserve("clave")).toEqual({ admitted: true });
  });

  it("refund devuelve un intento y reset pone la clave en cero", () => {
    const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 1_000 }, () => 0);
    limiter.reserve("k");
    limiter.reserve("k");
    expect(limiter.reserve("k").admitted).toBe(false);
    limiter.refund("k");
    expect(limiter.reserve("k").admitted).toBe(true);
    limiter.reset("k");
    expect(limiter.reserve("k").admitted).toBe(true);
    expect(limiter.reserve("k").admitted).toBe(true);
    expect(limiter.reserve("k").admitted).toBe(false);
  });

  it("acota la memoria: descarta primero las claves vencidas y después las más viejas", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 1_000 }, () => now, 3);
    limiter.reserve("a");
    now = 600;
    limiter.reserve("b");
    limiter.reserve("c");
    now = 1_100;
    // "a" venció: se descarta antes que "b" y "c".
    limiter.reserve("d");
    expect(limiter.size).toBe(3);
    expect(limiter.reserve("b").admitted).toBe(false);
    // Lleno y sin vencidas: se descarta la más vieja ("b") para dar lugar a "e".
    limiter.reserve("e");
    expect(limiter.size).toBe(3);
    expect(limiter.reserve("b").admitted).toBe(true);
  });
});
