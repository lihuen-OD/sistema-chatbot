// Bloqueo por clave de las capturas entre instancias y procesos (plan de P1-T5, §9.4). La
// clave está ocupada si existe `locks/<captureId>/`. La adquisición es un único `rename` de
// un directorio preparado y nunca vacío (`tmp/<instancia>/lock-<op>/`, con `owner.json` y,
// en `send`, la captura en `staged/`) a `locks/<captureId>`: si el destino existe, el
// `rename` falla con EEXIST o ENOTEMPTY y la clave está ocupada. No hay comprobación previa
// ni mutex en memoria: la exclusión la da el sistema de archivos, así que vale entre
// instancias y entre procesos sobre la misma raíz.
//
// Sin ruptura automática (A4): un bloqueo no se quita por antigüedad, plazo, pid ni estado
// aparente del titular. Solo el titular lo libera; uno abandonado por una caída queda hasta
// el mantenimiento con los consumidores detenidos (§7.3, bloque posterior).
import { randomBytes } from "node:crypto";
import { sep } from "node:path";
import { errorCode, writeNewFile, type FileOps } from "./file-ops.js";
import { readOwnSmallFile } from "./own-files.js";
import {
  createVerifiedPrivateDirectory,
  lstatOrMissing,
  PrivateDirectoryPreparationError,
} from "./private-root.js";
import type { WorkArea } from "./work-area.js";

/** Espera de `send` y de la comprobación de `readCapture` (§9.4 y §12): de 20 a 200 ms,
 * creciente, hasta 5 s. Constante con nombre, no configuración. La purga no espera. */
export const CAPTURE_LOCK_WAIT = Object.freeze({
  firstDelayMs: 20,
  maxDelayMs: 200,
  totalMs: 5000,
});

/** Reloj y espera inyectables: las pruebas recorren las esperas largas con un reloj falso
 * (plan §13). */
