import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupDatabases,
  connect,
  expectDatabaseError,
  started,
  waitUntilBlocked,
} from "./support/database.js";
import { freshWorld, insertIdentity, insertSubmission } from "./support/fixtures.js";

afterAll(cleanupDatabases);

// Invariantes 2, 3, 4 y 14 del plan: trámite activo único por empleado y número (ADR-011),
// generación única (ADR-014 §12), datos fijados del trámite (ADR-004, ADR-012) y correcciones.

describe("un trámite activo por empleado y número", () => {
  it("rechaza un segundo trámite activo aunque llegue por otra identidad", async () => {
    const { client, world } = await freshWorld();
    const phone = await insertIdentity(client, { employeeId: world.employeeA });
    const bsuid = await insertIdentity(client, {
      employeeId: world.employeeA,
      kind: "WHATSAPP_BSUID",
    });
    const conversations = await client.query<{ id: string }>(
      `INSERT INTO conversations (channel_id, channel_identity_id, employee_id)
       VALUES ($1, $2, $4), ($1, $3, $4) RETURNING id`,
      [world.channelId, phone, bsuid, world.employeeA],
    );
    const [byPhone, byBsuid] = conversations.rows.map((row) => row.id);

    await client.query(
      `INSERT INTO submissions (employee_id, channel_id, generation, conversation_id,
         flow_version_id, catalog_version_id) VALUES ($1, $2, 1, $3, $4, $5)`,
      [world.employeeA, world.channelId, byPhone, world.flowVersionId, world.catalogVersionId],
    );
    await expectDatabaseError(
      client.query(
        `INSERT INTO submissions (employee_id, channel_id, generation, conversation_id,
           flow_version_id, catalog_version_id) VALUES ($1, $2, 2, $3, $4, $5)`,
        [world.employeeA, world.channelId, byBsuid, world.flowVersionId, world.catalogVersionId],
      ),
      { code: "23505", constraint: "submissions_one_active" },
    );
  });

  it("permite uno nuevo cuando el anterior terminó, y otro en un número distinto", async () => {
    const { client, world } = await freshWorld();
    await insertSubmission(client, world, { generation: 1, status: "COMPLETED" });
    await insertSubmission(client, world, { generation: 2 });
    await insertSubmission(client, world, { channelId: world.otherChannelId, generation: 1 });
  });

  it("con dos creaciones concurrentes, confirma exactamente una (T29)", async () => {
    const { client, world, target } = await freshWorld();
    const first = await connect(target, "test-tramite-a");
    const second = await connect(target, "test-tramite-b");

    await first.query("BEGIN");
    await insertSubmission(first, world, { generation: 1 });
    await second.query("BEGIN");
    const competing = started(insertSubmission(second, world, { generation: 2 }));
    await waitUntilBlocked(client, "test-tramite-b");
    await first.query("COMMIT");

    await expectDatabaseError(competing, { code: "23505", constraint: "submissions_one_active" });
    await second.query("ROLLBACK");
    const { rows } = await client.query<{ generation: number }>(
      "SELECT generation FROM submissions",
    );
    expect(rows).toEqual([{ generation: 1 }]);
  });
});

describe("generación", () => {
  it("es única por empleado y número", async () => {
    const { client, world } = await freshWorld();
    await insertSubmission(client, world, { generation: 1, status: "CANCELLED" });
    await expectDatabaseError(insertSubmission(client, world, { generation: 1 }), {
      code: "23505",
      constraint: "submissions_generation_unique",
    });
  });

  it("empieza en 1", async () => {
    const { client, world } = await freshWorld();
    await expectDatabaseError(insertSubmission(client, world, { generation: 0 }), {
      code: "23514",
      constraint: "submissions_generation_check",
    });
  });
});

