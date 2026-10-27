// Área de trabajo y limpieza en ejecución (plan de P1-T5, §7.1 y §7.2). Principio A4:
// un proceso pausado conserva sus operaciones; ni la antigüedad ni un plazo prueban que
// algo está abandonado. La limpieza en ejecución solo toca lo que no puede pertenecer a
// una operación viva: restos de la propia instancia y contenido de `.reclaim/`, donde
// solo llega material que su dueño ya desprendió. Nunca toca temporales ni bloqueos de
// otras instancias, por viejos que sean; eso queda para el mantenimiento con consumidores
// detenidos (§7.3, bloque posterior). El ciclo de vida de la instancia (admisión de
// operaciones y cierre) está en §7.5.
import { randomBytes } from "node:crypto";
import { sep } from "node:path";
import { StorageClosedError } from "../ports/storage.js";
import { errorCode, writeNewFile, type FileOps } from "./file-ops.js";

export interface WorkAreaTiming {
  now(): Date;
}

export const systemWorkAreaTiming: WorkAreaTiming = { now: () => new Date() };

export interface WorkAreaCleanupReport {
  /** Entradas de `tmp/<instancia>/` borradas: temporales y bloqueos preparados propios
   * que no usa ninguna operación activa. */
  readonly ownLeftoverEntries: number;
  /** Entradas de `.reclaim/` borradas; un ENOENT de una carrera entre instancias cuenta
   * como borrado (§7.2). */
  readonly reclaimEntriesRemoved: number;
}

export interface WorkAreaCloseReport extends WorkAreaCleanupReport {
  /** Entradas retenidas que el cierre conservó (§7.1): pruebas de publicaciones inciertas
   * y material de retiros no restituidos. Con alguna, `tmp/<instancia>/` queda. */
  readonly retainedEntries: number;
}

/** Ciclo de vida de la instancia (§7.5). */
export type WorkAreaState = "OPEN" | "CLOSING" | "CLOSED";

/** El id ya está registrado (activo o retenido): la operación nueva no se admite y el
 * registro de la otra queda intacto. Con 128 bits aleatorios solo ocurre con un
 * generador defectuoso o inyectado. */
export class OperationIdInUseError extends Error {
  constructor() {
    super("El id de operación ya está registrado en esta instancia.");
    this.name = "OperationIdInUseError";
  }
}

export function operationIdFromEntryName(entryName: string): string | null {
  // `<op>.part` es el temporal de una escritura (o la prueba retenida de una publicación
  // incierta); `del-<op>` es el destino privado de un retiro exclusivo (§8.5); `lock-<op>`
  // es el bloqueo preparado con su material (§7.1). La operación registra su id antes de
  // crear la entrada.
  if (entryName.endsWith(".part")) return entryName.slice(0, -".part".length);
  if (entryName.startsWith("del-")) return entryName.slice("del-".length);
  if (entryName.startsWith("lock-")) return entryName.slice("lock-".length);
  return null;
}

export interface WorkAreaOptions {
  readonly rootPath: string;
  readonly instanceId: string;
  readonly fileOps: FileOps;
  readonly timing?: WorkAreaTiming;
  /** Error de una operación nueva después de empezar el cierre (§7.5). Cada adaptador usa
   * el suyo; por defecto, el del almacenamiento. */
  readonly closedError?: () => Error;
}

export class WorkArea {
  readonly instanceId: string;
  readonly tmpDirPath: string;
  readonly reclaimDirPath: string;
  readonly instanceDirPath: string;
  private readonly activeOperationIds = new Set<string>();
  /** Operaciones terminadas cuya entrada no se puede limpiar (§7.1): ninguna limpieza en
   * ejecución la toca y el cierre no borra el directorio mientras exista. */
  private readonly retainedOperationIds = new Set<string>();
  /** Operaciones admitidas sin entrada propia (la limpieza en ejecución). */
  private untrackedActiveCount = 0;
  private lifecycle: WorkAreaState = "OPEN";
  private drainWaiters: (() => void)[] = [];
  private closeAttempt: Promise<WorkAreaCloseReport> | undefined;
  private closeReport: WorkAreaCloseReport | undefined;
  private readonly fileOps: FileOps;
  private readonly timing: WorkAreaTiming;
  private readonly closedError: () => Error;

