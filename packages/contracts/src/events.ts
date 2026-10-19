import { TEXT_MAX_LENGTH } from "@sistema-chatbot/flow-schema";
import { z } from "zod";
import { engineDiagnosticSchema } from "./diagnostics.js";
import {
  byteSizeSchema,
  fileNameSchema,
  generationSchema,
  internalIdSchema,
  MAX_INT32,
  mimeTypeSchema,
  providerIdSchema,
  revisionSchema,
  senderIdentitiesSchema,
  utcDateTimeSchema,
} from "./primitives.js";

// Contratos internos normalizados (docs/05). No son payloads de Meta: el mapeo real y la
// verificación del BSUID quedan para P6. Validar un esquema no prueba autenticidad,
// autorización, idempotencia ni orden.

/** Opción estática (`opt_invoice`) o dinámica (`AUTHORIZED_COMPANIES:company_a`). */
export const optionIdSchema = z.string().regex(/^[A-Za-z0-9_]{1,64}(:[A-Za-z0-9_]{1,63})?$/);

export const SCAN_RESULTS = ["APPROVED", "REJECTED", "SCAN_INCONCLUSIVE"] as const;

// --- Payloads compartidos por el adaptador y el simulador ---------------------------------

const optionSelectedPayload = {
  kind: z.literal("OPTION_SELECTED"),
  /** Prompt emitido por el servidor; el host vincula la respuesta a su trámite (ADR-014 §12). */
  promptId: internalIdSchema,
  optionId: optionIdSchema,
};

/** Texto libre. "sí" u "ok" siguen siendo texto: nunca una confirmación (ADR-014 §4). */
const textReceivedPayload = {
  kind: z.literal("TEXT_RECEIVED"),
  text: z.string().min(1).max(TEXT_MAX_LENGTH),
};

/**
 * Referencias que trae una respuesta interactiva, codificadas en el botón que emitió el
 * servidor. Son referencias a verificar contra el registro del prompt, no una prueba.
 */
const promptActionBase = {
  kind: z.literal("PROMPT_ACTION"),
  promptId: internalIdSchema,
  submissionId: internalIdSchema,
  contextRevision: revisionSchema,
};

const promptActionPayloads = {
  CONFIRM: { ...promptActionBase, action: z.literal("CONFIRM"), documentId: internalIdSchema },
  REPLACE: { ...promptActionBase, action: z.literal("REPLACE"), documentId: internalIdSchema },
  CANCEL: { ...promptActionBase, action: z.literal("CANCEL") },
  CHOOSE: { ...promptActionBase, action: z.literal("CHOOSE"), candidateId: internalIdSchema },
};

function promptActionUnion<T extends z.ZodRawShape>(envelope: T) {
  return z.discriminatedUnion("action", [
    z.strictObject({ ...envelope, ...promptActionPayloads.CONFIRM }),
    z.strictObject({ ...envelope, ...promptActionPayloads.REPLACE }),
    z.strictObject({ ...envelope, ...promptActionPayloads.CANCEL }),
    z.strictObject({ ...envelope, ...promptActionPayloads.CHOOSE }),
  ]);
}

// --- Eventos normalizados del adaptador ----------------------------------------------------

/**
 * Sobre de un evento del canal tal como lo normaliza el adaptador. No incluye `employeeId`,
 * autorización ni vinculación: los decide el host (ADR-011, ADR-014 §12). `providerTimestamp`
 * es opcional para poder representar su ausencia; el host la diagnostica.
 */
const adapterEnvelope = {
  source: z.literal("ADAPTER"),
  eventId: internalIdSchema,
  channelId: internalIdSchema,
  senderIdentities: senderIdentitiesSchema,
  providerMessageId: providerIdSchema,
  providerTimestamp: utcDateTimeSchema.optional(),
  receivedAt: utcDateTimeSchema,
};

export const adapterEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...adapterEnvelope,
    ...optionSelectedPayload,
    /** Id del proveedor del mensaje al que responde, si el canal lo informa. */
    repliedProviderMessageId: providerIdSchema.optional(),
  }),
  z.strictObject({ ...adapterEnvelope, ...textReceivedPayload }),
  z.strictObject({
    ...adapterEnvelope,
    kind: z.literal("FILE_RECEIVED"),
    providerMediaId: providerIdSchema,
    declaredMimeType: mimeTypeSchema,
    declaredSizeBytes: byteSizeSchema.optional(),
    fileName: fileNameSchema.optional(),
  }),
  promptActionUnion(adapterEnvelope),
]);

export type AdapterEvent = z.infer<typeof adapterEventSchema>;

// --- Eventos internos producidos por trabajos ---------------------------------------------

/**
 * Los resultados internos conservan la referencia fijada al crear su trabajo: trámite,
 * generación y documento o entrega. Nunca se reasignan (ADR-014 §12).
 */
const jobEnvelope = {
  source: z.literal("JOB"),
  eventId: internalIdSchema,
  jobId: internalIdSchema,
  submissionId: internalIdSchema,
  generation: generationSchema,
  occurredAt: utcDateTimeSchema,
};

const scanResultBase = {
  ...jobEnvelope,
  kind: z.literal("DOCUMENT_SCAN_RESULT"),
  documentId: internalIdSchema,
};

