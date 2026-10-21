import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupDatabases,
  connect,
  expectDatabaseError,
  started,
  waitUntilBlocked,
} from "./support/database.js";
import {
  addCandidate,
  freshWorld,
  insertBoundEvent,
  insertCandidate,
  insertPrompt,
  insertSubmission,
  reserveCandidateSlot,
  type World,
} from "./support/fixtures.js";

afterAll(cleanupDatabases);

// Invariantes 5, 6 y 13 del plan (ADR-014 §2): hasta 3 candidatos por trámite completo con
// secuencia única y reservada, un seleccionado por paso documental, y un prompt activo.

async function candidateSeqs(client: pg.Client, submissionId: string): Promise<number[]> {
  const { rows } = await client.query<{ candidate_seq: number }>(
    "SELECT candidate_seq FROM documents WHERE submission_id = $1 ORDER BY candidate_seq",
    [submissionId],
  );
  return rows.map((row) => row.candidate_seq);
}

/** El trámite usó sus 3 lugares: no hay otra reserva, ni se repite una secuencia, ni entra un cuarto. */
async function expectQuotaUsedUp(
  client: pg.Client,
  world: World,
  submissionId: string,
): Promise<void> {
  expect(await reserveCandidateSlot(client, submissionId)).toBeUndefined();
  const eventId = await insertBoundEvent(client, world, submissionId);
  for (const seq of [1, 2, 3]) {
    await expectDatabaseError(insertCandidate(client, { submissionId, eventId, seq }), {
      code: "23505",
      constraint: "documents_candidate_seq_unique",
    });
  }
  await expectDatabaseError(insertCandidate(client, { submissionId, eventId, seq: 4 }), {
    code: "23000",
    constraint: "documents_candidate_seq_reserved",
  });
  expect(await candidateSeqs(client, submissionId)).toEqual([1, 2, 3]);
}

