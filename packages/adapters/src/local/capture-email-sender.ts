// Captura local de correo (plan de P1-T5, §9): implementa el puerto EmailSender sin entregar
// nada. Cada `send` válido deja una captura en `<raíz>/captures/<captureId>/`, publicada de
// forma atómica bajo el bloqueo de su clave (§9.4 y §9.5), deduplicada por la clave de
// idempotencia y verificada al reconocerla (§9.6). `readCapture`, `purgeCaptures`,
// `recoverWorkArea` y `close` completan la superficie (§9.1). El resultado es CAPTURED, con
// `delivered: false`: nunca un correo enviado ni entregado. Los módulos locales no abren
// red ni lanzan procesos (§4). La clase no sale por `index.ts`: solo la fábrica.
import { randomBytes } from "node:crypto";
import { sep } from "node:path";
import {
  DEFAULT_MAIL_CAPTURE_RECORD_DAYS,
  DEFAULT_MAIL_CAPTURE_RETENTION_DAYS,
  DEFAULT_MAX_FILE_BYTES,
} from "../config.js";
import { assertLocalAdapterEnvironment } from "../environment.js";
import {
  CAPTURE_ID_PATTERN,
  CaptureClosedError,
  CaptureIntegrityError,
  CaptureKeyBusyError,
  CaptureNotFoundError,
  CaptureWriteError,
  InvalidCaptureIdError,
  LOCAL_CAPTURE_KIND,
  type CaptureIntegrityReason,
  type CapturedEmail,
  type CapturedMessage,
  type CapturePurgeReport,
  type EmailSendResult,
  type EmailSender,
  type OutgoingEmail,
} from "../ports/email.js";
import { copyIntoHandle } from "./byte-copy.js";
import {
  CaptureKeyLocks,
  CaptureLockAcquisitionError,
  systemCaptureTiming,
  type CaptureLockOperation,
  type CaptureTiming,
  type HeldLock,
  type PreparedLock,
} from "./capture-key-lock.js";
import {
  captureIdentity,
  MESSAGE_MAX_BYTES,
  parseMessage,
  parseRecord,
  RECORD_MAX_BYTES,
  serializeMessage,
  serializeRecord,
  sha256Hex,
  validateOutgoingEmail,
  type AttachmentMetadata,
  type CaptureMessageDocument,
  type CaptureRecordDocument,
  type ValidatedEmail,
} from "./capture-message.js";
import { errorCode, nodeFileOps, writeNewFile, type FileOps, type Stats } from "./file-ops.js";
import { isOwnPrivateDirectory, readOwnFileHashed, readOwnSmallFile } from "./own-files.js";
import {
  createVerifiedPrivateDirectory,
  lstatOrMissing,
  preparePrivateRoot,
  PrivateDirectoryPreparationError,
  type PrivateRootContext,
} from "./private-root.js";
import {
  OperationIdInUseError,
  WorkArea,
  type WorkAreaCleanupReport,
  type WorkAreaCloseReport,
} from "./work-area.js";

export const CAPTURE_ROOT_SUBDIRECTORIES = ["captures", "locks", "tmp", ".reclaim"] as const;

const DAY_MS = 86_400_000;
const RETENTION_DAYS_RANGE = { min: 1, max: 30 } as const;
const RECORD_DAYS_RANGE = { min: 1, max: 365 } as const;
const MAX_FILE_BYTES_RANGE = { min: 1, max: 10_485_760 } as const;

export interface LocalCaptureEmailSenderOptions {
  /** Ruta absoluta de la raíz de capturas; la forma se revalida al construir (§6.1). */
  readonly rootPath: string;
  /** Plazo del contenido (`payload/`), en días desde `capturedAt`: 1 a 30, por defecto 7. */
  readonly retentionDays?: number;
  /** Plazo del registro (la entrada completa): 1 a 365, no menor que el anterior, por
   * defecto 30. Es el alcance temporal de la idempotencia local (§9.8). */
  readonly recordDays?: number;
  /** Máximo de bytes del adjunto (`MAX_FILE_BYTES`): 1 a 10485760. */
  readonly maxFileBytes?: number;
}

/** Evento de mantenimiento sin datos personales: solo un código y el `captureId`. */
export interface CaptureMaintenanceEvent {
  readonly kind: "CAPTURE_LOCK_RELEASE_PENDING" | "CAPTURE_LOCK_NOT_OWNED";
  readonly captureId: string;
}

export interface InternalCaptureOptions extends LocalCaptureEmailSenderOptions {
  readonly appEnv: string;
  readonly fileOps?: FileOps;
  readonly instanceId?: string;
  readonly timing?: CaptureTiming;
  /** Inyectable para las pruebas: ids de operación y `publicationId`. */
  readonly randomHex128?: () => string;
  readonly onMaintenanceEvent?: (event: CaptureMaintenanceEvent) => void;
}

/** Informe de `recoverWorkArea()` (§7.2): además de los restos propios, los bloqueos propios
 * cuya liberación había fallado. */
export interface CaptureCleanupReport extends WorkAreaCleanupReport {
  readonly locksReleased: number;
  readonly locksStillPending: number;
}

/** Informe de `close()` (§7.5). */
export type CaptureCloseReport = WorkAreaCloseReport & { readonly locksStillPending: number };

