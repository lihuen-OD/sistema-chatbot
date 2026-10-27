// Apoyo de las pruebas de la captura de correo (plan de P1-T5 §9 y §13): raíces reales bajo
// mkdtemp, reloj manual para recorrer las esperas largas sin tiempo real, mensajes de prueba
// con datos ficticios (example.com) y utilidades de lectura del formato en disco.
import { readFile } from "node:fs/promises";
import { sep } from "node:path";
import {
  LocalCaptureEmailSender,
  type InternalCaptureOptions,
} from "../src/local/capture-email-sender.js";
import type { CaptureTiming } from "../src/local/capture-key-lock.js";
import { captureIdentity } from "../src/local/capture-message.js";
import type { OutgoingEmail } from "../src/ports/email.js";
import { createTestDirectory, encode, TEST_APP_ENV } from "./support.js";

export interface TestCaptureContext {
  readonly tempRoot: string;
  readonly rootPath: string;
  readonly sender: LocalCaptureEmailSender;
}

export async function buildTestCapture(
  overrides: Partial<InternalCaptureOptions> = {},
  directory?: string,
): Promise<TestCaptureContext> {
  const tempRoot = directory ?? (await createTestDirectory());
  const rootPath = `${tempRoot}${sep}capturas`;
  const sender = await LocalCaptureEmailSender.build({
    appEnv: TEST_APP_ENV,
    rootPath,
    ...overrides,
  });
  return { tempRoot, rootPath, sender };
}

/** Reloj manual: `sleep` avanza el reloj y cede una vuelta del bucle, así la espera de 5 s
 * del bloqueo se recorre sin tiempo real (plan §13, reloj inyectado). */
export interface ManualTiming extends CaptureTiming {
  advance(ms: number): void;
  current(): number;
}

export function manualTiming(start = Date.UTC(2026, 9, 27, 12, 0, 0)): ManualTiming {
  let now = start;
  return {
    now: () => new Date(now),
    sleep: async (ms) => {
      now += ms;
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    },
    advance: (ms) => {
      now += ms;
    },
    current: () => now,
  };
}

export const DAY_MS = 86_400_000;

export function bytesOf(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: async function* (): AsyncIterableIterator<Uint8Array> {
      for (const chunk of chunks) {
        await Promise.resolve();
        yield chunk;
      }
    },
  };
}

/** Mensaje de prueba con datos ficticios. Cada llamada crea un flujo nuevo para el adjunto. */
export function sampleEmail(
  variant: { subject?: string; withAttachment?: boolean; attachmentBytes?: Uint8Array } = {},
): OutgoingEmail {
  const base = {
    to: ["destino.uno@example.com", "destino.dos@example.com"],
    subject: variant.subject ?? "Constancia de prueba",
    textBody: "Hola.\nAdjunto la constancia solicitada.\n\tSaludos",
  };
  if (variant.withAttachment === false) return base;
  return {
    ...base,
    attachment: {
      fileName: "constancia-ficticia.pdf",
      mimeType: "application/pdf",
      content: bytesOf(variant.attachmentBytes ?? encode("%PDF-1.7 contenido ficticio de prueba")),
    },
  };
}

export function captureIdOf(idempotencyKey: string): string {
  return captureIdentity(idempotencyKey).captureId;
}

export function entryPath(context: TestCaptureContext, captureId: string): string {
  return `${context.rootPath}${sep}captures${sep}${captureId}`;
}

export function instanceDirectoryOf(context: TestCaptureContext): string {
  return `${context.rootPath}${sep}tmp${sep}${context.sender.instanceId}`;
}

export async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}
