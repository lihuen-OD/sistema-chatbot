// Área de trabajo y limpieza en ejecución (plan de P1-T5, §7.1 y §7.2). Principio A4:
// un proceso pausado conserva sus operaciones; ni la antigüedad ni un plazo prueban que
// algo está abandonado. La limpieza en ejecución solo toca lo que no puede pertenecer a
// una operación viva: restos de la propia instancia y contenido de `.reclaim/`, donde
// solo llega material que su dueño ya desprendió. Nunca toca temporales ni bloqueos de
// otras instancias, por viejos que sean; eso queda para el mantenimiento con consumidores
// detenidos (§7.3, bloque posterior).
import { sep } from "node:path";
import { errorCode, writeFully, type FileOps } from "./file-ops.js";

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

export function operationIdFromEntryName(entryName: string): string | null {
  // `<op>.part` es el temporal de una escritura; `lock-<op>` es el bloqueo preparado con
  // su material (§7.1). La operación registra su id antes de crear la entrada.
  if (entryName.endsWith(".part")) return entryName.slice(0, -".part".length);
  if (entryName.startsWith("lock-")) return entryName.slice("lock-".length);
  return null;
}

export interface WorkAreaOptions {
  readonly rootPath: string;
  readonly instanceId: string;
  readonly fileOps: FileOps;
  readonly timing?: WorkAreaTiming;
}

export class WorkArea {
  readonly instanceId: string;
  readonly tmpDirPath: string;
  readonly reclaimDirPath: string;
  readonly instanceDirPath: string;
  private readonly activeOperationIds = new Set<string>();
  private readonly fileOps: FileOps;
  private readonly timing: WorkAreaTiming;

  constructor(options: WorkAreaOptions) {
    this.instanceId = options.instanceId;
    this.fileOps = options.fileOps;
    this.timing = options.timing ?? systemWorkAreaTiming;
    this.tmpDirPath = `${options.rootPath}${sep}tmp`;
    this.reclaimDirPath = `${options.rootPath}${sep}.reclaim`;
    this.instanceDirPath = `${this.tmpDirPath}${sep}${options.instanceId}`;
  }

  get activeOperationCount(): number {
    return this.activeOperationIds.size;
  }

  /** Marca la operación activa antes de crear su primera entrada en disco (§7.1). */
  startOperation(operationId: string): void {
    this.activeOperationIds.add(operationId);
  }

  finishOperation(operationId: string): void {
    this.activeOperationIds.delete(operationId);
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
      const handle = await this.fileOps.openTempForWrite(
        `${this.instanceDirPath}${sep}instance.json`,
      );
      try {
        // `write` puede escribir menos de lo pedido: la escritura completa avanza con
        // los bytes realmente escritos y falla si no hay progreso (§8.3).
        await writeFully(handle, new TextEncoder().encode(payload));
        await handle.fsync();
      } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
      }
      await handle.close();
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
   *    operaciones activas (restos de una limpieza fallida); `instance.json` se conserva;
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
      if (operationId !== null && this.activeOperationIds.has(operationId)) continue;
      await this.removeEntryIntoReclaim(`${this.instanceDirPath}${sep}${entry}`);
      report.ownLeftoverEntries += 1;
    }
    report.reclaimEntriesRemoved += await this.drainReclaim();
    return report;
  }

  /** `close()` (§7.2): la misma limpieza y, si no quedan operaciones activas, borra el
   * directorio de la instancia. Con operaciones activas no espera: las deja terminar por
   * su cuenta, y el directorio queda para esa vez o para el mantenimiento. */
  async close(): Promise<WorkAreaCleanupReport> {
    const report = await this.cleanLeftovers();
    if (this.activeOperationIds.size === 0) {
      await this.fileOps.rm(this.instanceDirPath, { recursive: true, force: true });
    }
    return report;
  }

  private async removeEntryIntoReclaim(entryPath: string): Promise<void> {
    // El desprendimiento a `.reclaim/` separa el borrado de lo vivo: luego lo vacía la
    // misma limpieza u otra instancia (si compiten, un ENOENT cuenta como borrado).
    const reclaimName = `${this.instanceId}-${Math.random().toString(16).slice(2)}`;
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
