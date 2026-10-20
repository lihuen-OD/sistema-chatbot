import { afterAll, describe, expect, it } from "vitest";
import { cleanupDatabases, expectDatabaseError } from "./support/database.js";
import { freshWorld, insertSubmission, type World } from "./support/fixtures.js";

afterAll(cleanupDatabases);

// Invariantes 10 y 11 del plan: evento externo único y vinculación escrita una vez (ADR-014 §12);
// estructura mínima de la outbox (§5.5). La tabla jobs queda para P2.

async function insertEvent(
  client: import("pg").Client,
  world: World,
  key: string,
  channelId = world.channelId,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO message_events (channel_id, external_event_key, event_type) VALUES ($1, $2, 'TEXT_RECEIVED') RETURNING id",
    [channelId, key],
  );
  return rows[0]?.id ?? "";
}

describe("eventos entrantes", () => {
  it("un evento por canal y clave externa (T04, parte de base)", async () => {
    const { client, world } = await freshWorld();
    await insertEvent(client, world, "wamid.repetido");
    await expectDatabaseError(insertEvent(client, world, "wamid.repetido"), {
      code: "23505",
      constraint: "message_events_external_key_unique",
    });
    await insertEvent(client, world, "wamid.repetido", world.otherChannelId);
  });

  it("la vinculación se escribe una sola vez (T51, parte de base)", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const eventId = await insertEvent(client, world, "wamid.1");
    await client.query(
      `UPDATE message_events SET bound_submission_id = $1, bound_generation = 1,
         bound_context_revision = 0, binding_outcome = 'APPLIED', bound_at = now() WHERE id = $2`,
      [submissionId, eventId],
    );
    await expectDatabaseError(
      client.query("UPDATE message_events SET binding_outcome = 'STALE' WHERE id = $1", [eventId]),
      { code: "23000", constraint: "message_events_binding_write_once" },
    );
    await expectDatabaseError(
      client.query("UPDATE message_events SET bound_context_revision = 1 WHERE id = $1", [eventId]),
      { code: "23000", constraint: "message_events_binding_write_once" },
    );
  });

  it("un evento sin trámite (NOT_BOUND) tampoco se revincula", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const eventId = await insertEvent(client, world, "wamid.1");
    await client.query(
      "UPDATE message_events SET binding_outcome = 'NOT_BOUND', bound_at = now() WHERE id = $1",
      [eventId],
    );
    await expectDatabaseError(
      client.query(
        `UPDATE message_events SET bound_submission_id = $1, bound_generation = 1,
           bound_context_revision = 0, binding_outcome = 'APPLIED' WHERE id = $2`,
        [submissionId, eventId],
      ),
      { code: "23000", constraint: "message_events_binding_write_once" },
    );
  });

  it("los campos de la vinculación son coherentes con el resultado", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const eventId = await insertEvent(client, world, "wamid.1");
    await expectDatabaseError(
      client.query(
        "UPDATE message_events SET binding_outcome = 'APPLIED', bound_at = now() WHERE id = $1",
        [eventId],
      ),
      { code: "23514", constraint: "message_events_binding_coherent" },
    );
    await expectDatabaseError(
      client.query(
        `UPDATE message_events SET bound_submission_id = $1, bound_generation = 1,
           bound_context_revision = 0, binding_outcome = 'NOT_BOUND', bound_at = now()
         WHERE id = $2`,
        [submissionId, eventId],
      ),
      { code: "23514", constraint: "message_events_binding_coherent" },
    );
    await expectDatabaseError(
      client.query("UPDATE message_events SET bound_submission_id = $1 WHERE id = $2", [
        submissionId,
        eventId,
      ]),
      { code: "23514", constraint: "message_events_binding_coherent" },
    );
  });

  it("la generación registrada es la del trámite vinculado", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world, { generation: 1 });
    const eventId = await insertEvent(client, world, "wamid.1");
    await expectDatabaseError(
      client.query(
        `UPDATE message_events SET bound_submission_id = $1, bound_generation = 2,
           bound_context_revision = 0, binding_outcome = 'APPLIED', bound_at = now() WHERE id = $2`,
        [submissionId, eventId],
      ),
      { code: "23503", constraint: "message_events_bound_generation_fk" },
    );
  });

  it("el contenido del evento no cambia", async () => {
    const { client, world } = await freshWorld();
    const eventId = await insertEvent(client, world, "wamid.1");
    await expectDatabaseError(
      client.query(`UPDATE message_events SET payload = '{"otro": true}' WHERE id = $1`, [eventId]),
      { code: "23000", constraint: "message_events_fixed_columns" },
    );
  });

  it("inbox_seq lo asigna la base en orden de llegada", async () => {
    const { client, world } = await freshWorld();
    await insertEvent(client, world, "wamid.1");
    await insertEvent(client, world, "wamid.2");
    const { rows } = await client.query<{ key: string; seq: string }>(
      "SELECT external_event_key AS key, inbox_seq AS seq FROM message_events ORDER BY inbox_seq",
    );
    expect(rows.map((row) => row.key)).toEqual(["wamid.1", "wamid.2"]);
    await expectDatabaseError(
      client.query(
        "INSERT INTO message_events (channel_id, external_event_key, event_type, inbox_seq) VALUES ($1, 'wamid.3', 'TEXT_RECEIVED', 1)",
        [world.channelId],
      ),
      { code: "428C9" },
    );
  });
});

