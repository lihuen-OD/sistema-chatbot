// Límites de intentos en memoria del proceso (plan de P1-T4, §5.9): por red y por par email-red.
// Cada intento reserva su lugar antes del trabajo costoso, así que una ráfaga concurrente sobre la
// misma clave no pasa toda junta por la comprobación. Son suficientes con un solo proceso en
// loopback (P1); con varias instancias habrá que compartirlos (P7).

export interface WindowLimit {
  /** Intentos admitidos por ventana. */
  readonly limit: number;
  readonly windowMs: number;
}

export type Admission =
  { readonly admitted: true } | { readonly admitted: false; readonly retryAfterSeconds: number };

interface Entry {
  count: number;
  windowStart: number;
}

export class FixedWindowLimiter {
  readonly #limit: WindowLimit;
  readonly #maxKeys: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();

  constructor(limit: WindowLimit, now: () => number, maxKeys = 10_000) {
    this.#limit = limit;
    this.#now = now;
    this.#maxKeys = maxKeys;
  }

  /** Reserva un intento para la clave. Si no hay lugar, informa cuándo reintentar. */
  reserve(key: string): Admission {
    const now = this.#now();
    let entry = this.#entries.get(key);
    if (entry !== undefined && now - entry.windowStart >= this.#limit.windowMs) {
      this.#entries.delete(key);
      entry = undefined;
    }
    if (entry === undefined) {
      this.#makeRoom(now);
      entry = { count: 0, windowStart: now };
      this.#entries.set(key, entry);
    }
    if (entry.count >= this.#limit.limit) {
      const remaining = entry.windowStart + this.#limit.windowMs - now;
      return { admitted: false, retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)) };
    }
    entry.count++;
    return { admitted: true };
  }

  /** Devuelve un intento reservado que no llegó a evaluarse (por ejemplo, por saturación). */
  refund(key: string): void {
    const entry = this.#entries.get(key);
    if (entry !== undefined && entry.count > 0) entry.count--;
  }

  /** Pone la clave en cero (login correcto). */
  reset(key: string): void {
    this.#entries.delete(key);
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Mantiene el máximo de claves: primero descarta las vencidas y después las más viejas. */
  #makeRoom(now: number): void {
    if (this.#entries.size < this.#maxKeys) return;
    for (const [key, entry] of this.#entries) {
      if (now - entry.windowStart >= this.#limit.windowMs) this.#entries.delete(key);
    }
    for (const key of this.#entries.keys()) {
      if (this.#entries.size < this.#maxKeys) break;
      this.#entries.delete(key);
    }
  }
}
