// Almacenamiento en carpeta privada (plan de P1-T5, §8): puerto ObjectStorage real sobre
// el sistema de archivos local. Claves opacas de 128 bits (§8.2), put con temporal y
// `link` sin sobrescribir (§8.3), resultados por fase (§8.4), publicación incierta y su
// conciliación (§8.4.1), lectura y borrado con retiro exclusivo (§8.5), ciclo de vida de
// la instancia (§7.5) y las guardas de entorno y de raíz en cada operación (§5, §6.5). La
// clase no sale por `index.ts`: solo la fábrica, para que no haya `new` fuera del paquete.
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { sep } from "node:path";
import { DEFAULT_MAX_FILE_BYTES } from "../config.js";
import { assertLocalAdapterEnvironment } from "../environment.js";
import {
  EmptyObjectError,
  InvalidObjectKeyError,
  LOCAL_PRIVATE_FOLDER_KIND,
  OBJECT_KEY_PATTERN,
  ObjectNotFoundError,
  ObjectTooLargeError,
  StorageIntegrityError,
  StorageWriteError,
  UncertainPublicationError,
  type OpenedObject,
  type ObjectStorage,
  type PutObjectOptions,
  type StoredObject,
  type UncertainPublicationResolution,
} from "../ports/storage.js";
import {
  errorCode,
  nodeFileOps,
  type FileOps,
  type FileOpsHandle,
  type Stats,
} from "./file-ops.js";
import { copyIntoHandle } from "./byte-copy.js";
import {
  createVerifiedPrivateDirectory,
  lstatOrMissing,
  preparePrivateRoot,
  PrivateDirectoryPreparationError,
  type PrivateRootContext,
} from "./private-root.js";
import {
  OperationIdInUseError,
  systemWorkAreaTiming,
  WorkArea,
  type WorkAreaCleanupReport,
  type WorkAreaCloseReport,
  type WorkAreaTiming,
} from "./work-area.js";

/** Informe de `close()` (§7.5): la limpieza final y las entradas retenidas que quedaron. */
export type StorageCloseReport = WorkAreaCloseReport;

/** Publicación incierta pendiente (§8.4.1): la prueba de pertenencia es el temporal
 * retenido, que sigue enlazado al inodo de los bytes de esa publicación. */
interface UncertainPublicationRecord {
  readonly operationId: string;
  readonly temporaryPath: string;
  readonly dev: number;
  readonly ino: number;
}

/** Máximo absoluto del límite configurado (`MAX_FILE_BYTES`, plan de P1-T5 §8.3). */
export const STORAGE_ABSOLUTE_MAX_FILE_BYTES = 10_485_760;

/** Tamaño de los trozos de lectura desde el descriptor: no carga el archivo entero. */
export const OBJECT_CHUNK_BYTES = 64 * 1024;

export interface PrivateFolderStorageOptions {
  /** Ruta absoluta de la raíz; la forma se revalida al construir (§6.1). */
  readonly rootPath: string;
  /** Máximo de bytes por objeto (`MAX_FILE_BYTES`); `put` siempre queda acotado por acá.
   * Entero de 1 a 10485760; un valor inválido se rechaza en la construcción. */
  readonly maxFileBytes?: number;
}

/** Evento de mantenimiento del adaptador, sin datos: códigos, nunca contenido ni rutas
 * completas (§8.5). Se agrega cada caso que el plan menciona por éxito con residuo:
 * el temporal publicado que no se pudo borrar (§8.4) y el objeto retirado por `delete`
 * cuyo borrado físico falló (§8.5, paso 6). */
export interface StorageMaintenanceEvent {
  readonly kind: "PUBLISHED_TEMPORARY_RESIDUE" | "DELETED_OBJECT_RESIDUE";
}

export interface InternalStorageOptions extends PrivateFolderStorageOptions {
  readonly appEnv: string;
  readonly fileOps?: FileOps;
  readonly instanceId?: string;
  readonly timing?: WorkAreaTiming;
  /** Inyectable para las pruebas; en ejecución son 128 bits de `randomBytes`. */
  readonly randomHex128?: () => string;
  onMaintenanceEvent?: (event: StorageMaintenanceEvent) => void;
}

export class LocalPrivateFolderStorage implements ObjectStorage {
  readonly kind = LOCAL_PRIVATE_FOLDER_KIND;
  private readonly fileOps: FileOps;
  private readonly root: PrivateRootContext;
  private readonly workArea: WorkArea;
  private readonly appEnv: string;
  private readonly maxFileBytes: number;
  private readonly randomHex128: () => string;
  private readonly onMaintenanceEvent: (event: StorageMaintenanceEvent) => void;
  private readonly uncertainPublications = new Map<string, UncertainPublicationRecord>();
  private readonly resolutions = new Map<string, Promise<UncertainPublicationResolution>>();