describe("cupo y secuencia de candidatos por trámite", () => {
  it("candidatos de distintos nodos y ejecuciones comparten el cupo de 3", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const placements = [
      { nodeId: "documento", executionInstanceId: "ejecucion-1" },
      { nodeId: "documento", executionInstanceId: "ejecucion-2" },
      { nodeId: "otro_documento", executionInstanceId: "ejecucion-1" },
    ];
    const seqs = [];
    for (const placement of placements) {
      seqs.push((await addCandidate(client, world, submissionId, placement)).seq);
    }
    expect(seqs).toEqual([1, 2, 3]);
    expect(await reserveCandidateSlot(client, submissionId)).toBeUndefined();
  });

  it("la base rechaza un cuarto candidato aunque se inserte sin reservar", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    for (let i = 0; i < 3; i++) await addCandidate(client, world, submissionId);
    const eventId = await insertBoundEvent(client, world, submissionId);
    await expectDatabaseError(insertCandidate(client, { submissionId, eventId, seq: 4 }), {
      code: "23000",
      constraint: "documents_candidate_seq_reserved",
    });
  });

  it("candidate_seq debe estar reservado, empezar en 1 y no repetirse", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world, { candidateCount: 1 });
    const eventA = await insertBoundEvent(client, world, submissionId);
    const eventB = await insertBoundEvent(client, world, submissionId);

    await expectDatabaseError(insertCandidate(client, { submissionId, eventId: eventA, seq: 2 }), {
      code: "23000",
      constraint: "documents_candidate_seq_reserved",
    });
    await expectDatabaseError(insertCandidate(client, { submissionId, eventId: eventA, seq: 0 }), {
      code: "23514",
      constraint: "documents_candidate_seq_range",
    });
    await insertCandidate(client, { submissionId, eventId: eventA, seq: 1 });
    await expectDatabaseError(insertCandidate(client, { submissionId, eventId: eventB, seq: 1 }), {
      code: "23505",
      constraint: "documents_candidate_seq_unique",
    });
  });

  it("reprocesar el mismo evento no crea otro candidato", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const { eventId } = await addCandidate(client, world, submissionId);
    await reserveCandidateSlot(client, submissionId);
    await expectDatabaseError(insertCandidate(client, { submissionId, eventId, seq: 2 }), {
      code: "23505",
      constraint: "documents_received_event_unique",
    });
  });

  it("el evento del archivo debe estar vinculado al mismo trámite", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world, { candidateCount: 1 });
    const otherSubmission = await insertSubmission(client, world, {
      employeeId: world.employeeB,
    });
    const foreignEvent = await insertBoundEvent(client, world, otherSubmission);
    await expectDatabaseError(
      insertCandidate(client, { submissionId, eventId: foreignEvent, seq: 1 }),
      { code: "23503", constraint: "documents_received_event_fk" },
    );
  });

  it("rechazar o purgar un candidato no devuelve cupo", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const { documentId } = await addCandidate(client, world, submissionId);
    await client.query(
      "UPDATE documents SET status = 'REJECTED', selection = 'DISCARDED', object_deleted_at = now() WHERE id = $1",
      [documentId],
    );
    await expectDatabaseError(
      client.query("UPDATE submissions SET candidate_count = candidate_count - 1 WHERE id = $1", [
        submissionId,
      ]),
      { code: "23000", constraint: "submissions_candidate_count_monotonic" },
    );
  });

  it("borrar un candidato no libera su candidate_seq ni deja entrar un cuarto", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const first = await addCandidate(client, world, submissionId);
    await expectDatabaseError(
      client.query("DELETE FROM documents WHERE id = $1", [first.documentId]),
      { code: "23000", constraint: "documents_no_delete" },
    );
    // El lugar 1 sigue ocupado y la próxima reserva es la 2.
    const eventId = await insertBoundEvent(client, world, submissionId);
    await expectDatabaseError(insertCandidate(client, { submissionId, eventId, seq: 1 }), {
      code: "23505",
      constraint: "documents_candidate_seq_unique",
    });
    expect((await addCandidate(client, world, submissionId)).seq).toBe(2);
    expect((await addCandidate(client, world, submissionId)).seq).toBe(3);
    await expectDatabaseError(
      client.query("DELETE FROM documents WHERE submission_id = $1", [submissionId]),
      { code: "23000", constraint: "documents_no_delete" },
    );
    await expectQuotaUsedUp(client, world, submissionId);
  });

  it("purgar el archivo conserva el candidato: su secuencia no se reutiliza ni entra un cuarto", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const { documentId } = await addCandidate(client, world, submissionId);
    await addCandidate(client, world, submissionId);
    await addCandidate(client, world, submissionId);

    // La purga del objeto se registra en la fila, que se conserva con su candidate_seq.
    const { rows } = await client.query<{ candidate_seq: number; purged: boolean }>(
      `UPDATE documents SET status = 'DELETED', selection = 'DISCARDED', object_deleted_at = now()
       WHERE id = $1 RETURNING candidate_seq, object_deleted_at IS NOT NULL AS purged`,
      [documentId],
    );
    expect(rows).toEqual([{ candidate_seq: 1, purged: true }]);
    await expectDatabaseError(client.query("DELETE FROM documents WHERE id = $1", [documentId]), {
      code: "23000",
      constraint: "documents_no_delete",
    });
    await expectQuotaUsedUp(client, world, submissionId);
  });

  it("TRUNCATE no vacía los candidatos", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    for (let i = 0; i < 3; i++) await addCandidate(client, world, submissionId);
    // Sin CASCADE lo impiden las claves foráneas que apuntan a documents. Con CASCADE, el trigger de
    // documents corre antes que los de las tablas que alcanza la cascada.
    await expectDatabaseError(client.query("TRUNCATE documents CASCADE"), {
      code: "23000",
      constraint: "documents_no_delete",
    });
    await expectQuotaUsedUp(client, world, submissionId);
  });

  it("con candidate_count = 2, dos reservas concurrentes producen un solo candidate_seq = 3 (T48)", async () => {
    const { client, world, target } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    await addCandidate(client, world, submissionId);
    await addCandidate(client, world, submissionId);
    const first = await connect(target, "test-cupo-a");
    const second = await connect(target, "test-cupo-b");

    await first.query("BEGIN");
    const firstSeq = await reserveCandidateSlot(first, submissionId);
    await second.query("BEGIN");
    const secondReservation = started(reserveCandidateSlot(second, submissionId));
    await waitUntilBlocked(client, "test-cupo-b");
    expect(firstSeq).toBe(3);
    const eventId = await insertBoundEvent(first, world, submissionId);
    await insertCandidate(first, { submissionId, eventId, seq: 3 });
    await first.query("COMMIT");

    // El UPDATE condicional se reevalúa con la fila ya confirmada: sin lugar, sin candidato.
    expect(await secondReservation).toBeUndefined();
    await second.query("ROLLBACK");
    const { rows } = await client.query<{ candidate_seq: number }>(
      "SELECT candidate_seq FROM documents WHERE submission_id = $1 ORDER BY candidate_seq",
      [submissionId],
    );
    expect(rows.map((row) => row.candidate_seq)).toEqual([1, 2, 3]);
  });

  it("los datos fijados del candidato no cambian", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const { documentId } = await addCandidate(client, world, submissionId);
    await expectDatabaseError(
      client.query("UPDATE documents SET node_id = 'otro_nodo' WHERE id = $1", [documentId]),
      { code: "23000", constraint: "documents_fixed_columns" },
    );
  });
});

