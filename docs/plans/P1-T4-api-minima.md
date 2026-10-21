# Plan de P1-T4 — `apps/api` mínima

- Fecha: 21/10/2026
- Estado: **propuesto, pendiente de aprobación del propietario.** Solo planificación: no se implementó nada ni se cambió código.
- Base: `main` en `78ea2c6` (P1-T1 a P1-T3 cerradas).
- Fuentes:
  - `docs/15_PLAN_CONSOLIDADO_P0.md` §9;
  - `docs/02_ARQUITECTURA.md` §9 (acceso administrativo);
  - `docs/04_MODELO_DATOS.md` (`AdminUser`, `Session`, `RoleAssignment`);
  - `docs/05_CONTRATOS_API.md`;
  - `docs/07_SEGURIDAD.md`;
  - `docs/09_PRUEBAS_Y_ACEPTACION.md` (T18, T20);
  - `docs/10_ENTORNOS_Y_OPERACION.md`;
  - ADR-001, ADR-003, ADR-008, ADR-009, ADR-010 y ADR-012.

## 1. Objetivo y salida verificable

Alcance según §9: `apps/api` mínima con configuración validada, health y sesiones administrativas locales.

La salida que fija §9 es "tests de configuración que rechazan modos simulados en producción". Este plan agrega además la evidencia que necesitan las otras dos partes del alcance:
- health que distingue proceso vivo de servicio listo;
- login, sesión, logout y revocación probados contra PostgreSQL real aislado;
- la parte de sesión y CSRF de T20: una sesión revocada y una mutación sin token CSRF se rechazan en el backend.

La parte de T20 sobre roles ("rol editor publica") queda en P4, junto con la matriz de permisos.

P1 no habilita producción, igual que las guardas de `packages/db`. Con `APP_ENV=production`, la API rechaza la configuración y no arranca. Por eso las pruebas de modos simulados comprueban que cada modo simulado produce su propio error en producción, y no solo que producción falla.

## 2. Estado de partida (relevado el 21/10/2026)

| Elemento | Estado | Consecuencia para P1-T4 |
|---|---|---|
| `apps/` | No existe. `pnpm-workspace.yaml` solo incluye `packages/*` | Agregar `apps/*` al workspace, al control de límites y a ESLint |
| `packages/contracts` | Tiene `UNAUTHENTICATED`, `FORBIDDEN`, `RATE_LIMITED`, `REQUEST_INVALID`, `PAYLOAD_TOO_LARGE` y `SERVICE_UNAVAILABLE`. No tiene código para el error interno (500) ni DTO de autenticación | Agregar `INTERNAL_ERROR` (500) y los DTO de login y sesión (§5.9) |
| `packages/db` | Guardas que solo admiten el contenedor local; `createPool`, `runMigrations` y `TemporaryDatabases` exportados | La API reutiliza las guardas: en P1 solo se conecta al contenedor del proyecto |
| ADR de autenticación | No existe, aunque docs/03 lo pedía en P0 | Crear ADR-015 con las decisiones de §5.4 a §5.6 |
| Node | Fijado en 24.21.0. El 20/10/2026 salió 24.22.1, versión de seguridad | Decisión del propietario (§11, punto 2) |
| `.env.example` | `MAX_FILES_PER_SUBMISSION=1`, mientras que ADR-014 fija hasta 3 candidatos por trámite y 1 adjunto por envío | P1-T4 no usa esa clave. Se registra la divergencia y no se cambia en silencio (§11, punto 9) |
| `flow-schema` | Las variables `enum` no tienen máximo de valores | Diagnóstico y propuesta en §8 |

## 3. Dependencias

### 3.1 Entre tareas

- **Requiere**, ya cerradas:
  - P1-T2: errores y DTO de `contracts`;
  - P1-T3: migraciones, guardas, tipos generados y job `db` de la CI.
- **Habilita:**
  - P1-T5: los adaptadores locales usan los mismos valores de modo;
  - P1-T6: CI completa y seed;
  - P3: el panel necesita login;
  - P4: roles, permisos, MFA o SSO y auditoría se apoyan en estas sesiones.
- **Antes de exponer definiciones por HTTP** (P3 y P4), conviene resolver el límite de `enum` (§8). P1-T4 no expone validación de definiciones.