  private constructor(deps: {
    appEnv: string;
    fileOps: FileOps;
    root: PrivateRootContext;
    workArea: WorkArea;
    maxFileBytes: number;
    randomHex128: () => string;
    onMaintenanceEvent: (event: StorageMaintenanceEvent) => void;
  }) {
    this.appEnv = deps.appEnv;
    this.fileOps = deps.fileOps;
    this.root = deps.root;
    this.workArea = deps.workArea;
    this.maxFileBytes = deps.maxFileBytes;
    this.randomHex128 = deps.randomHex128;
    this.onMaintenanceEvent = deps.onMaintenanceEvent;
  }

  /** Identificación de la instancia (128 bits aleatorios); sus temporales viven en
   * `tmp/<instancia>/` (§7.1). */
  get instanceId(): string {
    return this.workArea.instanceId;
  }

  get activeOperationCount(): number {
    return this.workArea.activeOperationCount;
  }

  /** Construcción: guardas de entorno (§5), forma de la ruta y recorridos de §6.2 y
   * §6.3, raíz y subdirectorios de §6.4, prueba de enlace duro, y área de trabajo con su
   * `instance.json`. Nada se corrige en silencio. */
  static async build(options: InternalStorageOptions): Promise<LocalPrivateFolderStorage> {
    const appEnv = assertLocalAdapterEnvironment(options.appEnv);
    const maxFileBytes = resolveConfiguredMaxFileBytes(options.maxFileBytes);
    const fileOps = options.fileOps ?? nodeFileOps;
    const root = await preparePrivateRoot({
      rootPath: options.rootPath,
      subdirectories: STORAGE_ROOT_SUBDIRECTORIES,
      fileOps,
    });
    await assertHardLinkSupport(fileOps, `${options.rootPath}${sep}tmp`);
    const workArea = new WorkArea({
      rootPath: options.rootPath,
      instanceId: options.instanceId ?? defaultRandomHex128(),
      fileOps,
      timing: options.timing ?? systemWorkAreaTiming,
    });
    await workArea.initialize();
    const storage = new LocalPrivateFolderStorage({
      appEnv,
      fileOps,
      root,
      workArea,
      maxFileBytes,
      randomHex128: options.randomHex128 ?? defaultRandomHex128,
      onMaintenanceEvent:
        options.onMaintenanceEvent ??
        (() => {
          return undefined;
        }),
    });
    return storage;
  }

  /** put (§8.3, §8.4). No es idempotente: cada llamada genera una clave nueva. Se admite
   * antes de su primera espera (§7.5) y solo borra el temporal que ella misma creó. */
  async put(
    content: AsyncIterable<Uint8Array>,
    options: PutObjectOptions = {},
  ): Promise<StoredObject> {
    assertLocalAdapterEnvironment(this.appEnv);
    const maxBytes = resolvePutLimit(options.maxBytes ?? this.maxFileBytes, this.maxFileBytes);
    if (options.signal?.aborted) {
      throw new StorageWriteError("BEFORE_PUBLISH", { failureReason: "CANCELLED" });
    }
    const operationId = this.randomHex128();
    this.admit(operationId, (cause) => new StorageWriteError("BEFORE_PUBLISH", { cause }));
    const temporaryPath = `${this.workArea.instanceDirPath}${sep}${operationId}.part`;
    // Propiedad del temporal (§8.3): se borra solo si esta operación lo creó, y nunca si
    // quedó como prueba de una publicación incierta (§8.4.1).
    let temporaryCreated = false;
    try {
      await this.root.verify(["root", "objects", "tmp"]);
      let handle: FileOpsHandle;
      try {
        handle = await this.fileOps.openTempForWrite(temporaryPath);
      } catch (error) {
        // No se creó (O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW): una entrada que ya
        // existía con ese nombre no es de esta operación y no se toca. Solo `link` crea
        // el objeto: destino ausente (§8.4, fila del paso 2).
        throw new StorageWriteError("BEFORE_PUBLISH", { cause: error });
      }
      temporaryCreated = true;
      try {
        const written = await this.fillTemporary(handle, content, maxBytes, options.signal);
        let temporaryStat: Stats;
        try {
          temporaryStat = await this.fileOps.lstat(temporaryPath);
        } catch (error) {
          throw new StorageWriteError("BEFORE_PUBLISH", { cause: error });
        }
        // Últimas comprobaciones antes del `link`, sin ninguna espera entre ellas y la
        // publicación: el entorno (§5.4), porque la fuente pudo tardar, y la cancelación
        // (§8.3), que pudo llegar durante el `fsync` o el `lstat`. Después del `link` la
        // cancelación se ignora: el objeto ya existe.
        assertLocalAdapterEnvironment(this.appEnv);
        if (options.signal?.aborted) {
          throw new StorageWriteError("BEFORE_PUBLISH", { failureReason: "CANCELLED" });
        }
        const stored = await this.publishAndSyncDirectory(
          operationId,
          temporaryPath,
          temporaryStat,
        );
        try {
          await this.fileOps.unlink(temporaryPath);
        } catch {
          // Paso 7 con residuo: el temporal es un segundo enlace del mismo inodo; lo
          // retoma la limpieza en ejecución de esta instancia (§8.4, última fila).
          this.onMaintenanceEvent({ kind: "PUBLISHED_TEMPORARY_RESIDUE" });
        }
        return Object.freeze({
          key: stored.key,
          sizeBytes: written.sizeBytes,
          sha256: written.sha256,
        });
      } finally {
        await attemptClose(handle);
      }
    } catch (error) {
      // Antes de publicar no hay objeto: solo `link` lo crea. El temporal propio se borra;
      // si el borrado falla, lo retoma la limpieza en ejecución propia (§7.2) o el
      // mantenimiento si la instancia terminó (§7.3). En una publicación incierta el
      // temporal es la prueba de pertenencia y queda retenido (§8.4.1).
      if (temporaryCreated && !(error instanceof UncertainPublicationError)) {
        await removeOwnTemporary(this.fileOps, temporaryPath);
      }
      throw error;
    } finally {
      this.workArea.finishOperation(operationId);
    }
  }

