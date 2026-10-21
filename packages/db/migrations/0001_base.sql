-- P1-T3 · 0001: funciones de integridad, organización, empresas, empleados, números empresariales
-- e identidades de canal.
-- Fuentes: docs/04_MODELO_DATOS.md, ADR-008 (organización única), ADR-011 (identidades).
--
-- Convenciones: claves uuid con uuidv7(), timestamptz, snake_case, códigos como text + CHECK.
-- Los triggers rechazan con SQLSTATE 23000 (integrity_constraint_violation) y el nombre de la
-- restricción en el campo CONSTRAINT del error, para que el host (P2) los traduzca.

-- Rechaza la operación (UPDATE, DELETE o TRUNCATE). TG_ARGV[0]: nombre de la restricción.
CREATE FUNCTION sc_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation',
          CONSTRAINT = TG_ARGV[0],
          TABLE = TG_TABLE_NAME;
END;
$$;

-- Rechaza cambios en las columnas listadas desde TG_ARGV[1]. TG_ARGV[0]: nombre de la restricción.
CREATE FUNCTION sc_reject_column_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  col text;
BEGIN
  FOR arg_index IN 1 .. TG_NARGS - 1 LOOP
    col := TG_ARGV[arg_index];
    IF NOT old_row ? col THEN
      RAISE EXCEPTION 'El trigger % lista la columna inexistente %.%.', TG_NAME, TG_TABLE_NAME, col;
    END IF;
    IF old_row -> col IS DISTINCT FROM new_row -> col THEN
      RAISE EXCEPTION 'La columna %.% no se puede modificar.', TG_TABLE_NAME, col
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = TG_ARGV[0],
              TABLE = TG_TABLE_NAME,
              COLUMN = col;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_code_unique UNIQUE (organization_id, code)
);

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  employee_number text NOT NULL CHECK (char_length(employee_number) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT employees_number_unique UNIQUE (organization_id, employee_number)
);

-- Los empleados no se borran físicamente: se desactivan (docs/04).
CREATE TRIGGER employees_no_delete
  BEFORE DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('employees_no_delete');

CREATE TABLE employee_company_scopes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  CONSTRAINT employee_company_scopes_period CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX employee_company_scopes_employee ON employee_company_scopes (employee_id, company_id);

-- Número empresarial de WhatsApp. Los identificadores externos conservan su cuenta (docs/04).
CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_account_id text NOT NULL CHECK (char_length(provider_account_id) BETWEEN 1 AND 128),
  provider_channel_id text NOT NULL CHECK (char_length(provider_channel_id) BETWEEN 1 AND 128),
  display_phone_e164 text CHECK (display_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channels_provider_check CHECK (provider = 'WHATSAPP'),
  CONSTRAINT channels_provider_unique UNIQUE (provider, provider_account_id, provider_channel_id)
);

-- Identidades de canal (ADR-011). Un empleado puede tener varias. La identidad canónica es
-- (provider, kind, scope_type, scope_id, normalized_value): como máximo una fila ACTIVE por
-- identidad canónica, así que no puede estar activa en empleados distintos. Las cinco columnas
-- son NOT NULL porque un índice único trata los NULL como distintos. Los CHECK coinciden con
-- packages/contracts y examples/directorio_demo.json; el formato real del BSUID se verifica en P6.
CREATE TABLE channel_identities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  provider text NOT NULL,
  kind text NOT NULL,
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  normalized_value text NOT NULL,
  status text NOT NULL,
  link_method text NOT NULL,
  verified_at timestamptz,
  revoked_at timestamptz,
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_identities_provider_check CHECK (provider = 'WHATSAPP'),
  CONSTRAINT channel_identities_status_check
    CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'REVOKED')),
  CONSTRAINT channel_identities_link_method_check
    CHECK (link_method IN ('DIRECTORY_ENROLLMENT', 'PROVIDER_ASSERTED', 'ADMIN_APPROVED')),
  CONSTRAINT channel_identities_kind_scope CHECK (
    (kind = 'PHONE_E164'
      AND scope_type = 'E164'
      AND scope_id = 'global'
      AND normalized_value ~ '^\+[1-9][0-9]{6,14}$')
    OR (kind = 'WHATSAPP_BSUID'
      AND scope_type = 'BUSINESS'
      AND scope_id ~ '^[a-z][a-z0-9_]{0,63}$'
      AND char_length(normalized_value) BETWEEN 1 AND 128)
  ),
  CONSTRAINT channel_identities_active_verified CHECK (status <> 'ACTIVE' OR verified_at IS NOT NULL),
  CONSTRAINT channel_identities_revoked_at CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX channel_identities_active_unique
  ON channel_identities (provider, kind, scope_type, scope_id, normalized_value)
  WHERE status = 'ACTIVE';

CREATE INDEX channel_identities_employee ON channel_identities (employee_id);

-- Una identidad no se reasigna a otro empleado ni cambia de valor: se revoca y se crea otra.
CREATE TRIGGER channel_identities_fixed_columns
  BEFORE UPDATE ON channel_identities
  FOR EACH ROW EXECUTE FUNCTION sc_reject_column_changes(
    'channel_identities_fixed_columns',
    'employee_id', 'provider', 'kind', 'scope_type', 'scope_id', 'normalized_value', 'created_at'
  );

CREATE TRIGGER channel_identities_no_delete
  BEFORE DELETE ON channel_identities
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('channel_identities_no_delete');
