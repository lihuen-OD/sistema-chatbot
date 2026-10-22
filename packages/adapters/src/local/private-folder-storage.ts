// Almacenamiento en carpeta privada (plan de P1-T5, §8): puerto ObjectStorage real sobre
// el sistema de archivos local. Claves opacas de 128 bits (§8.2), put con temporal y
// `link` sin sobrescribir (§8.3), resultados por fase (§8.4), lectura y borrado (§8.5),
// y las guardas de entorno y de raíz en cada operación (§5, §6.5). La clase no sale por
// `index.ts`: solo la fábrica, para que no haya `new` fuera del paquete.
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
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
  type OpenedObject,
  type ObjectStorage,
  type PutObjectOptions,
  type StoredObject,
} from "../ports/storage.js";
import { nodeFileOps, type FileOps, type FileOpsHandle, type Stats } from "./file-ops.js";
import { preparePrivateRoot, type PrivateRootContext } from "./private-root.js";
import {
  systemWorkAreaTiming,
  WorkArea,
  type WorkAreaCleanupReport,
  type WorkAreaTiming,
} from "./work-area.js";

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
 * completas (§8.5). Se agrega cada caso que el plan menciona por éxito con residuo. */
export interface StorageMaintenanceEvent {
  readonly kind: "PUBLISHED_TEMPORARY_RESIDUE";
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