### 3.2 Paquetes (verificados en el registro de npm el 21/10/2026)

Política del repositorio: versiones publicadas hace al menos 7 días, sin scripts de instalación salvo revisión explícita. Se vuelven a verificar al iniciar.

| Componente | Candidata | Publicada | Uso | Notas |
|---|---|---|---|---|
| express | 5.3.0 | 09/10/2026 | Servidor HTTP (ADR-009) | MIT, sin scripts de instalación, Node `>=18`. Incluye `body-parser` 2.3.0 |
| @types/express | 5.0.6 | 01/12/2025 | Tipos (desarrollo) | — |
| cookie | 2.0.1 | 30/06/2026 | Leer la cookie de sesión | MIT, sin dependencias, Node `>=22` |
| helmet | 8.3.0 | 12/07/2026 | Cabeceras de seguridad | MIT, sin dependencias. Alternativa: fijarlas a mano (§11, punto 6) |
| Argon2id | `node:crypto` (`argon2`, desde Node 24.7.0) | — | Hash de contraseñas | Sin dependencia nativa ni scripts de instalación. Presente en la API documentada de 24.21.0 |
| zod, kysely, pg, vitest | Las del lockfile | — | Configuración, base y pruebas | Sin cambios |

No hacen falta servicios nuevos: no se usa Redis ni un proveedor de identidad. Las pruebas HTTP usan `fetch` de Node contra un servidor en un puerto efímero de `127.0.0.1`, sin `supertest`.

## 4. Qué necesita el propietario

1. Aprobar este plan y autorizar P1-T4.
2. Responder las decisiones de §11. Todas tienen una propuesta por defecto.

No hay servicios que contratar ni términos que aceptar. Se descargan paquetes de npm.

## 5. Diseño propuesto

### 5.1 Estructura y límites

```
apps/api/
  src/
    config.ts        esquema de configuración y carga (§5.2)
    app.ts           createApp({ config, db, clock, random }): sin efectos al importar
    main.ts          arranque, señales y apagado (§5.12)
    http/            requestId, errores, límites de cuerpo, cabeceras, 404
    health/          rutas live y ready (§5.3)
    auth/            contraseñas, sesiones, CSRF, límites de intentos y rutas (§5.4 a §5.6)
    cli/admin.ts     alta, cambio de contraseña y desactivación de usuarios locales (§5.10)
  test/unit/         sin base
  test/db/           contra PostgreSQL (job db de la CI)
```

- **Dependencias internas permitidas:** `@sistema-chatbot/contracts` y `@sistema-chatbot/db`. Se agregan a `scripts/check-workspace-boundaries.mjs` y a ESLint. `flow-schema` se agrega recién cuando una ruta lo use (P3/P4).
- **Controllers delgados.** La lógica de sesiones, contraseñas y límites vive en módulos de `src/auth` que no importan Express y se prueban sin HTTP.
  - ADR-001 ubica las políticas de negocio en `domain`. La autenticación administrativa es infraestructura del host, no dominio del trámite, así que queda en la app.
  - Si el worker (P2) necesita la misma configuración, se extrae a un paquete con su addendum de ADR-001.
- **Dependencias inyectadas** en `createApp`: reloj, generador aleatorio y conexión. Así las pruebas controlan vencimientos y no dependen del entorno.

### 5.2 Configuración validada

Esquema zod sobre `process.env`. En `development` y `test` primero se completa con `.env` mediante `loadLocalEnv`, y el entorno conserva la prioridad.

| Clave | Regla | Por defecto |
|---|---|---|
| `APP_ENV` | `development`, `test`, `staging` o `production` | Obligatoria |
| `API_HOST` | En P1, solo loopback (`127.0.0.1` o `::1`) | `127.0.0.1` |
| `API_PORT` | Entero entre 1024 y 65535 | `4000` (como en `.env.example`) |
| `ADMIN_ORIGIN` | URL de origen, sin ruta. `https` fuera de `development` y `test` | Obligatoria |
| `DATABASE_URL` | La validan las guardas de `packages/db` (contenedor local) | Obligatoria |
| `CHANNEL_MODE`, `EMAIL_MODE`, `STORAGE_MODE`, `SCANNER_MODE` | Valores conocidos. Los simulados (`simulator`, `capture`, `local_private`, `fake_development_only`) están prohibidos en `production` | Obligatorias |
| `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS` | Enteros acotados | 30 y 8 (§11, punto 3) |

