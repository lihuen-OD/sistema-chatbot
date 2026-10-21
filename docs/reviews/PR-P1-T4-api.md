# P1-T4 — `apps/api` mínima: configuración, health y sesiones administrativas locales

## Dependencias

Orden de fusión:
1. `p1/t4-plan` (plan);
2. `p1/node-24.22.1` (Node 24.22.1);
3. `p1/flow-schema-enum-limit` (`enumValues = 50`);
4. esta rama.

Diff exclusivo: https://github.com/lihuen-OD/sistema-chatbot/compare/p1/flow-schema-enum-limit...p1/t4-api.

## Destino del PR

- **Mientras `p1/flow-schema-enum-limit` no esté fusionada,** este PR apunta a esa rama, para que el diff muestre solo sus cambios.
- **Después de fusionar `p1/flow-schema-enum-limit`** (y antes, `p1/t4-plan` y `p1/node-24.22.1`, en ese orden), hay que cambiar el destino de este PR a `main`, actualizada con esas fusiones, antes de revisarlo y fusionarlo.

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

## Correcciones de la revisión

1. **Caché de `enum`:** viene de `p1/flow-schema-enum-limit` por merge normal. Los conjuntos se construyen en cada ejecución del validador.
2. **Orden de bloqueos** (`createSession` y `revokeAdminSessions`):
   - **Prueba:** `lock-order.test.ts`. Una transacción retiene la fila del usuario, la desactivación (o el cambio de contraseña) queda primera en la cola, y el login con cookie previa llega después.
   - **Antes de corregir:** las 2 pruebas de cruce fallaron a los 1,1 s. PostgreSQL abortó el login por deadlock y la API respondió 500 en lugar de 401.
   - **Después:**
     - la desactivación y el cambio de contraseña terminan con `{ok: true}`;
     - el login responde 401 y no queda ninguna sesión activa;
     - con la cookie previa de otro usuario que se desactiva, el login de A responde 200 y B queda sin sesiones activas;
     - con la fila del usuario bloqueada más que `lock_timeout`, el login responde 503 con `Retry-After: 1` y sin sesión.
3. **Readiness con el conjunto exacto de migraciones:**
   - esquema exacto: 200;
   - migración faltante: 503 (`MIGRATIONS_PENDING`);
   - migración adicional, es decir, una API más vieja que la base: 503 (`MIGRATIONS_UNEXPECTED`);
   - base caída: 503;
   - `live` sigue en 200 en todos los casos.
   - **Mutación temporal:** con la regla anterior falla solo la prueba de la migración adicional.

## Validación

- `pnpm run check`: código 0 (62, 132, 191 y 58 pruebas).
- `pnpm run check:db`: código 0, con tipos al día, 93 pruebas de `db` y 44 de la API contra PostgreSQL. Las de la API pasaron 3 veces seguidas.
- Prueba de humo con el proceso real contra la base de desarrollo: login, `me`, logout, CSRF, `Origin` y apagado con `SIGTERM`.
- Checkout limpio y CI: en el informe de la entrega.

## Limitaciones

- Solo local: sin producción, MFA, roles ni auditoría (P4); sin TLS ni límites compartidos (P7).
- Sin pruebas en navegadores reales. La cookie `secure` se verificó en las respuestas HTTP.