/** Lo preparado por `send` dentro de `staged/`. */
interface StagedCapture {
  readonly contentSha256: string;
  readonly dev: number;
  readonly ino: number;
}

/** Lectura de `record.json` de una entrada. `VANISHED`: la entrada existía al empezar y ya
 * no está (una purga concurrente sin bloqueo, o alguien fuera del protocolo bajo él). */
type RecordRead =
  | { readonly kind: "ABSENT" }
  | { readonly kind: "VANISHED" }
  | { readonly kind: "ANOMALY"; readonly reason: CaptureIntegrityReason }
  | { readonly kind: "RECORD"; readonly record: CaptureRecordDocument; readonly entry: Stats };

type PayloadRead =
  | { readonly kind: "ABSENT" }
  | { readonly kind: "VANISHED" }
  | { readonly kind: "ANOMALY"; readonly reason: CaptureIntegrityReason }
  | { readonly kind: "VALID"; readonly message: CapturedMessage };

/** El adjunto superó `maxFileBytes` durante la copia: se rechaza, no es un fallo. */
class AttachmentTooLargeSignal extends Error {
  constructor() {
    super("El adjunto supera el máximo configurado.");
    this.name = "AttachmentTooLargeSignal";
  }
}

export class LocalCaptureEmailSender implements EmailSender {
  readonly kind = LOCAL_CAPTURE_KIND;
  readonly deliversExternally = false as const;
  private readonly appEnv: string;
  private readonly fileOps: FileOps;
  private readonly root: PrivateRootContext;
  private readonly workArea: WorkArea;
  private readonly locks: CaptureKeyLocks;
  private readonly timing: CaptureTiming;
  private readonly retentionDays: number;
  private readonly recordDays: number;
  private readonly maxFileBytes: number;
  private readonly randomHex128: () => string;
  private readonly onMaintenanceEvent: (event: CaptureMaintenanceEvent) => void;
  /** Bloqueos propios cuya liberación falló: los reintentan `recoverWorkArea` y `close`
   * (§7.2, punto 2). Mientras tanto, esa clave da KEY_BUSY. */
  private readonly pendingReleases = new Map<string, HeldLock>();

  private constructor(deps: {
    appEnv: string;
    fileOps: FileOps;
    root: PrivateRootContext;
    workArea: WorkArea;
    timing: CaptureTiming;
    retentionDays: number;
    recordDays: number;
    maxFileBytes: number;
    randomHex128: () => string;
    onMaintenanceEvent: (event: CaptureMaintenanceEvent) => void;
  }) {
    this.appEnv = deps.appEnv;
    this.fileOps = deps.fileOps;
    this.root = deps.root;
    this.workArea = deps.workArea;
    this.timing = deps.timing;
    this.retentionDays = deps.retentionDays;
    this.recordDays = deps.recordDays;
    this.maxFileBytes = deps.maxFileBytes;
    this.randomHex128 = deps.randomHex128;
    this.onMaintenanceEvent = deps.onMaintenanceEvent;
    this.locks = new CaptureKeyLocks({
      fileOps: deps.fileOps,
      rootPath: deps.root.rootPath,
      workArea: deps.workArea,
      processUid: deps.root.processUid,
      timing: deps.timing,
    });
  }

  get instanceId(): string {
    return this.workArea.instanceId;
  }

  /** Construcción: guardas de entorno (§5), plazos y límite, raíz privada y antecesores (§6)
   * con `captures/`, `locks/`, `tmp/` y `.reclaim/`, y área de trabajo con su
   * `instance.json` (§7.1). Nada se corrige en silencio. */
  static async build(options: InternalCaptureOptions): Promise<LocalCaptureEmailSender> {
    const appEnv = assertLocalAdapterEnvironment(options.appEnv);
    const retentionDays = resolveIntegerOption(
      "retentionDays",
      options.retentionDays ?? DEFAULT_MAIL_CAPTURE_RETENTION_DAYS,
      RETENTION_DAYS_RANGE,
    );
    const recordDays = resolveIntegerOption(
      "recordDays",
      options.recordDays ?? DEFAULT_MAIL_CAPTURE_RECORD_DAYS,
      RECORD_DAYS_RANGE,
    );
    if (recordDays < retentionDays) {
      throw new TypeError("recordDays no puede ser menor que retentionDays.");
    }
    const maxFileBytes = resolveIntegerOption(
      "maxFileBytes",
      options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      MAX_FILE_BYTES_RANGE,
    );
    const fileOps = options.fileOps ?? nodeFileOps;
    const timing = options.timing ?? systemCaptureTiming;
    const root = await preparePrivateRoot({
      rootPath: options.rootPath,
      subdirectories: CAPTURE_ROOT_SUBDIRECTORIES,
      fileOps,
    });
    const workArea = new WorkArea({
      rootPath: options.rootPath,
      instanceId: options.instanceId ?? defaultRandomHex128(),
      fileOps,
      timing,
      closedError: () => new CaptureClosedError(),
    });
    await workArea.initialize();
    return new LocalCaptureEmailSender({
      appEnv,
      fileOps,
      root,
      workArea,
      timing,
      retentionDays,
      recordDays,
      maxFileBytes,
      randomHex128: options.randomHex128 ?? defaultRandomHex128,
      onMaintenanceEvent:
        options.onMaintenanceEvent ??
        (() => {
          return undefined;
        }),
    });
  }

