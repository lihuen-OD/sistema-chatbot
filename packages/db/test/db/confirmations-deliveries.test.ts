import { afterAll, describe, expect, it } from "vitest";
import { cleanupDatabases, expectDatabaseError } from "./support/database.js";
import {
  addCandidate,
  confirmedSubmission,
  freshWorld,
  insertBoundEvent,
  insertConfirmation,
  insertDelivery,
  insertIdentity,
  insertPrompt,
  insertSubmission,
} from "./support/fixtures.js";

afterAll(cleanupDatabases);

// Invariantes 7, 8, 9 y 15 del plan (ADR-014): una confirmación por revisión de contexto y solo
// inserción; una entrega por confirmación con identidad derivada; cancelación solo desde PENDING.

describe("confirmaciones (T37, parte de base)", () => {
  it("una sola confirmación por revisión de contexto", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const { submissionId, documentId } = await confirmedSubmission(client, world, identityId);
    const promptId = await insertPrompt(client, submissionId, { documentId, status: "ANSWERED" });
    const eventId = await insertBoundEvent(client, world, submissionId);
    await expectDatabaseError(
      insertConfirmation(client, { submissionId, documentId, promptId, identityId, eventId }),
      { code: "23505", constraint: "document_confirmations_revision_unique" },
    );
    await insertConfirmation(client, {
      submissionId,
      documentId,
      promptId,
      identityId,
      eventId,
      contextRevision: 1,
    });
  });

  it("documento, prompt y evento pertenecen al mismo trámite", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const submissionId = await insertSubmission(client, world);
    const own = await addCandidate(client, world, submissionId, { selection: "SELECTED" });
    const promptId = await insertPrompt(client, submissionId, { documentId: own.documentId });
    const eventId = await insertBoundEvent(client, world, submissionId);

    const otherSubmission = await insertSubmission(client, world, {
      employeeId: world.employeeB,
    });
    const foreign = await addCandidate(client, world, otherSubmission);
    const foreignEvent = await insertBoundEvent(client, world, otherSubmission);

    await expectDatabaseError(
      insertConfirmation(client, {
        submissionId,
        documentId: foreign.documentId,
        promptId,
        identityId,
        eventId,
      }),
      { code: "23503", constraint: "document_confirmations_document_fk" },
    );
    await expectDatabaseError(
      insertConfirmation(client, {
        submissionId,
        documentId: own.documentId,
        promptId,
        identityId,
        eventId: foreignEvent,
      }),
      { code: "23503", constraint: "document_confirmations_event_fk" },
    );
  });

  it("es solo inserción", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const { confirmationId } = await confirmedSubmission(client, world, identityId);
    await expectDatabaseError(
      client.query(
        "UPDATE document_confirmations SET document_sha256 = repeat('c', 64) WHERE id = $1",
        [confirmationId],
      ),
      { code: "23000", constraint: "document_confirmations_insert_only" },
    );
    await expectDatabaseError(
      client.query("DELETE FROM document_confirmations WHERE id = $1", [confirmationId]),
      { code: "23000", constraint: "document_confirmations_insert_only" },
    );
    // CASCADE incluye las entregas, que también rechazan TRUNCATE.
    await expectDatabaseError(client.query("TRUNCATE document_confirmations CASCADE"), {
      code: "23000",
    });
    const { rows } = await client.query<{ total: string }>(
      "SELECT count(*) AS total FROM document_confirmations",
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });
});

