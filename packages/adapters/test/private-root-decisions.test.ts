import { describe, expect, it } from "vitest";
import {
  ROOT_UID,
  decideCanonicalAncestor,
  decideConfiguredSymlink,
  stickyBit,
  toWalkNodeInfo,
  type WalkNodeInfo,
} from "../src/local/private-root.js";

// Controles sobre antecesores con datos de `stat` SINTÉTICOS (plan de P1-T5 §6.3 y §13):
// los casos de otro usuario o de root no se pueden crear sin privilegios, así que esta
// prueba no ejercita el sistema de archivos: prueba la función de decisión pura.

const PROCESS_UID = 501;
const OTHER_UID = 1000;

function directory(uid: number, mode: number): WalkNodeInfo {
  return { kind: "directory", mode, uid };
}

function symlinkNode(uid: number, mode = 0o777): WalkNodeInfo {
  return { kind: "symlink", mode, uid };
}

describe("decideCanonicalAncestor (datos sintéticos, sin sistema de archivos)", () => {
  it("rechaza un antecesor de otro usuario (no se puede crear sin root: datos sintéticos)", () => {
    expect(
      decideCanonicalAncestor(directory(ROOT_UID, 0o755), directory(OTHER_UID, 0o755), PROCESS_UID),
    ).toBe("OWNER_FORBIDDEN");
  });

  it("acepta un antecesor de root y otro del usuario del proceso", () => {
    expect(
      decideCanonicalAncestor(directory(ROOT_UID, 0o755), directory(ROOT_UID, 0o755), PROCESS_UID),
    ).toBe("OK");
    expect(
      decideCanonicalAncestor(
        directory(ROOT_UID, 0o755),
        directory(PROCESS_UID, 0o700),
        PROCESS_UID,
      ),
    ).toBe("OK");
  });

  it("rechaza un antecesor de root con escritura de grupo (0770)", () => {
    expect(
      decideCanonicalAncestor(directory(ROOT_UID, 0o755), directory(ROOT_UID, 0o770), PROCESS_UID),
    ).toBe("WRITABLE");
  });

  it("rechaza un antecesor de root con escritura de otros (0757)", () => {
    expect(
      decideCanonicalAncestor(directory(ROOT_UID, 0o755), directory(ROOT_UID, 0o757), PROCESS_UID),
    ).toBe("WRITABLE");
  });

  it("acepta un directorio de root con bit sticky (1777), como /tmp", () => {
    expect(
      decideCanonicalAncestor(directory(ROOT_UID, 0o755), directory(ROOT_UID, 0o1777), PROCESS_UID),
    ).toBe("OK");
  });

  it("rechaza el componente siguiente a un sticky de root si es de otro usuario (1737 de otro no)", () => {
    expect(
      decideCanonicalAncestor(
        directory(ROOT_UID, 0o1777),
        directory(OTHER_UID, 0o700),
        PROCESS_UID,
      ),
    ).toBe("STICKY_NEXT_NOT_USER");
  });

  it("acepta el componente siguiente a un sticky de root si es del usuario", () => {
    expect(
      decideCanonicalAncestor(
        directory(ROOT_UID, 0o1777),
        directory(PROCESS_UID, 0o700),
        PROCESS_UID,
      ),
    ).toBe("OK");
  });

  it("un directorio sticky que no es de root no recibe la excepción", () => {
    // 1777 del usuario: escritura de otros sin ser root con sticky: se rechaza.
    expect(
      decideCanonicalAncestor(
        directory(ROOT_UID, 0o755),
        directory(PROCESS_UID, 0o1777),
        PROCESS_UID,
      ),
    ).toBe("WRITABLE");
  });

  it("rechaza un link en el recorrido canónico: la ruta cambió", () => {
    expect(
      decideCanonicalAncestor(directory(ROOT_UID, 0o755), symlinkNode(ROOT_UID), PROCESS_UID),
    ).toBe("NOT_DIRECTORY");
  });

  it("rechaza un antecesor que no es directorio", () => {
    expect(
      decideCanonicalAncestor(
        directory(ROOT_UID, 0o755),
        { kind: "other", mode: 0o644, uid: ROOT_UID },
        PROCESS_UID,
      ),
    ).toBe("NOT_DIRECTORY");
  });

  it("el primer componente sin padre distinto de / aplica la regla normal", () => {
    expect(decideCanonicalAncestor(null, directory(ROOT_UID, 0o755), PROCESS_UID)).toBe("OK");
  });
});

describe("decideConfiguredSymlink (datos sintéticos, sin sistema de archivos)", () => {
  it("acepta /var → private/var: enlace de root dentro de /", () => {
    const link = symlinkNode(ROOT_UID);
    expect(decideConfiguredSymlink(null, link, PROCESS_UID)).toBe("OK");
  });

  it("rechaza un enlace del usuario aunque apunte a un lugar válido", () => {
    expect(decideConfiguredSymlink(null, symlinkNode(PROCESS_UID), PROCESS_UID)).toBe(
      "SYMLINK_OWNER",
    );
  });

  it("rechaza un enlace que no está en un directorio", () => {
    expect(
      decideConfiguredSymlink(
        { kind: "other", mode: 0o644, uid: ROOT_UID },
        symlinkNode(ROOT_UID),
        PROCESS_UID,
      ),
    ).toBe("NOT_DIRECTORY");
  });

  it("rechaza el enlace cuando su directorio contenedor tiene escritura de otros", () => {
    expect(
      decideConfiguredSymlink(directory(PROCESS_UID, 0o757), symlinkNode(ROOT_UID), PROCESS_UID),
    ).toBe("WRITABLE");
  });

  it("rechaza el enlace que está dentro de un sticky de root", () => {
    expect(
      decideConfiguredSymlink(directory(ROOT_UID, 0o1777), symlinkNode(ROOT_UID), PROCESS_UID),
    ).toBe("STICKY_NEXT_NOT_USER");
  });
});

describe("ayudas de decisión", () => {
  it("reconoce el bit sticky en el modo", () => {
    expect(stickyBit(0o1777)).toBe(true);
    expect(stickyBit(0o1755)).toBe(true);
    expect(stickyBit(0o755)).toBe(false);
  });

  it("toWalkNodeInfo clasifica el tipo según los bits", () => {
    expect(
      toWalkNodeInfo({
        isSymbolicLink: () => true,
        isDirectory: () => false,
        mode: 0o777,
        uid: 0,
      } as never).kind,
    ).toBe("symlink");
    expect(
      toWalkNodeInfo({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        mode: 0o755,
        uid: 0,
      } as never).kind,
    ).toBe("directory");
  });
});