describe("selección", () => {
  it("como máximo un candidato SELECTED por paso documental", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    await addCandidate(client, world, submissionId, { selection: "SELECTED" });
    const secondSlot = await reserveCandidateSlot(client, submissionId);
    const eventId = await insertBoundEvent(client, world, submissionId);
    await expectDatabaseError(
      insertCandidate(client, {
        submissionId,
        eventId,
        seq: secondSlot ?? 0,
        selection: "SELECTED",
      }),
      { code: "23505", constraint: "documents_one_selected_per_step" },
    );
    await addCandidate(client, world, submissionId, {
      selection: "SELECTED",
      executionInstanceId: "ejecucion-2",
    });
  });

  it("el documento seleccionado del trámite pertenece al mismo trámite", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const otherSubmission = await insertSubmission(client, world, {
      employeeId: world.employeeB,
    });
    const own = await addCandidate(client, world, submissionId);
    const foreign = await addCandidate(client, world, otherSubmission);
    await client.query("UPDATE submissions SET selected_document_id = $1 WHERE id = $2", [
      own.documentId,
      submissionId,
    ]);
    await expectDatabaseError(
      client.query("UPDATE submissions SET selected_document_id = $1 WHERE id = $2", [
        foreign.documentId,
        submissionId,
      ]),
      { code: "23503", constraint: "submissions_selected_document_fk" },
    );
  });
});

describe("prompts", () => {
  it("un solo prompt ACTIVE por trámite (T46, parte de base)", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    await insertPrompt(client, submissionId, { kind: "FILE_REQUEST" });
    await expectDatabaseError(insertPrompt(client, submissionId, { kind: "FILE_REQUEST" }), {
      code: "23505",
      constraint: "prompts_one_active",
    });
    await insertPrompt(client, submissionId, { kind: "FILE_REQUEST", status: "SUPERSEDED" });
  });

  it("una revisión referencia un documento del mismo trámite", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    await expectDatabaseError(insertPrompt(client, submissionId, { kind: "REVIEW" }), {
      code: "23514",
      constraint: "prompts_review_document",
    });
    const otherSubmission = await insertSubmission(client, world, {
      employeeId: world.employeeB,
    });
    const foreign = await addCandidate(client, world, otherSubmission);
    await expectDatabaseError(
      insertPrompt(client, submissionId, { kind: "REVIEW", documentId: foreign.documentId }),
      { code: "23503", constraint: "prompts_document_fk" },
    );
  });
});