describe("entregas (T37 y T49, parte de base)", () => {
  it("una sola entrega por confirmación", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const { submissionId, confirmationId } = await confirmedSubmission(client, world, identityId);
    await insertDelivery(client, submissionId, confirmationId);
    await expectDatabaseError(insertDelivery(client, submissionId, confirmationId), {
      code: "23505",
      constraint: "deliveries_confirmation_unique",
    });
  });

  it("action_key se deriva de la confirmación: otra confirmación, otra identidad", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const first = await confirmedSubmission(client, world, identityId);
    const d1 = await insertDelivery(client, first.submissionId, first.confirmationId);
    await client.query("UPDATE deliveries SET status = 'CANCELLED' WHERE id = $1", [d1]);

    const promptId = await insertPrompt(client, first.submissionId, {
      documentId: first.documentId,
      status: "ANSWERED",
      contextRevision: 1,
    });
    const eventId = await insertBoundEvent(client, world, first.submissionId);
    const c2 = await insertConfirmation(client, {
      submissionId: first.submissionId,
      documentId: first.documentId,
      promptId,
      identityId,
      eventId,
      contextRevision: 1,
    });
    const d2 = await insertDelivery(client, first.submissionId, c2);

    const { rows } = await client.query<{ id: string; action_key: string }>(
      "SELECT id, action_key FROM deliveries ORDER BY created_at, id",
    );
    expect(rows).toEqual([
      { id: d1, action_key: `delivery:${first.confirmationId}` },
      { id: d2, action_key: `delivery:${c2}` },
    ]);
  });

  it("action_key no se puede escribir", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const { submissionId, confirmationId } = await confirmedSubmission(client, world, identityId);
    await expectDatabaseError(
      client.query(
        "INSERT INTO deliveries (submission_id, confirmation_id, action_key) VALUES ($1, $2, 'otra')",
        [submissionId, confirmationId],
      ),
      { code: "428C9" },
    );
  });

  it("la confirmación pertenece al mismo trámite", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const { confirmationId } = await confirmedSubmission(client, world, identityId);
    const otherSubmission = await insertSubmission(client, world, {
      employeeId: world.employeeB,
    });
    await expectDatabaseError(insertDelivery(client, otherSubmission, confirmationId), {
      code: "23503",
      constraint: "deliveries_confirmation_fk",
    });
  });

  it("CANCELLED solo desde PENDING y sin vuelta atrás", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const { submissionId, confirmationId } = await confirmedSubmission(client, world, identityId);
    const deliveryId = await insertDelivery(client, submissionId, confirmationId);

    await client.query("UPDATE deliveries SET status = 'CANCELLED' WHERE id = $1", [deliveryId]);
    await expectDatabaseError(
      client.query("UPDATE deliveries SET status = 'PENDING' WHERE id = $1", [deliveryId]),
      { code: "23000", constraint: "deliveries_cancelled_terminal" },
    );
  });

  it("una entrega que ya empezó a procesarse no se cancela", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const { submissionId, confirmationId } = await confirmedSubmission(client, world, identityId);
    const deliveryId = await insertDelivery(client, submissionId, confirmationId);
    await client.query("UPDATE deliveries SET status = 'PROCESSING' WHERE id = $1", [deliveryId]);
    await expectDatabaseError(
      client.query("UPDATE deliveries SET status = 'CANCELLED' WHERE id = $1", [deliveryId]),
      { code: "23000", constraint: "deliveries_cancel_only_pending" },
    );
  });

  it("BLOCKED exige un motivo de ADR-012", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const { submissionId, confirmationId } = await confirmedSubmission(client, world, identityId);
    const deliveryId = await insertDelivery(client, submissionId, confirmationId);
    await expectDatabaseError(
      client.query("UPDATE deliveries SET status = 'BLOCKED' WHERE id = $1", [deliveryId]),
      { code: "23514", constraint: "deliveries_blocked_reason" },
    );
    await expectDatabaseError(
      client.query(
        "UPDATE deliveries SET status = 'BLOCKED', block_reason = 'SIN_MOTIVO' WHERE id = $1",
        [deliveryId],
      ),
      { code: "23514", constraint: "deliveries_block_reason_check" },
    );
    await client.query(
      "UPDATE deliveries SET status = 'BLOCKED', block_reason = 'RECIPIENTS_MISSING' WHERE id = $1",
      [deliveryId],
    );
  });

  it("las entregas no se borran ni se reasignan", async () => {
    const { client, world } = await freshWorld();
    const identityId = await insertIdentity(client, { employeeId: world.employeeA });
    const { submissionId, confirmationId } = await confirmedSubmission(client, world, identityId);
    const deliveryId = await insertDelivery(client, submissionId, confirmationId);
    await expectDatabaseError(client.query("DELETE FROM deliveries WHERE id = $1", [deliveryId]), {
      code: "23000",
      constraint: "deliveries_no_delete",
    });
    const otherSubmission = await insertSubmission(client, world, {
      employeeId: world.employeeB,
    });
    await expectDatabaseError(
      client.query("UPDATE deliveries SET submission_id = $1 WHERE id = $2", [
        otherSubmission,
        deliveryId,
      ]),
      { code: "23000", constraint: "deliveries_fixed_columns" },
    );
  });
});
