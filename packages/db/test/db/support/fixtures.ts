import type pg from "pg";
import type { ConnectionTarget } from "../../../src/guards.js";
import { connect, createTestDatabase } from "./database.js";

// Datos ficticios mínimos para probar restricciones. Todo se inserta con SQL explícito para que
// cada prueba muestre qué fila provoca cada rechazo.

/** Base migrada propia de una prueba, con la organización, empleados, número y versiones base. */
export async function freshWorld(): Promise<{
  client: pg.Client;
  world: World;
  target: ConnectionTarget;
}> {
  const target = await createTestDatabase();
  const client = await connect(target);
  return { client, world: await seedWorld(client), target };
}

export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);

export interface World {
  readonly organizationId: string;
  readonly companyId: string;
  readonly employeeA: string;
  readonly employeeB: string;
  readonly channelId: string;
  readonly otherChannelId: string;
  readonly flowId: string;
  readonly flowVersionId: string;
  readonly catalogVersionId: string;
  readonly ruleSetVersionId: string;
}

async function insertId(client: pg.Client, text: string, values: unknown[] = []): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`${text} RETURNING id`, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("La inserción no devolvió id.");
  return id;
}

export async function seedWorld(client: pg.Client): Promise<World> {
  const organizationId = await insertId(
    client,
    "INSERT INTO organizations (name) VALUES ('Organización de prueba')",
  );
  const companyId = await insertId(
    client,
    "INSERT INTO companies (organization_id, code, name) VALUES ($1, 'empresa_a', 'Empresa A')",
    [organizationId],
  );
  const employeeA = await insertId(
    client,
    "INSERT INTO employees (organization_id, employee_number) VALUES ($1, 'L-0001')",
    [organizationId],
  );
  const employeeB = await insertId(
    client,
    "INSERT INTO employees (organization_id, employee_number) VALUES ($1, 'L-0002')",
    [organizationId],
  );
  const channelId = await insertId(
    client,
    "INSERT INTO channels (organization_id, provider, provider_account_id, provider_channel_id) VALUES ($1, 'WHATSAPP', 'cuenta_demo', 'numero_demo')",
    [organizationId],
  );
  const otherChannelId = await insertId(
    client,
    "INSERT INTO channels (organization_id, provider, provider_account_id, provider_channel_id) VALUES ($1, 'WHATSAPP', 'cuenta_demo', 'otro_numero')",
    [organizationId],
  );
  const flowId = await insertId(
    client,
    "INSERT INTO flows (flow_key, name) VALUES ('flujo_demo', 'Flujo demo')",
  );
  const flowVersionId = await insertId(
    client,
    "INSERT INTO flow_versions (flow_id, version, definition, content_hash, published_by) VALUES ($1, 1, '{}', $2, 'admin@example.com')",
    [flowId, HASH_A],
  );
  const catalogVersionId = await insertId(
    client,
    "INSERT INTO document_catalog_versions (catalog_key, version, content, content_hash, published_by) VALUES ('catalogo_demo', 1, '{}', $1, 'admin@example.com')",
    [HASH_A],
  );
  const ruleSetVersionId = await insertId(
    client,
    "INSERT INTO rule_set_versions (rule_set_key, version, definition, coverage_report, coverage_hash, content_hash, published_by) VALUES ('routing_demo', 1, '{}', '{}', $1, $1, 'admin@example.com')",
    [HASH_A],
  );
  return {
    organizationId,
    companyId,
    employeeA,
    employeeB,
    channelId,
    otherChannelId,
    flowId,
    flowVersionId,
    catalogVersionId,
    ruleSetVersionId,
  };
}

export interface IdentityOptions {
  readonly employeeId: string;
  readonly kind?: "PHONE_E164" | "WHATSAPP_BSUID";
  readonly value?: string;
  readonly scopeId?: string;
  readonly status?: "PENDING_VERIFICATION" | "ACTIVE" | "REVOKED";
}

export async function insertIdentity(client: pg.Client, options: IdentityOptions): Promise<string> {
  const kind = options.kind ?? "PHONE_E164";
  const status = options.status ?? "ACTIVE";
  return insertId(
    client,
    `INSERT INTO channel_identities
       (employee_id, provider, kind, scope_type, scope_id, normalized_value, status, link_method,
        verified_at, revoked_at, created_by)
     VALUES ($1, 'WHATSAPP', $2, $3, $4, $5, $6, 'DIRECTORY_ENROLLMENT',
        CASE WHEN $6 = 'ACTIVE' THEN now() END, CASE WHEN $6 = 'REVOKED' THEN now() END,
        'admin@example.com')`,
    [
      options.employeeId,
      kind,
      kind === "PHONE_E164" ? "E164" : "BUSINESS",
      options.scopeId ?? (kind === "PHONE_E164" ? "global" : "demo_business_scope"),
      options.value ?? (kind === "PHONE_E164" ? "+5491100000001" : "bsuid-demo-0001"),
      status,
    ],
  );
}

export interface SubmissionOptions {
  readonly employeeId?: string;
  readonly channelId?: string;
  readonly generation?: number;
  readonly status?: string;
  readonly kind?: "STANDARD" | "CORRECTION";
  readonly correctsSubmissionId?: string;
  readonly candidateCount?: number;
}

