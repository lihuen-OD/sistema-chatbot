import { describe, expect, it } from "vitest";
import {
  adapterEventSchema,
  boundEventSchema,
  hostEventSchema,
  jobEventSchema,
  MAX_INT32,
  parseJobEvent,
  parseProductionInboundEvent,
  parseSimulationEventRequest,
  parseSimulatorEvent,
  simulationEventRequestSchema,
  simulatorEventSchema,
  toSimulatorEvent,
} from "../src/index.js";
import {
  adapterSamples,
  bsuid,
  expectInvalid,
  expectValid,
  jobSamples,
  phone,
  simulationRequestSamples,
  simulatorSamples,
  withChanges,
} from "./samples.js";

describe("variantes válidas", () => {
  it.each(Object.entries(adapterSamples))("adaptador: %s", (_name, sample) => {
    expectValid(adapterEventSchema, sample);
    expectValid(hostEventSchema, sample);
  });

  it.each(Object.entries(jobSamples))("trabajo interno: %s", (_name, sample) => {
    expectValid(jobEventSchema, sample);
    expectValid(hostEventSchema, sample);
  });

  it.each(Object.entries(simulationRequestSamples))(
    "solicitud del simulador: %s",
    (_name, sample) => {
      expectValid(simulationEventRequestSchema, sample);
    },
  );

  it.each(Object.entries(simulatorSamples))("evento del simulador: %s", (_name, sample) => {
    expectValid(simulatorEventSchema, sample);
    expectValid(hostEventSchema, sample);
  });
});

describe("kind desconocido, campos faltantes y campos no permitidos", () => {
  it("rechaza un kind desconocido en cada origen", () => {
    expectInvalid(adapterEventSchema, { ...adapterSamples.textReceived, kind: "AUDIO_RECEIVED" });
    expectInvalid(jobEventSchema, { ...jobSamples.downloadQuarantined, kind: "UPLOAD_DONE" });
    expectInvalid(simulatorEventSchema, {
      ...simulatorSamples.textReceived,
      kind: "FILE_RECEIVED",
    });
  });

  it.each([
    "eventId",
    "channelId",
    "senderIdentities",
    "providerMessageId",
    "receivedAt",
    "source",
  ])("rechaza un evento del adaptador sin %s", (field) => {
    expectInvalid(
      adapterEventSchema,
      withChanges(adapterSamples.textReceived, { [field]: undefined }),
    );
  });

  it.each(["jobId", "submissionId", "generation", "documentId", "occurredAt"])(
    "rechaza un resultado interno sin %s",
    (field) => {
      expectInvalid(jobEventSchema, withChanges(jobSamples.scanApproved, { [field]: undefined }));
    },
  );

  it("rechaza archivos sin id de media ni tipo declarado", () => {
    expectInvalid(
      adapterEventSchema,
      withChanges(adapterSamples.fileReceived, { providerMediaId: undefined }),
    );
    expectInvalid(
      adapterEventSchema,
      withChanges(adapterSamples.fileReceived, { declaredMimeType: undefined }),
    );
  });

  it.each([
    ["employeeId", "emp-1"],
    ["companyId", "company_a"],
    ["authorized", true],
    ["boundSubmissionId", "sub-demo-1"],
    ["bindingOutcome", "APPLIED"],
    ["simulationId", "sim-demo"],
  ])("el adaptador no puede aportar %s", (field, value) => {
    expectInvalid(adapterEventSchema, { ...adapterSamples.optionSelected, [field]: value });
  });

  it("un resultado REJECTED exige motivo y los demás no lo admiten", () => {
    expectInvalid(
      jobEventSchema,
      withChanges(jobSamples.scanRejected, { rejectionReason: undefined }),
    );
    expectInvalid(jobEventSchema, { ...jobSamples.scanApproved, rejectionReason: "MALWARE" });
    expectInvalid(jobEventSchema, { ...jobSamples.scanRejected, rejectionReason: "VIRUS" });
  });
});

