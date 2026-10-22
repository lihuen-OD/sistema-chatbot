// Raíz privada y directorios antecesores (plan de P1-T5, §6). Rige para la raíz del
// almacenamiento (§8) y para la de las capturas (§9, bloque siguiente). Recorridos con
// `lstat` desde `/`; los controles de dueño y modo se resuelven con dos funciones puras
// (decideCanonicalAncestor y decideConfiguredSymlink) para que los casos que requieren
// otro usuario o root se prueben con datos sintéticos (§13), sin privilegios.
import { isAbsolute, normalize, sep } from "node:path";
import { StorageIntegrityError, type StorageIntegrityReason } from "../ports/storage.js";
import type { FileOps, Stats } from "./file-ops.js";

export const ROOT_UID = 0;

type WalkNodeKind = "directory" | "symlink" | "other";

export interface WalkNodeInfo {
  readonly kind: WalkNodeKind;
  /** Modo con los bits de tipo ya quitados; conserva sticky, setuid y setgid. */
  readonly mode: number;
  readonly uid: number;
}

/** Rechazos posibles del recorrido, separados del error para poder decidirlos con
 * datos de `stat` sintéticos sin tocar el sistema de archivos. */
export type AncestorRejectionCode =
  "NOT_DIRECTORY" | "OWNER_FORBIDDEN" | "WRITABLE" | "STICKY_NEXT_NOT_USER" | "SYMLINK_OWNER";

export function toWalkNodeInfo(stat: Stats): WalkNodeInfo {
  const kind: WalkNodeKind = stat.isSymbolicLink()
    ? "symlink"
    : stat.isDirectory()
      ? "directory"
      : "other";
  return { kind, mode: stat.mode & 0o7777, uid: stat.uid };
}

export function stickyBit(mode: number): boolean {
  return (mode & 0o1000) !== 0;
}

/** Escritura de grupo u otros, que el recorrido canónico rechaza (§6.3). En Linux una
 * ACL que otorga escritura se refleja en el bit de grupo (la máscara); en macOS las ACL
 * no se reflejan en el modo y Node no las expone: quedan documentadas como limitación
 * (§6.6), a revisar con `ls -led`. */
export function writableByGroupOrOthers(mode: number): boolean {
  return (mode & 0o020) !== 0 || (mode & 0o002) !== 0;
}

export function isRootOwnedSticky(node: WalkNodeInfo): boolean {
  return node.uid === ROOT_UID && stickyBit(node.mode);
}

/**
 * Decisión sobre un componente antecesor en el recorrido canónico (§6.3): debe ser un
 * directorio (`lstat`; si aparece un enlace, la ruta cambió durante el recorrido),
 * de root o del usuario del proceso, sin escritura de grupo ni de otros.
 * Única excepción, por propiedad: root con bit sticky (como `/tmp`); con ella, el
 * componente siguiente debe ser del usuario del proceso, y la excepción no se aplica a
 * ese componente para relajar su propio modo.
 */
export function decideCanonicalAncestor(
  parent: WalkNodeInfo | null,
  node: WalkNodeInfo,
  processUid: number,
): "OK" | AncestorRejectionCode {
  if (node.kind !== "directory") return "NOT_DIRECTORY";
  if (parent !== null && isRootOwnedSticky(parent)) {
    if (node.uid !== processUid) return "STICKY_NEXT_NOT_USER";
  } else if (node.uid !== ROOT_UID && node.uid !== processUid) {
    return "OWNER_FORBIDDEN";
  }
  if (!isRootOwnedSticky(node) && writableByGroupOrOthers(node.mode)) {
    return "WRITABLE";
  }
  return "OK";
}

/**
 * Decisión sobre un componente que es enlace simbólico en la ruta configurada (§6.2): se
 * acepta solo si es de root y el directorio que lo contiene cumple la regla de §6.3.
 * Bajo un directorio sticky de root no hay excepción que los combine: el componente
 * siguiente debe ser del usuario, y un enlace de usuario siempre se rechaza, así que el
 * enlace de root dentro de un sticky de root se rechaza también.
 */
export function decideConfiguredSymlink(
  parent: WalkNodeInfo | null,
  link: WalkNodeInfo,
  processUid: number,
): "OK" | AncestorRejectionCode {
  if (parent !== null) {
    if (parent.kind !== "directory") return "NOT_DIRECTORY";
    // El directorio que lo contiene cumple la regla de §6.3 (dueño, modo, sticky).
    if (!isRootOwnedSticky(parent)) {
      if (parent.uid !== ROOT_UID && parent.uid !== processUid) return "OWNER_FORBIDDEN";
      if (writableByGroupOrOthers(parent.mode)) return "WRITABLE";
    } else {
      // La excepción sticky exige que el componente siguiente sea del usuario; un enlace
      // de root no lo es, y un enlace de usuario lo rechaza la regla de dueño siguiente.
      return "STICKY_NEXT_NOT_USER";
    }
  }
  if (link.uid !== ROOT_UID) return "SYMLINK_OWNER";
  return "OK";
}

