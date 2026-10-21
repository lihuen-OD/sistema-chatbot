-- P1-T3 · 0003: conversaciones, trámites, eventos entrantes, candidatos, prompts y confirmaciones.
-- Fuentes: docs/04_MODELO_DATOS.md, ADR-004, ADR-011, ADR-012 y ADR-014 (§2, §12).

-- Hilo del canal por número empresarial e identidad (ADR-011).
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE RESTRICT,
  channel_identity_id uuid NOT NULL REFERENCES channel_identities (id) ON DELETE RESTRICT,
  employee_id uuid REFERENCES employees (id) ON DELETE RESTRICT,
  last_inbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_channel_identity_unique UNIQUE (channel_id, channel_identity_id)
);

-- Trámite. Fija al crearse empleado, número, generación, tipo y versiones (ADR-004, ADR-014 §12).
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE RESTRICT,
  generation integer NOT NULL,
  conversation_id uuid REFERENCES conversations (id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'STANDARD',
  corrects_submission_id uuid,
  flow_version_id uuid NOT NULL REFERENCES flow_versions (id) ON DELETE RESTRICT,
  catalog_version_id uuid NOT NULL REFERENCES document_catalog_versions (id) ON DELETE RESTRICT,
  company_id uuid REFERENCES companies (id) ON DELETE RESTRICT,
  document_type_id text CHECK (document_type_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  applied_classification text,
  current_node_id text CHECK (current_node_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  status text NOT NULL DEFAULT 'IN_PROGRESS',
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  context_revision integer NOT NULL DEFAULT 0 CHECK (context_revision >= 0),
  employee_change_count integer NOT NULL DEFAULT 0 CHECK (employee_change_count >= 0),
  candidate_count integer NOT NULL DEFAULT 0,
  selected_document_id uuid,
  file_request_anchor_provider_ts timestamptz,
  unexpected_input_count integer NOT NULL DEFAULT 0 CHECK (unexpected_input_count >= 0),
  final_state_notified boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_generation_check CHECK (generation >= 1),
  CONSTRAINT submissions_kind_check CHECK (kind IN ('STANDARD', 'CORRECTION')),
  CONSTRAINT submissions_status_check CHECK (status IN (
    'IN_PROGRESS', 'WAITING_ANSWER', 'WAITING_FILE', 'VALIDATING_FILE', 'WAITING_FILE_CHOICE',
    'WAITING_CONFIRMATION', 'DELIVERY_PENDING', 'NEEDS_REVIEW', 'COMPLETED', 'CANCELLED', 'EXPIRED'
  )),
  CONSTRAINT submissions_classification_check
    CHECK (applied_classification IN ('GENERAL', 'SENSITIVE_HR')),
  -- Cupo de candidatos por trámite completo (ADR-014 §2).
  CONSTRAINT submissions_candidate_count_range CHECK (candidate_count BETWEEN 0 AND 3),
  CONSTRAINT submissions_correction_link
    CHECK ((kind = 'CORRECTION') = (corrects_submission_id IS NOT NULL)),
  CONSTRAINT submissions_not_self_correction CHECK (corrects_submission_id <> id),
  -- Generación consecutiva única por empleado y número (ADR-014 §12).
  CONSTRAINT submissions_generation_unique UNIQUE (employee_id, channel_id, generation),
  -- Destinos de claves foráneas compuestas: (trámite, generación) y (trámite, empleado, número).
  CONSTRAINT submissions_id_generation_unique UNIQUE (id, generation),
  CONSTRAINT submissions_id_employee_channel_unique UNIQUE (id, employee_id, channel_id)
);

-- Una corrección pertenece al mismo empleado y número que el original (ADR-014).
ALTER TABLE submissions
  ADD CONSTRAINT submissions_correction_fk
  FOREIGN KEY (corrects_submission_id, employee_id, channel_id)
  REFERENCES submissions (id, employee_id, channel_id) ON DELETE RESTRICT;

-- Un trámite activo por empleado y número, aunque use varias identidades (ADR-011).
CREATE UNIQUE INDEX submissions_one_active
  ON submissions (employee_id, channel_id)
  WHERE status IN (
    'IN_PROGRESS', 'WAITING_ANSWER', 'WAITING_FILE', 'VALIDATING_FILE', 'WAITING_FILE_CHOICE',
    'WAITING_CONFIRMATION', 'DELIVERY_PENDING', 'NEEDS_REVIEW'
  );

CREATE INDEX submissions_company_status ON submissions (company_id, status, created_at, id);

CREATE TRIGGER submissions_fixed_columns
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION sc_reject_column_changes(
    'submissions_fixed_columns',
    'employee_id', 'channel_id', 'generation', 'kind', 'corrects_submission_id', 'conversation_id',
    'flow_version_id', 'catalog_version_id', 'created_at'
  );

-- La clasificación aplicada se escribe una vez (ADR-012) y el cupo no se devuelve (ADR-014 §2).
CREATE FUNCTION sc_submissions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.applied_classification IS NOT NULL
     AND NEW.applied_classification IS DISTINCT FROM OLD.applied_classification THEN
    RAISE EXCEPTION 'La clasificación aplicada del trámite no se puede cambiar.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'submissions_applied_classification_once',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'applied_classification';
  END IF;
  IF NEW.candidate_count < OLD.candidate_count THEN
    RAISE EXCEPTION 'El cupo de candidatos del trámite no se devuelve.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'submissions_candidate_count_monotonic',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'candidate_count';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER submissions_guard
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION sc_submissions_guard();

-- Una corrección solo se crea sobre un original COMPLETED (ADR-014). El original no se modifica.
-- Sin original, rechaza submissions_correction_link; de otro empleado, submissions_correction_fk.
CREATE FUNCTION sc_submissions_correction_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original_status text;
BEGIN
  IF NEW.kind = 'CORRECTION' AND NEW.corrects_submission_id IS NOT NULL THEN
    SELECT status INTO original_status FROM submissions WHERE id = NEW.corrects_submission_id;
    IF original_status IS DISTINCT FROM 'COMPLETED' THEN
      RAISE EXCEPTION 'Una corrección requiere un trámite original completado.'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'submissions_correction_requires_completed',
              TABLE = TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER submissions_correction_guard
  BEFORE INSERT ON submissions
  FOR EACH ROW EXECUTE FUNCTION sc_submissions_correction_guard();

-- Versión de cada conjunto de reglas fijada por el trámite (ADR-004). Solo inserción.
CREATE TABLE submission_rule_set_versions (
  submission_id uuid NOT NULL REFERENCES submissions (id) ON DELETE RESTRICT,
  rule_set_key text NOT NULL,
  rule_set_version_id uuid NOT NULL,
  CONSTRAINT submission_rule_set_versions_pkey PRIMARY KEY (submission_id, rule_set_key),
  CONSTRAINT submission_rule_set_versions_fk FOREIGN KEY (rule_set_version_id, rule_set_key)
    REFERENCES rule_set_versions (id, rule_set_key) ON DELETE RESTRICT
);

CREATE TRIGGER submission_rule_set_versions_insert_only
  BEFORE UPDATE OR DELETE ON submission_rule_set_versions
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('submission_rule_set_versions_insert_only');

-- Evento entrante (inbox). Único por canal y clave externa. La vinculación con un trámite se
-- escribe una sola vez, en la transacción de transición (ADR-014 §12). El estado de
-- procesamiento del inbox depende de la cola y queda para P2.
CREATE TABLE message_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE RESTRICT,
  external_event_key text NOT NULL CHECK (char_length(external_event_key) BETWEEN 1 AND 256),
  inbox_seq bigint GENERATED ALWAYS AS IDENTITY,
  event_type text NOT NULL CHECK (event_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  provider_timestamp timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  serialization_key text CHECK (char_length(serialization_key) BETWEEN 1 AND 256),
  bound_submission_id uuid,
  bound_generation integer,
  bound_context_revision integer CHECK (bound_context_revision >= 0),
  binding_outcome text,
  bound_at timestamptz,
  CONSTRAINT message_events_external_key_unique UNIQUE (channel_id, external_event_key),
  CONSTRAINT message_events_inbox_seq_unique UNIQUE (inbox_seq),
  CONSTRAINT message_events_bound_submission_unique UNIQUE (id, bound_submission_id),
  CONSTRAINT message_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT message_events_payload_size CHECK (octet_length(payload::text) <= 65536),
  CONSTRAINT message_events_binding_outcome_check
    CHECK (binding_outcome IN ('APPLIED', 'STALE', 'REJECTED', 'IGNORED', 'NOT_BOUND')),
  -- Sin vincular: todo nulo. NOT_BOUND: sin trámite. El resto: trámite, generación y revisión.
  CONSTRAINT message_events_binding_coherent CHECK (
    CASE
      WHEN binding_outcome IS NULL THEN
        num_nonnulls(bound_submission_id, bound_generation, bound_context_revision, bound_at) = 0
      WHEN binding_outcome = 'NOT_BOUND' THEN
        num_nonnulls(bound_submission_id, bound_generation, bound_context_revision) = 0
        AND bound_at IS NOT NULL
      ELSE
        num_nulls(bound_submission_id, bound_generation, bound_context_revision, bound_at) = 0
    END
  ),
  -- La generación registrada es la del trámite vinculado.
  CONSTRAINT message_events_bound_generation_fk FOREIGN KEY (bound_submission_id, bound_generation)
    REFERENCES submissions (id, generation) ON DELETE RESTRICT
);

CREATE INDEX message_events_serialization ON message_events (serialization_key, inbox_seq);

CREATE FUNCTION sc_message_events_binding_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.binding_outcome IS NOT NULL AND (
       NEW.binding_outcome IS DISTINCT FROM OLD.binding_outcome
    OR NEW.bound_submission_id IS DISTINCT FROM OLD.bound_submission_id
    OR NEW.bound_generation IS DISTINCT FROM OLD.bound_generation
    OR NEW.bound_context_revision IS DISTINCT FROM OLD.bound_context_revision
    OR NEW.bound_at IS DISTINCT FROM OLD.bound_at
  ) THEN
    RAISE EXCEPTION 'La vinculación del evento se escribe una sola vez.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'message_events_binding_write_once',
            TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER message_events_binding_write_once
  BEFORE UPDATE ON message_events
  FOR EACH ROW EXECUTE FUNCTION sc_message_events_binding_once();

CREATE TRIGGER message_events_fixed_columns
  BEFORE UPDATE ON message_events
  FOR EACH ROW EXECUTE FUNCTION sc_reject_column_changes(
    'message_events_fixed_columns',
    'channel_id', 'external_event_key', 'event_type', 'received_at', 'provider_timestamp', 'payload'
  );

-- Candidatos del paso documental (ADR-014 §2): hasta 3 por trámite completo, con candidate_seq
-- único, reservado antes con el incremento condicional de submissions.candidate_count.
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  submission_id uuid NOT NULL REFERENCES submissions (id) ON DELETE RESTRICT,
  node_id text NOT NULL CHECK (node_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  execution_instance_id text NOT NULL CHECK (char_length(execution_instance_id) BETWEEN 1 AND 128),
  candidate_seq smallint NOT NULL,
  selection text NOT NULL DEFAULT 'PENDING_CHOICE',
  status text NOT NULL DEFAULT 'RECEIVED',
  received_event_id uuid NOT NULL,
  storage_key text CHECK (char_length(storage_key) BETWEEN 1 AND 512),
  sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint CHECK (size_bytes >= 0),
  declared_mime_type text CHECK (char_length(declared_mime_type) BETWEEN 1 AND 255),
  detected_mime_type text CHECK (char_length(detected_mime_type) BETWEEN 1 AND 255),
  object_deleted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_candidate_seq_range CHECK (candidate_seq BETWEEN 1 AND 3),
  CONSTRAINT documents_selection_check
    CHECK (selection IN ('PENDING_CHOICE', 'SELECTED', 'SUPERSEDED', 'DISCARDED')),
  CONSTRAINT documents_status_check CHECK (status IN (
    'RECEIVED', 'QUARANTINED', 'SCANNING', 'APPROVED', 'REJECTED', 'SCAN_INCONCLUSIVE',
    'DOWNLOAD_FAILED', 'DELETED'
  )),
  CONSTRAINT documents_candidate_seq_unique UNIQUE (submission_id, candidate_seq),
  -- Reprocesar el mismo evento no reserva otro lugar.
  CONSTRAINT documents_received_event_unique UNIQUE (submission_id, received_event_id),
  CONSTRAINT documents_submission_unique UNIQUE (id, submission_id),
  -- El evento que trajo el archivo está vinculado al mismo trámite.
  CONSTRAINT documents_received_event_fk FOREIGN KEY (received_event_id, submission_id)
    REFERENCES message_events (id, bound_submission_id) ON DELETE RESTRICT
);

-- Como máximo un candidato SELECTED por paso documental.
CREATE UNIQUE INDEX documents_one_selected_per_step
  ON documents (submission_id, node_id, execution_instance_id)
  WHERE selection = 'SELECTED';

CREATE INDEX documents_submission_selection ON documents (submission_id, selection);

-- candidate_seq debe estar reservado en el trámite. Junto con el CHECK y la unicidad, impide un
-- cuarto candidato aunque falle la serialización de la aplicación.
CREATE FUNCTION sc_documents_candidate_reserved() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reserved integer;
BEGIN
  SELECT candidate_count INTO reserved FROM submissions WHERE id = NEW.submission_id;
  IF reserved IS NULL OR NEW.candidate_seq > reserved THEN
    RAISE EXCEPTION 'El candidato % no tiene un lugar reservado en el trámite.', NEW.candidate_seq
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'documents_candidate_seq_reserved',
            TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_candidate_reserved
  BEFORE INSERT ON documents
  FOR EACH ROW EXECUTE FUNCTION sc_documents_candidate_reserved();

CREATE TRIGGER documents_fixed_columns
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION sc_reject_column_changes(
    'documents_fixed_columns',
    'submission_id', 'node_id', 'execution_instance_id', 'candidate_seq', 'received_event_id',
    'created_at'
  );

-- El documento seleccionado del trámite pertenece al mismo trámite.
ALTER TABLE submissions
  ADD CONSTRAINT submissions_selected_document_fk
  FOREIGN KEY (selected_document_id, id) REFERENCES documents (id, submission_id) ON DELETE RESTRICT;

-- Prompts emitidos por el servidor. Un solo ACTIVE por trámite (docs/04).
CREATE TABLE prompts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  submission_id uuid NOT NULL REFERENCES submissions (id) ON DELETE RESTRICT,
  node_id text NOT NULL CHECK (node_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  execution_instance_id text NOT NULL CHECK (char_length(execution_instance_id) BETWEEN 1 AND 128),
  kind text NOT NULL,
  context_revision integer NOT NULL CHECK (context_revision >= 0),
  document_id uuid,
  outbound_message_id uuid,
  options_snapshot jsonb,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompts_kind_check
    CHECK (kind IN ('QUESTION', 'FILE_REQUEST', 'VALIDATION_NOTICE', 'FILE_CHOICE', 'REVIEW')),
  CONSTRAINT prompts_status_check CHECK (status IN ('ACTIVE', 'ANSWERED', 'SUPERSEDED', 'EXPIRED')),
  CONSTRAINT prompts_review_document CHECK (kind <> 'REVIEW' OR document_id IS NOT NULL),
  CONSTRAINT prompts_options_snapshot_size
    CHECK (options_snapshot IS NULL OR octet_length(options_snapshot::text) <= 65536),
  CONSTRAINT prompts_submission_unique UNIQUE (id, submission_id),
  CONSTRAINT prompts_document_fk FOREIGN KEY (document_id, submission_id)
    REFERENCES documents (id, submission_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX prompts_one_active ON prompts (submission_id) WHERE status = 'ACTIVE';

CREATE TRIGGER prompts_fixed_columns
  BEFORE UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION sc_reject_column_changes(
    'prompts_fixed_columns',
    'submission_id', 'node_id', 'execution_instance_id', 'kind', 'context_revision', 'document_id',
    'options_snapshot', 'created_at'
  );

-- Confirmación del empleado: una por revisión de contexto, solo inserción (ADR-014). Documento,
-- prompt y evento pertenecen al mismo trámite.
CREATE TABLE document_confirmations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  submission_id uuid NOT NULL REFERENCES submissions (id) ON DELETE RESTRICT,
  context_revision integer NOT NULL CHECK (context_revision >= 0),
  document_id uuid NOT NULL,
  document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  prompt_id uuid NOT NULL,
  channel_identity_id uuid NOT NULL REFERENCES channel_identities (id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_confirmations_revision_unique UNIQUE (submission_id, context_revision),
  CONSTRAINT document_confirmations_event_unique UNIQUE (event_id),
  CONSTRAINT document_confirmations_submission_unique UNIQUE (id, submission_id),
  CONSTRAINT document_confirmations_document_fk FOREIGN KEY (document_id, submission_id)
    REFERENCES documents (id, submission_id) ON DELETE RESTRICT,
  CONSTRAINT document_confirmations_prompt_fk FOREIGN KEY (prompt_id, submission_id)
    REFERENCES prompts (id, submission_id) ON DELETE RESTRICT,
  CONSTRAINT document_confirmations_event_fk FOREIGN KEY (event_id, submission_id)
    REFERENCES message_events (id, bound_submission_id) ON DELETE RESTRICT
);

CREATE TRIGGER document_confirmations_insert_only
  BEFORE UPDATE OR DELETE ON document_confirmations
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('document_confirmations_insert_only');

CREATE TRIGGER document_confirmations_no_truncate
  BEFORE TRUNCATE ON document_confirmations
  FOR EACH STATEMENT EXECUTE FUNCTION sc_reject_change('document_confirmations_insert_only');