describe("datos fijados del trámite", () => {
  it("empleado, número, generación y versiones no cambian", async () => {
    const { client, world } = await freshWorld();
    const id = await insertSubmission(client, world);
    for (const assignment of [
      ["employee_id", world.employeeB],
      ["channel_id", world.otherChannelId],
      ["generation", 2],
    ] as const) {
      await expectDatabaseError(
        client.query(`UPDATE submissions SET ${assignment[0]} = $1 WHERE id = $2`, [
          assignment[1],
          id,
        ]),
        { code: "23000", constraint: "submissions_fixed_columns" },
      );
    }
    const other = await client.query<{ id: string }>(
      "INSERT INTO flow_versions (flow_id, version, definition, content_hash, published_by) VALUES ($1, 2, '{}', $2, 'admin@example.com') RETURNING id",
      [world.flowId, "b".repeat(64)],
    );
    await expectDatabaseError(
      client.query("UPDATE submissions SET flow_version_id = $1 WHERE id = $2", [
        other.rows[0]?.id,
        id,
      ]),
      { code: "23000", constraint: "submissions_fixed_columns" },
    );
  });

  it("la clasificación aplicada se asigna una vez y no cambia (T32, parte de base)", async () => {
    const { client, world } = await freshWorld();
    const id = await insertSubmission(client, world);
    await client.query("UPDATE submissions SET applied_classification = 'GENERAL' WHERE id = $1", [
      id,
    ]);
    await expectDatabaseError(
      client.query("UPDATE submissions SET applied_classification = 'SENSITIVE_HR' WHERE id = $1", [
        id,
      ]),
      { code: "23000", constraint: "submissions_applied_classification_once" },
    );
    await expectDatabaseError(
      client.query("UPDATE submissions SET applied_classification = NULL WHERE id = $1", [id]),
      { code: "23000", constraint: "submissions_applied_classification_once" },
    );
  });

  it("el cupo de candidatos no se devuelve y no supera 3", async () => {
    const { client, world } = await freshWorld();
    const id = await insertSubmission(client, world, { candidateCount: 2 });
    await expectDatabaseError(
      client.query("UPDATE submissions SET candidate_count = 1 WHERE id = $1", [id]),
      { code: "23000", constraint: "submissions_candidate_count_monotonic" },
    );
    await expectDatabaseError(
      client.query("UPDATE submissions SET candidate_count = 4 WHERE id = $1", [id]),
      { code: "23514", constraint: "submissions_candidate_count_range" },
    );
  });

  it("no hay trámites sin empleado", async () => {
    const { client, world } = await freshWorld();
    await expectDatabaseError(
      client.query(
        "INSERT INTO submissions (channel_id, generation, flow_version_id, catalog_version_id) VALUES ($1, 1, $2, $3)",
        [world.channelId, world.flowVersionId, world.catalogVersionId],
      ),
      { code: "23502" },
    );
  });
});

describe("correcciones (T43, parte de base)", () => {
  it("se vinculan a un original COMPLETED del mismo empleado y número", async () => {
    const { client, world } = await freshWorld();
    const original = await insertSubmission(client, world, { generation: 1, status: "COMPLETED" });
    await insertSubmission(client, world, {
      generation: 2,
      kind: "CORRECTION",
      correctsSubmissionId: original,
    });
    const { rows } = await client.query<{ status: string }>(
      "SELECT status FROM submissions WHERE id = $1",
      [original],
    );
    expect(rows).toEqual([{ status: "COMPLETED" }]);
  });

  it("rechaza una corrección sin original, sobre un original no completado o de otro empleado", async () => {
    const { client, world } = await freshWorld();
    await expectDatabaseError(insertSubmission(client, world, { kind: "CORRECTION" }), {
      code: "23514",
      constraint: "submissions_correction_link",
    });

    const inProgress = await insertSubmission(client, world, { generation: 1 });
    await expectDatabaseError(
      insertSubmission(client, world, {
        generation: 2,
        kind: "CORRECTION",
        correctsSubmissionId: inProgress,
      }),
      { code: "23000", constraint: "submissions_correction_requires_completed" },
    );

    const ofOtherEmployee = await insertSubmission(client, world, {
      employeeId: world.employeeB,
      generation: 1,
      status: "COMPLETED",
    });
    await expectDatabaseError(
      insertSubmission(client, world, {
        generation: 3,
        status: "COMPLETED",
        kind: "CORRECTION",
        correctsSubmissionId: ofOtherEmployee,
      }),
      { code: "23503", constraint: "submissions_correction_fk" },
    );
  });
});

describe("sin borrado físico de lo referenciado", () => {
  it("rechaza borrar empleados y números con trámites", async () => {
    const { client, world } = await freshWorld();
    await insertSubmission(client, world);
    await expectDatabaseError(
      client.query("DELETE FROM employees WHERE id = $1", [world.employeeA]),
      { code: "23000", constraint: "employees_no_delete" },
    );
    await expectDatabaseError(
      client.query("DELETE FROM channels WHERE id = $1", [world.channelId]),
      {
        code: "23503",
      },
    );
  });
});
