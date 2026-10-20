import { afterAll, describe, expect, it } from "vitest";
import { cleanupDatabases, expectDatabaseError } from "./support/database.js";
import { freshWorld, HASH_B, insertSubmission } from "./support/fixtures.js";

afterAll(cleanupDatabases);

// Invariante 12 del plan (ADR-004): versiones publicadas inmutables y fijadas por el trámite.

describe("versiones publicadas (T03, parte de base)", () => {
  it("las versiones de flujo, reglas y catálogo no se modifican ni se borran", async () => {
    const { client, world } = await freshWorld();
    const cases = [
      ["flow_versions", world.flowVersionId, "flow_versions_immutable"],
      ["rule_set_versions", world.ruleSetVersionId, "rule_set_versions_immutable"],
      ["document_catalog_versions", world.catalogVersionId, "document_catalog_versions_immutable"],
    ] as const;
    for (const [table, id, constraint] of cases) {
      await expectDatabaseError(
        client.query(`UPDATE ${table} SET published_by = 'otro@example.com' WHERE id = $1`, [id]),
        { code: "23000", constraint },
      );
      await expectDatabaseError(client.query(`DELETE FROM ${table} WHERE id = $1`, [id]), {
        code: "23000",
        constraint,
      });
    }
    await expectDatabaseError(client.query("TRUNCATE rule_set_versions CASCADE"), {
      code: "23000",
    });
  });

  it("una versión por número y documento", async () => {
    const { client, world } = await freshWorld();
    await expectDatabaseError(
      client.query(
        "INSERT INTO flow_versions (flow_id, version, definition, content_hash, published_by) VALUES ($1, 1, '{}', $2, 'admin@example.com')",
        [world.flowId, HASH_B],
      ),
      { code: "23505", constraint: "flow_versions_version_unique" },
    );
  });

  it("la versión activa de un flujo pertenece a ese flujo", async () => {
    const { client, world } = await freshWorld();
    await client.query("UPDATE flows SET active_version_id = $1 WHERE id = $2", [
      world.flowVersionId,
      world.flowId,
    ]);
    const other = await client.query<{ id: string }>(
      "INSERT INTO flows (flow_key, name) VALUES ('otro_flujo', 'Otro') RETURNING id",
    );
    await expectDatabaseError(
      client.query("UPDATE flows SET active_version_id = $1 WHERE id = $2", [
        world.flowVersionId,
        other.rows[0]?.id,
      ]),
      { code: "23503", constraint: "flows_active_version_fk" },
    );
  });

  it("el trámite fija una versión por conjunto de reglas, solo inserción", async () => {
    const { client, world } = await freshWorld();
    const submissionId = await insertSubmission(client, world);
    await client.query(
      "INSERT INTO submission_rule_set_versions (submission_id, rule_set_key, rule_set_version_id) VALUES ($1, 'routing_demo', $2)",
      [submissionId, world.ruleSetVersionId],
    );
    const second = await client.query<{ id: string }>(
      "INSERT INTO rule_set_versions (rule_set_key, version, definition, coverage_report, coverage_hash, content_hash, published_by) VALUES ('routing_demo', 2, '{}', '{}', $1, $1, 'admin@example.com') RETURNING id",
      [HASH_B],
    );
    await expectDatabaseError(
      client.query(
        "INSERT INTO submission_rule_set_versions (submission_id, rule_set_key, rule_set_version_id) VALUES ($1, 'routing_demo', $2)",
        [submissionId, second.rows[0]?.id],
      ),
      { code: "23505", constraint: "submission_rule_set_versions_pkey" },
    );
    await expectDatabaseError(
      client.query(
        "UPDATE submission_rule_set_versions SET rule_set_version_id = $1 WHERE submission_id = $2",
        [second.rows[0]?.id, submissionId],
      ),
      { code: "23000", constraint: "submission_rule_set_versions_insert_only" },
    );
    await expectDatabaseError(
      client.query(
        "INSERT INTO submission_rule_set_versions (submission_id, rule_set_key, rule_set_version_id) VALUES ($1, 'otra_clave', $2)",
        [submissionId, world.ruleSetVersionId],
      ),
      { code: "23503", constraint: "submission_rule_set_versions_fk" },
    );
  });

  it("los borradores son objetos JSON acotados", async () => {
    const { client, world } = await freshWorld();
    await client.query(
      "INSERT INTO flow_drafts (flow_id, definition, updated_by) VALUES ($1, '{\"name\": \"En edición\"}', 'admin@example.com')",
      [world.flowId],
    );
    await expectDatabaseError(
      client.query("UPDATE flow_drafts SET definition = '[1, 2]' WHERE flow_id = $1", [
        world.flowId,
      ]),
      { code: "23514", constraint: "flow_drafts_definition_object" },
    );
    const { rows } = await client.query<{ revision: number }>(
      "SELECT revision FROM flow_drafts WHERE flow_id = $1",
      [world.flowId],
    );
    expect(rows).toEqual([{ revision: 0 }]);
  });
});
