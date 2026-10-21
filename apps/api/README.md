# @sistema-chatbot/api

API HTTP mínima de P1-T4: configuración validada, health y sesiones administrativas locales. Decisiones en ADR-015; plan en `docs/plans/P1-T4-api-minima.md`; contratos en `docs/05_CONTRATOS_API.md` (sección "API implementada").

No incluye panel, roles, MFA, auditoría ni recursos administrativos (P3 y P4). En P1 solo escucha en loopback y **no arranca en producción**.

## Uso local

Requisitos: el contenedor del proyecto en marcha (`pnpm db:up`), la base de desarrollo migrada (`pnpm db:migrate`) y el `.env` de la raíz (ver `.env.example`).

```sh
pnpm api:admin create --email admin@example.com   # pide la contraseña sin eco
pnpm api:dev                                      # 127.0.0.1:4000
```

| Comando (raíz) | Qué hace |
|---|---|
| `pnpm api:dev` | Compila la API y sus dependencias, y la arranca. `SIGTERM` o `SIGINT` la apagan en orden |
| `pnpm api:admin <comando> --email <email>` | Usuarios locales: `create`, `set-password`, `disable`, `revoke-sessions` y `unlock`. La contraseña se pide por la terminal sin eco (o por la entrada estándar si no es una terminal), nunca como argumento. Rechaza `APP_ENV=production` |
| `pnpm run check` | Incluye las pruebas de la API sin base |
| `pnpm run test:db:api` | Pruebas de la API contra PostgreSQL. `pnpm run check:db` las incluye |

Los usuarios no se borran (trigger): se desactivan. `unlock` limpia solo el límite persistente por email; los límites en memoria vencen solos o al reiniciar la API.

## Configuración

| Clave | Regla | Por defecto |
|---|---|---|
| `APP_ENV` | `development`, `test`, `staging` o `production`. `production` no se admite en P1 | — |
| `API_HOST` | `127.0.0.1` o `::1` | `127.0.0.1` |
| `API_PORT` | 1024 a 65535 | `4000` |
| `ADMIN_ORIGIN` | Solo un origen. HTTP únicamente en `development` o `test` con host de loopback | — |
| `DATABASE_URL` | Guardas de `packages/db`: solo el contenedor local | — |
| `CHANNEL_MODE`, `EMAIL_MODE`, `STORAGE_MODE`, `SCANNER_MODE` | En P1 solo existen los simulados, y en producción se rechazan uno por uno | — |
| `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS` | 5 a 30 y 1 a 8 | 30 y 8 |

Los errores de configuración se informan juntos, por clave y código, nunca con el valor.

## Rutas

- `GET /health/live`: el proceso responde.
- `GET /health/ready`: base accesible, exactamente las migraciones esperadas (una faltante o una adicional dan 503) y sin apagado en curso.
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`: devuelve el token CSRF de la sesión. Sirve para recuperarlo después de recargar, sin otro login.
- `POST /api/v1/auth/logout`: exige `X-CSRF-Token`.

Toda mutación exige `Origin` igual a `ADMIN_ORIGIN`. No hay CORS.

## Seguridad

Resumen de ADR-015:
- **Cookie:** `__Host-sc_session` con `Secure`. En desarrollo local por HTTP, `sc_dev_session` sin `Secure`, porque Safari no envía cookies `Secure` a `http://localhost`. En los dos casos `HttpOnly` y `SameSite=Strict`.
- **Sesión:** la base guarda el SHA-256 del token. Vence a los 30 minutos sin actividad o a las 8 horas en total, y la revocación surte efecto en la petición siguiente.
- **Contraseñas:** Argon2id de `node:crypto` (64 MiB, t=3, p=4), con 2 cálculos a la vez y cola de 8.
- **Login:** las ráfagas sobre la misma clave reciben 429 y la saturación de Argon2 recibe 503. No revela si una cuenta existe.
- **Bloqueo provocado:** los límites lo mitigan, con las limitaciones de ADR-015.
- **Concurrencia:** desactivar o cambiar la contraseña revoca en la base. Un login concurrente no deja una sesión válida.
- **Orden de bloqueos:** toda transacción toma primero las filas de usuarios y después las de sesiones. La creación de la sesión espera bloqueos hasta 5 s y, si no los obtiene, responde 503.

## Pruebas

- **`test/unit`** (sin base): configuración, Argon2 (vector de RFC 9106), admisión (compuerta y límites), tokens, argumentos de la CLI y HTTP con una base que falla.
- **`test/db`** (PostgreSQL del contenedor, bases temporales clonadas de una plantilla migrada):
  - login y enumeración;
  - sesiones (CSRF entre recargas y pestañas, vencimientos, rotación y revocación);
  - ráfagas de admisión;
  - concurrencia con desactivación y cambio de contraseña;
  - health y apagado;
  - usuarios locales y el proceso de la CLI.