export interface CaptureTiming {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export const systemCaptureTiming: CaptureTiming = {
  now: () => new Date(),
  sleep: (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

export type CaptureLockOperation = "SEND" | "READ" | "PURGE";

/** Directorio preparado en `tmp/<instancia>/lock-<op>/`, con su identidad. */
export interface PreparedLock {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly token: string;
}

/** Bloqueo tomado: el mismo directorio, ya en `locks/<captureId>`. */
export interface HeldLock {
  readonly captureId: string;
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly token: string;
}

/** La adquisición falló con un error que no es "ocupado" (§9.5). `uncertain`: tampoco se
 * pudo comprobar si el `rename` tomó efecto; quien llama conserva el material y no toca
 * `locks/<captureId>`. */
export class CaptureLockAcquisitionError extends Error {
  readonly uncertain: boolean;

  constructor(cause: unknown, uncertain: boolean) {
    super("No se pudo adquirir el bloqueo de la captura.", { cause });
    this.name = "CaptureLockAcquisitionError";
    this.uncertain = uncertain;
  }
}

const OWNER_FILE = "owner.json";
const OWNER_FORMAT = "LOCAL_CAPTURE_LOCK_OWNER_V1";
const OWNER_MAX_BYTES = 1024;

export interface CaptureKeyLocksOptions {
  readonly fileOps: FileOps;
  readonly rootPath: string;
  readonly workArea: WorkArea;
  readonly processUid: number;
  readonly timing: CaptureTiming;
  /** Control previo a cada intento de adquisición (las guardas de entorno, §5.4), sin
   * ninguna espera entre él y el `rename`: cubre la espera de la copia y la del bloqueo. Si
   * lanza, no se adquiere nada y lo preparado sigue en `tmp/` para que quien llama lo retire.
   * La liberación nunca lo usa: un rechazo no impide liberar lo propio. */
  readonly beforeAcquire: () => void;
}

export class CaptureKeyLocks {
  private readonly fileOps: FileOps;
  private readonly locksPath: string;
  private readonly reclaimPath: string;
  private readonly workArea: WorkArea;
  private readonly processUid: number;
  private readonly timing: CaptureTiming;
  private readonly beforeAcquire: () => void;

  constructor(options: CaptureKeyLocksOptions) {
    this.fileOps = options.fileOps;
    this.locksPath = `${options.rootPath}${sep}locks`;
    this.reclaimPath = `${options.rootPath}${sep}.reclaim`;
    this.workArea = options.workArea;
    this.processUid = options.processUid;
    this.timing = options.timing;
    this.beforeAcquire = options.beforeAcquire;
  }

  lockPathOf(captureId: string): string {
    return `${this.locksPath}${sep}${captureId}`;
  }

  /**
   * Prepara `tmp/<instancia>/lock-<op>/` (§9.4, paso 1): directorio propio 0700 verificado,
   * `owner.json` (instancia, pid, token y fecha, solo información para el mantenimiento) y
   * el material de la operación (`populate`, en `send` la captura en `staged/`). Todo con
   * `fsync`. Si el `mkdir` falla (también con EEXIST), nada es de esta operación y no se toca;
   * si falla algo después, se borra lo que esta operación creó y se propaga el error.
   */
  async prepare<T>(
    operationId: string,
    operation: CaptureLockOperation,
    populate: (lockDirectory: string) => Promise<T>,
  ): Promise<{ prepared: PreparedLock; populated: T }> {
    const path = `${this.workArea.instanceDirPath}${sep}lock-${operationId}`;
    try {
      await createVerifiedPrivateDirectory(this.fileOps, path, this.processUid);
    } catch (error) {
      if (error instanceof PrivateDirectoryPreparationError) {
        if (!error.removed) this.workArea.retainOperation(operationId);
        throw error.cause;
      }
      throw error;
    }
    try {
      const token = randomBytes(16).toString("hex");
      const owner = {
        format: OWNER_FORMAT,
        instanceId: this.workArea.instanceId,
        pid: process.pid,
        token,
        operation,
        createdAt: this.timing.now().toISOString(),
      };
      await writeNewFile(
        this.fileOps,
        `${path}${sep}${OWNER_FILE}`,
        new TextEncoder().encode(`${JSON.stringify(owner)}\n`),
      );
      const populated = await populate(path);
      await this.fileOps.fsyncDir(path);
      const stat = await this.fileOps.lstat(path);
      return { prepared: { path, dev: stat.dev, ino: stat.ino, token }, populated };
    } catch (error) {
      await this.removePrepared(path);
      throw error;
    }
  }

  /** Borra un directorio preparado que sigue en el `tmp/` propio (nunca adquirido). Si
   * falla, queda como resto propio para la limpieza en ejecución (§7.2). */
  async removePrepared(path: string): Promise<void> {
    await this.fileOps.rm(path, { recursive: true, force: true }).catch(() => undefined);
  }

  /**
   * Un intento de adquisición (§9.4, paso 2): `rename(lo preparado, locks/<captureId>)`.
   * EEXIST o ENOTEMPTY: ocupado, y lo preparado sigue en `tmp/`. Con otro error se compara
   * el dev e inodo de `locks/<captureId>` con lo preparado (§9.5): si es el nuestro, el
   * bloqueo está tomado; si no, `CaptureLockAcquisitionError`. Si esa comparación también
   * falla, el error es incierto. Antes del `rename` corre `beforeAcquire`.
   */
  async tryAcquire(prepared: PreparedLock, captureId: string): Promise<HeldLock | null> {
    const lockPath = this.lockPathOf(captureId);
    this.beforeAcquire();
    try {
      await this.fileOps.rename(prepared.path, lockPath);
    } catch (error) {
      const code = errorCode(error);
      if (code === "EEXIST" || code === "ENOTEMPTY") return null;
      let current;
      try {
        current = await lstatOrMissing(this.fileOps, lockPath);
      } catch {
        throw new CaptureLockAcquisitionError(error, true);
      }
      if (current?.dev !== prepared.dev || current.ino !== prepared.ino) {
        throw new CaptureLockAcquisitionError(error, false);
      }
    }
    return {
      captureId,
      path: lockPath,
      dev: prepared.dev,
      ino: prepared.ino,
      token: prepared.token,
    };
  }

  /** Adquisición con espera creciente de 20 a 200 ms, hasta 5 s (§9.4). `null`: la clave
   * siguió ocupada durante toda la espera. */
  async acquireWithWait(prepared: PreparedLock, captureId: string): Promise<HeldLock | null> {
    const deadline = this.timing.now().getTime() + CAPTURE_LOCK_WAIT.totalMs;
    let delay: number = CAPTURE_LOCK_WAIT.firstDelayMs;
    for (;;) {
      const held = await this.tryAcquire(prepared, captureId);
      if (held !== null) return held;
      const remaining = deadline - this.timing.now().getTime();
      if (remaining <= 0) return null;
      await this.timing.sleep(Math.min(delay, remaining));
      delay = Math.min(delay * 2, CAPTURE_LOCK_WAIT.maxDelayMs);
    }
  }

  /**
   * Liberación (§9.4): solo la hace el titular, y solo si `locks/<captureId>` sigue siendo
   * su directorio (mismo dev e inodo y mismo token en `owner.json`). Entonces lo traslada a
   * `.reclaim/` con un `rename` y lo borra; el material reclamado o `staged/` se va con él.
   * `NOT_OWNED`: el bloqueo ya no es el propio (alguien fuera del protocolo lo tocó) y no se
   * toca nada. Un error del sistema se propaga: quien llama deja la liberación pendiente.
   */
  async release(held: HeldLock): Promise<"RELEASED" | "NOT_OWNED"> {
    const current = await lstatOrMissing(this.fileOps, held.path);
    if (current?.dev !== held.dev || current.ino !== held.ino) return "NOT_OWNED";
    const owner = await readOwnSmallFile(
      this.fileOps,
      `${held.path}${sep}${OWNER_FILE}`,
      this.processUid,
      OWNER_MAX_BYTES,
    );
    if (owner.kind !== "OK" || ownerToken(owner.value) !== held.token) return "NOT_OWNED";
    const reclaimed = `${this.reclaimPath}${sep}${this.workArea.instanceId}-lock-${randomBytes(16).toString("hex")}`;
    await this.fileOps.rename(held.path, reclaimed);
    // Ya desprendido: si el borrado falla, lo vacía cualquier limpieza de `.reclaim/`.
    await this.fileOps.rm(reclaimed, { recursive: true, force: true }).catch(() => undefined);
    return "RELEASED";
  }
}

function ownerToken(bytes: Uint8Array): string | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== "object" || value === null) return null;
    const token = (value as { token?: unknown }).token;
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}
