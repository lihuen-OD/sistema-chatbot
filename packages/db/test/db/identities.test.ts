import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupDatabases,
  connect,
  expectDatabaseError,
  started,
  waitUntilBlocked,
} from "./support/database.js";
import { freshWorld, insertIdentity } from "./support/fixtures.js";

afterAll(cleanupDatabases);

// Invariante 1 del plan (ADR-011): una identidad canónica activa pertenece a un solo empleado; un
// empleado puede tener varias identidades. Parte de base de T29/T30.

describe("identidades de canal", () => {
  it("un empleado puede tener teléfono y BSUID activos a la vez", async () => {
    const { client, world } = await freshWorld();
    await insertIdentity(client, { employeeId: world.employeeA });
    await insertIdentity(client, { employeeId: world.employeeA, kind: "WHATSAPP_BSUID" });
    await insertIdentity(client, { employeeId: world.employeeA, value: "+5491100000099" });
    const { rows } = await client.query<{ total: string }>(
      "SELECT count(*) AS total FROM channel_identities WHERE employee_id = $1 AND status = 'ACTIVE'",
      [world.employeeA],
    );
    expect(Number(rows[0]?.total)).toBe(3);
  });

  it("la misma identidad canónica no puede estar activa en otro empleado", async () => {
    const { client, world } = await freshWorld();
    await insertIdentity(client, { employeeId: world.employeeA });
    await expectDatabaseError(insertIdentity(client, { employeeId: world.employeeB }), {
      code: "23505",
      constraint: "channel_identities_active_unique",
    });
    await insertIdentity(client, { employeeId: world.employeeA, kind: "WHATSAPP_BSUID" });
    await expectDatabaseError(
      insertIdentity(client, { employeeId: world.employeeB, kind: "WHATSAPP_BSUID" }),
      { code: "23505", constraint: "channel_identities_active_unique" },
    );
  });

  it("el mismo valor en otro ámbito es otra identidad", async () => {
    const { client, world } = await freshWorld();
    await insertIdentity(client, { employeeId: world.employeeA, kind: "WHATSAPP_BSUID" });
    await insertIdentity(client, {
      employeeId: world.employeeB,
      kind: "WHATSAPP_BSUID",
      scopeId: "otro_ambito",
    });
  });

  it("una identidad revocada no impide activar el mismo valor en otro empleado", async () => {
    const { client, world } = await freshWorld();
    await insertIdentity(client, { employeeId: world.employeeA, status: "REVOKED" });
    await insertIdentity(client, { employeeId: world.employeeB });
  });

  it("las columnas de la identidad canónica no admiten NULL", async () => {
    const { client, world } = await freshWorld();
    await expectDatabaseError(
      client.query(
        `INSERT INTO channel_identities (employee_id, provider, kind, scope_type, scope_id,
           normalized_value, status, link_method, verified_at, created_by)
         VALUES ($1, 'WHATSAPP', 'WHATSAPP_BSUID', 'BUSINESS', NULL, 'bsuid-1', 'ACTIVE',
           'ADMIN_APPROVED', now(), 'admin@example.com')`,
        [world.employeeA],
      ),
      { code: "23502" },
    );
  });

  it("el tipo fija el ámbito y el formato del valor", async () => {
    const { client, world } = await freshWorld();
    await expectDatabaseError(
      client.query(
        `INSERT INTO channel_identities (employee_id, provider, kind, scope_type, scope_id,
           normalized_value, status, link_method, verified_at, created_by)
         VALUES ($1, 'WHATSAPP', 'PHONE_E164', 'BUSINESS', 'global', '+5491100000001', 'ACTIVE',
           'DIRECTORY_ENROLLMENT', now(), 'admin@example.com')`,
        [world.employeeA],
      ),
      { code: "23514", constraint: "channel_identities_kind_scope" },
    );
    await expectDatabaseError(
      insertIdentity(client, { employeeId: world.employeeA, value: "5491100000001" }),
      { code: "23514", constraint: "channel_identities_kind_scope" },
    );
  });

  it("una identidad no se reasigna a otro empleado ni se borra", async () => {
    const { client, world } = await freshWorld();
    const id = await insertIdentity(client, { employeeId: world.employeeA });
    await expectDatabaseError(
      client.query("UPDATE channel_identities SET employee_id = $1 WHERE id = $2", [
        world.employeeB,
        id,
      ]),
      { code: "23000", constraint: "channel_identities_fixed_columns" },
    );
    await expectDatabaseError(client.query("DELETE FROM channel_identities WHERE id = $1", [id]), {
      code: "23000",
      constraint: "channel_identities_no_delete",
    });
  });

  it("dos activaciones concurrentes de la misma identidad en empleados distintos: solo una confirma", async () => {
    const { client, world, target } = await freshWorld();
    const pendingId = await insertIdentity(client, {
      employeeId: world.employeeA,
      status: "PENDING_VERIFICATION",
    });
    const first = await connect(target, "test-identidad-a");
    const second = await connect(target, "test-identidad-b");

    await first.query("BEGIN");
    await first.query(
      "UPDATE channel_identities SET status = 'ACTIVE', verified_at = now() WHERE id = $1",
      [pendingId],
    );
    await second.query("BEGIN");
    const competing = started(insertIdentity(second, { employeeId: world.employeeB }));
    await waitUntilBlocked(client, "test-identidad-b");
    await first.query("COMMIT");

    await expectDatabaseError(competing, {
      code: "23505",
      constraint: "channel_identities_active_unique",
    });
    await second.query("ROLLBACK");
    const { rows } = await client.query<{ employee_id: string }>(
      "SELECT employee_id FROM channel_identities WHERE status = 'ACTIVE'",
    );
    expect(rows).toEqual([{ employee_id: world.employeeA }]);
  });
});
