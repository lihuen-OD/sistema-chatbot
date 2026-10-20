-- P1-T3 · 0002: flujos, borradores y versiones publicadas de flujos, reglas y catálogo.
-- Fuentes: docs/04_MODELO_DATOS.md, ADR-004 (versiones inmutables), ADR-012 (catálogo y reglas).
--
-- Las versiones publicadas son solo inserción: triggers rechazan UPDATE, DELETE y TRUNCATE.
-- Los documentos JSON se validan con flow-schema antes de publicar; acá se acota su tamaño.
-- Límite inicial de 4 MiB: una definición en los límites de FLOW_LIMITS ocupa 2,3 MB como texto.

CREATE TABLE flows (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  flow_key text NOT NULL CHECK (flow_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flows_key_unique UNIQUE (flow_key)
);

-- Un borrador por flujo en V1, con revisión optimista. Puede estar incompleto.
CREATE TABLE flow_drafts (
  flow_id uuid PRIMARY KEY REFERENCES flows (id) ON DELETE RESTRICT,
  definition jsonb NOT NULL,
  layout jsonb,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flow_drafts_definition_object CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT flow_drafts_layout_object CHECK (layout IS NULL OR jsonb_typeof(layout) = 'object'),
  CONSTRAINT flow_drafts_size CHECK (
    octet_length(definition::text) <= 4194304
    AND (layout IS NULL OR octet_length(layout::text) <= 4194304)
  )
);

CREATE TABLE flow_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  flow_id uuid NOT NULL REFERENCES flows (id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  definition jsonb NOT NULL,
  content_hash text NOT NULL,
  published_by text NOT NULL CHECK (char_length(published_by) BETWEEN 1 AND 200),
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flow_versions_version_unique UNIQUE (flow_id, version),
  CONSTRAINT flow_versions_flow_unique UNIQUE (id, flow_id),
  CONSTRAINT flow_versions_content_hash CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT flow_versions_definition_object CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT flow_versions_size CHECK (octet_length(definition::text) <= 4194304)
);

-- La versión activa pertenece al mismo flujo.
ALTER TABLE flows
  ADD CONSTRAINT flows_active_version_fk
  FOREIGN KEY (active_version_id, id) REFERENCES flow_versions (id, flow_id) ON DELETE RESTRICT;

CREATE TRIGGER flow_versions_immutable
  BEFORE UPDATE OR DELETE ON flow_versions
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('flow_versions_immutable');

CREATE TRIGGER flow_versions_no_truncate
  BEFORE TRUNCATE ON flow_versions
  FOR EACH STATEMENT EXECUTE FUNCTION sc_reject_change('flow_versions_immutable');

-- Versión publicada de un conjunto de reglas (ADR-012): documento validado por flow-schema e
-- informe de cobertura acotado (1 MiB; RULE_LIMITS admite hasta 1.000 combinaciones).
CREATE TABLE rule_set_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  rule_set_key text NOT NULL CHECK (rule_set_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  version integer NOT NULL CHECK (version >= 1),
  definition jsonb NOT NULL,
  coverage_report jsonb NOT NULL,
  coverage_hash text NOT NULL,
  content_hash text NOT NULL,
  published_by text NOT NULL CHECK (char_length(published_by) BETWEEN 1 AND 200),
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_set_versions_version_unique UNIQUE (rule_set_key, version),
  CONSTRAINT rule_set_versions_key_unique UNIQUE (id, rule_set_key),
  CONSTRAINT rule_set_versions_hashes CHECK (
    content_hash ~ '^[0-9a-f]{64}$' AND coverage_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT rule_set_versions_objects CHECK (
    jsonb_typeof(definition) = 'object' AND jsonb_typeof(coverage_report) = 'object'
  ),
  CONSTRAINT rule_set_versions_size CHECK (
    octet_length(definition::text) <= 4194304 AND octet_length(coverage_report::text) <= 1048576
  )
);

CREATE TRIGGER rule_set_versions_immutable
  BEFORE UPDATE OR DELETE ON rule_set_versions
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('rule_set_versions_immutable');

CREATE TRIGGER rule_set_versions_no_truncate
  BEFORE TRUNCATE ON rule_set_versions
  FOR EACH STATEMENT EXECUTE FUNCTION sc_reject_change('rule_set_versions_immutable');

-- Versión publicada del catálogo documental: tipos documentales y su clasificación (ADR-012).
CREATE TABLE document_catalog_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  catalog_key text NOT NULL CHECK (catalog_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  version integer NOT NULL CHECK (version >= 1),
  content jsonb NOT NULL,
  content_hash text NOT NULL,
  published_by text NOT NULL CHECK (char_length(published_by) BETWEEN 1 AND 200),
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_catalog_versions_version_unique UNIQUE (catalog_key, version),
  CONSTRAINT document_catalog_versions_content_hash CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_catalog_versions_content_object CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT document_catalog_versions_size CHECK (octet_length(content::text) <= 4194304)
);

CREATE TRIGGER document_catalog_versions_immutable
  BEFORE UPDATE OR DELETE ON document_catalog_versions
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('document_catalog_versions_immutable');

CREATE TRIGGER document_catalog_versions_no_truncate
  BEFORE TRUNCATE ON document_catalog_versions
  FOR EACH STATEMENT EXECUTE FUNCTION sc_reject_change('document_catalog_versions_immutable');