  /** put (§8.3, §8.4). No es idempotente: cada llamada genera una clave nueva. */
  async put(
    content: AsyncIterable<Uint8Array>,
    options: PutObjectOptions = {},
  ): Promise<StoredObject> {
    assertLocalAdapterEnvironment(this.appEnv);
    const maxBytes = resolvePutLimit(options.maxBytes ?? this.maxFileBytes, this.maxFileBytes);
    if (options.signal?.aborted) {
      throw new StorageWriteError("BEFORE_PUBLISH", { failureReason: "CANCELLED" });
    }
    await this.root.verify(["root", "objects", "tmp"]);

    const operationId = this.randomHex128();
    this.workArea.startOperation(operationId);
    const temporaryPath = `${this.workArea.instanceDirPath}${sep}${operationId}.part`;
    try {
      let handle: FileOpsHandle;
      try {
        handle = await this.fileOps.openTempForWrite(temporaryPath);
      } catch (error) {
        // El temporal no se creó (O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW). Solo `link`
        // crea el objeto: destino ausente (§8.4, fila del paso 2).
        throw new StorageWriteError("BEFORE_PUBLISH", { cause: error });
      }
      try {
        const filled = await this.fillTemporary(handle, content, maxBytes, options.signal);
        if (options.signal?.aborted) {
          throw new StorageWriteError("BEFORE_PUBLISH", { failureReason: "CANCELLED" });
        }
        const written = { sizeBytes: filled.sizeBytes, sha256: filled.sha256 };
        let temporaryStat: Stats;
        try {
          temporaryStat = await this.fileOps.lstat(temporaryPath);
        } catch (error) {
          throw new StorageWriteError("BEFORE_PUBLISH", { cause: error });
        }
        const stored = await this.publishAndSyncDirectory(temporaryPath, temporaryStat);
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
      // Antes de publicar no hay objeto: solo `link` lo crea. El temporal se borra; si el
      // borrado falla, lo retoma la limpieza en ejecución propia (§7.2) o el
      // mantenimiento si la instancia terminó (§7.3).
      await removeTemporaryIfOurs(this.fileOps, temporaryPath);
      throw error;
    } finally {
      this.workArea.finishOperation(operationId);
    }
  }

  /** open (§8.5): abre con O_RDONLY | O_NOFOLLOW y comprueba con fstat sobre el
   * descriptor (no sobre la ruta): archivo regular del usuario del proceso, modo 0600.
   * No carga el archivo en memoria; la interrupción del recorrido cierra el descriptor. */
  async open(key: string): Promise<OpenedObject> {
    assertLocalAdapterEnvironment(this.appEnv);
    assertObjectKey(key);
    await this.root.verify(["root", "objects"]);
    let handle: FileOpsHandle;
    try {
      handle = await this.fileOps.openObjectForRead(
        `${this.root.rootPath}${sep}objects${sep}${key}`,
      );
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOENT") throw new ObjectNotFoundError();
      if (code === "ELOOP") throw new StorageIntegrityError("TARGET_SYMLINK");
      throw new StorageIntegrityError("TARGET_TYPE");
    }
    try {
      const stat = await handle.fstat();
      if (!stat.isFile()) throw new StorageIntegrityError("TARGET_TYPE");
      if (stat.uid !== this.root.processUid) throw new StorageIntegrityError("TARGET_OWNER");
      if ((stat.mode & 0o7777) !== 0o600) throw new StorageIntegrityError("TARGET_MODE");
      const sizeBytes = stat.size;
      const stream = objectStream(handle, OBJECT_CHUNK_BYTES);
      return Object.freeze({ sizeBytes, stream });
    } catch (error) {
      await attemptClose(handle);
      throw error;
    }
  }

  /** delete (§8.5): `unlink` y después `fsync` de `objects/`; repetible. Dos borrados
   * concurrentes dan un DELETED y un ALREADY_ABSENT. */
  async delete(key: string): Promise<"DELETED" | "ALREADY_ABSENT"> {
    assertLocalAdapterEnvironment(this.appEnv);
    assertObjectKey(key);
    await this.root.verify(["root", "objects"]);
    const objectPath = `${this.root.rootPath}${sep}objects${sep}${key}`;
    let unlinkResult: "DELETED" | "ALREADY_ABSENT" = "ALREADY_ABSENT";
    const existing = await lstatOrNull(this.fileOps, objectPath);
    if (existing !== null) {
      // Solamente objetos propios: regular, del usuario del proceso (§8.5). El modo no
      // condiciona el borrado; la lectura es la que exige 0600.
      if (existing.isSymbolicLink()) throw new StorageIntegrityError("TARGET_SYMLINK");
      if (!existing.isFile()) throw new StorageIntegrityError("TARGET_TYPE");
      if (existing.uid !== this.root.processUid) throw new StorageIntegrityError("TARGET_OWNER");
      try {
        await this.fileOps.unlink(objectPath);
        unlinkResult = "DELETED";
      } catch (error) {
        if (codeOf(error) === "ENOENT") {
          unlinkResult = "ALREADY_ABSENT";
        } else {
          // Otra causa: el objeto sigue presente (§8.5, fila BEFORE_REMOVE).
          throw new StorageWriteError("BEFORE_REMOVE", { key, cause: error });
        }
      }
    }
    try {
      await this.fsyncDirectory("objects");
    } catch (error) {
      // El objeto ya no es visible (o ya no estaba), pero la durabilidad del borrado
      // queda sin confirmar: el host reintenta `delete` hasta terminar sin error.
      throw new StorageWriteError("AFTER_REMOVE", { key, cause: error });
    }
    return unlinkResult;
  }

  /** listObjects (§8.1): conciliación de huérfanos (P2). Lista las claves con el formato
   * propio, archivos regulares del usuario del proceso, en orden determinista. Otras
   * entradas no son objetos de este adaptador y no rompen el listado. */
  listObjects(): AsyncIterable<{ key: string; sizeBytes: number }> {
    assertLocalAdapterEnvironment(this.appEnv);
    return this.iterateObjects();
  }

  private async *iterateObjects(): AsyncIterable<{ key: string; sizeBytes: number }> {
    await this.root.verify(["root", "objects"]);
    const objectsPath = `${this.root.rootPath}${sep}objects`;
    const entries = [...(await this.fileOps.readdir(objectsPath))].sort();
    for (const entry of entries) {
      if (!OBJECT_KEY_PATTERN.test(entry)) continue;
      const stat = await lstatOrNull(this.fileOps, `${objectsPath}${sep}${entry}`);
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

  /** Limpieza en ejecución (§7.2), con el recorrido de antecesores reactualizado (§6.5). */
  async recoverWorkArea(): Promise<WorkAreaCleanupReport> {
    assertLocalAdapterEnvironment(this.appEnv);
    await this.root.walkAncestors();
    await this.root.verify(["root", "tmp", ".reclaim"]);
    return this.workArea.cleanLeftovers();
  }

  /** Cierre (§7.2): la misma limpieza; si no quedan operaciones activas, borra el
   * directorio de la instancia. Con operaciones activas no interfiere: las deja
   * terminar y el directorio queda para esa vez o para el mantenimiento. */
  async close(): Promise<WorkAreaCleanupReport> {
    assertLocalAdapterEnvironment(this.appEnv);
    await this.root.walkAncestors();
    await this.root.verify(["root", "tmp", ".reclaim"]);
    return this.workArea.close();
  }

  private async fillTemporary(
    handle: FileOpsHandle,
    content: AsyncIterable<Uint8Array>,
    maxBytes: number,
    signal: AbortSignal | undefined,
  ): Promise<{ sizeBytes: number; sha256: string }> {
    const digest = createHash("sha256");
    let sizeBytes = 0;
    const iterator = content[Symbol.asyncIterator]();
    let aborted = false;
    const cancelled = () => {
      aborted = true;
      return new StorageWriteError("BEFORE_PUBLISH", { failureReason: "CANCELLED" });
    };
    try {
      for (;;) {
        if (signal?.aborted === true) throw cancelled();
        let chunkResult: IteratorResult<Uint8Array>;
        if (signal === undefined) {
          chunkResult = await iterator.next();
        } else {
          // Si gana la cancelación, el rechazo del flujo abandonado no debe quedar sin
          // manejar: la operación ya está terminando antes de publicar.
          const nextPromise = iterator.next();
          nextPromise.catch(() => undefined);
          chunkResult = await raceWithAbort(nextPromise, signal, cancelled);
        }
        if (chunkResult.done === true) break;
        const chunk = asUint8Array(chunkResult.value);
        const received = sizeBytes + chunk.byteLength;
        if (received > maxBytes) {
          // Límite sobre los bytes recibidos: deja de leer de inmediato (§8.3).
          throw new ObjectTooLargeError(maxBytes, received);
        }
        await handle.write(chunk);
        digest.update(chunk);
        sizeBytes = received;
      }
    } catch (error) {
      // Un objeto vacío se rechaza; un fallo del flujo a mitad de escritura queda
      // antes de publicar (§8.4). En ambos casos se cierra la fuente lo mejor posible.
      await closeSourceQuietly(iterator, aborted);
      if (
        error instanceof StorageWriteError ||
        error instanceof ObjectTooLargeError ||
        error instanceof EmptyObjectError
      ) {
        throw error;
      }
      // Error ajeno del flujo (§8.4, fila 2 a 4): la fase es la misma que la del resto
      // de los fallos de la copia; la causa original queda como `cause`.
      throw new StorageWriteError("BEFORE_PUBLISH", { cause: error });
    }
    if (sizeBytes === 0) throw new EmptyObjectError();
    await closeSourceQuietly(iterator, aborted);
    // Paso 4: fsync del archivo. El cierre fallido también queda antes de publicar.
    try {
      await handle.fsync();
    } catch (error) {
      throw new StorageWriteError("BEFORE_PUBLISH", { cause: error });
    }
    return { sizeBytes, sha256: digest.digest("hex") };
  }

  /** Publicación (§8.3 paso 5) y fsync del directorio (paso 6), con los resultados por
   * fase de §8.4. El punto de publicación es el éxito del `link`: nunca reemplaza un
   * destino existente, y un error espurio se resuelve comparando dev e inodo. */
  private async publishAndSyncDirectory(
    temporaryPath: string,
    temporaryStat: Stats,
  ): Promise<{ key: string }> {
    const key = this.randomHex128();
    const objectPath = `${this.root.rootPath}${sep}objects${sep}${key}`;
    try {
      await this.fileOps.link(temporaryPath, objectPath);
    } catch (error) {
      const destination = await lstatOrNull(this.fileOps, objectPath);
      if (
        destination !== null &&
        destination.dev === temporaryStat.dev &&
        destination.ino === temporaryStat.ino
      ) {
        // El enlace realmente tomó efecto: sigue en el paso 6 como publicado.
      } else if (codeOf(error) === "EEXIST") {
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
 * nombre determinista. Los errores de limpieza no tap el diagnóstico. */
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

function asUint8Array(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** Espera el próximo trozo o la cancelación, lo que ocurra primero. */
async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onAbort: () => Error,
): Promise<T> {
  if (signal.aborted) throw onAbort();
  let abortListener: (() => void) | undefined;
  const cancelledPromise = new Promise<never>((_, reject) => {
    abortListener = () => {
      reject(onAbort());
    };
    signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([promise, cancelledPromise]);
  } finally {
    if (abortListener !== undefined) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}

async function closeSourceQuietly(
  iterator: AsyncIterator<Uint8Array>,
  aborted: boolean,
): Promise<void> {
  try {
    if (aborted || typeof iterator.return === "function") {
      await iterator.return?.(undefined);
    }
  } catch {
    // La fuente ya falló o fue cancelada: su cierre no aporta información nueva.
  }
}

async function attemptClose(handle: FileOpsHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    // El cierre es el último recurso de liberación; los datos ya tienen fsync.
  }
}

async function lstatOrNull(fileOps: FileOps, path: string): Promise<Stats | null> {
  try {
    return await fileOps.lstat(path);
  } catch {
    return null;
  }
}

async function removeTemporaryIfOurs(fileOps: FileOps, temporaryPath: string): Promise<void> {
  try {
    const stat = await fileOps.lstat(temporaryPath);
    if (stat.isFile() || stat.isDirectory()) {
      await fileOps.unlink(temporaryPath);
    }
  } catch {
    // ENOENT u otro error: se retoma en la limpieza en ejecución (§7.2) o en el
    // mantenimiento con consumidores detenidos (§7.3).
  }
}

function codeOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function objectStream(handle: FileOpsHandle, chunkSize: number): AsyncIterableIterator<Uint8Array> {
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
