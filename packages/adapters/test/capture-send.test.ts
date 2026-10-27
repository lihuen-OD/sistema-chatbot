// Captura de correo: validación, formato en disco, permisos, duplicados, conflictos,
// corrupción, entrada sin registro y escrituras (plan de P1-T5, §9.2, §9.3, §9.5–§9.7 y §13).
// Archivos reales bajo mkdtemp; los fallos se inyectan con FileOps.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { sep } from "node:path";
import { nodeFileOps, type FileOpsHandle } from "../src/local/file-ops.js";
import {
  CaptureIntegrityError,
  CaptureWriteError,
  type OutgoingEmail,
} from "../src/ports/email.js";
import {
  buildTestCapture,
  bytesOf,
  captureIdOf,
  entryPath,
  instanceDirectoryOf,
  readJsonFile,
  sampleEmail,
  type TestCaptureContext,
} from "./capture-support.js";
import {
  createTestDirectory,
  currentUmask,
  decorateFileOps,
  encode,
  installTestAppEnv,
  listNames,
  sha256Hex,
  withUmask,
} from "./support.js";

let restoreAppEnv: () => void;
beforeEach(() => {
  restoreAppEnv = installTestAppEnv();
});
afterEach(() => {
  restoreAppEnv();
});

const KEY = "entrega-0001:confirmacion-0001";

async function expectNothingWritten(context: TestCaptureContext): Promise<void> {
  expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
  expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
  expect(await listNames(instanceDirectoryOf(context))).toEqual(["instance.json"]);
}

function errorWithCode(code: string): Error {
  return Object.assign(new Error(`inyección: ${code}`), { code });
}

/** Un flujo que cuenta los trozos que entrega. */
function countingSource(chunks: Uint8Array[]): {
  source: AsyncIterable<Uint8Array>;
  delivered: () => number;
} {
  let delivered = 0;
  return {
    source: {
      [Symbol.asyncIterator]: async function* (): AsyncIterableIterator<Uint8Array> {
        for (const chunk of chunks) {
          delivered += 1;
          await Promise.resolve();
          yield chunk;
        }
      },
    },
    delivered: () => delivered,
  };
}