// El mapa de rechazo a motivo: los códigos del error son del catálogo del paquete y no
// llevan valores (§5) ni rutas completas (§8.5).
function reasonForAncestorRejection(
  code: Exclude<AncestorRejectionCode, "NOT_DIRECTORY">,
): StorageIntegrityReason {
  switch (code) {
    case "OWNER_FORBIDDEN":
      return "ANCESTOR_OWNER";
    case "WRITABLE":
      return "ANCESTOR_WRITABLE";
    case "STICKY_NEXT_NOT_USER":
      return "ANCESTOR_OTHERS_WRITABLE_STICKY";
    case "SYMLINK_OWNER":
      return "ANCESTOR_SYMLINK";
  }
}

function ancestorIntegrityError(code: AncestorRejectionCode): StorageIntegrityError {
  if (code === "NOT_DIRECTORY") return new StorageIntegrityError("ANCESTOR_SYMLINK");
  return new StorageIntegrityError(reasonForAncestorRejection(code));
}

export function getProcessUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new StorageIntegrityError("ROOT_PATH_SHAPE");
  }
  return uid;
}

/** Comprobación de forma (§6.1): absoluta, sin byte nulo ni `.`/`..`, igual a
 * `path.normalize` de sí misma, y no la raíz del sistema. */
export function assertRootPathShape(rootPath: string): void {
  if (
    rootPath === "" ||
    rootPath.includes("\0") ||
    !isAbsolute(rootPath) ||
    normalize(rootPath) !== rootPath ||
    rootPath === "/"
  ) {
    throw new StorageIntegrityError("ROOT_PATH_SHAPE");
  }
  for (const component of segmentsOf(rootPath)) {
    if (component === "." || component === "..") {
      throw new StorageIntegrityError("ROOT_PATH_SHAPE");
    }
  }
}

export function segmentsOf(rootPath: string): readonly string[] {
  return rootPath.split(sep).slice(1);
}

export interface DirectoryRecord {
  readonly name: string;
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  /** Modo esperado, siempre 0700 para la raíz y sus subdirectorios. */
  readonly mode: 0o700;
}

export interface PrivateRootContext {
  readonly rootPath: string;
  readonly subdirectories: readonly string[];
  readonly recordByDirectory: ReadonlyMap<string, DirectoryRecord>;
  readonly processUid: number;
  /** Recorre de nuevo la ruta configurada y la canónica (§6.5: al construir y en cada
   * limpieza). No recorre nada en las operaciones ordinarias. */
  walkAncestors(): Promise<void>;
  /** Verificación de cada operación (§6.5): repite `lstat` de los directorios pedidos y
   * compara dev, ino, tipo, dueño y modo; si algo cambió, falla sin escribir ni borrar. */
  verify(names: readonly string[]): Promise<void>;
}

export interface PreparePrivateRootOptions {
  readonly rootPath: string;
  readonly subdirectories: readonly string[];
  readonly fileOps: FileOps;
}

/** Construye o comprueba la raíz y sus subdirectorios (§6.4) y registra dev e inodo. */
export async function preparePrivateRoot(
  options: PreparePrivateRootOptions,
): Promise<PrivateRootContext> {
  const { rootPath, subdirectories, fileOps } = options;
  assertRootPathShape(rootPath);
  const processUid = getProcessUid();
  await walkConfiguredPath(rootPath, fileOps, processUid);
  await walkCanonicalAncestors(rootPath, fileOps, processUid);

  const recordByDirectory = new Map<string, DirectoryRecord>();
  recordByDirectory.set(
    "root",
    await ensurePrivateDirectory(rootPath, "root", fileOps, processUid),
  );
  for (const name of subdirectories) {
    const path = `${rootPath}${sep}${name}`;
    recordByDirectory.set(name, await ensurePrivateDirectory(path, name, fileOps, processUid));
  }
  return {
    rootPath,
    subdirectories,
    recordByDirectory,
    processUid,
    walkAncestors: async () => {
      await walkConfiguredPath(rootPath, fileOps, processUid);
      await walkCanonicalAncestors(rootPath, fileOps, processUid);
    },
    verify: async (names) => {
      for (const name of names) {
        const record = recordByDirectory.get(name);
        if (record === undefined) {
          throw new StorageIntegrityError("SUBDIRECTORY_REPLACED");
        }
        let stat: Stats;
        try {
          stat = await fileOps.lstat(record.path);
        } catch {
          throw new StorageIntegrityError(
            record.name === "root" ? "ROOT_REPLACED" : "SUBDIRECTORY_REPLACED",
          );
        }
        const isRoot = record.name === "root";
        if (
          stat.isSymbolicLink() ||
          !stat.isDirectory() ||
          stat.uid !== processUid ||
          (stat.mode & 0o7777) !== 0o700
        ) {
          throw new StorageIntegrityError(
            record.name === "root"
              ? stat.isSymbolicLink()
                ? "ROOT_SYMLINK"
                : "ROOT_NOT_DIRECTORY"
              : "UNEXPECTED_ENTRY_TYPE",
          );
        }
        if (stat.dev !== record.dev || stat.ino !== record.ino) {
          throw new StorageIntegrityError(isRoot ? "ROOT_REPLACED" : "SUBDIRECTORY_REPLACED");
        }
      }
    },
  };
}