describe("acciones de prompt", () => {
  it.each([
    ["CONFIRM sin documentId", withChanges(adapterSamples.confirm, { documentId: undefined })],
    ["CONFIRM con candidateId", { ...adapterSamples.confirm, candidateId: "doc-demo-3" }],
    ["REPLACE sin documentId", withChanges(adapterSamples.replace, { documentId: undefined })],
    ["CANCEL con documentId", { ...adapterSamples.cancel, documentId: "doc-demo-2" }],
    ["CANCEL con candidateId", { ...adapterSamples.cancel, candidateId: "doc-demo-3" }],
    ["CHOOSE sin candidateId", withChanges(adapterSamples.choose, { candidateId: undefined })],
    ["CHOOSE con documentId", { ...adapterSamples.choose, documentId: "doc-demo-2" }],
    ["acción desconocida", { ...adapterSamples.cancel, action: "APPROVE" }],
    ["sin promptId", withChanges(adapterSamples.confirm, { promptId: undefined })],
    ["sin submissionId", withChanges(adapterSamples.confirm, { submissionId: undefined })],
    ["sin contextRevision", withChanges(adapterSamples.confirm, { contextRevision: undefined })],
    ["contextRevision negativa", { ...adapterSamples.confirm, contextRevision: -1 }],
    ["contextRevision no entera", { ...adapterSamples.confirm, contextRevision: 1.5 }],
  ])("rechaza %s", (_name, value) => {
    expectInvalid(adapterEventSchema, value);
  });

  it("un texto 'sí' sigue siendo TEXT_RECEIVED y no admite campos de confirmación", () => {
    const parsed = adapterEventSchema.parse(adapterSamples.textReceived);
    expect(parsed.kind).toBe("TEXT_RECEIVED");
    expectInvalid(adapterEventSchema, { ...adapterSamples.textReceived, action: "CONFIRM" });
    expectInvalid(adapterEventSchema, { ...adapterSamples.textReceived, documentId: "doc-demo-2" });
  });

  it("aplica las mismas reglas en las solicitudes del simulador", () => {
    expectInvalid(
      simulationEventRequestSchema,
      withChanges(simulationRequestSamples.confirm, { documentId: undefined }),
    );
    expectInvalid(simulationEventRequestSchema, {
      ...simulationRequestSamples.cancel,
      documentId: "doc-sim-1",
    });
  });
});

describe("fechas, enteros y tamaños", () => {
  it.each([
    "2026-13-01T00:00:00Z",
    "2026-02-30T10:00:00Z",
    "2026-10-19 17:00:00",
    "2026-10-19T17:00:00",
    "2026-10-19T17:00:00+03:00",
    "19/10/2026",
    "",
  ])("rechaza la fecha %j", (date) => {
    expectInvalid(adapterEventSchema, { ...adapterSamples.textReceived, receivedAt: date });
    expectInvalid(jobEventSchema, { ...jobSamples.scanApproved, occurredAt: date });
  });

  it("acepta fechas UTC con fracciones de segundo", () => {
    expectValid(adapterEventSchema, {
      ...adapterSamples.textReceived,
      receivedAt: "2026-10-19T17:00:00.123Z",
    });
  });

  it.each([
    [
      "contextRevision fuera de rango",
      adapterEventSchema,
      { ...adapterSamples.confirm, contextRevision: MAX_INT32 + 1 },
    ],
    ["generación 0", jobEventSchema, { ...jobSamples.scanApproved, generation: 0 }],
    ["intento 0", jobEventSchema, { ...jobSamples.dispatchStarted, attempt: 0 }],
    ["fencingToken 0", jobEventSchema, { ...jobSamples.dispatchStarted, fencingToken: 0 }],
    [
      "tamaño negativo",
      adapterEventSchema,
      { ...adapterSamples.fileReceived, declaredSizeBytes: -1 },
    ],
    [
      "tamaño no entero",
      adapterEventSchema,
      { ...adapterSamples.fileReceived, declaredSizeBytes: 1.5 },
    ],
    [
      "tamaño no seguro",
      adapterEventSchema,
      { ...adapterSamples.fileReceived, declaredSizeBytes: 2 ** 53 },
    ],
    [
      "tamaño simulado como texto",
      simulationEventRequestSchema,
      { ...simulationRequestSamples.fileMetadata, sizeBytes: "120000" },
    ],
  ])("rechaza %s", (_name, schema, value) => {
    expectInvalid(schema, value);
  });

  it("acota el texto a 4.096 caracteres", () => {
    expectValid(adapterEventSchema, { ...adapterSamples.textReceived, text: "a".repeat(4096) });
    expectInvalid(adapterEventSchema, { ...adapterSamples.textReceived, text: "a".repeat(4097) });
    expectInvalid(adapterEventSchema, { ...adapterSamples.textReceived, text: "" });
  });

  it("acota el nombre de archivo y rechaza caracteres de control", () => {
    expectValid(adapterEventSchema, { ...adapterSamples.fileReceived, fileName: "a".repeat(255) });
    expectInvalid(adapterEventSchema, {
      ...adapterSamples.fileReceived,
      fileName: "a".repeat(256),
    });
    expectInvalid(adapterEventSchema, {
      ...adapterSamples.fileReceived,
      fileName: "factura\n.pdf",
    });
  });

  it("acota identidades, opciones e ids", () => {
    const five = [
      phone,
      bsuid,
      ...[2, 3, 4].map((n) => ({ ...phone, value: `+1202555010${String(n)}` })),
    ];
    expectInvalid(adapterEventSchema, { ...adapterSamples.textReceived, senderIdentities: five });
    expectInvalid(adapterEventSchema, { ...adapterSamples.textReceived, senderIdentities: [] });
    expectInvalid(adapterEventSchema, {
      ...adapterSamples.textReceived,
      senderIdentities: [phone, phone],
    });
    expectInvalid(adapterEventSchema, {
      ...adapterSamples.optionSelected,
      optionId: `opt_${"a".repeat(80)}`,
    });
    expectInvalid(adapterEventSchema, {
      ...adapterSamples.textReceived,
      providerMessageId: "wamid demo",
    });
    expectInvalid(adapterEventSchema, {
      ...adapterSamples.textReceived,
      eventId: "-empieza-con-guion",
    });
  });
});

