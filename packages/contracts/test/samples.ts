import { readFileSync } from "node:fs";
import { expect } from "vitest";
import type { z } from "zod";

// Ejemplos válidos de cada variante. Datos ficticios: teléfono del rango 555-01XX y BSUID de
// demostración, como en examples/.

export const phone = {
  provider: "WHATSAPP",
  kind: "PHONE_E164",
  scopeType: "E164",
  scopeId: "global",
  value: "+12025550101",
} as const;

export const bsuid = {
  provider: "WHATSAPP",
  kind: "WHATSAPP_BSUID",
  scopeType: "BUSINESS",
  scopeId: "demo_business_scope",
  value: "demo-bsuid-0001",
} as const;

const adapterBase = {
  source: "ADAPTER",
  eventId: "ev-demo-1",
  channelId: "wa-test",
  senderIdentities: [phone, bsuid],
  providerMessageId: "wamid.demo-1",
  providerTimestamp: "2026-10-19T16:59:58Z",
  receivedAt: "2026-10-19T17:00:00Z",
} as const;

const promptRefs = {
  kind: "PROMPT_ACTION",
  promptId: "prm-demo-7",
  submissionId: "sub-demo-1",
  contextRevision: 4,
} as const;

export const adapterSamples = {
  optionSelected: {
    ...adapterBase,
    kind: "OPTION_SELECTED",
    promptId: "prm-demo-1",
    optionId: "AUTHORIZED_COMPANIES:company_a",
  },
  textReceived: { ...adapterBase, kind: "TEXT_RECEIVED", text: "sí" },
  fileReceived: {
    ...adapterBase,
    kind: "FILE_RECEIVED",
    providerMediaId: "media-demo-1",
    declaredMimeType: "application/pdf",
    declaredSizeBytes: 120_000,
    fileName: "factura.pdf",
  },
  confirm: { ...adapterBase, ...promptRefs, action: "CONFIRM", documentId: "doc-demo-2" },
  replace: { ...adapterBase, ...promptRefs, action: "REPLACE", documentId: "doc-demo-2" },
  cancel: { ...adapterBase, ...promptRefs, action: "CANCEL" },
  choose: { ...adapterBase, ...promptRefs, action: "CHOOSE", candidateId: "doc-demo-3" },
} as const;

const jobBase = {
  source: "JOB",
  eventId: "ev-job-1",
  jobId: "job-demo-1",
  submissionId: "sub-demo-1",
  generation: 2,
  occurredAt: "2026-10-19T17:01:00Z",
} as const;

export const jobSamples = {
  downloadQuarantined: {
    ...jobBase,
    kind: "DOCUMENT_DOWNLOAD_RESULT",
    documentId: "doc-demo-2",
    result: "QUARANTINED",
  },
  downloadFailed: {
    ...jobBase,
    kind: "DOCUMENT_DOWNLOAD_RESULT",
    documentId: "doc-demo-2",
    result: "DOWNLOAD_FAILED",
  },
  scanApproved: {
    ...jobBase,
    kind: "DOCUMENT_SCAN_RESULT",
    documentId: "doc-demo-2",
    result: "APPROVED",
  },
  scanInconclusive: {
    ...jobBase,
    kind: "DOCUMENT_SCAN_RESULT",
    documentId: "doc-demo-2",
    result: "SCAN_INCONCLUSIVE",
  },
  scanRejected: {
    ...jobBase,
    kind: "DOCUMENT_SCAN_RESULT",
    documentId: "doc-demo-2",
    result: "REJECTED",
    rejectionReason: "MALWARE",
  },
  dispatchStarted: {
    ...jobBase,
    kind: "DISPATCH_STARTED",
    deliveryId: "dlv-demo-1",
    attempt: 1,
    fencingToken: 7,
  },
} as const;

const simulatorBase = {
  source: "SIMULATOR",
  simulationId: "sim-demo",
  eventId: "ev-sim-1",
  occurredAt: "2026-10-19T17:02:00Z",
} as const;

export const simulationRequestSamples = {
  optionSelected: {
    kind: "OPTION_SELECTED",
    promptId: "prm-sim-1",
    optionId: "opt_invoice",
  },
  textReceived: { kind: "TEXT_RECEIVED", text: "CANCELAR" },
  confirm: { ...promptRefs, action: "CONFIRM", documentId: "doc-sim-1" },
  replace: { ...promptRefs, action: "REPLACE", documentId: "doc-sim-1" },
  cancel: { ...promptRefs, action: "CANCEL" },
  choose: { ...promptRefs, action: "CHOOSE", candidateId: "doc-sim-2" },
  fileMetadata: {
    kind: "FILE_METADATA_SIMULATED",
    fileName: "factura.pdf",
    declaredMimeType: "application/pdf",
    sizeBytes: 120_000,
    simulatedScanResult: "APPROVED",
  },
  fileMetadataPendingScan: {
    kind: "FILE_METADATA_SIMULATED",
    fileName: "foto.jpg",
    declaredMimeType: "image/jpeg",
    sizeBytes: 20_000_000,
  },
  scanResult: { kind: "SCAN_RESULT_SIMULATED", documentId: "doc-sim-1", result: "REJECTED" },
} as const;

const asSimulatorEvent = (request: object): Record<string, unknown> => ({
  ...simulatorBase,
  ...request,
});

export const simulatorSamples = {
  optionSelected: asSimulatorEvent(simulationRequestSamples.optionSelected),
  textReceived: asSimulatorEvent(simulationRequestSamples.textReceived),
  confirm: asSimulatorEvent(simulationRequestSamples.confirm),
  replace: asSimulatorEvent(simulationRequestSamples.replace),
  cancel: asSimulatorEvent(simulationRequestSamples.cancel),
  choose: asSimulatorEvent(simulationRequestSamples.choose),
  fileMetadata: asSimulatorEvent(simulationRequestSamples.fileMetadata),
  fileMetadataPendingScan: asSimulatorEvent(simulationRequestSamples.fileMetadataPendingScan),
  scanResult: asSimulatorEvent(simulationRequestSamples.scanResult),
};

export function expectValid(schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value);
  expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true);
}

export function expectInvalid(schema: z.ZodType, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

/** Copia con cambios; `undefined` elimina la clave. */
export function withChanges(
  value: object,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = Object.fromEntries(
    Object.entries(value) as [string, unknown][],
  );
  for (const [key, change] of Object.entries(changes)) {
    if (change === undefined) Reflect.deleteProperty(copy, key);
    else copy[key] = change;
  }
  return copy;
}

const EXAMPLES = new URL("../../../examples/", import.meta.url);

export function readExample(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, EXAMPLES), "utf8")) as unknown;
}

export function readRepositoryFile(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}