  constructor(options: WorkAreaOptions) {
    this.instanceId = options.instanceId;
    this.fileOps = options.fileOps;
    this.timing = options.timing ?? systemWorkAreaTiming;
    this.closedError = options.closedError ?? (() => new StorageClosedError());
    this.tmpDirPath = `${options.rootPath}${sep}tmp`;
    this.reclaimDirPath = `${options.rootPath}${sep}.reclaim`;
    this.instanceDirPath = `${this.tmpDirPath}${sep}${options.instanceId}`;
  }

  get activeOperationCount(): number {
    return this.activeOperationIds.size;
  }

  get retainedEntryCount(): number {
    return this.retainedOperationIds.size;
  }

  get state(): WorkAreaState {
    return this.lifecycle;
  }

  /** Rechaza si la instancia ya empezó a cerrar (§7.5). */
  assertOpen(): void {
    if (this.lifecycle !== "OPEN") throw this.closedError();
  }

  /**
   * Admite una operación antes de su primera espera y de crear cualquier entrada (§7.1,
   * §7.5). Rechaza con el error de cierre del adaptador si la instancia ya empezó a
   * cerrar, y con `OperationIdInUseError` si el id está registrado, sin tocar ese registro.
   */
  admitOperation(operationId: string): void {
    this.assertOpen();
    if (this.activeOperationIds.has(operationId) || this.retainedOperationIds.has(operationId)) {
      throw new OperationIdInUseError();
    }
    this.activeOperationIds.add(operationId);
  }