Reglas:
- **Todos los errores juntos.** La validación reúne todos los problemas y los informa por clave y motivo, **nunca con el valor**, para no filtrar una credencial pegada en la variable equivocada. Si hay errores, el proceso termina con código distinto de cero antes de abrir el puerto o la base.
- **Producción en P1:** `APP_ENV=production` agrega `PRODUCTION_NOT_SUPPORTED`. Además, cada modo simulado agrega su propio `SIMULATED_MODE_IN_PRODUCTION`, con la clave afectada. Los modos reales todavía no existen (P5 y P6), así que no hay valor que los habilite. No se agregan valores reales vacíos que parezcan implementados.
- **Alcance:** solo se leen las claves de esta tabla. Las de WhatsApp, correo y almacenamiento son de P5 y P6 y no se validan acá.
- **Inmutable:** la configuración se congela una vez cargada. Ningún módulo lee `process.env` por su cuenta.

### 5.3 Health

| Ruta | Comprueba | Respuesta |
|---|---|---|
| `GET /health/live` | Solo que el proceso responde, sin dependencias | 200 `{"status":"ok"}` |
| `GET /health/ready` | `SELECT 1` con timeout corto, sin migraciones pendientes respecto de los archivos de `packages/db`, y que no esté apagándose | 200 `{"status":"ready"}` o 503 `SERVICE_UNAVAILABLE` |

- Las rutas quedan fuera de `/api/v1`, porque no son API de clientes.
- No requieren sesión y no informan versiones, nombres de base, motivos ni tiempos. El motivo del 503 va solo al log, con `requestId`.
- El chequeo de migraciones evita que una API más nueva o más vieja opere sobre un esquema distinto (docs/10, expand/contract).
- La marca `cluster_name` se verifica una vez al arrancar, con las guardas.

### 5.4 Sesiones administrativas

**Usuarios** (`admin_users`, §5.8): email normalizado único, hash de contraseña y estado `ACTIVE` o `DISABLED`. No hay registro público: los usuarios se crean con la CLI local (§5.10). Organización única (ADR-008): no hace falta `organization_id`. Los roles y alcances (`RoleAssignment`) son de P4.

**Contraseñas:**
- **Algoritmo:** Argon2id de `node:crypto`, con el segundo conjunto recomendado por RFC 9106: 64 MiB, t=3, p=4, salt de 16 bytes y tag de 32.
  - Medición local (Apple M5, p=1): 63 ms por hash.
  - Se vuelve a medir al implementar y se ajusta si supera unos 500 ms en el equipo de referencia.