export const jobEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...jobEnvelope,
    kind: z.literal("DOCUMENT_DOWNLOAD_RESULT"),
    documentId: internalIdSchema,
    result: z.enum(["QUARANTINED", "DOWNLOAD_FAILED"]),
  }),
  z.discriminatedUnion("result", [
    z.strictObject({ ...scanResultBase, result: z.enum(["APPROVED", "SCAN_INCONCLUSIVE"]) }),
    z.strictObject({
      ...scanResultBase,
      result: z.literal("REJECTED"),
      // ADR-007: malware, tipo real distinto del declarado o archivo cifrado no analizable.
      rejectionReason: z.enum(["MALWARE", "TYPE_MISMATCH", "ENCRYPTED"]),
    }),
  ]),
  z.strictObject({
    ...jobEnvelope,
    kind: z.literal("DISPATCH_STARTED"),
    deliveryId: internalIdSchema,
    attempt: z.int().min(1).max(MAX_INT32),
    fencingToken: z.int().min(1),
  }),
]);

export type JobEvent = z.infer<typeof jobEventSchema>;

// --- Simulador -------------------------------------------------------------------------------

const fileMetadataSimulatedPayload = {
  kind: z.literal("FILE_METADATA_SIMULATED"),
  fileName: fileNameSchema,
  declaredMimeType: mimeTypeSchema,
  sizeBytes: byteSizeSchema,
  /** Resultado inmediato elegido por quien prueba; si falta, se entrega después. */
  simulatedScanResult: z.enum(SCAN_RESULTS).optional(),
};

const scanResultSimulatedPayload = {
  kind: z.literal("SCAN_RESULT_SIMULATED"),
  documentId: internalIdSchema,
  result: z.enum(SCAN_RESULTS),
};

/**
 * Cuerpo de POST /simulations/:id/events. El cliente no envía `source`, `simulationId`,
 * `eventId` ni fechas: los asigna el servidor (toSimulatorEvent).
 */
export const simulationEventRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject(optionSelectedPayload),
  z.strictObject(textReceivedPayload),
  promptActionUnion({}),
  z.strictObject(fileMetadataSimulatedPayload),
  z.strictObject(scanResultSimulatedPayload),
]);

export type SimulationEventRequest = z.infer<typeof simulationEventRequestSchema>;

/** Evento del simulador, en su propio espacio (`simulationId`). La producción lo rechaza. */
const simulatorEnvelope = {
  source: z.literal("SIMULATOR"),
  simulationId: internalIdSchema,
  eventId: internalIdSchema,
  occurredAt: utcDateTimeSchema,
};

export const simulatorEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...simulatorEnvelope, ...optionSelectedPayload }),
  z.strictObject({ ...simulatorEnvelope, ...textReceivedPayload }),
  promptActionUnion(simulatorEnvelope),
  z.strictObject({ ...simulatorEnvelope, ...fileMetadataSimulatedPayload }),
  z.strictObject({ ...simulatorEnvelope, ...scanResultSimulatedPayload }),
]);

export type SimulatorEvent = z.infer<typeof simulatorEventSchema>;

export interface SimulatorEnvelope {
  readonly simulationId: string;
  readonly eventId: string;
  readonly occurredAt: string;
}

/** Compone el evento del simulador con los datos que asigna el servidor. */
export function toSimulatorEvent(
  request: SimulationEventRequest,
  envelope: SimulatorEnvelope,
): SimulatorEvent {
  return simulatorEventSchema.parse({ ...request, source: "SIMULATOR", ...envelope });
}

// --- Eventos del host y vinculación ---------------------------------------------------------

export const hostEventSchema = z.discriminatedUnion("source", [
  adapterEventSchema,
  jobEventSchema,
  simulatorEventSchema,
]);

export type HostEvent = z.infer<typeof hostEventSchema>;

export const BINDING_OUTCOMES = ["APPLIED", "STALE", "REJECTED", "IGNORED", "NOT_BOUND"] as const;

/**
 * Datos que agrega el host al vincular un evento, una sola vez y en la transacción de
 * transición (ADR-014 §12). El adaptador no los envía; este contrato no implementa su
 * inmutabilidad ni su persistencia.
 */
export const eventBindingSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("NOT_BOUND"),
    boundAt: utcDateTimeSchema,
    employeeId: internalIdSchema.optional(),
    diagnostic: engineDiagnosticSchema.optional(),
  }),
  z.strictObject({
    outcome: z.enum(["APPLIED", "STALE", "REJECTED", "IGNORED"]),
    submissionId: internalIdSchema,
    generation: generationSchema,
    contextRevision: revisionSchema,
    boundAt: utcDateTimeSchema,
    /** Empleado resuelto por el host a partir de las identidades (ADR-011). */
    employeeId: internalIdSchema.optional(),
    diagnostic: engineDiagnosticSchema.optional(),
  }),
]);

export type EventBinding = z.infer<typeof eventBindingSchema>;

export const boundEventSchema = z
  .strictObject({ event: hostEventSchema, binding: eventBindingSchema })
  .superRefine(({ event, binding }, ctx) => {
    if (event.source !== "JOB") return;
    // Los resultados internos se vinculan a la referencia fijada en su trabajo.
    if (
      binding.outcome === "NOT_BOUND" ||
      binding.submissionId !== event.submissionId ||
      binding.generation !== event.generation
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["binding"],
        message: "Un resultado interno se vincula al trámite y la generación de su trabajo.",
      });
    }
  });

export type BoundEvent = z.infer<typeof boundEventSchema>;