  /** Admite una operación sin entrada propia; devuelve la liberación (idempotente). */
  admitUntracked(): () => void {
    this.assertOpen();
    this.untrackedActiveCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.untrackedActiveCount -= 1;
      this.notifyIfDrained();
    };
  }

  /** Termina una operación admitida. No toca las retenidas. */
  finishOperation(operationId: string): void {
    this.activeOperationIds.delete(operationId);
    this.notifyIfDrained();
  }

  /** La operación termina, pero su entrada queda retenida (§7.1): la prueba de una
   * publicación incierta o el material de un retiro no restituido. */
  retainOperation(operationId: string): void {
    this.activeOperationIds.delete(operationId);
    this.retainedOperationIds.add(operationId);
    this.notifyIfDrained();
  }

  /** Suelta una entrada retenida: desde ahí, si queda, es un resto propio más. */
  releaseRetained(operationId: string): void {
    this.retainedOperationIds.delete(operationId);
  }

  /** Paso a `CLOSING` (§7.5): desde acá ninguna operación nueva se admite. */
  beginClosing(): void {
    if (this.lifecycle === "OPEN") this.lifecycle = "CLOSING";
  }

  /** Espera a que terminen las operaciones admitidas antes del cierre. */
  async waitForAdmittedOperations(): Promise<void> {
    if (this.isDrained()) return;
    await new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  /**
   * Cierre (§7.5), compartido por los adaptadores locales. Pasa a CLOSING antes de
   * cualquier espera, así ninguna operación nueva usa recursos que el cierre retira; espera
   * a las ya admitidas; corre los pasos propios del adaptador (`beforeFinish`: recorrido
   * de antecesores, verificación de la raíz y, en la captura, la liberación de bloqueos
   * propios pendientes); después limpia y borra el directorio de la instancia, salvo
   * entradas retenidas. Las llamadas concurrentes comparten el intento; después de cerrar
   * se devuelve el mismo informe sin tocar el disco; si un intento falla, la llamada
   * siguiente lo reintenta.
   */
  async closeWith<Extra extends object>(
    beforeFinish: () => Promise<Extra>,
  ): Promise<WorkAreaCloseReport & Extra> {
    if (this.closeReport !== undefined) return this.closeReport as WorkAreaCloseReport & Extra;
    this.beginClosing();
    this.closeAttempt ??= this.runClose(beforeFinish);
    return (await this.closeAttempt) as WorkAreaCloseReport & Extra;
  }

  private async runClose(beforeFinish: () => Promise<object>): Promise<WorkAreaCloseReport> {
    try {
      await this.waitForAdmittedOperations();
      const extra = await beforeFinish();
      const report = { ...(await this.finishClosing()), ...extra };
      this.closeReport = report;
      return report;
    } finally {
      this.closeAttempt = undefined;
    }
  }

  /** Último paso del cierre (§7.5), sin operaciones admitidas: la misma limpieza y el
   * borrado del directorio de la instancia, salvo que haya entradas retenidas. */
  async finishClosing(): Promise<WorkAreaCloseReport> {
    const report = await this.cleanLeftovers();
    const retainedEntries = this.retainedOperationIds.size;
    if (retainedEntries === 0) {
      await this.fileOps.rm(this.instanceDirPath, { recursive: true, force: true });
    }
    this.lifecycle = "CLOSED";
    return { ...report, retainedEntries };
  }

  private isDrained(): boolean {
    return this.activeOperationIds.size === 0 && this.untrackedActiveCount === 0;
  }

  private notifyIfDrained(): void {
    if (!this.isDrained() || this.drainWaiters.length === 0) return;
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Crea el directorio de la instancia y su `instance.json` informativo (0600): guarda
   * instanceId, pid y fecha; sirve para el informe del mantenimiento y nunca prueba si
   * el proceso vive (un pid se reutiliza, §7.1). El `mkdir` falla si el directorio ya
   * existe, así que nunca se escribe sobre otra instancia. Si algo falla después, se
   * borra el directorio recién creado: nadie va a usar esa instancia. */
  async initialize(): Promise<void> {
    // 0700 pedido a `mkdir` (§6.4) y reafirmado con `chmod`, porque la umask puede
    // recortarlo.
    await this.fileOps.mkdir(this.instanceDirPath, 0o700);
    try {
      await this.fileOps.chmod(this.instanceDirPath, 0o700);
      const payload = `${JSON.stringify({
        instanceId: this.instanceId,
        pid: process.pid,
        createdAt: this.timing.now().toISOString(),
      })}\n`;
      // Escritura completa (`write` puede escribir menos de lo pedido) y `fsync` (§8.3).
      await writeNewFile(
        this.fileOps,
        `${this.instanceDirPath}${sep}instance.json`,
        new TextEncoder().encode(payload),
      );
    } catch (error) {
      await this.fileOps
        .rm(this.instanceDirPath, { recursive: true, force: true })
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * Limpieza en ejecución (§7.2). Solo toca:
   * 1. entradas de `tmp/<instancia>/` propias cuyo id no está en el registro de
   *    operaciones activas ni retenidas (restos de una limpieza fallida); `instance.json`
   *    se conserva;
   * 2. el contenido de `.reclaim/`, material ya desprendido de toda operación.
   * Nunca toca `tmp/` ni `locks/` de otras instancias, ni `captures/` ni `objects/`.
   */
  async cleanLeftovers(): Promise<WorkAreaCleanupReport> {
    const report: { ownLeftoverEntries: number; reclaimEntriesRemoved: number } = {
      ownLeftoverEntries: 0,
      reclaimEntriesRemoved: 0,
    };
    const entries = await this.fileOps.readdir(this.instanceDirPath);
    for (const entry of entries) {
      if (entry === "instance.json") continue;
      const operationId = operationIdFromEntryName(entry);
      if (
        operationId !== null &&
        (this.activeOperationIds.has(operationId) || this.retainedOperationIds.has(operationId))
      ) {
        continue;
      }
      await this.removeEntryIntoReclaim(`${this.instanceDirPath}${sep}${entry}`);
      report.ownLeftoverEntries += 1;
    }
    report.reclaimEntriesRemoved += await this.drainReclaim();
    return report;
  }

  private async removeEntryIntoReclaim(entryPath: string): Promise<void> {
    // El desprendimiento a `.reclaim/` separa el borrado de lo vivo: luego lo vacía la
    // misma limpieza u otra instancia (si compiten, un ENOENT cuenta como borrado). El
    // nombre es de 128 bits: `rename` reemplazaría una entrada existente.
    const reclaimName = `${this.instanceId}-${randomBytes(16).toString("hex")}`;
    try {
      await this.fileOps.rename(entryPath, `${this.reclaimDirPath}${sep}${reclaimName}`);
    } catch (error) {
      if (isEnoent(error)) return;
      throw error;
    }
    await this.fileOps.rm(`${this.reclaimDirPath}${sep}${reclaimName}`, {
      recursive: true,
      force: true,
    });
  }

  private async drainReclaim(): Promise<number> {
    let removed = 0;
    const entries = await this.fileOps.readdir(this.reclaimDirPath);
    for (const entry of entries) {
      try {
        await this.fileOps.rm(`${this.reclaimDirPath}${sep}${entry}`, {
          recursive: true,
          force: true,
        });
        removed += 1;
      } catch (error) {
        if (!isEnoent(error)) throw error;
        removed += 1;
      }
    }
    return removed;
  }
}

function isEnoent(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}
