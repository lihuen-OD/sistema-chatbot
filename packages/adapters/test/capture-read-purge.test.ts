// Lectura, retención y purga de capturas (plan de P1-T5, §9.7, §9.8 y §13): lecturas
// concurrentes con una purga (nunca una mezcla), plazos por `capturedAt` con reloj manual,
// purgas concurrentes, la purga pausada frente a una recreación (escenarios A, B y C del
// propietario) y errores del sistema que no son ausencia.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sep } from "node:path";
import { nodeFileOps } from "../src/local/file-ops.js";
import {
  CaptureKeyBusyError,
  CaptureNotFoundError,
  InvalidCaptureIdError,
} from "../src/ports/email.js";
import {
  buildTestCapture,
  captureIdOf,
  DAY_MS,
  entryPath,
  manualTiming,
  readJsonFile,
  sampleEmail,
  type TestCaptureContext,
} from "./capture-support.js";
import {
  createGate,
  createTestDirectory,
  decorateFileOps,
  encode,
  installTestAppEnv,
  listNames,
} from "./support.js";

let restoreAppEnv: () => void;
beforeEach(() => {
  restoreAppEnv = installTestAppEnv();
});
afterEach(() => {
  restoreAppEnv();
});

const KEY = "entrega-0004:confirmacion-0004";
const CAPTURE_ID = captureIdOf(KEY);

function errorWithCode(code: string): Error {
  return Object.assign(new Error(`inyección: ${code}`), { code });
}

async function publicationIdOf(
  context: TestCaptureContext,
  captureId = CAPTURE_ID,
): Promise<unknown> {
  return (await readJsonFile(`${entryPath(context, captureId)}${sep}record.json`))["publicationId"];
}

describe("readCapture (§9.7)", () => {
  it("devuelve registro y contenido validados; el adjunto con sus bytes", async () => {
    const context = await buildTestCapture();
    const attachmentBytes = encode("%PDF ficticio para leer");
    await context.sender.send(KEY, sampleEmail({ attachmentBytes }));
    const read = await context.sender.readCapture(CAPTURE_ID);
    expect(read).toMatchObject({
      captureId: CAPTURE_ID,
      delivery: "NOT_SENT_LOCAL_CAPTURE",
      delivered: false,
      payloadAvailable: true,
      message: {
        to: ["destino.uno@example.com", "destino.dos@example.com"],
        subject: "Constancia de prueba",
        attachment: {
          fileName: "constancia-ficticia.pdf",
          mimeType: "application/pdf",
          content: attachmentBytes,
        },
      },
    });
    expect(read.publicationId).toBe(await publicationIdOf(context));
  });

  it("inexistente: CaptureNotFoundError; identificador mal formado: InvalidCaptureIdError", async () => {
    const context = await buildTestCapture();
    await expect(context.sender.readCapture(CAPTURE_ID)).rejects.toBeInstanceOf(
      CaptureNotFoundError,
    );
    for (const bad of ["", "../x", CAPTURE_ID.toUpperCase(), `${CAPTURE_ID}0`]) {
      await expect(context.sender.readCapture(bad)).rejects.toBeInstanceOf(InvalidCaptureIdError);
    }
  });

  /** Una purga legítima corre entre la lectura del registro y la del contenido (se inyecta en
   * el `lstat` de `payload/` del lector). Nunca hay una mezcla: con la entrada purgada,
   * CaptureNotFoundError; con solo el contenido purgado, el registro sin contenido. */
  it.each([
    { purga: "la entrada completa", days: 31, expected: "NOT_FOUND" as const },
    { purga: "solo el contenido", days: 8, expected: "RECORD_ONLY" as const },
  ])("una purga de $purga entre las dos lecturas no produce datos mezclados", async (scenario) => {
    const directory = await createTestDirectory();
    const timing = manualTiming();
    const purger = await buildTestCapture({ timing }, directory);
    const control = { purgeOnPayloadLstat: false };
    const reader = await buildTestCapture(
      {
        timing,
        fileOps: decorateFileOps(nodeFileOps, {
          lstat: async (path: string) => {
            if (control.purgeOnPayloadLstat && path.endsWith(`${CAPTURE_ID}${sep}payload`)) {
              control.purgeOnPayloadLstat = false;
              await purger.sender.purgeCaptures();
            }
            return nodeFileOps.lstat(path);
          },
        }),
      },
      directory,
    );
    await reader.sender.send(KEY, sampleEmail());
    timing.advance(scenario.days * DAY_MS);
    control.purgeOnPayloadLstat = true;
    if (scenario.expected === "NOT_FOUND") {
      await expect(reader.sender.readCapture(CAPTURE_ID)).rejects.toBeInstanceOf(
        CaptureNotFoundError,
      );
    } else {
      await expect(reader.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
        payloadAvailable: false,
        message: null,
      });
    }
    expect(control.purgeOnPayloadLstat).toBe(false);
  });

  it("una captura recreada entre las dos lecturas (otra publicación): la lectura se resuelve bajo el bloqueo, sin mezclar", async () => {
    const directory = await createTestDirectory();
    const timing = manualTiming();
    const other = await buildTestCapture({ timing }, directory);
    const control = { recreateOnMessageRead: false };
    const reader = await buildTestCapture(
      {
        timing,
        fileOps: decorateFileOps(nodeFileOps, {
          openObjectForRead: async (path: string) => {
            if (control.recreateOnMessageRead && path.endsWith(`${sep}payload${sep}message.json`)) {
              control.recreateOnMessageRead = false;
              timing.advance(31 * DAY_MS);
              await other.sender.purgeCaptures();
              await other.sender.send(KEY, sampleEmail({ subject: "Recreada" }));
            }
            return nodeFileOps.openObjectForRead(path);
          },
        }),
      },
      directory,
    );
    await reader.sender.send(KEY, sampleEmail({ subject: "Original" }));
    const original = await publicationIdOf(reader);
    control.recreateOnMessageRead = true;
    const read = await reader.sender.readCapture(CAPTURE_ID);
    expect(read.publicationId).not.toBe(original);
    expect(read.publicationId).toBe(await publicationIdOf(reader));
    expect(read.message?.subject).toBe("Recreada");
  });

  it("un EIO al leer el registro no es ausencia: se reintenta bajo el bloqueo y el error se propaga", async () => {
    const injected = errorWithCode("EIO");
    const control = { fail: false };
    const context = await buildTestCapture({
      fileOps: decorateFileOps(nodeFileOps, {
        openObjectForRead: async (path: string) => {
          if (control.fail && path.endsWith("record.json")) throw injected;
          return nodeFileOps.openObjectForRead(path);
        },
      }),
    });
    await context.sender.send(KEY, sampleEmail());
    control.fail = true;
    await expect(context.sender.readCapture(CAPTURE_ID)).rejects.toBe(injected);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    control.fail = false;
    await expect(context.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      payloadAvailable: true,
    });
  });
});