describe("identidades con tipo y ámbito", () => {
  it.each([
    ["teléfono con ámbito de negocio", { ...phone, scopeType: "BUSINESS" }],
    ["teléfono con ámbito distinto de global", { ...phone, scopeId: "demo_business_scope" }],
    ["teléfono sin formato E.164", { ...phone, value: "12025550101" }],
    ["BSUID con ámbito E164", { ...bsuid, scopeType: "E164" }],
    ["BSUID sin ámbito válido", { ...bsuid, scopeId: "Ámbito inválido" }],
    ["BSUID demasiado largo", { ...bsuid, value: "x".repeat(129) }],
    ["proveedor no admitido", { ...phone, provider: "TELEGRAM" }],
    ["tipo desconocido", { ...phone, kind: "EMAIL" }],
    ["estado de directorio en el evento", { ...phone, status: "ACTIVE" }],
  ])("rechaza %s", (_name, identity) => {
    expectInvalid(adapterEventSchema, {
      ...adapterSamples.textReceived,
      senderIdentities: [identity],
    });
  });
});

describe("archivo sin timestamp del proveedor", () => {
  it("se representa para que el host lo diagnostique como FILE_NOT_CORRELATED", () => {
    const withoutTimestamp = withChanges(adapterSamples.fileReceived, {
      providerTimestamp: undefined,
    });
    const parsed = parseProductionInboundEvent(withoutTimestamp);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.providerTimestamp).toBeUndefined();

    expectValid(boundEventSchema, {
      event: parsed.value,
      binding: {
        outcome: "NOT_BOUND",
        boundAt: "2026-10-19T17:00:01Z",
        diagnostic: { code: "FILE_NOT_CORRELATED", reason: "MISSING_PROVIDER_TIMESTAMP" },
      },
    });
  });

  it("no acepta una fecha vacía ni nula en su lugar", () => {
    expectInvalid(adapterEventSchema, { ...adapterSamples.fileReceived, providerTimestamp: "" });
    expectInvalid(adapterEventSchema, { ...adapterSamples.fileReceived, providerTimestamp: null });
  });

  it("es la única variante del adaptador que admite omitir el timestamp", () => {
    for (const sample of [
      adapterSamples.optionSelected,
      adapterSamples.textReceived,
      adapterSamples.confirm,
      adapterSamples.replace,
      adapterSamples.cancel,
      adapterSamples.choose,
    ]) {
      expectInvalid(adapterEventSchema, withChanges(sample, { providerTimestamp: undefined }));
    }
  });
});