describe("validación antes de escribir (§9.2)", () => {
  const long = (length: number): string => "a".repeat(length);
  const cases: { caso: string; key?: unknown; message: () => unknown; reason: string }[] = [
    {
      caso: "clave vacía",
      key: "",
      message: () => sampleEmail(),
      reason: "INVALID_IDEMPOTENCY_KEY",
    },
    {
      caso: "clave de 201",
      key: long(201),
      message: () => sampleEmail(),
      reason: "INVALID_IDEMPOTENCY_KEY",
    },
    {
      caso: "clave no ASCII",
      key: "clave-ñ",
      message: () => sampleEmail(),
      reason: "INVALID_IDEMPOTENCY_KEY",
    },
    {
      caso: "clave con LF",
      key: "clave\n",
      message: () => sampleEmail(),
      reason: "INVALID_IDEMPOTENCY_KEY",
    },
    { caso: "mensaje nulo", message: () => null, reason: "INVALID_MESSAGE" },
    { caso: "asunto vacío", message: () => sampleEmail({ subject: "" }), reason: "SUBJECT_EMPTY" },
    {
      caso: "asunto de 201",
      message: () => sampleEmail({ subject: long(201) }),
      reason: "SUBJECT_TOO_LONG",
    },
    {
      caso: "asunto con LF",
      message: () => sampleEmail({ subject: "Hola\nBcc: x@example.com" }),
      reason: "SUBJECT_LINE_BREAK",
    },
    {
      caso: "asunto con CR",
      message: () => sampleEmail({ subject: "Hola\rx" }),
      reason: "SUBJECT_LINE_BREAK",
    },
    {
      caso: "sin destinatarios",
      message: () => ({ ...sampleEmail(), to: [] }),
      reason: "NO_RECIPIENTS",
    },
    {
      caso: "21 destinatarios",
      message: () => ({
        ...sampleEmail(),
        to: Array.from({ length: 21 }, (_, i) => `d${String(i)}@example.com`),
      }),
      reason: "TOO_MANY_RECIPIENTS",
    },
    {
      caso: "destinatario sin forma de email",
      message: () => ({ ...sampleEmail(), to: ["no-es-email"] }),
      reason: "INVALID_RECIPIENT",
    },
    {
      caso: "destinatario con CR/LF",
      message: () => ({ ...sampleEmail(), to: ["a@example.com\r\nBcc: b@example.com"] }),
      reason: "INVALID_RECIPIENT",
    },
    {
      caso: "destinatario repetido",
      message: () => ({ ...sampleEmail(), to: ["a@example.com", "A@Example.com"] }),
      reason: "DUPLICATE_RECIPIENT",
    },
    {
      caso: "cuerpo vacío",
      message: () => ({ ...sampleEmail(), textBody: "" }),
      reason: "BODY_EMPTY",
    },
    {
      caso: "cuerpo de más de 64 KiB",
      message: () => ({ ...sampleEmail(), textBody: long(65_537) }),
      reason: "BODY_TOO_LARGE",
    },
    {
      caso: "cuerpo con CR",
      message: () => ({ ...sampleEmail(), textBody: "línea\r\nsiguiente" }),
      reason: "BODY_CONTROL_CHARACTER",
    },
    {
      caso: "cuerpo con NUL",
      message: () => ({ ...sampleEmail(), textBody: "a\u0000b" }),
      reason: "BODY_CONTROL_CHARACTER",
    },
    {
      caso: "nombre de adjunto con LF",
      message: () => ({
        ...sampleEmail(),
        attachment: {
          fileName: "a\nb.pdf",
          mimeType: "application/pdf",
          content: bytesOf(encode("x")),
        },
      }),
      reason: "INVALID_ATTACHMENT_NAME",
    },
    {
      caso: "nombre de adjunto con separador",
      message: () => ({
        ...sampleEmail(),
        attachment: {
          fileName: "../../etc/passwd",
          mimeType: "application/pdf",
          content: bytesOf(encode("x")),
        },
      }),
      reason: "INVALID_ATTACHMENT_NAME",
    },
    {
      caso: "nombre de adjunto de 256",
      message: () => ({
        ...sampleEmail(),
        attachment: {
          fileName: long(256),
          mimeType: "application/pdf",
          content: bytesOf(encode("x")),
        },
      }),
      reason: "INVALID_ATTACHMENT_NAME",
    },
    {
      caso: "MIME no permitido",
      message: () => ({
        ...sampleEmail(),
        attachment: {
          fileName: "a.exe",
          mimeType: "application/x-msdownload",
          content: bytesOf(encode("x")),
        },
      }),
      reason: "ATTACHMENT_MIME_NOT_ALLOWED",
    },
  ];

  it.each(cases)("$caso: REJECTED $reason y nada escrito", async (testCase) => {
    const context = await buildTestCapture();
    const result = await context.sender.send(
      (testCase.key ?? KEY) as string,
      testCase.message() as OutgoingEmail,
    );
    expect(result).toMatchObject({ outcome: "REJECTED", reason: testCase.reason });
    await expectNothingWritten(context);
  });

  it("el asunto con CR o LF informa la posición de `lineBreakPosition` (T53, parte del adaptador)", async () => {
    const context = await buildTestCapture();
    await expect(
      context.sender.send(KEY, sampleEmail({ subject: "Asunto\r\nBcc: otro@example.com" })),
    ).resolves.toEqual({ outcome: "REJECTED", reason: "SUBJECT_LINE_BREAK", lineBreakPosition: 6 });
  });

  it("un rechazo previo no consume el flujo del adjunto", async () => {
    const context = await buildTestCapture();
    const { source, delivered } = countingSource([encode("x")]);
    const result = await context.sender.send(KEY, {
      ...sampleEmail({ subject: "" }),
      attachment: { fileName: "a.pdf", mimeType: "application/pdf", content: source },
    });
    expect(result).toMatchObject({ outcome: "REJECTED", reason: "SUBJECT_EMPTY" });
    expect(delivered()).toBe(0);
  });

  it("adjunto que supera maxFileBytes: REJECTED durante la copia, deja de leer y no queda nada", async () => {
    const context = await buildTestCapture({ maxFileBytes: 1000 });
    const { source, delivered } = countingSource(
      Array.from({ length: 10 }, () => new Uint8Array(400)),
    );
    const result = await context.sender.send(KEY, {
      ...sampleEmail(),
      attachment: { fileName: "grande.pdf", mimeType: "application/pdf", content: source },
    });
    expect(result).toEqual({ outcome: "REJECTED", reason: "ATTACHMENT_TOO_LARGE" });
    expect(delivered()).toBe(3);
    await expectNothingWritten(context);
  });
});

