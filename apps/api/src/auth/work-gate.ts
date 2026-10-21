// Compuerta de concurrencia para trabajo costoso (Argon2; plan de P1-T4, §5.5 y §5.9): como mucho
// `maxActive` tareas a la vez y `maxQueued` esperando, cada una hasta `maxWaitMs`. Lo que excede
// se rechaza enseguida con WorkGateSaturatedError, sin reservar memoria.

export interface WorkGateOptions {
  readonly maxActive: number;
  readonly maxQueued: number;
  readonly maxWaitMs: number;
}

export const ARGON2_GATE: WorkGateOptions = Object.freeze({
  maxActive: 2,
  maxQueued: 8,
  maxWaitMs: 2_000,
});

export class WorkGateSaturatedError extends Error {
  constructor() {
    super("La compuerta de trabajo costoso está saturada.");
    this.name = "WorkGateSaturatedError";
  }
}

interface Waiter {
  readonly resolve: () => void;
  readonly timer: NodeJS.Timeout;
}

export class WorkGate {
  readonly #options: WorkGateOptions;
  readonly #queue: Waiter[] = [];
  #active = 0;
  #maxObserved = 0;

  constructor(options: WorkGateOptions = ARGON2_GATE) {
    this.#options = options;
  }

  /** Ejecuta `work` con un lugar de la compuerta y lo libera al terminar, aunque falle. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await work();
    } finally {
      this.#release();
    }
  }

  get active(): number {
    return this.#active;
  }

  get queued(): number {
    return this.#queue.length;
  }

  /** Máximo de tareas simultáneas observado desde que se creó (para pruebas y métricas). */
  get maxObserved(): number {
    return this.#maxObserved;
  }

  #acquire(): Promise<void> {
    if (this.#active < this.#options.maxActive) {
      this.#start();
      return Promise.resolve();
    }
    if (this.#queue.length >= this.#options.maxQueued) {
      return Promise.reject(new WorkGateSaturatedError());
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          const index = this.#queue.indexOf(waiter);
          if (index !== -1) this.#queue.splice(index, 1);
          reject(new WorkGateSaturatedError());
        }, this.#options.maxWaitMs),
      };
      this.#queue.push(waiter);
    });
  }

  #start(): void {
    this.#active++;
    this.#maxObserved = Math.max(this.#maxObserved, this.#active);
  }

  #release(): void {
    this.#active--;
    const next = this.#queue.shift();
    if (next === undefined) return;
    clearTimeout(next.timer);
    this.#start();
    next.resolve();
  }
}
