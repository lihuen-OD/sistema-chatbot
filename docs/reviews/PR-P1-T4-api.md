# P1-T4 — `apps/api` mínima: configuración, health y sesiones administrativas locales

## Dependencias

Orden de fusión:
1. `p1/t4-plan` (plan);
2. `p1/node-24.22.1` (Node 24.22.1);
3. `p1/flow-schema-enum-limit` (`enumValues = 50`);
4. esta rama.

Diff exclusivo: https://github.com/lihuen-OD/sistema-chatbot/compare/p1/flow-schema-enum-limit...p1/t4-api.

## Problema resuelto

P1-T4 de `docs/15` §9: la primera API con configuración validada, health y sesiones administrativas locales. Las decisiones están en ADR-015 y el plan aprobado en `docs/plans/P1-T4-api-minima.md`, con la §15 de implementación.

## Cambios

- **`apps/api`:**
  - configuración que rechaza producción y cada modo simulado, sin mostrar valores;
  - `/health/live` y `/health/ready`;
  - `POST /api/v1/auth/login`, `GET /api/v1/auth/me` y `POST /api/v1/auth/logout`;
  - CLI de usuarios locales.
- **Sesiones:**
  - token opaco con hash en la base, y 30 minutos de inactividad u 8 horas en total, comprobados en el servidor;
  - rotación en el login y revocación por logout, cambio de contraseña, desactivación u operador;
  - cookie `__Host-sc_session` con `Secure`, o `sc_dev_session` solo en local por HTTP.
- **CSRF:** derivado de la sesión. Después de recargar, `/auth/me` devuelve el mismo token, sin otro login y sin invalidar otras pestañas. `Origin` obligatorio y sin CORS.
- **Login:**
  - límites por red, par y email que reservan antes del trabajo costoso: 429 si un límite rechaza y 503 si la compuerta está saturada;
  - Argon2id con 2 cálculos a la vez;
  - sin enumeración;
  - el bloqueo provocado está mitigado, con limitaciones documentadas.
- **Base (`0006_admin_auth`):** la desactivación y el cambio de contraseña revocan en la misma transacción, y una sesión solo se inserta con credenciales vigentes (`FOR SHARE`). Así un login concurrente no elude la revocación.
- **`contracts`:** `INTERNAL_ERROR` y los DTO de autenticación.
- **Configuración:** `MAX_FILES_PER_SUBMISSION` reemplazada por `MAX_CANDIDATE_FILES_PER_SUBMISSION=3` y `MAX_CANDIDATE_BYTES_PER_SUBMISSION=31457280` en `.env.example`. La aplicación del cupo es de P2.
- **Documentos:**
  - ADR-015 y addenda de ADR-001, ADR-003, ADR-009 y ADR-014;
  - docs/04, 05, 07, 09, 10, 13 y 15;
  - los README.

## Validación

- `pnpm run check`: código 0 (62, 128, 191 y 58 pruebas).
- `pnpm run check:db`: código 0, con tipos al día, 93 pruebas de `db` y 39 de la API contra PostgreSQL.
- Prueba de humo con el proceso real contra la base de desarrollo: login, `me`, logout, CSRF, `Origin` y apagado con `SIGTERM`.
- Checkout limpio y CI: en el informe de la entrega.

## Limitaciones

- Solo local: sin producción, MFA, roles ni auditoría (P4); sin TLS ni límites compartidos (P7).
- Sin pruebas en navegadores reales. La cookie `secure` se verificó en las respuestas HTTP.