  /**
   * send (§9.5). 1) Validación sin escribir nada (§9.2). 2) Preparación sin bloqueo de
   * `tmp/<instancia>/lock-<op>/` con `owner.json` y la captura completa en `staged/`, con
   * `fsync` de archivos y directorios. 3) Adquisición del bloqueo de la clave: el mismo
   * `rename` deja la captura preparada bajo el bloqueo. 4) Bajo el bloqueo: si la entrada no
   * existe, se publica con `rename(staged, captures/<id>)`; si existe, se verifica (§9.6).
   * 5) `fsync` de `captures/`. 6) Liberación. El punto de publicación es el éxito del
   * `rename` del paso 4.
   */
  async send(idempotencyKey: string, message: OutgoingEmail): Promise<EmailSendResult> {
    assertLocalAdapterEnvironment(this.appEnv);
    this.workArea.assertOpen();
    const validation = validateOutgoingEmail(idempotencyKey, message);
    if (!validation.ok) return validation.rejection;
    const { captureId, idempotencyKeySha256 } = captureIdentity(idempotencyKey);
    const operationId = this.randomHex128();
    this.admit(operationId, (cause) => new CaptureWriteError("BEFORE_PUBLISH", { cause }));
    let held: HeldLock | null = null;
    try {
      await this.root.verify(["root", "captures", "locks", "tmp"]);
      let prepared: PreparedLock;
      let staged: StagedCapture;
      try {
        ({ prepared, populated: staged } = await this.locks.prepare(
          operationId,
          "SEND",
          (lockDir) =>
            this.stageCapture(lockDir, captureId, idempotencyKeySha256, validation.email),
        ));
      } catch (error) {
        if (error instanceof AttachmentTooLargeSignal) {
          return Object.freeze({ outcome: "REJECTED", reason: "ATTACHMENT_TOO_LARGE" });
        }
        throw new CaptureWriteError("BEFORE_PUBLISH", { cause: error });
      }
      held = await this.acquireOrThrow(operationId, prepared, captureId);
      return await this.publishOrVerify(held, captureId, idempotencyKeySha256, staged);
    } finally {
      if (held !== null) await this.releaseLock(held);
      this.workArea.finishOperation(operationId);
    }
  }

  /**
   * readCapture (§9.7). Camino normal sin bloqueo: si la lectura es coherente (registro,
   * contenido validado contra `contentSha256` y la misma publicación al final), se devuelve.
   * Ante una anomalía no concluye: repite la lectura bajo el bloqueo de la clave (con la
   * espera de §9.4, y KEY_BUSY si no lo obtiene) y recién ahí decide. Nunca devuelve datos
   * mezclados.
   */
  async readCapture(captureId: string): Promise<CapturedEmail> {
    assertLocalAdapterEnvironment(this.appEnv);
    if (typeof captureId !== "string" || !CAPTURE_ID_PATTERN.test(captureId)) {
      throw new InvalidCaptureIdError();
    }
    this.workArea.assertOpen();
    await this.root.verify(["root", "captures"]);
    const unlocked = await this.readWithoutLock(captureId);
    if (unlocked === "ABSENT") throw new CaptureNotFoundError(captureId);
    if (unlocked !== "CHECK_UNDER_LOCK") return unlocked;
    return this.readUnderLock(captureId);
  }

  /**
   * purgeCaptures (§9.8). 1) Escaneo sin bloqueo: lee cada `record.json` y anota qué venció,
   * por `capturedAt` del registro. 2) Por cada candidato intenta el bloqueo sin esperar; si
   * está ocupado (incluido un bloqueo abandonado), lo omite. 3) Bajo el bloqueo relee y
   * decide: sin directorio, lo omite; sin registro, lo informa (§9.7); otro `publicationId`,
   * es una captura recreada y la omite; el mismo, recalcula el vencimiento y reclama dentro
   * del bloqueo el contenido o la entrada. 4) `fsync` del directorio afectado, liberación y
   * borrado de lo reclamado.
   */
  async purgeCaptures(): Promise<CapturePurgeReport> {
    assertLocalAdapterEnvironment(this.appEnv);
    const release = this.workArea.admitUntracked();
    const report = {
      scanned: 0,
      payloadsPurged: 0,
      entriesPurged: 0,
      skippedBusy: [] as string[],
      skippedRecreated: [] as string[],
      integrityProblems: [] as { captureId: string; reason: CaptureIntegrityReason }[],
      unreadable: [] as string[],
    };
    try {
      await this.root.verify(["root", "captures", "locks", "tmp", ".reclaim"]);
      const names = [...(await this.fileOps.readdir(this.capturesPath()))]
        .filter((name) => CAPTURE_ID_PATTERN.test(name))
        .sort();
      const candidates: { captureId: string; publicationId: string | null }[] = [];
      for (const captureId of names) {
        report.scanned += 1;
        let read: RecordRead;
        try {
          read = await this.readRecord(captureId);
        } catch {
          report.unreadable.push(captureId);
          continue;
        }
        if (read.kind === "ABSENT" || read.kind === "VANISHED") continue;
        if (read.kind === "ANOMALY") {
          // Lo visto sin bloqueo no decide: se comprueba bajo el bloqueo (§9.7 y §9.8).
          candidates.push({ captureId, publicationId: null });
          continue;
        }
        if (this.expiry(read.record) !== "NONE") {
          candidates.push({ captureId, publicationId: read.record.publicationId });
        }
      }
      for (const candidate of candidates) {
        await this.purgeOne(candidate.captureId, candidate.publicationId, report);
      }
      return Object.freeze({
        ...report,
        skippedBusy: Object.freeze(report.skippedBusy),
        skippedRecreated: Object.freeze(report.skippedRecreated),
        integrityProblems: Object.freeze(report.integrityProblems),
        unreadable: Object.freeze(report.unreadable),
      });
    } finally {
      release();
    }
  }