describe("captura y formato en disco (§9.3)", () => {
  it("con adjunto: CAPTURED sin entrega; message.json y attachment.bin coinciden con lo enviado", async () => {
    const context = await buildTestCapture();
    const attachmentBytes = new Uint8Array(150_000).map((_, index) => index % 251);
    const result = await context.sender.send(KEY, sampleEmail({ attachmentBytes }));
    const captureId = captureIdOf(KEY);
    expect(result).toEqual({
      outcome: "CAPTURED",
      captureId,
      duplicate: false,
      payloadAvailable: true,
      delivered: false,
    });
    expect(context.sender.deliversExternally).toBe(false);
    expect(context.sender.kind).toBe("LOCAL_CAPTURE");
    const entry = entryPath(context, captureId);
    expect(await listNames(entry)).toEqual(["payload", "record.json"]);
    expect(await listNames(`${entry}${sep}payload`)).toEqual(["attachment.bin", "message.json"]);
    const message = await readJsonFile(`${entry}${sep}payload${sep}message.json`);
    expect(message).toEqual({
      format: "LOCAL_CAPTURE_V1",
      delivered: false,
      to: ["destino.uno@example.com", "destino.dos@example.com"],
      subject: "Constancia de prueba",
      textBody: "Hola.\nAdjunto la constancia solicitada.\n\tSaludos",
      attachment: {
        fileName: "constancia-ficticia.pdf",
        mimeType: "application/pdf",
        sizeBytes: attachmentBytes.length,
        sha256: sha256Hex(attachmentBytes),
      },
    });
    expect(new Uint8Array(await readFile(`${entry}${sep}payload${sep}attachment.bin`))).toEqual(
      attachmentBytes,
    );
    const record = await readJsonFile(`${entry}${sep}record.json`);
    expect(record).toMatchObject({
      format: "LOCAL_CAPTURE_RECORD_V1",
      captureId,
      idempotencyKeySha256: sha256Hex(encode(KEY)),
      contentSha256: sha256Hex(await readFile(`${entry}${sep}payload${sep}message.json`)),
      delivery: "NOT_SENT_LOCAL_CAPTURE",
      delivered: false,
    });
    expect(record["publicationId"]).toMatch(/^[0-9a-f]{32}$/);
    // Nada queda preparado ni bloqueado.
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    expect(await listNames(instanceDirectoryOf(context))).toEqual(["instance.json"]);
  });

  it("sin adjunto: message.json con attachment null y sin attachment.bin", async () => {
    const context = await buildTestCapture();
    const result = await context.sender.send(KEY, sampleEmail({ withAttachment: false }));
    expect(result).toMatchObject({ outcome: "CAPTURED", duplicate: false });
    const payload = `${entryPath(context, captureIdOf(KEY))}${sep}payload`;
    expect(await listNames(payload)).toEqual(["message.json"]);
    expect(await readJsonFile(`${payload}${sep}message.json`)).toMatchObject({ attachment: null });
  });

  it("record.json no contiene destinatarios, asunto, cuerpo, nombre de archivo ni la clave en claro", async () => {
    const context = await buildTestCapture();
    const key = "clave-visible-XYZ-123";
    await context.sender.send(key, {
      to: ["persona.ficticia@example.com"],
      subject: "AsuntoDistintivo",
      textBody: "CuerpoDistintivo",
      attachment: {
        fileName: "ArchivoDistintivo.pdf",
        mimeType: "application/pdf",
        content: bytesOf(encode("x")),
      },
    });
    const raw = await readFile(`${entryPath(context, captureIdOf(key))}${sep}record.json`, "utf8");
    for (const secret of [
      "persona.ficticia",
      "example.com",
      "AsuntoDistintivo",
      "CuerpoDistintivo",
      "ArchivoDistintivo",
      key,
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(
      [
        "captureId",
        "capturedAt",
        "contentSha256",
        "delivered",
        "delivery",
        "format",
        "idempotencyKeySha256",
        "publicationId",
      ].sort(),
    );
  });

  it("la clave y el nombre original nunca forman rutas", async () => {
    const context = await buildTestCapture();
    const key = "../../fuera/../de/la/raiz";
    await context.sender.send(key, {
      ...sampleEmail(),
      attachment: { fileName: "..pdf", mimeType: "application/pdf", content: bytesOf(encode("x")) },
    });
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([captureIdOf(key)]);
    expect(await listNames(context.tempRoot)).toEqual(["capturas"]);
  });

  it("con umask 0777: directorios 0700 y archivos 0600, y la captura se lee completa", async () => {
    // El directorio de la prueba se crea antes, con la umask normal; dentro de `withUmask`
    // solo corren la construcción de la raíz y el envío.
    const directory = await createTestDirectory();
    const umaskBefore = currentUmask();
    const { context, captureId } = await withUmask(0o777, async () => {
      const built = await buildTestCapture({}, directory);
      await built.sender.send(KEY, sampleEmail());
      return { context: built, captureId: captureIdOf(KEY) };
    });
    expect(currentUmask()).toBe(umaskBefore);
    const entry = entryPath(context, captureId);
    for (const directory of [entry, `${entry}${sep}payload`]) {
      expect((await lstat(directory)).mode & 0o7777).toBe(0o700);
    }
    for (const file of [
      `${entry}${sep}record.json`,
      `${entry}${sep}payload${sep}message.json`,
      `${entry}${sep}payload${sep}attachment.bin`,
    ]) {
      expect((await lstat(file)).mode & 0o7777).toBe(0o600);
    }
    await expect(context.sender.readCapture(captureId)).resolves.toMatchObject({
      payloadAvailable: true,
    });
  });
});

describe("duplicados, conflictos y corrupción (§9.6)", () => {
  it("misma clave y mismo contenido: la misma captura con duplicate: true, sin otra entrada", async () => {
    const context = await buildTestCapture();
    const first = await context.sender.send(KEY, sampleEmail());
    const record = await readFile(`${entryPath(context, captureIdOf(KEY))}${sep}record.json`);
    const second = await context.sender.send(KEY, sampleEmail());
    expect(second).toEqual({ ...first, duplicate: true });
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([captureIdOf(KEY)]);
    expect(await readFile(`${entryPath(context, captureIdOf(KEY))}${sep}record.json`)).toEqual(
      record,
    );
    expect(await listNames(instanceDirectoryOf(context))).toEqual(["instance.json"]);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
  });

  it("misma clave y otro contenido: IDEMPOTENCY_CONFLICT y la original intacta", async () => {
    const context = await buildTestCapture();
    await context.sender.send(KEY, sampleEmail());
    const entry = entryPath(context, captureIdOf(KEY));
    const before = await readFile(`${entry}${sep}payload${sep}message.json`);
    await expect(
      context.sender.send(KEY, sampleEmail({ subject: "Otro asunto" })),
    ).resolves.toEqual({ outcome: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
    await expect(
      context.sender.send(KEY, sampleEmail({ attachmentBytes: encode("otros bytes") })),
    ).resolves.toEqual({ outcome: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
    expect(await readFile(`${entry}${sep}payload${sep}message.json`)).toEqual(before);
  });

  it.each([
    {
      caso: "attachment.bin alterado (mismo tamaño)",
      alterar: async (entry: string) => {
        const path = `${entry}${sep}payload${sep}attachment.bin`;
        const bytes = await readFile(path);
        bytes[0] = (bytes[0] ?? 0) ^ 0xff;
        await writeFile(path, bytes);
      },
      reason: "PAYLOAD_MISMATCH",
    },
    {
      caso: "attachment.bin ausente",
      alterar: async (entry: string) => {
        await rm(`${entry}${sep}payload${sep}attachment.bin`);
      },
      reason: "PAYLOAD_INCOMPLETE",
    },
    {
      caso: "message.json alterado",
      alterar: async (entry: string) => {
        await writeFile(`${entry}${sep}payload${sep}message.json`, encode("{}\n"));
      },
      reason: "PAYLOAD_MISMATCH",
    },
    {
      caso: "record.json con otro idempotencyKeySha256",
      alterar: async (entry: string) => {
        const path = `${entry}${sep}record.json`;
        const record = await readJsonFile(path);
        await writeFile(
          path,
          `${JSON.stringify({ ...record, idempotencyKeySha256: sha256Hex(encode("otra")) })}\n`,
        );
      },
      reason: "IDEMPOTENCY_KEY_MISMATCH",
    },
    {
      caso: "record.json con modo 0644",
      alterar: async (entry: string) => {
        await chmod(`${entry}${sep}record.json`, 0o644);
      },
      reason: "RECORD_INVALID",
    },
  ])("$caso: CaptureIntegrityError $reason y nada se sobrescribe", async (testCase) => {
    const context = await buildTestCapture();
    await context.sender.send(KEY, sampleEmail());
    const captureId = captureIdOf(KEY);
    const entry = entryPath(context, captureId);
    await testCase.alterar(entry);
    const snapshot = await snapshotTree(entry);
    const failure = await context.sender.send(KEY, sampleEmail()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CaptureIntegrityError);
    expect(failure).toMatchObject({ captureId, reason: testCase.reason });
    await expect(context.sender.readCapture(captureId)).rejects.toMatchObject({
      name: "CaptureIntegrityError",
      reason: testCase.reason,
    });
    expect(await snapshotTree(entry)).toEqual(snapshot);
    expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
  });
});

describe("entrada sin registro y contenido incompleto (§9.7)", () => {
  it.each(["vacía", "con payload/"])(
    "captures/<id>/ sin record.json (%s): send, purga y lectura la tratan como integridad y no la tocan",
    async (variant) => {
      const context = await buildTestCapture();
      const captureId = captureIdOf(KEY);
      const entry = entryPath(context, captureId);
      await mkdir(entry, { mode: 0o700 });
      await chmod(entry, 0o700);
      if (variant === "con payload/") {
        await mkdir(`${entry}${sep}payload`, { mode: 0o700 });
        await chmod(`${entry}${sep}payload`, 0o700);
        await writeFile(`${entry}${sep}payload${sep}message.json`, encode("{}"), { mode: 0o600 });
      }
      const before = await lstat(entry);
      const snapshot = await snapshotTree(entry);
      await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
        name: "CaptureIntegrityError",
        captureId,
        reason: "RECORD_MISSING",
      });
      await expect(context.sender.readCapture(captureId)).rejects.toMatchObject({
        name: "CaptureIntegrityError",
        reason: "RECORD_MISSING",
      });
      const report = await context.sender.purgeCaptures();
      expect(report.integrityProblems).toEqual([{ captureId, reason: "RECORD_MISSING" }]);
      expect((await lstat(entry)).ino).toBe(before.ino);
      expect(await snapshotTree(entry)).toEqual(snapshot);
      expect(await listNames(`${context.rootPath}${sep}locks`)).toEqual([]);
    },
  );
});

describe("escrituras y fallos durante la preparación (§9.5, fila 2)", () => {
  it("`write` de 2 bytes por llamada en todos los archivos: la captura queda completa e íntegra", async () => {
    const context = await buildTestCapture({
      fileOps: decorateFileOps(nodeFileOps, {
        openTempForWrite: async (path: string) =>
          limitedWrites(await nodeFileOps.openTempForWrite(path), 2),
      }),
    });
    const attachmentBytes = new Uint8Array(5000).map((_, index) => index % 7);
    await expect(context.sender.send(KEY, sampleEmail({ attachmentBytes }))).resolves.toMatchObject(
      {
        outcome: "CAPTURED",
      },
    );
    await expect(context.sender.readCapture(captureIdOf(KEY))).resolves.toMatchObject({
      message: {
        attachment: {
          content: attachmentBytes,
          sizeBytes: 5000,
          sha256: sha256Hex(attachmentBytes),
        },
      },
    });
  });

  it.each(["attachment.bin", "message.json", "record.json", "owner.json"])(
    "escritura sin progreso en %s: BEFORE_PUBLISH y no queda nada",
    async (fileName) => {
      const context = await buildTestCapture({
        fileOps: decorateFileOps(nodeFileOps, {
          openTempForWrite: async (path: string) => {
            const inner = await nodeFileOps.openTempForWrite(path);
            return path.endsWith(`${sep}${fileName}`) ? limitedWrites(inner, 0) : inner;
          },
        }),
      });
      const failure = await context.sender
        .send(KEY, sampleEmail())
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CaptureWriteError);
      expect(failure).toMatchObject({ phase: "BEFORE_PUBLISH" });
      await expectNothingWritten(context);
    },
  );

  it("la fuente del adjunto falla a mitad de la copia: BEFORE_PUBLISH con la causa y no queda nada", async () => {
    const context = await buildTestCapture();
    async function* failing(): AsyncIterableIterator<Uint8Array> {
      await Promise.resolve();
      yield encode("primera parte");
      throw new Error("fallo de la fuente");
    }
    const failure = await context.sender
      .send(KEY, {
        ...sampleEmail(),
        attachment: { fileName: "a.pdf", mimeType: "application/pdf", content: failing() },
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "CaptureWriteError", phase: "BEFORE_PUBLISH" });
    expect(((failure as Error).cause as Error).message).toBe("fallo de la fuente");
    await expectNothingWritten(context);
  });

  it.each([
    { paso: "fsync de attachment.bin", fallo: "FILE" as const },
    { paso: "fsync de staged/", fallo: "DIR" as const },
  ])("falla el $paso: BEFORE_PUBLISH y no queda nada", async (scenario) => {
    const context = await buildTestCapture({
      fileOps: decorateFileOps(nodeFileOps, {
        openTempForWrite: async (path: string) => {
          const inner = await nodeFileOps.openTempForWrite(path);
          if (scenario.fallo !== "FILE" || !path.endsWith("attachment.bin")) return inner;
          return { ...delegate(inner), fsync: () => Promise.reject(errorWithCode("EIO")) };
        },
        fsyncDir: async (path: string) => {
          if (scenario.fallo === "DIR" && path.endsWith(`${sep}staged`)) throw errorWithCode("EIO");
          await nodeFileOps.fsyncDir(path);
        },
      }),
    });
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
      name: "CaptureWriteError",
      phase: "BEFORE_PUBLISH",
    });
    await expectNothingWritten(context);
  });
});

describe("temporales preexistentes y sin red", () => {
  it("un `lock-<op>` preexistente no se modifica ni se borra: BEFORE_PUBLISH y nada publicado", async () => {
    const OP = "0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c";
    const context = await buildTestCapture({ randomHex128: () => OP });
    const preexisting = `${instanceDirectoryOf(context)}${sep}lock-${OP}`;
    await mkdir(preexisting, { mode: 0o700 });
    await chmod(preexisting, 0o750);
    await writeFile(`${preexisting}${sep}ajeno`, encode("no tocar"), { mode: 0o600 });
    const before = await lstat(preexisting);
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
      name: "CaptureWriteError",
      phase: "BEFORE_PUBLISH",
    });
    const after = await lstat(preexisting);
    expect([after.ino, after.mode & 0o7777]).toEqual([before.ino, 0o750]);
    expect(await readFile(`${preexisting}${sep}ajeno`, "utf8")).toBe("no tocar");
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
  });

  it("con fetch, net.connect y http.request reemplazados por funciones que fallan, la captura funciona", async () => {
    const context = await buildTestCapture();
    const originals = { fetch: globalThis.fetch, connect: net.connect, request: http.request };
    const forbidden = (): never => {
      throw new Error("La captura local no debe usar la red.");
    };
    globalThis.fetch = forbidden;
    net.connect = forbidden;
    http.request = forbidden;
    try {
      await expect(context.sender.send(KEY, sampleEmail())).resolves.toMatchObject({
        outcome: "CAPTURED",
      });
      await expect(context.sender.readCapture(captureIdOf(KEY))).resolves.toMatchObject({
        payloadAvailable: true,
      });
      await expect(context.sender.purgeCaptures()).resolves.toMatchObject({ scanned: 1 });
    } finally {
      globalThis.fetch = originals.fetch;
      net.connect = originals.connect;
      http.request = originals.request;
    }
  });
});