describe("retención y alcance de la idempotencia (§9.8)", () => {
  it("al vencer el contenido se borra payload/ y queda el registro; el reintento da duplicate con payloadAvailable false", async () => {
    const timing = manualTiming();
    const context = await buildTestCapture({ timing });
    await context.sender.send(KEY, sampleEmail());
    const publication = await publicationIdOf(context);
    timing.advance(7 * DAY_MS - 1);
    await expect(context.sender.purgeCaptures()).resolves.toMatchObject({
      payloadsPurged: 0,
      entriesPurged: 0,
    });
    timing.advance(1);
    await expect(context.sender.purgeCaptures()).resolves.toMatchObject({
      payloadsPurged: 1,
      entriesPurged: 0,
    });
    expect(await listNames(entryPath(context, CAPTURE_ID))).toEqual(["record.json"]);
    expect(await publicationIdOf(context)).toBe(publication);
    await expect(context.sender.send(KEY, sampleEmail())).resolves.toEqual({
      outcome: "CAPTURED",
      captureId: CAPTURE_ID,
      duplicate: true,
      payloadAvailable: false,
      delivered: false,
    });
    // La deduplicación se conserva: otro contenido sigue siendo un conflicto.
    await expect(context.sender.send(KEY, sampleEmail({ subject: "Otro" }))).resolves.toMatchObject(
      {
        reason: "IDEMPOTENCY_CONFLICT",
      },
    );
    await expect(context.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      payloadAvailable: false,
      message: null,
    });
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    expect(await listNames(`${context.rootPath}${sep}.reclaim`)).toEqual([]);
  });

  it("al vencer el registro se borra la entrada; un reintento posterior crea otra captura con otro publicationId", async () => {
    const timing = manualTiming();
    const context = await buildTestCapture({ timing });
    await context.sender.send(KEY, sampleEmail());
    const first = await publicationIdOf(context);
    timing.advance(30 * DAY_MS);
    await expect(context.sender.purgeCaptures()).resolves.toMatchObject({ entriesPurged: 1 });
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
    await expect(context.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
      duplicate: false,
    });
    expect(await publicationIdOf(context)).not.toBe(first);
  });

  it("plazos configurados: contenido a 2 días y registro a 3", async () => {
    const timing = manualTiming();
    const context = await buildTestCapture({ timing, retentionDays: 2, recordDays: 3 });
    await context.sender.send(KEY, sampleEmail());
    timing.advance(2 * DAY_MS);
    await expect(context.sender.purgeCaptures()).resolves.toMatchObject({ payloadsPurged: 1 });
    timing.advance(DAY_MS);
    await expect(context.sender.purgeCaptures()).resolves.toMatchObject({ entriesPurged: 1 });
  });

  it("dos purgas concurrentes de varias instancias eliminan cada entrada una vez, sin errores", async () => {
    const directory = await createTestDirectory();
    const timing = manualTiming();
    const first = await buildTestCapture({ timing }, directory);
    const second = await buildTestCapture({ timing }, directory);
    const keys = Array.from({ length: 8 }, (_, index) => `clave-purga-${String(index)}`);
    for (const key of keys) await first.sender.send(key, sampleEmail());
    timing.advance(31 * DAY_MS);
    const [a, b] = await Promise.all([first.sender.purgeCaptures(), second.sender.purgeCaptures()]);
    expect(a.entriesPurged + b.entriesPurged).toBe(keys.length);
    expect(a.integrityProblems.length + b.integrityProblems.length).toBe(0);
    expect(await listNames(`${first.rootPath}${sep}captures`)).toEqual([]);
    expect(await listNames(`${first.rootPath}${sep}locks`)).toEqual([]);
  });

  it("un EIO al leer en la purga no es ausencia: se informa como ilegible y nada se borra", async () => {
    const timing = manualTiming();
    const control = { fail: false };
    const context = await buildTestCapture({
      timing,
      fileOps: decorateFileOps(nodeFileOps, {
        openObjectForRead: async (path: string) => {
          if (control.fail && path.endsWith("record.json")) throw errorWithCode("EIO");
          return nodeFileOps.openObjectForRead(path);
        },
      }),
    });
    await context.sender.send(KEY, sampleEmail());
    timing.advance(31 * DAY_MS);
    control.fail = true;
    await expect(context.sender.purgeCaptures()).resolves.toMatchObject({
      entriesPurged: 0,
      unreadable: [CAPTURE_ID],
    });
    expect(await listNames(entryPath(context, CAPTURE_ID))).toEqual(["payload", "record.json"]);
  });
});