  /** open (§8.5): abre con O_RDONLY | O_NOFOLLOW y comprueba con fstat sobre el
   * descriptor (no sobre la ruta): archivo regular del usuario del proceso, modo 0600.
   * No carga el archivo en memoria; la interrupción del recorrido cierra el descriptor.
   * El stream vuelve a comprobar el entorno antes de cada lectura (§5.4). */
  async open(key: string): Promise<OpenedObject> {
    assertLocalAdapterEnvironment(this.appEnv);
    assertObjectKey(key);
    this.workArea.assertOpen();
    await this.root.verify(["root", "objects"]);
    let handle: FileOpsHandle;
    try {
      handle = await this.fileOps.openObjectForRead(
        `${this.root.rootPath}${sep}objects${sep}${key}`,
      );
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT") throw new ObjectNotFoundError();
      if (code === "ELOOP") throw new StorageIntegrityError("TARGET_SYMLINK");
      // Entradas que no se abren como archivo (sockets, dispositivos): tipo inesperado.
      if (code === "ENXIO" || code === "ENODEV" || code === "EOPNOTSUPP") {
        throw new StorageIntegrityError("TARGET_TYPE");
      }
      // EACCES, EIO, EMFILE y los demás son errores del sistema, no del objeto.
      throw error;
    }
    try {
      const stat = await handle.fstat();
      if (!stat.isFile()) throw new StorageIntegrityError("TARGET_TYPE");
      if (stat.uid !== this.root.processUid) throw new StorageIntegrityError("TARGET_OWNER");
      if ((stat.mode & 0o7777) !== 0o600) throw new StorageIntegrityError("TARGET_MODE");
      const sizeBytes = stat.size;
      const stream = objectStream(handle, OBJECT_CHUNK_BYTES, () => {
        assertLocalAdapterEnvironment(this.appEnv);
      });
      return Object.freeze({ sizeBytes, stream });
    } catch (error) {
      await attemptClose(handle);
      throw error;
    }
  }