/** Recorrido de la ruta configurada desde `/` (§6.2), sin `realpath`: los componentes
 * que faltan se crean de a uno con mkdir 0700 + chmod 0700 (§6.4) hasta la raíz misma. */
async function walkConfiguredPath(
  rootPath: string,
  fileOps: FileOps,
  processUid: number,
): Promise<void> {
  const segments = segmentsOf(rootPath);
  let parent: WalkNodeInfo | null = null;
  const prefixCount = segments.length;
  for (let index = 0; index < prefixCount; index += 1) {
    const prefix = `/${segments.slice(0, index + 1).join("/")}`;
    const stat = await lstatOrNull(fileOps, prefix);
    if (stat === null) {
      await fileOps.mkdir(prefix);
      await fileOps.chmod(prefix, 0o700);
      const fresh = toWalkNodeInfo(await fileOps.lstat(prefix));
      if (fresh.kind !== "directory" || fresh.uid !== processUid) {
        throw new StorageIntegrityError("ROOT_NOT_DIRECTORY");
      }
      parent = fresh;
      continue;
    }
    const info = toWalkNodeInfo(stat);
    const isRootItself = index === prefixCount - 1;
    if (info.kind === "symlink") {
      if (isRootItself) throw new StorageIntegrityError("ROOT_SYMLINK");
      const decision = decideConfiguredSymlink(parent, info, processUid);
      if (decision !== "OK") throw ancestorIntegrityError(decision);
    } else if (info.kind !== "directory") {
      throw new StorageIntegrityError("PATH_COMPONENT_NOT_DIRECTORY");
    }
    parent = info;
  }
}

/** Recorrido de la ruta canónica (§6.3) desde `/` hasta el padre de la raíz, excluida esta. */
async function walkCanonicalAncestors(
  rootPath: string,
  fileOps: FileOps,
  processUid: number,
): Promise<void> {
  const real = await fileOps.realpath(rootPath);
  if (real === "/" || real.includes("\0")) throw new StorageIntegrityError("ROOT_PATH_SHAPE");
  const segments = segmentsOf(real);
  const rootDirectoryIndex = segments.length - 1;
  let parent: WalkNodeInfo = toWalkNodeInfo(await fileOps.lstat("/"));
  if (parent.kind !== "directory") throw new StorageIntegrityError("PATH_COMPONENT_NOT_DIRECTORY");
  for (let index = 0; index < rootDirectoryIndex; index += 1) {
    const path = `/${segments.slice(0, index + 1).join("/")}`;
    const stat = await lstatOrNull(fileOps, path);
    if (stat === null) throw new StorageIntegrityError("ANCESTOR_SYMLINK");
    const info = toWalkNodeInfo(stat);
    const decision = decideCanonicalAncestor(parent, info, processUid);
    if (decision !== "OK") throw ancestorIntegrityError(decision);
    parent = info;
  }
}

async function lstatOrNull(fileOps: FileOps, path: string): Promise<Stats | null> {
  try {
    return await fileOps.lstat(path);
  } catch {
    return null;
  }
}

/** Crea o comprueba un directorio privado (§6.4): no enlace, del usuario del proceso y
 * con modo exactamente 0700; si falta, se crea y se reafirma el modo por la umask.
 * Un modo o dueño distintos no se corrigen en silencio. */
async function ensurePrivateDirectory(
  path: string,
  name: string,
  fileOps: FileOps,
  processUid: number,
): Promise<DirectoryRecord> {
  const existing = await lstatOrNull(fileOps, path);
  if (existing === null) {
    await fileOps.mkdir(path);
    await fileOps.chmod(path, 0o700);
    const created = toWalkNodeInfo(await fileOps.lstat(path));
    if (created.kind !== "directory" || created.uid !== processUid) {
      throw new StorageIntegrityError("ROOT_NOT_DIRECTORY");
    }
  } else {
    const info = toWalkNodeInfo(existing);
    if (info.kind !== "directory") {
      throw new StorageIntegrityError(
        name === "root" ? "ROOT_NOT_DIRECTORY" : "PATH_COMPONENT_NOT_DIRECTORY",
      );
    }
    if (info.uid !== processUid) {
      throw new StorageIntegrityError(name === "root" ? "ROOT_OWNER" : "SUBDIRECTORY_OWNER");
    }
    if (info.mode !== 0o700) {
      throw new StorageIntegrityError(name === "root" ? "ROOT_MODE" : "SUBDIRECTORY_MODE");
    }
  }
  const stat = await fileOps.lstat(path);
  return { name, path, dev: stat.dev, ino: stat.ino, mode: 0o700 };
}