- **Formato:** cadena PHC (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`). Si cambian los parámetros, el hash se actualiza en el siguiente login correcto.
- **Concurrencia acotada:** como máximo 4 cálculos a la vez (unos 256 MiB). El resto espera en una cola corta y, si se llena, recibe `RATE_LIMITED`.
- **Política:**
  - de 15 a 128 caracteres y sin reglas de composición. Con un solo factor, NIST SP 800-63B-4 exige al menos 15;
  - el login acepta hasta 128, para que un cambio de política no deje afuera a nadie;
  - no se consulta una lista de contraseñas filtradas, porque requeriría un servicio externo (pendiente para P7).

**Login** (`POST /api/v1/auth/login`, cuerpo `{email, password}`):
1. Origen y tipo de contenido válidos (§5.5), y límites por red y por email (§5.6).
2. Buscar un usuario `ACTIVE` por email normalizado. Si no existe o está desactivado, se verifica igual contra un hash ficticio calculado al arrancar. Así el tiempo no revela si el usuario existe.
3. Si falla: 401 `UNAUTHENTICATED` con un mensaje único, y se registra el intento en el límite.
4. Si es correcto:
   - revocar la sesión que traiga la petición, si hay una (evita la fijación de sesión);
   - crear una sesión nueva;
   - poner la cookie;
   - devolver `{user, permissions: [], csrfToken}`. `permissions` queda vacía hasta P4.

**Sesión:**
- **Token:** 32 bytes de `randomBytes`, en base64url. Solo viaja en la cookie. En la base se guarda su SHA-256: un token de alta entropía no necesita hash lento.
- **Cookie:** `__Host-sc_session` con `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, sin `Domain` y sin `Max-Age`. El vencimiento lo controla el servidor.
  - Excepción: en `development`, con `ADMIN_ORIGIN` en `http://localhost`, la cookie se llama `sc_dev_session` y va sin `Secure`, porque algunos navegadores no la guardan sobre HTTP.
  - Se prueban ambos casos.
- **Vencimiento:** por inactividad (30 min) y absoluto (8 h). `last_seen_at` se actualiza como mucho una vez por minuto.
- **Validación en cada petición:** token, `revoked_at` nulo, ambos vencimientos y usuario `ACTIVE`, todo en una sola consulta.
- **`GET /api/v1/auth/me`:** devuelve `{user, permissions: [], csrfToken}`, para que el panel recupere el token CSRF al recargar.
- **`POST /api/v1/auth/logout`:** exige CSRF, revoca la sesión y borra la cookie. Responde 204.
- **Desactivar un usuario** revoca todas sus sesiones en la misma transacción, mediante un trigger (§5.8). No depende de que el código se acuerde.

**MFA y SSO:** P4 (docs/03), como exige docs/07 para administradores y publicadores en producción. Mientras no existan, la API no arranca en producción (§5.2).

### 5.5 CSRF, origen y CORS

- **Token sincronizador por sesión:** 32 bytes aleatorios. En la base se guarda su hash. El cliente lo envía en la cabecera `X-CSRF-Token` en todo método que no sea `GET`, `HEAD` ni `OPTIONS`, y se compara en tiempo constante.
- **Origen:** las mutaciones exigen `Origin` igual a `ADMIN_ORIGIN`. Si falta, se rechaza.
- **Login:** todavía no hay sesión ni token. Se protege con el control de `Origin` y con `Content-Type: application/json`: un formulario HTML de otro sitio no puede enviarlo sin preflight CORS, y la API no responde preflights.
- **Rechazos:** 403 `FORBIDDEN`, sin detalle.
- **Sin CORS.** El panel llega a la API por el mismo origen: proxy de Vite en desarrollo (P3) y el mismo dominio en producción (P7). Las cookies y las respuestas no quedan disponibles para otros orígenes.

### 5.6 Límites de intentos

- **Por email normalizado,** exista o no el usuario: 5 fallos en 15 minutos bloquean ese email hasta que termina la ventana.
  - Se guarda en PostgreSQL (`admin_login_throttle`, con clave SHA-256 del email), así no se reinicia al reiniciar la API.
  - Como cuenta igual para emails inexistentes, un 429 no revela si la cuenta existe.
  - El bloqueo es temporal, nunca permanente: un atacante no puede dejar afuera a un administrador de forma indefinida.
- **Por dirección de red:** 20 intentos en 15 minutos, en memoria del proceso. Es suficiente con un solo proceso en `127.0.0.1`. Con varias instancias (P7) habrá que compartirlo; queda registrado como riesgo.
- **Respuesta:** 429 `RATE_LIMITED` con `Retry-After`. Un login correcto pone en cero el contador de ese email.
- Los valores se ajustan en §11, punto 3.

### 5.7 HTTP: errores, límites y cabeceras

- **`requestId`** generado por el servidor en cada petición, con el formato de `internalIdSchema`. Va en la cabecera `X-Request-Id` y en todo error. Se ignora el valor que mande el cliente.
- **Errores:**
  - siempre `apiErrorResponseSchema` de `contracts`;
  - ruta inexistente: 404 `NOT_FOUND`;
  - método no admitido: 404 (§11, punto 7);
  - excepción no controlada: 500 `INTERNAL_ERROR`, con mensaje genérico, sin stack ni detalle.
- **Cuerpo:**
  - solo JSON (`express.json` con `strict: true`);
  - **16 KiB** como máximo en las rutas de P1-T4, que superados dan 413 `PAYLOAD_TOO_LARGE`;
  - `inflate: false`: un cuerpo comprimido se rechaza, sin descomprimirlo;
  - JSON mal formado: 400 `REQUEST_INVALID`, sin repetir el contenido recibido;
  - otro `Content-Type`: 400 `REQUEST_INVALID` con motivo `CONTENT_TYPE` (§11, punto 7).
- **Cabeceras:**
  - `helmet`, con `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`;
  - `X-Content-Type-Options: nosniff` y `Referrer-Policy: no-referrer`;
  - `Cache-Control: no-store` en toda respuesta de la API;
  - sin `X-Powered-By`;
  - HSTS solo cuando haya HTTPS (P7).
- **Servidor:** `requestTimeout`, `headersTimeout` y `keepAliveTimeout` explícitos, y `trust proxy` desactivado: en P1 no hay proxy.

### 5.8 Modelo de datos: migración `0006_admin_auth`

Migración nueva; las aplicadas no se tocan.

| Tabla | Columnas principales | Restricciones |
|---|---|---|
| `admin_users` | `id`, `email_normalized`, `password_hash`, `status`, `password_changed_at`, `disabled_at`, `created_at`, `updated_at` | `UNIQUE (email_normalized)`; `CHECK` de longitud y forma del email; `CHECK` del estado y su coherencia con `disabled_at`; sin `DELETE` ni `TRUNCATE` (trigger) |
| `admin_sessions` | `id`, `user_id`, `token_hash`, `csrf_token_hash`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `revoke_reason` | `token_hash` único de 32 bytes; FK `RESTRICT`; `absolute_expires_at > created_at`; columnas fijas; `revoked_at` y su motivo se escriben una sola vez |
| `admin_login_throttle` | `key_hash`, `failures`, `window_started_at`, `blocked_until` | Clave primaria `key_hash`; `failures >= 0` |

Invariantes con trigger:
- **Desactivación:** pasar un usuario a `DISABLED` revoca sus sesiones activas (`revoke_reason = 'USER_DISABLED'`) en la misma transacción.
- **Sesión revocada:** no se reactiva.

Se regeneran los tipos (`db:types`) y la verificación de divergencia los cubre. Las sesiones vencidas se purgan en P7, con la política de retención.

### 5.9 Contratos

En `packages/contracts`:
- **Errores:** `INTERNAL_ERROR` (500), sin `details`.
- **DTO de autenticación:**
  - `loginRequestSchema`: email de hasta 254 caracteres y contraseña de hasta 128;
  - `sessionResponseSchema`: `user.id`, `user.email`, `permissions` (lista vacía en P1) y `csrfToken`.
- **Documentación:** se actualizan `docs/05` y el README de `contracts`.

### 5.10 Usuarios locales: CLI

`pnpm --filter @sistema-chatbot/api run admin -- create|set-password|disable --email …`:
- rechaza `APP_ENV=production` y pasa por las guardas de base;
- lee la contraseña de la terminal sin eco, nunca de un argumento, porque quedaría en el historial;
- desactivar revoca las sesiones, por el trigger de §5.8.

Es una herramienta del operador local, no seed. El seed ficticio es de P1-T6. Para datos de demo se recomiendan direcciones `@example.com` (AGENTS.md).

### 5.11 Logs

- **Formato:** una línea JSON por petición, con `requestId`, método, ruta declarada (no la URL con parámetros), estado y duración. En eventos de autenticación se registra el `userId` del login correcto.
- **Nunca se registran:** cookies, cabeceras `Authorization` o `X-CSRF-Token`, cuerpos, contraseñas, tokens ni el email de un intento fallido.
- **Sin dependencia nueva:** se usa un logger propio y mínimo. La observabilidad completa es de P7.

### 5.12 Apagado ordenado

Con `SIGTERM` o `SIGINT`:
1. `ready` pasa a 503;
2. se dejan de aceptar conexiones;
3. se esperan las peticiones en curso con un plazo, que se mide en las pruebas;
4. se cierra el pool y el proceso termina con 0.

La API no tiene llamadas externas en curso: el drenaje de efectos de ADR-002 es del worker (P2).

### 5.13 Scripts y CI

- **Raíz:**
  - `pnpm api:dev`: compila y arranca contra el contenedor local;
  - `check` incluye las pruebas de la API que no usan base;
  - `check:db` agrega las pruebas de base de la API.
- **CI:** el job `db` ejecuta también las pruebas de base de la API. No cambian las acciones ni sus permisos.
- **`.env.example`:** agrega `API_HOST` y los vencimientos de sesión, sin valores secretos.

## 6. Medidas de seguridad

| Amenaza | Control | Prueba |
|---|---|---|
| Arrancar en producción con efectos simulados | Configuración que rechaza producción en P1 y cada modo simulado | Un error por modo, con su clave |
| Credencial filtrada en logs o errores de configuración | Errores por clave sin valor; logs sin cuerpos ni cabeceras sensibles | Un valor secreto no aparece en la salida |
| API expuesta en la red local sin TLS | `API_HOST` solo loopback en P1 | `0.0.0.0` rechazado |
| Robo o reutilización de sesión | Token aleatorio con hash en la base; cookie `HttpOnly`/`Secure`/`SameSite=Strict`; vencimientos; revocación | Sesión revocada, vencida, de usuario desactivado o con cookie alterada: 401 |
| Fijación de sesión | Sesión nueva en cada login; la anterior se revoca | La cookie previa deja de valer |
| CSRF | Token sincronizador, `Origin` obligatorio, JSON obligatorio y sin CORS | Mutación sin token, con token ajeno o de otro origen: 403 |
| Fuerza bruta | Límite por email (persistente) y por red; Argon2id | 429 con `Retry-After` |
| Enumeración de cuentas | Mismo error, hash ficticio y límite por email exista o no | Respuestas idénticas para inexistente, desactivado y contraseña incorrecta |
| Agotar memoria con Argon2 | Concurrencia acotada | Pedidos que exceden la cola: 429 sin caída |
| Cuerpos abusivos | 16 KiB, sin descompresión y JSON estricto | 413 y 400 sin eco |
| Filtración por errores | Errores de `contracts`, 500 genérico | Sin stack ni detalle interno |
| Contenido interpretado por el navegador | CSP restrictiva, `nosniff`, `no-store` | Cabeceras presentes |
| Base equivocada | Guardas de `packages/db` | Ya probado en P1-T3; la API no las evita |

Fuera de P1-T4, con su etapa: MFA o SSO, permisos y auditoría (P4); TLS, HSTS, límites compartidos entre instancias, rol de base con mínimos privilegios y lista de contraseñas filtradas (P7).

## 7. Pruebas de salida

Cada prueba comprueba aceptación y rechazo. Los conteos se informan al terminar; no se anticipan.

**Sin base** (`pnpm run check`):
- **Configuración:**
  - una de desarrollo válida se acepta;
  - en producción, cada modo simulado da `SIMULATED_MODE_IN_PRODUCTION` con su clave (salida de §9);
  - producción da además `PRODUCTION_NOT_SUPPORTED`;
  - se rechazan `APP_ENV` desconocido, puerto fuera de rango, host no loopback, `ADMIN_ORIGIN` con ruta o con `http` fuera de desarrollo, y claves faltantes;
  - los errores no contienen valores.
- **Contraseñas:**
  - formato PHC;
  - verificación correcta e incorrecta;
  - actualización del hash si cambian los parámetros;
  - política de 15 a 128 caracteres;
  - límite de concurrencia.
- **HTTP**, con dependencias simuladas:
  - 404, 413 y 400 por JSON inválido, comprimido o con otro tipo;
  - 500 sin detalle;
  - errores válidos según `apiErrorResponseSchema`;
  - cabeceras de seguridad;
  - `requestId` en la cabecera y en el error.
- **Límites:** ventana, bloqueo temporal, `Retry-After` y puesta en cero, con reloj inyectado.
- **Límites entre paquetes:** `api` solo depende de `contracts` y `db`.

**Con PostgreSQL** (`pnpm run check:db`, job `db`):
- **Migración `0006`:**
  - email único normalizado;
  - sin borrado de usuarios;
  - revocación escrita una vez;
  - desactivar revoca las sesiones;
  - columnas fijas;
  - `token_hash` único.
- **Login:**
  - el correcto pone la cookie con sus atributos y no devuelve el token en el cuerpo;
  - la base no contiene el token en claro;
  - incorrecto, inexistente y desactivado responden igual.
- **Sesión:**
  - `me` con cookie: 200; sin cookie o alterada: 401;
  - vencimiento por inactividad y absoluto, con reloj inyectado;
  - logout revoca y la cookie deja de valer;
  - la desactivación revoca;
  - un login con una cookie previa la revoca.
- **CSRF (parte de T20):** logout sin token, con token de otra sesión o con otro `Origin`: 403, y la sesión sigue activa.
- **Límite por email:** persiste entre dos instancias de la app y responde 429 también para un email inexistente.
- **Health:**
  - `live` sin base;
  - `ready` 200 con la base migrada;
  - 503 con una base sin la última migración, con la base cerrada y durante el apagado.
- **CLI:** alta, cambio de contraseña y desactivación contra una base temporal. Rechaza producción.

T18 ("simulación intenta correo real") sigue en P3 y P5. P1-T4 aporta solo el rechazo de modos simulados en producción.

## 8. Listas `enum` de `flow-schema`: diagnóstico y propuesta

**Pendiente** (revisión de P1-T2): `flow-schema` limita los valores de `in`/`notIn` (50), pero no la cantidad de valores de una variable `enum`, ni en flujos ni en conjuntos de reglas.

**Diagnóstico** (21/10/2026):
- **Código:** las comprobaciones de dominio usan `values.includes(...)` sobre la lista completa.
  - En `checkEmail` (`flow.ts`), comparar el `enum` del flujo con el del conjunto de reglas es O(n·m).
  - `domainProblem` y `existsInDomain` son O(n) por cada valor comparado.
  - El producto de dominios (más de 1000 combinaciones) se corta antes de enumerar, así que no es el problema.
- **Medición:**
  - Método: `validateFlowDefinition` con el flujo y las reglas de `examples/`, más una variable `area` con N valores declarada en los dos y usada en el nodo de correo. Script temporal fuera del repositorio, sobre el `dist` de `main`. Node 24.21.0, Apple M5.
  - Resultados:

    | N | Tamaño del flujo | Validación |
    |---|---|---|
    | 10.000 | 79 KiB | 58 ms |
    | 20.000 | 167 KiB | 170 ms |
    | 40.000 | 343 KiB | 769 ms |
    | 80.000 | 694 KiB | 3.514 ms |
    | 120.000 | 1.065 KiB | 6.746 ms |

  - El crecimiento es cuadrático, y la validación ocupa el único hilo de JavaScript: mientras dura, la API no atiende a nadie. No lo evitan los límites del borrador de P1-T2 (250.000 valores, 32 niveles) ni el `CHECK` de 4 MiB de la base sobre borradores y definiciones.
- **Riesgo:** con un endpoint que valide definiciones (borradores y simulador en P3; validar y publicar en P4), un usuario autenticado podría bloquear la API con unos pocos pedidos. Hoy no hay exposición: no existe ningún endpoint.

**Propuesta:** una tarea corta y separada, en su propia rama y PR, solo en `flow-schema` y su documentación. No va dentro de P1-T4, que no toca definiciones. Debe estar fusionada antes de que cualquier endpoint reciba definiciones (P3).
1. **Límite.** Nuevo `enumValues = 50` en `FLOW_LIMITS` y en `RULE_LIMITS`, alineado con `valuesPerList`: así cualquier `in` sobre todos los valores sigue siendo expresable.
   - Se comprueba en `checkSizeLimits` de flujos y reglas, antes de las comprobaciones semánticas.
   - Error: `FLOW_LIMIT_EXCEEDED` o `RULE_LIMIT_EXCEEDED` con `details.limit = "enumValues"`, en la ruta `variables.<nombre>.values` o `contextVariables.<nombre>.values`. Sin códigos nuevos.
2. **Complejidad.** Reemplazar las búsquedas lineales por `Set`, como defensa adicional aunque el límite ya acote el costo.
3. **Pruebas:**
   - frontera de 50 aceptada y 51 rechazada, en flujo y reglas;
   - el rechazo ocurre antes del análisis semántico (sin `EMAIL_CONTEXT_MISMATCH`);
   - regresión de rendimiento: la definición de 120.000 valores devuelve el error de límite en menos de 100 ms (hoy tarda 6,7 s);
   - los fixtures de `examples/` siguen válidos: no declaran `enum`.
4. **Documentos:** tablas de límites de ADR-003 y ADR-012 (addendum), README de `flow-schema`, docs/13 y PROJECT_STATUS.

**Alternativas descartadas:**
- **`.max()` en el esquema zod:** daría un error estructural en lugar del código de límite estable que usan los demás límites.
- **Confiar solo en el tamaño del cuerpo HTTP o en el `CHECK` de 4 MiB:** la medición muestra que un flujo de 1 MiB ya alcanza para 6,7 s.

## 9. Fuera de alcance

- MFA, SSO, recuperación de cuenta, roles y matriz de permisos, auditoría (P4).
- Panel y proxy de desarrollo (P3).
- Endpoints de flujos, simulaciones, directorio, contactos, trámites y descargas (P3 y P4).
- Webhooks (P6).
- Adaptadores (P1-T5).
- Seed y CI completa (P1-T6).
- Despliegue, TLS, límites compartidos entre instancias y rol de base de mínimos privilegios (P7).
- OpenAPI: docs/05 la prevé al implementar. Con tres rutas de autenticación y dos de health, se propone generarla en P4, cuando haya recursos administrativos (§11, punto 8).

## 10. Archivos previstos

- **Nuevos:**
  - `apps/api/` (§5.1);
  - `packages/db/migrations/0006_admin_auth.sql` y sus pruebas en `packages/db/test/db/`;
  - `docs/adr/ADR-015-autenticacion-administrativa.md`.
- **Modificados:**
  - `packages/db/src/generated/database.ts`;
  - `packages/contracts` (§5.9);
  - `pnpm-workspace.yaml`, `scripts/check-workspace-boundaries.mjs`, `eslint.config.js`, `package.json` raíz, `.github/workflows/ci.yml` y `.env.example`;
  - documentación: ADR-001 y ADR-009 (addenda), docs/04, 05, 07, 09, 10 y 13, README, PROJECT_STATUS y la §12 de este plan.

## 11. Decisiones del propietario

| # | Decisión | Propuesta por defecto |
|---|---|---|
| 1 | Aprobar el plan y autorizar P1-T4 | — |
| 2 | Node 24.22.1 (seguridad, 20/10/2026): entre otras cosas corrige un CVE de brotli y otro de la caché de números aleatorios de `crypto` | Esperar a que cumpla 7 días (27/10/2026) y actualizar `.node-version`, `engines` y la CI en una tarea corta antes de P1-T4. Alternativa: excepción explícita a la política ahora. La API de P1 escucha solo en loopback y no descomprime cuerpos |
| 3 | Vencimientos y límites | Inactividad 30 min; absoluto 8 h; 5 fallos por email en 15 min; 20 intentos por red en 15 min |
| 4 | Política de contraseñas | 15 a 128 caracteres, sin composición, con Argon2id según RFC 9106 |
| 5 | Límite de `enum` (§8) | 50 valores, en una tarea separada que se fusiona antes de P3 |
| 6 | `helmet` o cabeceras propias | `helmet` 8.3.0: sin dependencias y menos riesgo de omitir una cabecera |
| 7 | Códigos para método no admitido y tipo de contenido | 404 y 400 `REQUEST_INVALID`, sin agregar códigos. Alternativa: 405 y 415 con códigos nuevos en `contracts` |
| 8 | OpenAPI | Generarla en P4 |
| 9 | `MAX_FILES_PER_SUBMISSION=1` en `.env.example` frente a ADR-014 | Registrar la divergencia y resolverla en P2, donde viven las constantes del host. P1-T4 no la lee |

## 12. Riesgos

- **Límite en memoria:** el límite por red se pierde al reiniciar y no se comparte entre procesos. Se acepta en P1 (un proceso, loopback) y se revisa en P7.
- **Argon2 nativo de Node:** depende de mantener Node actualizado (§11, punto 2). A cambio evita un módulo nativo con scripts de instalación.
- **Cookie de desarrollo sin `Secure`:** solo con `APP_ENV=development` y origen `http://localhost`. Las pruebas comprueban que no se usa en otro caso.
- **Usuarios sin MFA:** aceptable solo en local. La API se niega a arrancar en producción hasta P4/P7.
- **Configuración solo en la API:** si el worker la necesita, extraerla tiene costo. Se hace en P2 con su addendum.
- **Este plan no prueba nada:** las medidas de §6 cuentan recién cuando sus pruebas pasen.