describe("purga pausada frente a una recreación (§9.8, escenarios del propietario)", () => {
  it("A: la purga A se pausa después del escaneo sin bloqueo; B purga, send recrea P2; A toma el bloqueo, ve P2 y la omite", async () => {
    const directory = await createTestDirectory();
    const timing = manualTiming();
    const reachedLock = createGate();
    const resume = createGate();
    const control = { pauseBeforeLock: false };
    const purgeA = await buildTestCapture(
      {
        timing,
        fileOps: decorateFileOps(nodeFileOps, {
          mkdir: async (path: string, mode?: number) => {
            if (control.pauseBeforeLock && path.includes(`${sep}lock-`)) {
              control.pauseBeforeLock = false;
              reachedLock.open();
              await resume.promise;
            }
            await nodeFileOps.mkdir(path, mode);
          },
        }),
      },
      directory,
    );
    const purgeB = await buildTestCapture({ timing }, directory);
    await purgeB.sender.send(KEY, sampleEmail({ subject: "P1" }));
    const p1 = await publicationIdOf(purgeB);
    timing.advance(31 * DAY_MS);
    control.pauseBeforeLock = true;
    const pausedPurge = purgeA.sender.purgeCaptures();
    await reachedLock.promise; // A ya leyó P1 en el escaneo
    await expect(purgeB.sender.purgeCaptures()).resolves.toMatchObject({ entriesPurged: 1 });
    await expect(purgeB.sender.send(KEY, sampleEmail({ subject: "P2" }))).resolves.toMatchObject({
      duplicate: false,
    });
    const p2 = await publicationIdOf(purgeB);
    expect(p2).not.toBe(p1);
    resume.open();
    await expect(pausedPurge).resolves.toMatchObject({
      entriesPurged: 0,
      skippedRecreated: [CAPTURE_ID],
    });
    expect(await publicationIdOf(purgeB)).toBe(p2);
    await expect(purgeB.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      payloadAvailable: true,
      message: { subject: "P2" },
    });
  });

  it("B: la purga A se pausa con el bloqueo tomado más de 120 s; B la omite, send da KEY_BUSY; A reclama P1 y el reintento publica P2", async () => {
    const directory = await createTestDirectory();
    const timing = manualTiming();
    const reachedReclaim = createGate();
    const resume = createGate();
    const control = { pauseOnReclaim: false };
    const purgeA = await buildTestCapture(
      {
        timing,
        fileOps: decorateFileOps(nodeFileOps, {
          rename: async (source: string, destination: string) => {
            if (control.pauseOnReclaim && destination.endsWith(`${sep}entry`)) {
              control.pauseOnReclaim = false;
              reachedReclaim.open();
              await resume.promise;
            }
            await nodeFileOps.rename(source, destination);
          },
        }),
      },
      directory,
    );
    const other = await buildTestCapture({ timing }, directory);
    await other.sender.send(KEY, sampleEmail({ subject: "P1" }));
    timing.advance(31 * DAY_MS);
    control.pauseOnReclaim = true;
    const pausedPurge = purgeA.sender.purgeCaptures();
    await reachedReclaim.promise; // A tiene el bloqueo y ya releyó P1
    timing.advance(121_000);
    await expect(other.sender.purgeCaptures()).resolves.toMatchObject({
      skippedBusy: [CAPTURE_ID],
    });
    await expect(other.sender.send(KEY, sampleEmail({ subject: "P2" }))).rejects.toBeInstanceOf(
      CaptureKeyBusyError,
    );
    resume.open();
    await expect(pausedPurge).resolves.toMatchObject({ entriesPurged: 1 });
    await expect(other.sender.send(KEY, sampleEmail({ subject: "P2" }))).resolves.toMatchObject({
      duplicate: false,
    });
    await expect(other.sender.readCapture(CAPTURE_ID)).resolves.toMatchObject({
      message: { subject: "P2" },
    });
  });

  it("C: la purga A cae con el bloqueo tomado después de reclamar P1; send da KEY_BUSY y nada rompe el bloqueo", async () => {
    const directory = await createTestDirectory();
    const timing = manualTiming();
    const crashed = createGate();
    const control = { crashAfterReclaim: false };
    const purgeA = await buildTestCapture(
      {
        timing,
        fileOps: decorateFileOps(nodeFileOps, {
          rename: async (source: string, destination: string) => {
            await nodeFileOps.rename(source, destination);
            if (control.crashAfterReclaim && destination.endsWith(`${sep}entry`)) {
              control.crashAfterReclaim = false;
              crashed.open();
              await new Promise<never>(() => undefined); // la instancia "cae" con el bloqueo
            }
          },
        }),
      },
      directory,
    );
    const other = await buildTestCapture({ timing }, directory);
    await other.sender.send(KEY, sampleEmail({ subject: "P1" }));
    timing.advance(31 * DAY_MS);
    control.crashAfterReclaim = true;
    void purgeA.sender.purgeCaptures().catch(() => undefined);
    await crashed.promise;
    expect(await listNames(`${other.rootPath}${sep}captures`)).toEqual([]);
    expect(await listNames(`${other.rootPath}${sep}locks${sep}${CAPTURE_ID}`)).toEqual([
      "entry",
      "owner.json",
    ]);
    await other.sender.recoverWorkArea();
    await expect(other.sender.send(KEY, sampleEmail({ subject: "P2" }))).rejects.toBeInstanceOf(
      CaptureKeyBusyError,
    );
    expect(await listNames(`${other.rootPath}${sep}locks${sep}${CAPTURE_ID}`)).toEqual([
      "entry",
      "owner.json",
    ]);
    // Pasos 3 y 4 del escenario (terminar de borrar P1 y quitar el bloqueo con los
    // consumidores detenidos) son del mantenimiento de §7.3, bloque posterior.
  });
});