  /** delete (§8.5): retiro exclusivo con `rename` a un destino privado de la operación,
   * `fsync` de `objects/` y borrado físico; repetible. Dos borrados concurrentes, de una o
   * de varias instancias o procesos, dan un DELETED y un ALREADY_ABSENT: solo un `rename`
   * del mismo origen lo encuentra (el resultado ya no sale de `unlink`, que en APFS puede
   * dar éxito dos veces). */
  async delete(key: string): Promise<"DELETED" | "ALREADY_ABSENT"> {
    assertLocalAdapterEnvironment(this.appEnv);
    assertObjectKey(key);
    const operationId = this.randomHex128();
    this.admit(operationId, (cause) => new StorageWriteError("BEFORE_REMOVE", { key, cause }));
    try {
      // Una publicación incierta pendiente con esta clave no se borra a ciegas (§8.4.1).
      if (this.uncertainPublications.has(key)) throw new UncertainPublicationError(key);
      await this.root.verify(["root", "objects", "tmp"]);
      // Solo ENOENT es ausencia: un error del sistema no se convierte en "ya estaba". No
      // se retiró nada, así que es la fase BEFORE_REMOVE.
      let existing: Stats | null;
      try {
        existing = await lstatOrMissing(this.fileOps, this.objectPathOf(key));
      } catch (error) {
        throw new StorageWriteError("BEFORE_REMOVE", { key, cause: error });
      }
      let privateDirectory: string | undefined;
      if (existing !== null) {
        // Solamente objetos propios: regular, del usuario del proceso (§8.5). El modo no
        // condiciona el borrado; la lectura es la que exige 0600.
        if (existing.isSymbolicLink()) throw new StorageIntegrityError("TARGET_SYMLINK");
        if (!existing.isFile()) throw new StorageIntegrityError("TARGET_TYPE");
        if (existing.uid !== this.root.processUid) {
          throw new StorageIntegrityError("TARGET_OWNER");
        }
        privateDirectory = await this.withdrawExclusively(
          key,
          operationId,
          existing,
          (cause) => new StorageWriteError("BEFORE_REMOVE", { key, cause }),
        );
      }
      try {
        await this.fsyncDirectory("objects");
      } catch (error) {
        // El objeto ya no está bajo su clave (o ya no estaba), pero la durabilidad de su
        // salida queda sin confirmar: el host reintenta `delete` hasta terminar sin error.
        if (privateDirectory !== undefined) await this.removeWithdrawn(privateDirectory);
        throw new StorageWriteError("AFTER_REMOVE", { key, cause: error });
      }
      if (privateDirectory === undefined) return "ALREADY_ABSENT";
      await this.removeWithdrawn(privateDirectory);
      return "DELETED";
    } finally {
      this.workArea.finishOperation(operationId);
    }
  }

  /** listObjects (§8.1): conciliación de huérfanos (P2). Lista las claves con el formato
   * propio, archivos regulares del usuario del proceso, en orden determinista. Otras
   * entradas no son objetos de este adaptador y no rompen el listado. */
  listObjects(): AsyncIterable<{ key: string; sizeBytes: number }> {
    assertLocalAdapterEnvironment(this.appEnv);
    this.workArea.assertOpen();
    return this.iterateObjects();
  }

  private async *iterateObjects(): AsyncIterable<{ key: string; sizeBytes: number }> {
    // Las guardas de entorno acompañan el consumo (§5.4): crear el iterable no es el
    // punto de uso. Se comprueba al empezar, al reanudar después de cada resultado
    // (comienzo del bucle) y después de cada espera, antes de entregar. El estado de la
    // instancia (§7.5) se comprueba al empezar a consumir.
    assertLocalAdapterEnvironment(this.appEnv);
    this.workArea.assertOpen();
    await this.root.verify(["root", "objects"]);
    const objectsPath = `${this.root.rootPath}${sep}objects`;
    const entries = [...(await this.fileOps.readdir(objectsPath))].sort();
    for (const entry of entries) {
      assertLocalAdapterEnvironment(this.appEnv);
      if (!OBJECT_KEY_PATTERN.test(entry)) continue;
      // Solo ENOENT es ausencia; un error del sistema no "saltea" el objeto.
      const stat = await lstatOrMissing(this.fileOps, `${objectsPath}${sep}${entry}`);
      assertLocalAdapterEnvironment(this.appEnv);
      if (
        stat === null ||
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.uid !== this.root.processUid
      ) {
        continue;
      }
      yield { key: entry, sizeBytes: stat.size };
    }
  }

  /** Conciliación de una publicación incierta (§8.4.1). La pertenencia se comprueba con el
   * temporal retenido, que sigue enlazado al inodo de los bytes de esa publicación: solo
   * se retira lo que comparte ese dev e inodo, y una entrada distinta no se toca. Las
   * llamadas concurrentes con la misma clave comparten el mismo intento. */
  async resolveUncertainPublication(key: string): Promise<UncertainPublicationResolution> {
    assertLocalAdapterEnvironment(this.appEnv);
    assertObjectKey(key);
    const inFlight = this.resolutions.get(key);
    if (inFlight !== undefined) return inFlight;
    const attempt = this.resolveUncertainPublicationOnce(key);
    this.resolutions.set(key, attempt);
    try {
      return await attempt;
    } finally {
      this.resolutions.delete(key);
    }
  }