describe("raíz y configuración", () => {
  it.each([
    { retentionDays: 0 },
    { retentionDays: 31 },
    { recordDays: 366 },
    { retentionDays: 10, recordDays: 5 },
    { maxFileBytes: 10_485_761 },
    { maxFileBytes: 1.5 },
  ])("configuración inválida %j: no construye", async (options) => {
    await expect(buildTestCapture(options)).rejects.toBeInstanceOf(TypeError);
  });

  it("la raíz de capturas tiene captures/, locks/, tmp/ y .reclaim/ en 0700", async () => {
    const context = await buildTestCapture();
    expect(await listNames(context.rootPath)).toEqual([".reclaim", "captures", "locks", "tmp"]);
    for (const name of await readdir(context.rootPath)) {
      expect((await lstat(`${context.rootPath}${sep}${name}`)).mode & 0o7777).toBe(0o700);
    }
  });

  it("una raíz reemplazada después de construir: la operación siguiente falla sin escribir", async () => {
    const context = await buildTestCapture();
    await rename(`${context.rootPath}${sep}captures`, `${context.tempRoot}${sep}capturas-viejas`);
    await mkdir(`${context.rootPath}${sep}captures`, { mode: 0o700 });
    await expect(context.sender.send(KEY, sampleEmail())).rejects.toMatchObject({
      name: "StorageIntegrityError",
      reason: "SUBDIRECTORY_REPLACED",
    });
    expect(await listNames(`${context.rootPath}${sep}captures`)).toEqual([]);
  });
});