describe("outbox: estructura mínima acordada (§5.5)", () => {
  async function insertAction(
    client: import("pg").Client,
    values: { key: string; submissionId?: string | null; generation?: number | null },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO outbox_actions (logical_key, action_type, submission_id, generation) VALUES ($1, 'SEND_PROMPT', $2, $3) RETURNING id",
      [values.key, values.submissionId ?? null, values.generation ?? null],
    );
    return rows[0]?.id ?? "";
  }

  it("una acción por clave lógica", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    await insertAction(client, { key: "prompt:1", submissionId, generation: 1 });
    await expectDatabaseError(
      insertAction(client, { key: "prompt:1", submissionId, generation: 1 }),
      { code: "23505", constraint: "outbox_actions_logical_key_unique" },
    );
  });

  it("trámite y generación se fijan al crear y coinciden con el trámite (T51, parte de base)", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world, { generation: 1 });
    await expectDatabaseError(
      insertAction(client, { key: "prompt:1", submissionId, generation: 2 }),
      { code: "23503", constraint: "outbox_actions_submission_fk" },
    );
    await expectDatabaseError(insertAction(client, { key: "prompt:2", submissionId }), {
      code: "23514",
      constraint: "outbox_actions_submission_generation",
    });
    const actionId = await insertAction(client, { key: "prompt:3", submissionId, generation: 1 });
    const other = await insertSubmission(client, world, { employeeId: world.employeeB });
    await expectDatabaseError(
      client.query("UPDATE outbox_actions SET submission_id = $1 WHERE id = $2", [other, actionId]),
      { code: "23000", constraint: "outbox_actions_fixed_columns" },
    );
  });

  it("admite acciones sin trámite, como el aviso a un remitente no identificado", async () => {
    const { client } = await freshWorld();
    await insertAction(client, { key: "enrolamiento:1" });
  });

  it("una acción cancelada no vuelve a otro estado (T49, parte de base)", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    const actionId = await insertAction(client, { key: "prompt:1", submissionId, generation: 1 });
    await client.query("UPDATE outbox_actions SET status = 'CANCELLED' WHERE id = $1", [actionId]);
    await expectDatabaseError(
      client.query("UPDATE outbox_actions SET status = 'CLAIMED' WHERE id = $1", [actionId]),
      { code: "23000", constraint: "outbox_actions_cancelled_terminal" },
    );
  });

  it("la tabla jobs no existe: su forma depende de la cola que se elija en P2", async () => {
    const { client } = await freshWorld();
    const { rows } = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('jobs') IS NOT NULL AS exists",
    );
    expect(rows).toEqual([{ exists: false }]);
  });
});
