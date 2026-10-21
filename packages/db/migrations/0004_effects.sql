-- P1-T3 · 0004: entregas y estructura mínima de la outbox.
-- Fuentes: docs/04_MODELO_DATOS.md, ADR-002, ADR-012 y ADR-014.
--
-- La tabla `jobs` no se crea en P1-T3: su forma depende de la cola que se elija al iniciar P2
-- (ADR-002). Desviación registrada en el plan de P1-T3 (§5.5) y en docs/15 §9.

-- Entrega: una por confirmación. action_key se deriva de confirmation_id, así que una entrega
-- nueva después de cancelar otra tiene identidad propia (ADR-014, T49).
CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  submission_id uuid NOT NULL REFERENCES submissions (id) ON DELETE RESTRICT,
  confirmation_id uuid NOT NULL,
  action_key text GENERATED ALWAYS AS ('delivery:' || confirmation_id::text) STORED NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  block_reason text,
  applied_classification text,
  recipients_snapshot jsonb,
  content_snapshot jsonb,
  rule_snapshot jsonb,
  provider_message_id text CHECK (char_length(provider_message_id) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deliveries_status_check CHECK (status IN (
    'PENDING', 'PROCESSING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'BOUNCED', 'FAILED', 'UNCERTAIN',
    'BLOCKED', 'CANCELLED'
  )),
  CONSTRAINT deliveries_block_reason_check CHECK (block_reason IN (
    'RULE_NOT_MATCHED', 'RULES_AMBIGUOUS', 'RECIPIENTS_MISSING', 'RECIPIENT_NOT_AUTHORIZED',
    'RECIPIENT_BLOCKED', 'RECIPIENTS_LIMIT_EXCEEDED', 'EMPLOYEE_SCOPE_REVOKED'
  )),
  CONSTRAINT deliveries_blocked_reason CHECK (status <> 'BLOCKED' OR block_reason IS NOT NULL),
  CONSTRAINT deliveries_classification_check
    CHECK (applied_classification IN ('GENERAL', 'SENSITIVE_HR')),
  CONSTRAINT deliveries_snapshot_size CHECK (
    coalesce(octet_length(recipients_snapshot::text), 0) <= 65536
    AND coalesce(octet_length(rule_snapshot::text), 0) <= 65536
    AND coalesce(octet_length(content_snapshot::text), 0) <= 262144
  ),
  CONSTRAINT deliveries_confirmation_unique UNIQUE (confirmation_id),
  CONSTRAINT deliveries_action_key_unique UNIQUE (action_key),
  CONSTRAINT deliveries_submission_unique UNIQUE (id, submission_id),
  CONSTRAINT deliveries_confirmation_fk FOREIGN KEY (confirmation_id, submission_id)
    REFERENCES document_confirmations (id, submission_id) ON DELETE RESTRICT
);

CREATE INDEX deliveries_submission_status ON deliveries (submission_id, status);

CREATE TRIGGER deliveries_fixed_columns
  BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION sc_reject_column_changes(
    'deliveries_fixed_columns', 'submission_id', 'confirmation_id', 'created_at'
  );

-- CANCELLED solo desde PENDING, antes del punto de no retorno, y terminal (docs/04, ADR-014).
CREATE FUNCTION sc_deliveries_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Una entrega cancelada no vuelve a otro estado.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'deliveries_cancelled_terminal',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status';
  END IF;
  IF NEW.status = 'CANCELLED' AND OLD.status NOT IN ('PENDING', 'CANCELLED') THEN
    RAISE EXCEPTION 'Solo se cancela una entrega PENDING (estado actual: %).', OLD.status
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'deliveries_cancel_only_pending',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deliveries_status_guard
  BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION sc_deliveries_status_guard();

CREATE TRIGGER deliveries_no_delete
  BEFORE DELETE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('deliveries_no_delete');

CREATE TRIGGER deliveries_no_truncate
  BEFORE TRUNCATE ON deliveries
  FOR EACH STATEMENT EXECUTE FUNCTION sc_reject_change('deliveries_no_delete');

-- Outbox: solo lo decidido sin depender de la cola (plan de P1-T3, §5.5).
-- - Identidad lógica única (ADR-002).
-- - Trámite y generación fijados al crear; nunca se reasignan (ADR-014 §12). Pueden faltar en
--   acciones sin trámite, por ejemplo el mensaje de enrolamiento a un remitente no identificado.
-- - CANCELLED terminal (T49).
-- El payload, el reclamo, sus datos y los índices de la cola quedan para P2.
CREATE TABLE outbox_actions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  logical_key text NOT NULL CHECK (char_length(logical_key) BETWEEN 1 AND 256),
  action_type text NOT NULL CHECK (action_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  submission_id uuid,
  generation integer,
  delivery_id uuid,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_actions_logical_key_unique UNIQUE (logical_key),
  CONSTRAINT outbox_actions_status_check
    CHECK (status IN ('PENDING', 'CLAIMED', 'DONE', 'CANCELLED')),
  CONSTRAINT outbox_actions_submission_generation
    CHECK ((submission_id IS NULL) = (generation IS NULL)),
  CONSTRAINT outbox_actions_delivery_submission
    CHECK (delivery_id IS NULL OR submission_id IS NOT NULL),
  CONSTRAINT outbox_actions_submission_fk FOREIGN KEY (submission_id, generation)
    REFERENCES submissions (id, generation) ON DELETE RESTRICT,
  CONSTRAINT outbox_actions_delivery_fk FOREIGN KEY (delivery_id, submission_id)
    REFERENCES deliveries (id, submission_id) ON DELETE RESTRICT
);

CREATE TRIGGER outbox_actions_fixed_columns
  BEFORE UPDATE ON outbox_actions
  FOR EACH ROW EXECUTE FUNCTION sc_reject_column_changes(
    'outbox_actions_fixed_columns',
    'logical_key', 'action_type', 'submission_id', 'generation', 'delivery_id', 'created_at'
  );

CREATE FUNCTION sc_outbox_actions_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Una acción cancelada de la outbox no vuelve a otro estado.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'outbox_actions_cancelled_terminal',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_actions_status_guard
  BEFORE UPDATE ON outbox_actions
  FOR EACH ROW EXECUTE FUNCTION sc_outbox_actions_status_guard();
