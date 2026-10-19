import type { z } from "zod";
import type { RequestProblem } from "./api-errors.js";
import {
  adapterEventSchema,
  jobEventSchema,
  simulationEventRequestSchema,
  simulatorEventSchema,
  type AdapterEvent,
  type JobEvent,
  type SimulationEventRequest,
  type SimulatorEvent,
} from "./events.js";

export type EntryResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: "SOURCE_NOT_ALLOWED" | "INVALID";
      readonly problems: readonly RequestProblem[];
    };

/**
 * Entrada de producción: solo eventos normalizados del adaptador. Rechaza eventos del simulador
 * o de trabajos internos y cualquier evento con `simulationId`. Es una separación de contratos;
 * la protección efectiva del host y del despliegue todavía no existe.
 */
export function parseProductionInboundEvent(input: unknown): EntryResult<AdapterEvent> {
  if (isRecord(input) && (input["source"] !== "ADAPTER" || "simulationId" in input)) {
    return sourceNotAllowed(input);
  }
  return parseWith(adapterEventSchema, input);
}

/** Entrada del host de simulación: solo eventos con origen SIMULATOR y su `simulationId`. */
export function parseSimulatorEvent(input: unknown): EntryResult<SimulatorEvent> {
  if (isRecord(input) && input["source"] !== "SIMULATOR") return sourceNotAllowed(input);
  return parseWith(simulatorEventSchema, input);
}

/** Resultados de trabajos internos; nunca llegan desde el canal. */
export function parseJobEvent(input: unknown): EntryResult<JobEvent> {
  if (isRecord(input) && input["source"] !== "JOB") return sourceNotAllowed(input);
  return parseWith(jobEventSchema, input);
}

/** Cuerpo de POST /simulations/:id/events. */
export function parseSimulationEventRequest(input: unknown): EntryResult<SimulationEventRequest> {
  return parseWith(simulationEventRequestSchema, input);
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown): EntryResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    reason: "INVALID",
    problems: result.error.issues.slice(0, 50).map((issue) => ({
      path: issue.path
        .slice(0, 16)
        .map((segment) => (typeof segment === "number" ? segment : String(segment).slice(0, 128))),
      reason: issue.code,
    })),
  };
}

function sourceNotAllowed(input: Record<string, unknown>): EntryResult<never> {
  const path = "simulationId" in input && input["source"] === "ADAPTER" ? "simulationId" : "source";
  return {
    ok: false,
    reason: "SOURCE_NOT_ALLOWED",
    problems: [{ path: [path], reason: "SOURCE_NOT_ALLOWED" }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