describe("separación entre simulador, adaptador y trabajos internos", () => {
  it("la entrada de producción acepta solo eventos del adaptador", () => {
    expect(parseProductionInboundEvent(adapterSamples.confirm).ok).toBe(true);
    for (const sample of [
      simulatorSamples.fileMetadata,
      simulatorSamples.confirm,
      jobSamples.scanApproved,
    ]) {
      const result = parseProductionInboundEvent(sample);
      expect(result).toMatchObject({ ok: false, reason: "SOURCE_NOT_ALLOWED" });
    }
  });

  it("un evento con forma de adaptador pero con simulationId se rechaza en producción", () => {
    const result = parseProductionInboundEvent({
      ...adapterSamples.textReceived,
      simulationId: "sim-demo",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "SOURCE_NOT_ALLOWED",
      problems: [{ path: ["simulationId"] }],
    });
  });

  it("el simulador acepta solo eventos de simulación con simulationId", () => {
    expect(parseSimulatorEvent(simulatorSamples.fileMetadata).ok).toBe(true);
    expect(parseSimulatorEvent(adapterSamples.textReceived)).toMatchObject({
      reason: "SOURCE_NOT_ALLOWED",
    });
    expect(
      parseSimulatorEvent(withChanges(simulatorSamples.textReceived, { simulationId: undefined })),
    ).toMatchObject({
      ok: false,
      reason: "INVALID",
    });
  });

  it("los resultados internos solo entran por la vía de trabajos", () => {
    expect(parseJobEvent(jobSamples.dispatchStarted).ok).toBe(true);
    expect(parseJobEvent(adapterSamples.fileReceived)).toMatchObject({
      reason: "SOURCE_NOT_ALLOWED",
    });
    expect(parseJobEvent(simulatorSamples.scanResult)).toMatchObject({
      reason: "SOURCE_NOT_ALLOWED",
    });
  });

  it("FILE_RECEIVED es solo del adaptador y FILE_METADATA_SIMULATED solo del simulador", () => {
    expectInvalid(simulationEventRequestSchema, {
      kind: "FILE_RECEIVED",
      providerMediaId: "m",
      declaredMimeType: "application/pdf",
    });
    expectInvalid(adapterEventSchema, { ...simulatorSamples.fileMetadata, source: "ADAPTER" });
  });

  it("la solicitud del simulador no puede fijar origen, simulación, id ni fecha", () => {
    for (const field of ["source", "simulationId", "eventId", "occurredAt"]) {
      expect(
        parseSimulationEventRequest({ ...simulationRequestSamples.textReceived, [field]: "x" }).ok,
      ).toBe(false);
    }
  });

  it("toSimulatorEvent compone el evento con los datos del servidor", () => {
    const event = toSimulatorEvent(simulationRequestSamples.confirm, {
      simulationId: "sim-demo",
      eventId: "ev-sim-9",
      occurredAt: "2026-10-19T17:03:00Z",
    });
    expect(event).toMatchObject({
      source: "SIMULATOR",
      simulationId: "sim-demo",
      kind: "PROMPT_ACTION",
    });
    expect(parseSimulatorEvent(event).ok).toBe(true);
    expect(parseProductionInboundEvent(event).ok).toBe(false);
  });
});

describe("vinculación del host", () => {
  const binding = {
    outcome: "APPLIED",
    submissionId: "sub-demo-1",
    generation: 2,
    contextRevision: 4,
    boundAt: "2026-10-19T17:00:01Z",
    employeeId: "emp-demo-1",
  } as const;

  it("acepta un evento del adaptador vinculado por el host", () => {
    expectValid(boundEventSchema, { event: adapterSamples.confirm, binding });
  });

  it("una respuesta puede quedar vinculada a otro trámite que el que declara el botón", () => {
    expectValid(boundEventSchema, {
      event: adapterSamples.confirm,
      binding: {
        ...binding,
        outcome: "REJECTED",
        submissionId: "sub-demo-9",
        diagnostic: { code: "PROMPT_STALE" },
      },
    });
  });

  it("NOT_BOUND no lleva trámite y los demás resultados lo exigen", () => {
    expectInvalid(boundEventSchema, {
      event: adapterSamples.textReceived,
      binding: { outcome: "NOT_BOUND", boundAt: binding.boundAt, submissionId: "sub-demo-1" },
    });
    expectInvalid(boundEventSchema, {
      event: adapterSamples.textReceived,
      binding: withChanges(binding, { generation: undefined }),
    });
    expectInvalid(boundEventSchema, {
      event: adapterSamples.textReceived,
      binding: { ...binding, outcome: "MAYBE" },
    });
  });

  it("un resultado interno se vincula al trámite y la generación de su trabajo", () => {
    expectValid(boundEventSchema, {
      event: jobSamples.scanApproved,
      binding: { ...binding, outcome: "IGNORED" },
    });
    expectInvalid(boundEventSchema, {
      event: jobSamples.scanApproved,
      binding: { ...binding, submissionId: "sub-demo-9" },
    });
    expectInvalid(boundEventSchema, {
      event: jobSamples.scanApproved,
      binding: { ...binding, generation: 3 },
    });
    expectInvalid(boundEventSchema, {
      event: jobSamples.scanApproved,
      binding: { outcome: "NOT_BOUND", boundAt: binding.boundAt },
    });
  });

  it("los datos de vinculación no pueden venir dentro del evento", () => {
    expectInvalid(hostEventSchema, { ...adapterSamples.confirm, binding });
  });
});