  /** Limpieza en ejecución (§7.2), con el recorrido de antecesores reactualizado (§6.5).
   * Se admite como operación: el cierre espera a que termine (§7.5). */
  async recoverWorkArea(): Promise<WorkAreaCleanupReport> {
    assertLocalAdapterEnvironment(this.appEnv);
    const release = this.workArea.admitUntracked();
    try {
      await this.root.walkAncestors();
      await this.root.verify(["root", "tmp", ".reclaim"]);
      return await this.workArea.cleanLeftovers();
    } finally {
      release();
    }
  }

  /** Cierre (§7.5). Pasa a CLOSING antes de cualquier espera, así ninguna operación nueva
   * usa recursos que el cierre retira; espera a las ya admitidas; después limpia y borra
   * el directorio de la instancia, salvo entradas retenidas. Las llamadas concurrentes
   * comparten el intento; después de cerrar devuelve el mismo informe sin tocar el disco;
   * si un intento falla, la llamada siguiente lo reintenta. */
  async close(): Promise<StorageCloseReport> {
    assertLocalAdapterEnvironment(this.appEnv);
    return this.workArea.closeWith(async () => {
      await this.root.walkAncestors();
      await this.root.verify(["root", "tmp", ".reclaim"]);
      return {};
    });
  }

  /** Admisión de una operación (§7.1, §7.5): `StorageClosedError` si la instancia ya
   * empezó a cerrar; un id ya registrado se rechaza con el error de la fase, sin tocar el
   * registro de la otra operación. */
  private admit(operationId: string, onIdInUse: (cause: Error) => Error): void {
    try {
      this.workArea.admitOperation(operationId);
    } catch (error) {
      if (error instanceof OperationIdInUseError) throw onIdInUse(error);
      throw error;
    }
  }

  private objectPathOf(key: string): string {
    return `${this.root.rootPath}${sep}objects${sep}${key}`;
  }

  private async resolveUncertainPublicationOnce(
    key: string,
  ): Promise<UncertainPublicationResolution> {
    const operationId = this.randomHex128();
    this.admit(operationId, (cause) => new UncertainPublicationError(key, { cause }));
    try {
      const record = this.uncertainPublications.get(key);
      if (record === undefined) return "NOT_RETAINED";
      const stillUncertain = (cause: unknown): Error =>
        new UncertainPublicationError(key, { cause });
      await this.root.verify(["root", "objects", "tmp"]);
      // La prueba tiene que seguir siendo el mismo inodo: sin ella no hay con qué comparar,
      // y nada se retira.
      let proof: Stats | null;
      try {
        proof = await lstatOrMissing(this.fileOps, record.temporaryPath);
      } catch (error) {
        throw stillUncertain(error);
      }
      if (proof?.dev !== record.dev || proof.ino !== record.ino) {
        throw stillUncertain(new Error("La prueba retenida de la publicación ya no está."));
      }
      let destination: Stats | null;
      try {
        destination = await lstatOrMissing(this.fileOps, this.objectPathOf(key));
      } catch (error) {
        throw stillUncertain(error);
      }
      let outcome: UncertainPublicationResolution;
      let privateDirectory: string | undefined;
      if (destination === null) {
        outcome = "NOT_PUBLISHED";
      } else if (destination.dev === record.dev && destination.ino === record.ino) {
        privateDirectory = await this.withdrawExclusively(key, operationId, record, stillUncertain);
        outcome = privateDirectory === undefined ? "NOT_PUBLISHED" : "WITHDRAWN";
      } else {
        // Otra entrada ocupa la clave (por ejemplo, un objeto anterior): no se toca.
        outcome = "KEY_HELD_BY_OTHER";
      }
      // Durabilidad de la clave vacía o del retiro, como en `delete`.
      try {
        await this.fsyncDirectory("objects");
      } catch (error) {
        if (privateDirectory !== undefined) await this.removeWithdrawn(privateDirectory);
        throw stillUncertain(error);
      }
      if (privateDirectory !== undefined) await this.removeWithdrawn(privateDirectory);
      // Determinado: se suelta la prueba. Si el temporal no se puede borrar, queda como
      // resto propio para la limpieza en ejecución.
      this.uncertainPublications.delete(key);
      this.workArea.releaseRetained(record.operationId);
      await removeOwnTemporary(this.fileOps, record.temporaryPath);
      return outcome;
    } finally {
      this.workArea.finishOperation(operationId);
    }
  }

