-- P1-T4 · 0006: usuarios administrativos locales, sesiones y límite de intentos de login por email.
-- Fuentes: ADR-015, docs/04_MODELO_DATOS.md (AdminUser, Session) y docs/07_SEGURIDAD.md.
--
-- Invariantes de la base:
-- - un usuario no se borra; desactivarlo o cambiarle la contraseña revoca sus sesiones activas en la
--   misma transacción;
-- - cada sesión se crea con la versión de credenciales vigente de un usuario activo. El trigger de
--   inserción bloquea la fila del usuario (FOR SHARE), así que un login concurrente con una
--   desactivación o un cambio de contraseña no deja una sesión que eluda la revocación;
-- - una sesión revocada no se modifica ni se reactiva.

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email_normalized text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  -- La administra el trigger: sube con cada cambio de contraseña o de estado.
  credential_version integer NOT NULL DEFAULT 1,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_email_unique UNIQUE (email_normalized),
  CONSTRAINT admin_users_email_format CHECK (
    char_length(email_normalized) BETWEEN 3 AND 254
    AND email_normalized ~ '^[^@\s]+@[^@\s]+$'
    AND email_normalized !~ '[A-Z]'
  ),
  -- Cadena PHC de Argon2id; los parámetros pueden cambiar sin migración.
  CONSTRAINT admin_users_password_hash_format CHECK (
    password_hash ~ '^\$argon2id\$v=19\$m=[0-9]{1,10},t=[0-9]{1,10},p=[0-9]{1,3}\$[A-Za-z0-9+/]{11,}\$[A-Za-z0-9+/]{16,}$'
  ),
  CONSTRAINT admin_users_status_check CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT admin_users_disabled_coherent CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL)),
  CONSTRAINT admin_users_credential_version_check CHECK (credential_version >= 1)
);

CREATE TRIGGER admin_users_no_delete
  BEFORE DELETE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('admin_users_no_delete');

CREATE TRIGGER admin_users_no_truncate
  BEFORE TRUNCATE ON admin_users
  FOR EACH STATEMENT EXECUTE FUNCTION sc_reject_change('admin_users_no_delete');

CREATE TRIGGER admin_users_fixed_columns
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION sc_reject_column_changes(
    'admin_users_fixed_columns',
    'id', 'email_normalized', 'created_at'
  );

-- Un cambio de contraseña (password_changed_at) o de estado sube la versión de credenciales. Una
-- actualización del hash sin cambio de contraseña (nuevos parámetros de Argon2) no la cambia.
CREATE FUNCTION sc_admin_users_credentials() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.credential_version IS DISTINCT FROM OLD.credential_version THEN
    RAISE EXCEPTION 'La versión de credenciales la administra la base.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'admin_users_credential_version_managed',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'credential_version';
  END IF;
  IF NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.credential_version := OLD.credential_version + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_users_credentials
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION sc_admin_users_credentials();

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
  -- SHA-256 del token: el token solo viaja en la cookie.
  token_hash bytea NOT NULL,
  credential_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  CONSTRAINT admin_sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT admin_sessions_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT admin_sessions_expiry_order CHECK (
    created_at < absolute_expires_at
    AND last_seen_at >= created_at
    AND idle_expires_at <= absolute_expires_at
  ),
  CONSTRAINT admin_sessions_revocation_coherent CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT admin_sessions_revoke_reason_check CHECK (revoke_reason IN (
    'LOGOUT', 'LOGIN_REPLACED', 'PASSWORD_CHANGED', 'USER_DISABLED', 'ADMIN_REVOKED'
  ))
);

CREATE INDEX admin_sessions_user_active ON admin_sessions (user_id) WHERE revoked_at IS NULL;

-- La sesión nace activa, de un usuario activo y con su versión de credenciales vigente. FOR SHARE
-- espera a una desactivación o un cambio de contraseña en curso y, si se confirma antes, ve la
-- versión nueva y rechaza la inserción.
CREATE FUNCTION sc_admin_sessions_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  user_status text;
  user_version integer;
BEGIN
  IF NEW.revoked_at IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Una sesión se crea activa.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'admin_sessions_insert_active',
            TABLE = TG_TABLE_NAME;
  END IF;
  SELECT status, credential_version INTO user_status, user_version
    FROM admin_users WHERE id = NEW.user_id FOR SHARE;
  IF user_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'El usuario no está activo.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'admin_sessions_user_active',
            TABLE = TG_TABLE_NAME;
  END IF;
  IF NEW.credential_version IS DISTINCT FROM user_version THEN
    RAISE EXCEPTION 'Las credenciales cambiaron después de verificarse.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'admin_sessions_credentials_current',
            TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_sessions_insert_guard
  BEFORE INSERT ON admin_sessions
  FOR EACH ROW EXECUTE FUNCTION sc_admin_sessions_insert_guard();

CREATE TRIGGER admin_sessions_fixed_columns
  BEFORE UPDATE ON admin_sessions
  FOR EACH ROW EXECUTE FUNCTION sc_reject_column_changes(
    'admin_sessions_fixed_columns',
    'id', 'user_id', 'token_hash', 'credential_version', 'created_at', 'absolute_expires_at'
  );

-- Una sesión revocada queda como está: no se reactiva ni cambia su motivo.
CREATE FUNCTION sc_admin_sessions_revoked_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Una sesión revocada no se modifica.'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'admin_sessions_revoked_final',
            TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_sessions_revoked_final
  BEFORE UPDATE ON admin_sessions
  FOR EACH ROW EXECUTE FUNCTION sc_admin_sessions_revoked_final();

-- Desactivar o cambiar la contraseña revoca las sesiones activas en la misma transacción.
CREATE FUNCTION sc_admin_users_revoke_sessions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reason text;
BEGIN
  IF NEW.status = 'DISABLED' AND OLD.status IS DISTINCT FROM 'DISABLED' THEN
    reason := 'USER_DISABLED';
  ELSIF NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at THEN
    reason := 'PASSWORD_CHANGED';
  ELSE
    RETURN NULL;
  END IF;
  UPDATE admin_sessions SET revoked_at = now(), revoke_reason = reason
    WHERE user_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;

CREATE TRIGGER admin_users_revoke_sessions
  AFTER UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION sc_admin_users_revoke_sessions();

-- Límite de fallos de login por email, persistente y compartido entre procesos. La clave es el
-- SHA-256 del email normalizado: se cuenta exista o no la cuenta, y no se guarda el email ni la red.
CREATE TABLE admin_login_throttle (
  key_hash bytea PRIMARY KEY,
  failures integer NOT NULL,
  window_started_at timestamptz NOT NULL,
  CONSTRAINT admin_login_throttle_key_length CHECK (octet_length(key_hash) = 32),
  CONSTRAINT admin_login_throttle_failures_check CHECK (failures >= 0)
);