  /** Limpieza en ejecución (§7.2): restos propios sin operación activa ni retenidos,
   * `.reclaim/`, y los bloqueos propios cuya liberación había fallado. Nunca toca `tmp/` ni
   * `locks/` de otras instancias, por viejos que sean (A4). */
  async recoverWorkArea(): Promise<CaptureCleanupReport> {
    assertLocalAdapterEnvironment(this.appEnv);
    const release = this.workArea.admitUntracked();
    try {
      await this.root.walkAncestors();
      await this.root.verify(["root", "locks", "tmp", ".reclaim"]);
      const locksReleased = await this.retryPendingReleases();
      const report = await this.workArea.cleanLeftovers();
      return { ...report, locksReleased, locksStillPending: this.pendingReleases.size };
    } finally {
      release();
    }
  }

  /** Cierre (§7.5), con el mismo ciclo de vida que el almacenamiento. Antes de la limpieza
   * final reintenta liberar los bloqueos propios pendientes; los que no pudo liberar quedan
   * (la clave da KEY_BUSY hasta el mantenimiento, §7.3) y se informan. */
  async close(): Promise<CaptureCloseReport> {
    assertLocalAdapterEnvironment(this.appEnv);
    return this.workArea.closeWith(async () => {
      await this.root.walkAncestors();
      await this.root.verify(["root", "locks", "tmp", ".reclaim"]);
      await this.retryPendingReleases();
      return { locksStillPending: this.pendingReleases.size };
    });
  }

  // ----- send -----