  /**
   * Retiro exclusivo (§8.5, pasos 2 a 4): `mkdir` del destino privado de la operación y
   * `rename(objects/<clave>, del-<op>/<clave>)`. Solo un `rename` del mismo origen lo
   * encuentra, aun entre instancias o procesos. Devuelve el destino privado con el objeto
   * retirado, o `undefined` si la clave quedó vacía antes (otro retiro ganó). Lo
   * trasladado tiene que tener el dev e inodo esperados; si no, se restituye y se rechaza
   * con TARGET_CHANGED. Lo que no se pudo verificar nunca se borra.
   */
  private async withdrawExclusively(
    key: string,
    operationId: string,
    expected: { readonly dev: number; readonly ino: number },
    beforeWithdrawal: (cause: unknown) => Error,
  ): Promise<string | undefined> {
    const objectPath = this.objectPathOf(key);
    const privateDirectory = `${this.workArea.instanceDirPath}${sep}del-${operationId}`;
    // Preparación del destino (§8.5, paso 2), antes de trasladar nada: 0700 reafirmado y
    // verificado, porque la umask puede dejarlo en 000 y el `rename` fallaría con EACCES.
    // Si falla, el objeto sigue intacto y el error es el de la fase previa al retiro.
    try {
      await createVerifiedPrivateDirectory(this.fileOps, privateDirectory, this.root.processUid);
    } catch (error) {
      if (error instanceof PrivateDirectoryPreparationError) {
        // Se retira solo el directorio vacío propio; si no se pudo, queda retenido.
        if (!error.removed) this.workArea.retainOperation(operationId);
        throw beforeWithdrawal(error.cause);
      }
      // Sin crear (también con EEXIST): una entrada existente no es de esta operación, y
      // no se le cambia el modo ni se borra.
      throw beforeWithdrawal(error);
    }
    const withdrawnPath = `${privateDirectory}${sep}${key}`;
    try {
      await this.fileOps.rename(objectPath, withdrawnPath);
    } catch (error) {
      // Solo cuenta como retirado lo que está en el destino privado.
      let arrived: Stats | null;
      try {
        arrived = await lstatOrMissing(this.fileOps, withdrawnPath);
      } catch {
        // No se sabe si llegó: el destino privado queda retenido, sin borrar nada.
        this.workArea.retainOperation(operationId);
        throw beforeWithdrawal(error);
      }
      if (arrived === null) {
        await this.fileOps
          .rm(privateDirectory, { recursive: true, force: true })
          .catch(() => undefined);
        if (errorCode(error) === "ENOENT") {
          // Otro retiro ganó, o la clave ya estaba vacía: se confirma que lo está.
          let remaining: Stats | null;
          try {
            remaining = await lstatOrMissing(this.fileOps, objectPath);
          } catch (checkError) {
            throw beforeWithdrawal(checkError);
          }
          if (remaining === null) return undefined;
        }
        throw beforeWithdrawal(error);
      }
    }
    // Comprobación posterior (§8.5, paso 4): lo trasladado es lo que se comprobó. Si no se
    // puede leer, cuenta como no verificado.
    let withdrawn: Stats | null;
    try {
      withdrawn = await lstatOrMissing(this.fileOps, withdrawnPath);
    } catch {
      withdrawn = null;
    }
    if (withdrawn !== null && withdrawn.dev === expected.dev && withdrawn.ino === expected.ino) {
      return privateDirectory;
    }
    await this.restoreWithdrawn(operationId, privateDirectory, withdrawnPath, objectPath);
    throw new StorageIntegrityError("TARGET_CHANGED");
  }

  /** Restitución después de una comprobación posterior fallida (§8.5, paso 4): `link` de
   * vuelta a la clave, que no reemplaza nada. Si no se puede, el material queda retenido
   * en el destino privado: nunca se borra lo que no se pudo verificar. */
  private async restoreWithdrawn(
    operationId: string,
    privateDirectory: string,
    withdrawnPath: string,
    objectPath: string,
  ): Promise<void> {
    try {
      await this.fileOps.link(withdrawnPath, objectPath);
    } catch {
      this.workArea.retainOperation(operationId);
      return;
    }
    await this.fileOps
      .rm(privateDirectory, { recursive: true, force: true })
      .catch(() => undefined);
    await this.fsyncDirectory("objects").catch(() => undefined);
  }

  /** Borrado físico del objeto retirado (§8.5, paso 6). Si falla, el objeto ya no está
   * bajo su clave: queda como resto propio y se informa con un evento sin datos. */
  private async removeWithdrawn(privateDirectory: string): Promise<void> {
    try {
      await this.fileOps.rm(privateDirectory, { recursive: true, force: true });
    } catch {
      this.onMaintenanceEvent({ kind: "DELETED_OBJECT_RESIDUE" });
    }
  }