/** Delegación explícita de una manija (el spread perdería el `this` real). */
function delegate(inner: FileOpsHandle): FileOpsHandle {
  return {
    write: (buffer: Uint8Array) => inner.write(buffer),
    readInto: (buffer: Uint8Array, position: number) => inner.readInto(buffer, position),
    fstat: () => inner.fstat(),
    fchmod: (mode: number) => inner.fchmod(mode),
    fsync: () => inner.fsync(),
    close: () => inner.close(),
  };
}

/** `write` que acepta como máximo `limit` bytes por llamada (0: sin progreso). */
function limitedWrites(inner: FileOpsHandle, limit: number): FileOpsHandle {
  return {
    ...delegate(inner),
    write: async (buffer: Uint8Array) => {
      if (limit === 0) return 0;
      return inner.write(buffer.subarray(0, Math.min(limit, buffer.byteLength)));
    },
  };
}

/** Nombres, modos, inodos y contenidos de un árbol: para comprobar que nada cambió. */
async function snapshotTree(root: string): Promise<string[]> {
  const lines: string[] = [];
  async function walk(path: string, relative: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isDirectory()) {
      lines.push(`${relative}/ ${String(stat.ino)} ${(stat.mode & 0o7777).toString(8)}`);
      for (const name of (await readdir(path)).sort()) {
        await walk(`${path}${sep}${name}`, `${relative}/${name}`);
      }
    } else {
      lines.push(
        `${relative} ${String(stat.ino)} ${(stat.mode & 0o7777).toString(8)} ${sha256Hex(await readFile(path))}`,
      );
    }
  }
  await walk(root, ".");
  return lines;
}