  /** `staged/` dentro del bloqueo preparado (§9.5, paso 2): `payload/attachment.bin` copiado
   * por streaming con el límite durante la copia y el hash de los bytes reales,
   * `payload/message.json` y `record.json` con un `publicationId` nuevo. Archivos 0600 con
   * O_EXCL y `fsync`; directorios 0700 verificados y con `fsync`. */
  private async stageCapture(
    lockDirectory: string,
    captureId: string,
    idempotencyKeySha256: string,
    email: ValidatedEmail,
  ): Promise<StagedCapture> {
    const stagedPath = `${lockDirectory}${sep}staged`;
    const payloadPath = `${stagedPath}${sep}payload`;
    await this.createOwnDirectory(stagedPath);
    await this.createOwnDirectory(payloadPath);
    let attachment: AttachmentMetadata | null = null;
    if (email.attachment !== null) {
      const handle = await this.fileOps.openTempForWrite(`${payloadPath}${sep}attachment.bin`);
      let copied;
      try {
        const iterator = email.attachment.content[Symbol.asyncIterator]();
        copied = await copyIntoHandle(
          handle,
          iterator,
          { maxBytes: this.maxFileBytes },
          {
            tooLarge: () => new AttachmentTooLargeSignal(),
            // `send` no recibe señal de cancelación: nunca se usa.
            cancelled: () => new Error("Cancelación no prevista en send."),
          },
        );
        await handle.fsync();
      } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
      }
      await handle.close();
      attachment = {
        fileName: email.attachment.fileName,
        mimeType: email.attachment.mimeType,
        sizeBytes: copied.sizeBytes,
        sha256: copied.sha256,
      };
    }
    const messageBytes = serializeMessage(email, attachment);
    const contentSha256 = sha256Hex(messageBytes);
    await writeNewFile(this.fileOps, `${payloadPath}${sep}message.json`, messageBytes);
    await writeNewFile(
      this.fileOps,
      `${stagedPath}${sep}record.json`,
      serializeRecord({
        captureId,
        publicationId: this.randomHex128(),
        idempotencyKeySha256,
        contentSha256,
        capturedAt: this.timing.now().toISOString(),
      }),
    );
    await this.fileOps.fsyncDir(payloadPath);
    await this.fileOps.fsyncDir(stagedPath);
    const stagedStat = await this.fileOps.lstat(stagedPath);
    return { contentSha256, dev: stagedStat.dev, ino: stagedStat.ino };
  }

  /** Adquisición con espera (§9.4 y §9.5, paso 3). KEY_BUSY si la clave sigue ocupada toda la
   * espera; con otro error, BEFORE_PUBLISH. Si ni siquiera se pudo comprobar si el `rename`
   * tomó efecto, el material se conserva (retenido) y `locks/<id>` no se toca. */
  private async acquireOrThrow(
    operationId: string,
    prepared: PreparedLock,
    captureId: string,
  ): Promise<HeldLock> {
    let held: HeldLock | null;
    try {
      held = await this.locks.acquireWithWait(prepared, captureId);
    } catch (error) {
      if (error instanceof CaptureLockAcquisitionError && error.uncertain) {
        this.workArea.retainOperation(operationId);
      } else {
        await this.locks.removePrepared(prepared.path);
      }
      throw new CaptureWriteError("BEFORE_PUBLISH", {
        cause: error instanceof CaptureLockAcquisitionError ? error.cause : error,
      });
    }
    if (held === null) {
      await this.locks.removePrepared(prepared.path);
      throw new CaptureKeyBusyError(captureId);
    }
    return held;
  }

  /** Bajo el bloqueo (§9.5, pasos 4 y 5, y §9.6). */
  private async publishOrVerify(
    held: HeldLock,
    captureId: string,
    idempotencyKeySha256: string,
    staged: StagedCapture,
  ): Promise<EmailSendResult> {
    const entryPath = this.entryPathOf(captureId);
    let existing: Stats | null;
    try {
      existing = await lstatOrMissing(this.fileOps, entryPath);
    } catch (error) {
      // No se puede decidir: no se publica nada. `staged/` se descarta al liberar.
      throw new CaptureWriteError("BEFORE_PUBLISH", { cause: error });
    }
    if (existing !== null) {
      return this.verifyExisting(captureId, idempotencyKeySha256, staged.contentSha256);
    }
    const stagedPath = `${held.path}${sep}staged`;
    try {
      await this.fileOps.rename(stagedPath, entryPath);
    } catch (error) {
      await this.reconcilePublication(error, captureId, stagedPath, entryPath, staged);
    }
    try {
      await this.fileOps.fsyncDir(this.capturesPath());
    } catch (error) {
      // Publicada y completa; la durabilidad queda sin confirmar. No se retira: el reintento
      // con la misma clave la reconoce y repite el `fsync` (§9.5).
      throw new CaptureWriteError("AFTER_PUBLISH", { captureId, cause: error });
    }
    return captured(captureId, false, true);
  }

  /** `rename` de publicación con error (§9.5). Vuelve normalmente solo si la captura quedó
   * publicada (es nuestro `staged/`); si no, lanza el resultado de la fila que corresponde. */
  private async reconcilePublication(
    error: unknown,
    captureId: string,
    stagedPath: string,
    entryPath: string,
    staged: StagedCapture,
  ): Promise<void> {
    const code = errorCode(error);
    if (code === "EEXIST" || code === "ENOTEMPTY") {
      // Apareció una entrada pese al bloqueo: un actor fuera del protocolo. No se toca.
      throw new CaptureIntegrityError(captureId, "ENTRY_APPEARED_UNDER_LOCK");
    }
    if (code === "ENOENT") {
      let stagedNow: Stats | null;
      try {
        stagedNow = await lstatOrMissing(this.fileOps, stagedPath);
      } catch {
        throw new CaptureWriteError("BEFORE_PUBLISH", { cause: error });
      }
      if (stagedNow === null) throw new CaptureIntegrityError(captureId, "STAGED_MISSING");
      throw new CaptureWriteError("BEFORE_PUBLISH", { cause: error });
    }
    let published: Stats | null;
    try {
      published = await lstatOrMissing(this.fileOps, entryPath);
    } catch {
      // Incierto: ni el `rename` ni su comprobación dicen si quedó publicada. No se borra nada
      // publicado; el reintento con la misma clave lo resuelve (la verifica o la publica).
      throw new CaptureWriteError("PUBLISH_UNCERTAIN", { captureId, cause: error });
    }
    if (published === null) throw new CaptureWriteError("BEFORE_PUBLISH", { cause: error });
    if (published.dev !== staged.dev || published.ino !== staged.ino) {
      throw new CaptureIntegrityError(captureId, "ENTRY_APPEARED_UNDER_LOCK");
    }
    // Es nuestro `staged/`: el `rename` tomó efecto y sigue como publicada.
  }

  /** Verificación de una captura existente, siempre bajo el bloqueo (§9.6). */
  private async verifyExisting(
    captureId: string,
    idempotencyKeySha256: string,
    contentSha256: string,
  ): Promise<EmailSendResult> {
    let read: RecordRead;
    try {
      read = await this.readRecord(captureId);
    } catch (error) {
      throw new CaptureWriteError("BEFORE_PUBLISH", { cause: error });
    }
    if (read.kind === "ABSENT" || read.kind === "VANISHED") {
      // Existía al tomar la decisión, bajo el bloqueo propio: alguien fuera del protocolo.
      throw new CaptureIntegrityError(captureId, "ENTRY_VANISHED_UNDER_LOCK");
    }
    if (read.kind === "ANOMALY") throw new CaptureIntegrityError(captureId, read.reason);
    if (read.record.idempotencyKeySha256 !== idempotencyKeySha256) {
      throw new CaptureIntegrityError(captureId, "IDEMPOTENCY_KEY_MISMATCH");
    }
    if (read.record.contentSha256 !== contentSha256) {
      return Object.freeze({ outcome: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
    }
    let payload: PayloadRead;
    try {
      payload = await this.readPayload(captureId, read.record, false);
    } catch (error) {
      throw new CaptureWriteError("BEFORE_PUBLISH", { cause: error });
    }
    if (payload.kind === "ANOMALY") throw new CaptureIntegrityError(captureId, payload.reason);
    if (payload.kind === "VANISHED") {
      throw new CaptureIntegrityError(captureId, "PAYLOAD_INCOMPLETE");
    }
    try {
      await this.fileOps.fsyncDir(this.capturesPath());
    } catch (error) {
      throw new CaptureWriteError("AFTER_PUBLISH", { captureId, cause: error });
    }
    return captured(captureId, true, payload.kind === "VALID");
  }

  // ----- readCapture -----

  private async readWithoutLock(
    captureId: string,
  ): Promise<CapturedEmail | "ABSENT" | "CHECK_UNDER_LOCK"> {
    try {
      const first = await this.readRecord(captureId);
      if (first.kind === "ABSENT") return "ABSENT";
      if (first.kind !== "RECORD") return "CHECK_UNDER_LOCK";
      const payload = await this.readPayload(captureId, first.record, true);
      if (payload.kind === "ANOMALY" || payload.kind === "VANISHED") return "CHECK_UNDER_LOCK";
      // Coherencia: la entrada y la publicación siguen siendo las mismas al terminar.
      const last = await this.readRecord(captureId);
      if (
        last.kind !== "RECORD" ||
        last.record.publicationId !== first.record.publicationId ||
        last.entry.dev !== first.entry.dev ||
        last.entry.ino !== first.entry.ino
      ) {
        return "CHECK_UNDER_LOCK";
      }
      return toCapturedEmail(first.record, payload);
    } catch {
      // Un error del sistema no es ausencia: se decide bajo el bloqueo.
      return "CHECK_UNDER_LOCK";
    }
  }

  private async readUnderLock(captureId: string): Promise<CapturedEmail> {
    const result = await this.withLock(captureId, "READ", "WAIT", async () => {
      const read = await this.readRecord(captureId);
      if (read.kind === "ABSENT") throw new CaptureNotFoundError(captureId);
      if (read.kind === "VANISHED") {
        throw new CaptureIntegrityError(captureId, "ENTRY_VANISHED_UNDER_LOCK");
      }
      if (read.kind === "ANOMALY") throw new CaptureIntegrityError(captureId, read.reason);
      const payload = await this.readPayload(captureId, read.record, true);
      if (payload.kind === "ANOMALY") throw new CaptureIntegrityError(captureId, payload.reason);
      if (payload.kind === "VANISHED") {
        throw new CaptureIntegrityError(captureId, "PAYLOAD_INCOMPLETE");
      }
      return toCapturedEmail(read.record, payload);
    });
    if (result === "BUSY") throw new CaptureKeyBusyError(captureId);
    return result;
  }

  // ----- purgeCaptures -----

  private async purgeOne(
    captureId: string,
    expectedPublicationId: string | null,
    report: {
      payloadsPurged: number;
      entriesPurged: number;
      skippedBusy: string[];
      skippedRecreated: string[];
      integrityProblems: { captureId: string; reason: CaptureIntegrityReason }[];
      unreadable: string[];
    },
  ): Promise<void> {
    const outcome = await this.withLock(captureId, "PURGE", "NO_WAIT", async (held) => {
      let read: RecordRead;
      try {
        read = await this.readRecord(captureId);
      } catch {
        report.unreadable.push(captureId);
        return;
      }
      if (read.kind === "ABSENT") return; // ya purgada
      if (read.kind === "VANISHED") {
        report.integrityProblems.push({ captureId, reason: "ENTRY_VANISHED_UNDER_LOCK" });
        return;
      }
      if (read.kind === "ANOMALY") {
        // §9.7: se informa y se omite; la entrada no se toca.
        report.integrityProblems.push({ captureId, reason: read.reason });
        return;
      }
      if (expectedPublicationId !== null && read.record.publicationId !== expectedPublicationId) {
        // Una captura recreada después del escaneo: no se toca (§9.8).
        report.skippedRecreated.push(captureId);
        return;
      }
      const expiry = this.expiry(read.record);
      const entryPath = this.entryPathOf(captureId);
      if (expiry === "RECORD") {
        await this.fileOps.rename(entryPath, `${held.path}${sep}entry`);
        await this.fileOps.fsyncDir(this.capturesPath());
        report.entriesPurged += 1;
      } else if (expiry === "PAYLOAD") {
        try {
          await this.fileOps.rename(`${entryPath}${sep}payload`, `${held.path}${sep}payload`);
        } catch (error) {
          if (errorCode(error) === "ENOENT") return; // el contenido ya estaba purgado
          throw error;
        }
        await this.fileOps.fsyncDir(entryPath);
        report.payloadsPurged += 1;
      }
    });
    if (outcome === "BUSY") report.skippedBusy.push(captureId);
  }

  /** Qué venció de una captura, por `capturedAt` de su registro y el reloj actual (§9.8). */
  private expiry(record: CaptureRecordDocument): "NONE" | "PAYLOAD" | "RECORD" {
    const capturedAt = Date.parse(record.capturedAt);
    const now = this.timing.now().getTime();
    if (now >= capturedAt + this.recordDays * DAY_MS) return "RECORD";
    if (now >= capturedAt + this.retentionDays * DAY_MS) return "PAYLOAD";
    return "NONE";
  }

  // ----- bloqueo, lectura de entradas y utilidades -----

  /**
   * Ejecuta `work` con el bloqueo de la clave (§9.4). `WAIT`: con la espera de hasta 5 s y
   * KEY_BUSY si no se obtiene; `NO_WAIT` (la purga): un solo intento y `BUSY` si está
   * ocupada. La operación se admite antes de preparar nada y el bloqueo se libera al final.
   */
  private async withLock<T>(
    captureId: string,
    operation: CaptureLockOperation,
    wait: "WAIT" | "NO_WAIT",
    work: (held: HeldLock) => Promise<T>,
  ): Promise<T | "BUSY"> {
    const operationId = this.randomHex128();
    this.workArea.admitOperation(operationId);
    let held: HeldLock | null = null;
    try {
      const { prepared } = await this.locks.prepare(operationId, operation, () =>
        Promise.resolve(undefined),
      );
      try {
        held =
          wait === "WAIT"
            ? await this.locks.acquireWithWait(prepared, captureId)
            : await this.locks.tryAcquire(prepared, captureId);
      } catch (error) {
        // Si no se pudo comprobar si el `rename` tomó efecto, se conserva el material
        // (retenido) y `locks/<id>` no se toca.
        if (error instanceof CaptureLockAcquisitionError && error.uncertain) {
          this.workArea.retainOperation(operationId);
        } else {
          await this.locks.removePrepared(prepared.path);
        }
        throw error;
      }
      if (held === null) {
        await this.locks.removePrepared(prepared.path);
        return "BUSY";
      }
      return await work(held);
    } finally {
      if (held !== null) await this.releaseLock(held);
      this.workArea.finishOperation(operationId);
    }
  }

  private async releaseLock(held: HeldLock): Promise<void> {
    let outcome: "RELEASED" | "NOT_OWNED";
    try {
      outcome = await this.locks.release(held);
    } catch {
      // El resultado ya está decidido: la liberación queda pendiente para la limpieza en
      // ejecución propia o el cierre (§9.5, última fila). Mientras tanto, KEY_BUSY.
      this.pendingReleases.set(held.captureId, held);
      this.onMaintenanceEvent({ kind: "CAPTURE_LOCK_RELEASE_PENDING", captureId: held.captureId });
      return;
    }
    if (outcome === "NOT_OWNED") {
      this.onMaintenanceEvent({ kind: "CAPTURE_LOCK_NOT_OWNED", captureId: held.captureId });
    }
  }

  private async retryPendingReleases(): Promise<number> {
    let released = 0;
    for (const [captureId, held] of [...this.pendingReleases]) {
      let outcome: "RELEASED" | "NOT_OWNED";
      try {
        outcome = await this.locks.release(held);
      } catch {
        continue;
      }
      this.pendingReleases.delete(captureId);
      if (outcome === "RELEASED") released += 1;
      else this.onMaintenanceEvent({ kind: "CAPTURE_LOCK_NOT_OWNED", captureId });
    }
    return released;
  }

  /** `record.json` de una entrada (§9.6, pasos 1 y 2). Solo ENOENT es ausencia: un error del
   * sistema se propaga. */
  private async readRecord(captureId: string): Promise<RecordRead> {
    const entryPath = this.entryPathOf(captureId);
    const entry = await lstatOrMissing(this.fileOps, entryPath);
    if (entry === null) return { kind: "ABSENT" };
    if (!isOwnPrivateDirectory(entry, this.root.processUid)) {
      return { kind: "ANOMALY", reason: "ENTRY_NOT_PRIVATE_DIRECTORY" };
    }
    const file = await readOwnSmallFile(
      this.fileOps,
      `${entryPath}${sep}record.json`,
      this.root.processUid,
      RECORD_MAX_BYTES,
    );
    if (file.kind === "MISSING") {
      const again = await lstatOrMissing(this.fileOps, entryPath);
      return again === null ? { kind: "VANISHED" } : { kind: "ANOMALY", reason: "RECORD_MISSING" };
    }
    if (file.kind === "INVALID") return { kind: "ANOMALY", reason: "RECORD_INVALID" };
    const record = parseRecord(file.value, captureId);
    if (record === null) return { kind: "ANOMALY", reason: "RECORD_INVALID" };
    // `captureId` son los primeros 32 hexadecimales del hash de la clave: un registro cuyo
    // hash no empieza así no es de esta entrada (un registro ajeno), también para quien lee
    // sin conocer la clave.
    if (!record.idempotencyKeySha256.startsWith(captureId)) {
      return { kind: "ANOMALY", reason: "IDEMPOTENCY_KEY_MISMATCH" };
    }
    return { kind: "RECORD", record, entry };
  }

  /** `payload/` de una entrada (§9.6, paso 5): `message.json` cuyo SHA-256 es
   * `contentSha256` y `attachment.bin` con el tamaño y el SHA-256 declarados. */
  private async readPayload(
    captureId: string,
    record: CaptureRecordDocument,
    keepContent: boolean,
  ): Promise<PayloadRead> {
    const payloadPath = `${this.entryPathOf(captureId)}${sep}payload`;
    const payloadDirectory = await lstatOrMissing(this.fileOps, payloadPath);
    if (payloadDirectory === null) return { kind: "ABSENT" };
    if (!isOwnPrivateDirectory(payloadDirectory, this.root.processUid)) {
      return { kind: "ANOMALY", reason: "PAYLOAD_INCOMPLETE" };
    }
    const vanishedOr = async (
      reason: CaptureIntegrityReason,
    ): Promise<{ kind: "VANISHED" } | { kind: "ANOMALY"; reason: CaptureIntegrityReason }> =>
      (await lstatOrMissing(this.fileOps, payloadPath)) === null
        ? { kind: "VANISHED" }
        : { kind: "ANOMALY", reason };
    const messageFile = await readOwnSmallFile(
      this.fileOps,
      `${payloadPath}${sep}message.json`,
      this.root.processUid,
      MESSAGE_MAX_BYTES,
    );
    if (messageFile.kind === "MISSING") return vanishedOr("PAYLOAD_INCOMPLETE");
    if (messageFile.kind === "INVALID") return { kind: "ANOMALY", reason: "PAYLOAD_MISMATCH" };
    if (sha256Hex(messageFile.value) !== record.contentSha256) {
      return { kind: "ANOMALY", reason: "PAYLOAD_MISMATCH" };
    }
    const document: CaptureMessageDocument | null = parseMessage(messageFile.value);
    if (document === null) return { kind: "ANOMALY", reason: "PAYLOAD_MISMATCH" };
    const attachmentPath = `${payloadPath}${sep}attachment.bin`;
    if (document.attachment === null) {
      const stray = await lstatOrMissing(this.fileOps, attachmentPath);
      if (stray !== null) return { kind: "ANOMALY", reason: "PAYLOAD_MISMATCH" };
      return { kind: "VALID", message: toMessage(document, null) };
    }
    const attachmentFile = await readOwnFileHashed(
      this.fileOps,
      attachmentPath,
      this.root.processUid,
      document.attachment.sizeBytes,
      keepContent,
    );
    if (attachmentFile.kind === "MISSING") return vanishedOr("PAYLOAD_INCOMPLETE");
    if (
      attachmentFile.kind === "INVALID" ||
      attachmentFile.value.sha256 !== document.attachment.sha256
    ) {
      return { kind: "ANOMALY", reason: "PAYLOAD_MISMATCH" };
    }
    return {
      kind: "VALID",
      message: toMessage(document, attachmentFile.value.content ?? new Uint8Array(0)),
    };
  }

  /** Directorio propio verificado (§6.4). Si su preparación falla, se retira vacío; lo que
   * no se pudo retirar queda dentro del bloqueo preparado, que es de esta operación. */
  private async createOwnDirectory(path: string): Promise<void> {
    try {
      await createVerifiedPrivateDirectory(this.fileOps, path, this.root.processUid);
    } catch (error) {
      throw error instanceof PrivateDirectoryPreparationError ? error.cause : error;
    }
  }

  private admit(operationId: string, onIdInUse: (cause: Error) => Error): void {
    try {
      this.workArea.admitOperation(operationId);
    } catch (error) {
      if (error instanceof OperationIdInUseError) throw onIdInUse(error);
      throw error;
    }
  }

  private capturesPath(): string {
    return `${this.root.rootPath}${sep}captures`;
  }

  private entryPathOf(captureId: string): string {
    return `${this.capturesPath()}${sep}${captureId}`;
  }
}

function captured(
  captureId: string,
  duplicate: boolean,
  payloadAvailable: boolean,
): EmailSendResult {
  return Object.freeze({
    outcome: "CAPTURED",
    captureId,
    duplicate,
    payloadAvailable,
    delivered: false,
  });
}

function toMessage(document: CaptureMessageDocument, content: Uint8Array | null): CapturedMessage {
  return Object.freeze({
    to: Object.freeze([...document.to]),
    subject: document.subject,
    textBody: document.textBody,
    attachment:
      document.attachment === null || content === null
        ? null
        : Object.freeze({ ...document.attachment, content }),
  });
}

function toCapturedEmail(
  record: CaptureRecordDocument,
  payload: { kind: "ABSENT" } | { kind: "VALID"; message: CapturedMessage },
): CapturedEmail {
  return Object.freeze({
    captureId: record.captureId,
    publicationId: record.publicationId,
    capturedAt: record.capturedAt,
    contentSha256: record.contentSha256,
    delivery: record.delivery,
    delivered: false,
    payloadAvailable: payload.kind === "VALID",
    message: payload.kind === "VALID" ? payload.message : null,
  });
}

function resolveIntegerOption(
  name: string,
  value: number,
  range: { readonly min: number; readonly max: number },
): number {
  if (!Number.isSafeInteger(value) || value < range.min || value > range.max) {
    throw new TypeError(
      `${name} debe ser un entero de ${String(range.min)} a ${String(range.max)}.`,
    );
  }
  return value;
}

function defaultRandomHex128(): string {
  return randomBytes(16).toString("hex");
}

/** Fábrica pública (plan §4 y §9): aplica las guardas y devuelve la captura local. */
export async function createLocalCaptureEmailSender(
  appEnv: string,
  options: LocalCaptureEmailSenderOptions,
): Promise<LocalCaptureEmailSender> {
  return LocalCaptureEmailSender.build({ ...options, appEnv });
}