  private async fillTemporary(
    handle: FileOpsHandle,
    content: AsyncIterable<Uint8Array>,
    maxBytes: number,
    signal: AbortSignal | undefined,
  ): Promise<{ sizeBytes: number; sha256: string }> {
    const iterator = content[Symbol.asyncIterator]();
    let sizeBytes: number;
    let sha256: string;
    try {
      ({ sizeBytes, sha256 } = await copyIntoHandle(
        handle,
        iterator,
        { maxBytes, signal },
        {
          tooLarge: (limitBytes, receivedBytes) =>
            new ObjectTooLargeError(limitBytes, receivedBytes),
          cancelled: () => new StorageWriteError("BEFORE_PUBLISH", { failureReason: "CANCELLED" }),
        },
      ));
    } catch (error) {
      // Salida anticipada: un fallo antes de publicar (§8.4); la copia ya le pidió a la
      // fuente que cierre, sin esperarla.
      if (error instanceof StorageWriteError || error instanceof ObjectTooLargeError) {
        throw error;
      }
      // Error ajeno del flujo o de la escritura (§8.4, fila 2 a 4): la fase es la misma que
      // la del resto de los fallos de la copia; la causa original queda como `cause`.
      throw new StorageWriteError("BEFORE_PUBLISH", { cause: error });
    }
    // Fuente agotada: el protocolo de iteración no llama a `return()` después de `done`.
    if (sizeBytes === 0) throw new EmptyObjectError();
    // Paso 4: fsync del archivo.
    try {
      await handle.fsync();
    } catch (error) {
      throw new StorageWriteError("BEFORE_PUBLISH", { cause: error });
    }
    return { sizeBytes, sha256 };
  }

  /** Publicación (§8.3 paso 5) y fsync del directorio (paso 6), con los resultados por
   * fase de §8.4. El punto de publicación es el éxito del `link`: nunca reemplaza un
   * destino existente, y un error espurio se resuelve comparando dev e inodo. Si esa
   * comparación tampoco es posible, la publicación es incierta (§8.4.1). */
  private async publishAndSyncDirectory(
    operationId: string,
    temporaryPath: string,
    temporaryStat: Stats,
  ): Promise<{ key: string }> {
    const key = this.randomHex128();
    // Una clave con una publicación incierta pendiente no se vuelve a usar (§8.4.1).
    if (this.uncertainPublications.has(key)) throw new StorageIntegrityError("KEY_COLLISION");
    const objectPath = this.objectPathOf(key);
    try {
      await this.fileOps.link(temporaryPath, objectPath);
    } catch (error) {
      // Reconciliación del error espurio (§8.4) con dev e inodo del destino.
      let destination: Stats | null;
      try {
        destination = await lstatOrMissing(this.fileOps, objectPath);
      } catch (checkError) {
        // Incierto (§8.4.1): bajo la clave puede no haber nada, estar este objeto o uno
        // anterior; ningún código de error prueba cuál. No es un objeto propio
        // confirmado ni se autoriza borrar la clave. Se conserva la prueba de pertenencia:
        // el temporal, que sigue enlazado a este inodo, queda retenido.
        this.uncertainPublications.set(key, {
          operationId,
          temporaryPath,
          dev: temporaryStat.dev,
          ino: temporaryStat.ino,
        });
        this.workArea.retainOperation(operationId);
        throw new UncertainPublicationError(key, {
          cause: new AggregateError([error, checkError], "link y comparación fallidos"),
        });
      }
      if (
        destination !== null &&
        destination.dev === temporaryStat.dev &&
        destination.ino === temporaryStat.ino
      ) {
        // El enlace realmente tomó efecto: sigue en el paso 6 como publicado.
      } else if (errorCode(error) === "EEXIST") {
        // Con 128 bits aleatorios, un choque indica una entrada ajena: integridad.
        throw new StorageIntegrityError("KEY_COLLISION");
      } else {
        throw new StorageWriteError("BEFORE_PUBLISH", { cause: error });
      }
    }
    try {
      await this.fsyncDirectory("objects");
    } catch (error) {
      // Nadie conoce todavía la clave: el adaptador retira el objeto. Si el retiro
      // también falla, queda LEFT_IN_PLACE para que el host registre la clave (P2).
      let objectState: "WITHDRAWN" | "LEFT_IN_PLACE" = "WITHDRAWN";
      try {
        await this.fileOps.unlink(objectPath);
      } catch {
        objectState = "LEFT_IN_PLACE";
      }
      throw new StorageWriteError("AFTER_PUBLISH", { key, objectState, cause: error });
    }
    return { key };
  }