export async function insertSubmission(
  client: pg.Client,
  world: World,
  options: SubmissionOptions = {},
): Promise<string> {
  return insertId(
    client,
    `INSERT INTO submissions
       (employee_id, channel_id, generation, kind, corrects_submission_id, flow_version_id,
        catalog_version_id, status, candidate_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      options.employeeId ?? world.employeeA,
      options.channelId ?? world.channelId,
      options.generation ?? 1,
      options.kind ?? "STANDARD",
      options.correctsSubmissionId ?? null,
      world.flowVersionId,
      world.catalogVersionId,
      options.status ?? "IN_PROGRESS",
      options.candidateCount ?? 0,
    ],
  );
}

let eventCounter = 0;

/** Evento entrante vinculado (APPLIED) al trámite y su generación. */
export async function insertBoundEvent(
  client: pg.Client,
  world: World,
  submissionId: string,
  generation = 1,
): Promise<string> {
  eventCounter++;
  return insertId(
    client,
    `INSERT INTO message_events
       (channel_id, external_event_key, event_type, bound_submission_id, bound_generation,
        bound_context_revision, binding_outcome, bound_at)
     VALUES ($1, $2, 'FILE_RECEIVED', $3, $4, 0, 'APPLIED', now())`,
    [world.channelId, `wamid.prueba.${String(eventCounter)}`, submissionId, generation],
  );
}

/** Incremento condicional de referencia (ADR-014 §2). Devuelve el lugar reservado o undefined. */
export async function reserveCandidateSlot(
  client: pg.Client,
  submissionId: string,
): Promise<number | undefined> {
  const { rows } = await client.query<{ candidate_count: number }>(
    "UPDATE submissions SET candidate_count = candidate_count + 1 WHERE id = $1 AND candidate_count < 3 RETURNING candidate_count",
    [submissionId],
  );
  return rows[0]?.candidate_count;
}

export interface CandidateOptions {
  readonly submissionId: string;
  readonly eventId: string;
  readonly seq: number;
  readonly selection?: string;
  readonly status?: string;
  readonly nodeId?: string;
  readonly executionInstanceId?: string;
  readonly sha256?: string;
}

export async function insertCandidate(
  client: pg.Client,
  options: CandidateOptions,
): Promise<string> {
  return insertId(
    client,
    `INSERT INTO documents
       (submission_id, node_id, execution_instance_id, candidate_seq, selection, status,
        received_event_id, sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      options.submissionId,
      options.nodeId ?? "documento",
      options.executionInstanceId ?? "ejecucion-1",
      options.seq,
      options.selection ?? "PENDING_CHOICE",
      options.status ?? "RECEIVED",
      options.eventId,
      options.sha256 ?? HASH_A,
    ],
  );
}

/** Reserva un lugar y crea el candidato en esa posición. */
export async function addCandidate(
  client: pg.Client,
  world: World,
  submissionId: string,
  options: Partial<CandidateOptions> = {},
): Promise<{ documentId: string; eventId: string; seq: number }> {
  const seq = await reserveCandidateSlot(client, submissionId);
  if (seq === undefined) throw new Error("Sin cupo para otro candidato.");
  const eventId = await insertBoundEvent(client, world, submissionId);
  const documentId = await insertCandidate(client, { ...options, submissionId, eventId, seq });
  return { documentId, eventId, seq };
}

export async function insertPrompt(
  client: pg.Client,
  submissionId: string,
  options: { kind?: string; documentId?: string; status?: string; contextRevision?: number } = {},
): Promise<string> {
  return insertId(
    client,
    `INSERT INTO prompts (submission_id, node_id, execution_instance_id, kind, context_revision,
       document_id, status)
     VALUES ($1, 'documento', 'ejecucion-1', $2, $3, $4, $5)`,
    [
      submissionId,
      options.kind ?? "REVIEW",
      options.contextRevision ?? 0,
      options.documentId ?? null,
      options.status ?? "ACTIVE",
    ],
  );
}

export interface ConfirmationOptions {
  readonly submissionId: string;
  readonly documentId: string;
  readonly promptId: string;
  readonly identityId: string;
  readonly eventId: string;
  readonly contextRevision?: number;
}

export async function insertConfirmation(
  client: pg.Client,
  options: ConfirmationOptions,
): Promise<string> {
  return insertId(
    client,
    `INSERT INTO document_confirmations (submission_id, context_revision, document_id,
       document_sha256, prompt_id, channel_identity_id, event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      options.submissionId,
      options.contextRevision ?? 0,
      options.documentId,
      HASH_A,
      options.promptId,
      options.identityId,
      options.eventId,
    ],
  );
}

export async function insertDelivery(
  client: pg.Client,
  submissionId: string,
  confirmationId: string,
): Promise<string> {
  return insertId(
    client,
    "INSERT INTO deliveries (submission_id, confirmation_id) VALUES ($1, $2)",
    [submissionId, confirmationId],
  );
}

/** Trámite con candidato seleccionado, prompt de revisión y confirmación, listo para una entrega. */
export async function confirmedSubmission(
  client: pg.Client,
  world: World,
  identityId: string,
): Promise<{ submissionId: string; documentId: string; confirmationId: string }> {
  const submissionId = await insertSubmission(client, world, { status: "WAITING_CONFIRMATION" });
  const { documentId } = await addCandidate(client, world, submissionId, {
    selection: "SELECTED",
    status: "APPROVED",
  });
  const promptId = await insertPrompt(client, submissionId, { documentId });
  const eventId = await insertBoundEvent(client, world, submissionId);
  const confirmationId = await insertConfirmation(client, {
    submissionId,
    documentId,
    promptId,
    identityId,
    eventId,
  });
  return { submissionId, documentId, confirmationId };
}
