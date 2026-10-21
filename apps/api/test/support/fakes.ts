import {
  createArgon2Hasher,
  type PasswordCheck,
  type PasswordHasher,
} from "../../src/auth/passwords.js";

// Dobles de prueba: Argon2id real con parámetros mínimos (rápido), hashers que cuentan o que se
// detienen en la verificación, y un reloj manual.

/** Argon2id real con parámetros mínimos. Las pruebas de los parámetros vigentes están aparte. */
export const fastHasher: PasswordHasher = createArgon2Hasher({
  memory: 256,
  passes: 1,
  parallelism: 1,
});

export interface CountingHasher extends PasswordHasher {
  readonly verifications: number;
}

export function countingHasher(base: PasswordHasher = fastHasher): CountingHasher {
  let verifications = 0;
  return {
    hash: (password) => base.hash(password),
    async verify(stored, password) {
      verifications++;
      return base.verify(stored, password);
    },
    get verifications() {
      return verifications;
    },
  };
}

export interface GatedHasher extends PasswordHasher {
  /** Verificaciones que entraron y esperan la liberación. */
  readonly entered: number;
  /** Resuelve cuando `count` verificaciones entraron. */
  waitForEntered(count: number): Promise<void>;
  /** Deja seguir a todas las verificaciones detenidas y a las siguientes. */
  release(): void;
}

export function gatedHasher(base: PasswordHasher = fastHasher): GatedHasher {
  let entered = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const waiters: { count: number; resolve: () => void }[] = [];
  return {
    hash: (password) => base.hash(password),
    async verify(stored, password): Promise<PasswordCheck> {
      entered++;
      for (const waiter of waiters.filter((candidate) => entered >= candidate.count)) {
        waiter.resolve();
      }
      await opened;
      return base.verify(stored, password);
    },
    get entered() {
      return entered;
    },
    waitForEntered(count) {
      if (entered >= count) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push({ count, resolve });
      });
    },
    release() {
      open();
    },
  };
}

export class ManualClock {
  #now: number;

  constructor(start = Date.parse("2026-10-21T12:00:00.000Z")) {
    this.#now = start;
  }

  readonly now = (): Date => new Date(this.#now);

  advance(ms: number): void {
    this.#now += ms;
  }
}

/** Espera, sin pausas fijas, a que la condición se cumpla. */
export async function eventually(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("La condición no se cumplió a tiempo.");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const SESSION_DURATIONS = { idleMs: 30 * MINUTE, absoluteMs: 8 * HOUR } as const;