  private async fsyncDirectory(name: string): Promise<void> {
    await this.fileOps.fsyncDir(`${this.root.rootPath}${sep}${name}`);
  }
}

/** Prueba de enlace duro (§6.4): la publicación la hace `link`; en algunos montajes de
 * red o exFAT no lo hay. El fallo de la construcción es claro y no deja residuos con
 * nombre determinista. Los errores de limpieza no tapan el diagnóstico. */
async function assertHardLinkSupport(fileOps: FileOps, tmpDirPath: string): Promise<void> {
  const suffix = randomBytes(8).toString("hex");
  const probePath = `${tmpDirPath}${sep}.probe-${suffix}`;
  const linkedPath = `${tmpDirPath}${sep}.linked-${suffix}`;
  try {
    const handle = await fileOps.openTempForWrite(probePath);
    await handle.close();
    try {
      await fileOps.link(probePath, linkedPath);
      const stats = await fileOps.lstat(probePath);
      if (stats.nlink < 2) {
        throw new Error("El enlace no apareció en el contador del archivo original.");
      }
    } finally {
      await fileOps.rm(linkedPath, { force: true }).catch(() => undefined);
      await fileOps.rm(probePath, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    throw error instanceof StorageIntegrityError
      ? error
      : new StorageIntegrityError("HARD_LINK_UNSUPPORTED");
  }
}

function defaultRandomHex128(): string {
  return randomBytes(16).toString("hex");
}

export const STORAGE_ROOT_SUBDIRECTORIES = ["objects", "tmp", ".reclaim"] as const;

/** Fábrica pública (plan §4): aplica las guardas y devuelve el ObjectStorage local. */
export async function createLocalPrivateFolderStorage(
  appEnv: string,
  options: PrivateFolderStorageOptions,
): Promise<LocalPrivateFolderStorage> {
  return LocalPrivateFolderStorage.build({ ...options, appEnv });
}

function resolveConfiguredMaxFileBytes(value: number | undefined): number {
  const candidate = value ?? DEFAULT_MAX_FILE_BYTES;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > STORAGE_ABSOLUTE_MAX_FILE_BYTES
  ) {
    throw new TypeError("maxFileBytes debe ser un entero de 1 a 10485760.");
  }
  return candidate;
}

function resolvePutLimit(requested: number | undefined, configuredMax: number): number {
  if (requested === undefined || !Number.isSafeInteger(requested) || requested < 1) {
    throw new TypeError("maxBytes de put debe ser un entero positivo.");
  }
  // El máximo configurado nunca se supera, aunque el llamador pida más (§8.3).
  return Math.min(requested, configuredMax);
}

function assertObjectKey(key: string): void {
  if (!OBJECT_KEY_PATTERN.test(key)) throw new InvalidObjectKeyError();
}

async function attemptClose(handle: FileOpsHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    // El cierre es el último recurso de liberación; los datos ya tienen fsync.
  }
}

/** Borra el temporal que creó esta operación (§8.3). Solo se llama cuando la apertura con
 * `O_EXCL` tuvo éxito. Si falla, queda como resto propio para la limpieza en ejecución
 * (§7.2) o el mantenimiento con consumidores detenidos (§7.3). */
async function removeOwnTemporary(fileOps: FileOps, temporaryPath: string): Promise<void> {
  try {
    await fileOps.unlink(temporaryPath);
  } catch {
    // Resto propio: lo retoma la limpieza.
  }
}

/** Lectura por trozos desde el descriptor. `assertEnvironment` corre antes de cada
 * lectura: un stream abierto bajo `test` y leído después de cambiar el entorno rechaza
 * (§5.4) y cierra el descriptor. */
function objectStream(
  handle: FileOpsHandle,
  chunkSize: number,
  assertEnvironment: () => void,
): AsyncIterableIterator<Uint8Array> {
  let position = 0;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await handle.close();
  };
  const iterator: AsyncIterableIterator<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
    next: async () => {
      if (closed) return { done: true, value: undefined };
      const buffer = Buffer.allocUnsafe(chunkSize);
      let bytesRead: number;
      try {
        assertEnvironment();
        bytesRead = await handle.readInto(buffer, position);
      } catch (error) {
        await close().catch(() => undefined);
        throw error;
      }
      if (bytesRead === 0) {
        await close();
        return { done: true, value: undefined };
      }
      position += bytesRead;
      return { done: false, value: new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead) };
    },
    // Cierre del descriptor si quien consume abandona la lectura antes de terminar:
    // break/throw en `for await` y el `return()` explícito de la promesa del iterador.
    return: async () => {
      await close();
      return { done: true, value: undefined };
    },
  };
  return iterator;
}
