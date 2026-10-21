# Plan de P1-T4 — `apps/api` mínima

- Fecha: 21/10/2026
- Estado: **aprobado el 21/10/2026 sobre `2567f10`, con precisiones del propietario; implementado en la rama `p1/t4-api` (§15).** El orden autorizado fue: actualización de Node (`p1/node-24.22.1`), límite de `enum` (`p1/flow-schema-enum-limit`) y API mínima, en ramas y PR separados.
- Propuestas iniciales fijadas por el propietario (21/10/2026):
  - sesiones con 30 minutos de inactividad y 8 horas en total;
  - contraseñas de 15 a 128 caracteres.
- Base: `main` en `78ea2c6` (P1-T1 a P1-T3 cerradas).
- Fuentes:
  - `docs/15_PLAN_CONSOLIDADO_P0.md` §9;
  - `docs/02_ARQUITECTURA.md` §9 (acceso administrativo);
  - `docs/04_MODELO_DATOS.md` (`AdminUser`, `Session`, `RoleAssignment`);
  - `docs/05_CONTRATOS_API.md`;
  - `docs/07_SEGURIDAD.md`;
  - `docs/09_PRUEBAS_Y_ACEPTACION.md` (T18, T20);
  - `docs/10_ENTORNOS_Y_OPERACION.md`;
  - ADR-001, ADR-003, ADR-007, ADR-008, ADR-009, ADR-010, ADR-012, ADR-013 y ADR-014.

## 1. Objetivo y salida verificable

Alcance según §9: `apps/api` mínima con configuración validada, health y sesiones administrativas locales.

La salida que fija §9 es "tests de configuración que rechazan modos simulados en producción". Este plan agrega además la evidencia que necesitan las otras dos partes del alcance:
- health que distingue proceso vivo de servicio listo;
- login, sesión, rotación, vencimiento y revocación probados contra PostgreSQL real aislado;
- la parte de sesión y CSRF de T20: una sesión revocada y una mutación sin token CSRF se rechazan en el backend.

La parte de T20 sobre roles ("rol editor publica") queda en P4, junto con la matriz de permisos.

P1 no habilita producción, igual que las guardas de `packages/db`. Con `APP_ENV=production`, la API rechaza la configuración y no arranca. Por eso las pruebas de modos simulados comprueban que cada modo simulado produce su propio error en producción, y no solo que producción falla.

## 2. Estado de partida (relevado el 21/10/2026)

| Elemento | Estado | Consecuencia para P1-T4 |
|---|---|---|
| `apps/` | No existe. `pnpm-workspace.yaml` solo incluye `packages/*` | Agregar `apps/*` al workspace, al control de límites y a ESLint |
| `packages/contracts` | Tiene `UNAUTHENTICATED`, `FORBIDDEN`, `RATE_LIMITED`, `REQUEST_INVALID`, `PAYLOAD_TOO_LARGE` y `SERVICE_UNAVAILABLE`. No tiene código para el error interno (500) ni DTO de autenticación | Agregar `INTERNAL_ERROR` (500) y los DTO de login y sesión (§5.12) |
| `packages/db` | Guardas que solo admiten el contenedor local; `createPool`, `runMigrations` y `TemporaryDatabases` exportados | La API reutiliza las guardas: en P1 solo se conecta al contenedor del proyecto |
| ADR de autenticación | No existe, aunque docs/03 lo pedía en P0 | Crear ADR-015 con las decisiones de §5.4 a §5.9 |
| Node | Fijado en 24.21.0 (`.node-version`, `engines`, CI). El 21/10/2026 salió 24.22.1, versión de seguridad | Ver §6 |
| Node del sistema | 24.18.0, ya rechazada por `engines` | Afectada por el aviso de §6. Las verificaciones usan una copia aislada |
| Archivos por trámite | `.env.example` declara `MAX_FILES_PER_SUBMISSION=1` y ADR-003 dice "Archivos por trámite: 1"; ADR-014 fija 3 candidatos por trámite y 1 adjunto por envío | Ver §10. P1-T4 no lee esa clave |
| `flow-schema` | Las variables `enum` no tienen máximo de valores | Ver §9 |

## 3. Dependencias

### 3.1 Entre tareas

- **Requiere**, ya cerradas:
  - P1-T2: errores y DTO de `contracts`;
  - P1-T3: migraciones, guardas, tipos generados y job `db` de la CI.
- **Conviene antes:** la actualización de Node a 24.22.1 (§6). Es una tarea corta, propuesta para el 28/10/2026.
- **Habilita:**
  - P1-T5: los adaptadores locales usan los mismos valores de modo;
  - P1-T6: CI completa y seed;
  - P3: el panel necesita login;
  - P4: roles, permisos, MFA o SSO y auditoría se apoyan en estas sesiones.
- **Antes de exponer definiciones por HTTP** (P3 y P4) se fusiona la tarea separada de `enumValues` (§9). P1-T4 no expone validación de definiciones.

### 3.2 Paquetes (verificados en el registro de npm el 21/10/2026)

Política del repositorio: versiones publicadas hace al menos 7 días, sin scripts de instalación salvo revisión explícita. Se vuelven a verificar al iniciar.

| Componente | Candidata | Publicada | Uso | Notas |
|---|---|---|---|---|
| express | 5.3.0 | 09/10/2026 | Servidor HTTP (ADR-009) | MIT, sin scripts de instalación, Node `>=18`. Incluye `body-parser` 2.3.0 |
| @types/express | 5.0.6 | 01/12/2025 | Tipos (desarrollo) | — |
| cookie | 2.0.1 | 30/06/2026 | Leer la cookie de sesión | MIT, sin dependencias, Node `>=22` |
| helmet | 8.3.0 | 12/07/2026 | Cabeceras de seguridad | MIT, sin dependencias. Alternativa: fijarlas a mano (§13) |
| Argon2id | `node:crypto` | — | Hash de contraseñas | Sin dependencia nativa. Ver §5.5 |
| zod, kysely, pg, vitest | Las del lockfile | — | Configuración, base y pruebas | Sin cambios |

No hacen falta servicios nuevos: no se usa Redis ni un proveedor de identidad. Las pruebas HTTP usan `fetch` de Node contra un servidor en un puerto efímero de `127.0.0.1`, sin `supertest`.

## 4. Qué necesita el propietario

1. Aprobar este plan y autorizar P1-T4.
2. Resolver las decisiones abiertas de §13.

No hay servicios que contratar ni términos que aceptar. Se descargan paquetes de npm.

## 5. Diseño propuesto

### 5.1 Estructura y límites

```
apps/api/
  src/
    config.ts        esquema de configuración y carga (§5.2)
    app.ts           createApp({ config, db, clock, random }): sin efectos al importar
    main.ts          arranque, señales y apagado (§5.15)
    http/            requestId, errores, límites de cuerpo, cabeceras, 404
    health/          rutas live y ready (§5.3)
    auth/            contraseñas, sesiones, cookie, CSRF, límites y rutas (§5.4 a §5.9)
    cli/admin.ts     usuarios locales (§5.13)
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
| `ADMIN_ORIGIN` | URL de origen, sin ruta ni credenciales. `http` solo en `development` y `test` y con host `localhost`, `127.0.0.1` o `[::1]`. En cualquier otro caso, `https` | Obligatoria |
| `DATABASE_URL` | La validan las guardas de `packages/db` (contenedor local) | Obligatoria |
| `CHANNEL_MODE`, `EMAIL_MODE`, `STORAGE_MODE`, `SCANNER_MODE` | Valores conocidos. Los simulados (`simulator`, `capture`, `local_private`, `fake_development_only`) están prohibidos en `production` | Obligatorias |
| `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS` | Enteros: inactividad de 5 a 30 minutos; total de 1 a 8 horas, y mayor que la inactividad | 30 y 8 |

Reglas:
- **Todos los errores juntos.** La validación reúne todos los problemas y los informa por clave y motivo, **nunca con el valor**, para no filtrar una credencial pegada en la variable equivocada. Si hay errores, el proceso termina con código distinto de cero antes de abrir el puerto o la base.
- **Producción en P1:** `APP_ENV=production` agrega `PRODUCTION_NOT_SUPPORTED`. Además, cada modo simulado agrega su propio `SIMULATED_MODE_IN_PRODUCTION`, con la clave afectada. Los modos reales todavía no existen (P5 y P6), así que no hay valor que los habilite. No se agregan valores reales vacíos que parezcan implementados.
- **Modo de cookie:** se deriva de la configuración y no se configura aparte (§5.7).
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

### 5.4 Usuarios y contraseñas

**Usuarios** (`admin_users`, §5.11): email normalizado único, hash de contraseña y estado `ACTIVE` o `DISABLED`.
- No hay registro público: los usuarios se crean con la CLI local (§5.13).
- Organización única (ADR-008): no hace falta `organization_id`.
- Los roles y alcances (`RoleAssignment`) son de P4.

**Política de contraseñas**, propuesta inicial del propietario:
- de 15 a 128 caracteres, sin reglas de composición. Con un solo factor, NIST SP 800-63B-4 exige al menos 15;
- el máximo acota el trabajo de Argon2 y el tamaño del cuerpo;
- el login acepta de 1 a 128 caracteres, para que un cambio de política no deje afuera a nadie, pero el alta y el cambio de contraseña exigen 15;
- no se consulta una lista de contraseñas filtradas, porque requeriría un servicio externo (pendiente para P7).

### 5.5 Argon2id en Node: disponibilidad, estabilidad, parámetros y concurrencia

**Disponibilidad y estabilidad** (verificadas el 21/10/2026):

| Hecho | Fuente |
|---|---|
| `crypto.argon2()` y `crypto.argon2Sync()` se agregaron en Node 24.7.0, como `SEMVER-MINOR` | `CHANGELOG_V24.md`, PR nodejs/node#50353 |
| Se marcaron estables en 24.19.0 (03/08/2026) | `CHANGELOG_V24.md`, "doc,crypto: mark argon2 … as stable", #63924 |
| 24.20.0 (26/08/2026) corrigió los errores de validación y que Argon2 eludiera el modo FIPS | `CHANGELOG_V24.md`, #64852 y #64776 |
| 24.22.0 y 24.22.1 no tienen cambios de Argon2 | `CHANGELOG_V24.md` |
| En la documentación de 24.21.0 y de 24.22.1, la sección no tiene marca propia y hereda la del módulo `crypto`: "Stability: 2 - Stable" | `nodejs.org/docs/v24.21.0/api/crypto.html` y `…/v24.22.1/…` |
| Node lo implementa sobre el KDF Argon2 de OpenSSL, compilado solo si OpenSSL lo trae (`OPENSSL_WITH_ARGON2`). OpenSSL 3.5.8 en 24.21.0 y 3.5.9 en 24.22.1 | `deps/ncrypto/ncrypto.cc` (tag v24.21.0); `nodejs.org/dist/index.json` |

**Comprobación local en 24.21.0** (Apple M5):
- el vector de prueba de Argon2id de RFC 9106 §5.3 coincide;
- no aparece ningún `ExperimentalWarning`;
- 64 MiB, t=3: mediana de 21 ms con p=4 y de 63 ms con p=1;
- 4 cálculos concurrentes con p=4 tardan 80 ms y suman unos 193 MiB de memoria residente.

La 24.22.1 no se ejecutó: tenía horas de publicada (§6). Se repite la misma comprobación al adoptarla.

**Versión exacta:** la implementación se hace sobre **Node 24.22.1**, adoptada el 28/10/2026 (§6). Si P1-T4 empieza antes, se trabaja en 24.21.0 y el PR no se fusiona sin la actualización. Las dos versiones tienen Argon2 estable y con las correcciones de 24.20.0.

**Parámetros:** segundo conjunto recomendado de RFC 9106 §4.
- `argon2id`, con 64 MiB de memoria (65536 bloques de 1 KiB), t=3, p=4;
- sal de 16 bytes de `randomBytes` y tag de 32 bytes;
- sin pimienta (`secret`) en P1, porque exigiría administrar un secreto. Se reconsidera en P7;
- formato PHC (`$argon2id$v=19$m=65536,t=3,p=4$<sal>$<hash>`). Si los parámetros cambian, el hash se actualiza en el siguiente login correcto;
- se vuelven a medir en el equipo de referencia al implementar, con un objetivo de 100 a 500 ms por cálculo en el hardware de producción (P7).

**Concurrencia:**
- como máximo **2 cálculos simultáneos**: unos 100 MiB según la medición, y deja libres 2 de los 4 hilos del pool de libuv para otras tareas;
- cola de espera de **8**, con un plazo de **2 s**;
- si la cola está llena o vence el plazo: 503 `SERVICE_UNAVAILABLE` con `Retry-After: 1`. La respuesta es idéntica para cualquier email (§5.9);
- el hash ficticio, la actualización del hash y la CLI pasan por el mismo límite;
- `UV_THREADPOOL_SIZE` queda en su valor por defecto.

Una prueba unitaria fija el vector de RFC 9106. Así un runtime sin Argon2 o con otra implementación falla en `check`, en lugar de fallar en el login.

### 5.6 Sesiones: emisión, rotación, vencimientos y revocación

**Emisión:**
- **Token:** 32 bytes de `randomBytes`, en base64url. Solo viaja en la cookie (§5.7). En la base se guarda su SHA-256, en `token_hash`, único: un token de alta entropía no necesita hash lento.
- **Token CSRF:** también de 32 bytes, propio de cada sesión, con su hash en `csrf_token_hash`.
- La respuesta de login devuelve `{user, permissions: [], csrfToken}`, nunca el token de sesión. `permissions` queda vacía hasta P4.

**Rotación:**
- **En cada login correcto** se emite un token nuevo. Si la petición traía una cookie de sesión, esa sesión se revoca con `LOGIN_REPLACED`. Así no hay fijación de sesión.
- **Al cambiar la contraseña** se revocan todas las sesiones del usuario (`PASSWORD_CHANGED`).
- **Sin rotación periódica dentro de la sesión:** el vencimiento absoluto de 8 h acota la vida de cada token, y rotar sin cambio de privilegios agrega carreras entre pestañas sin beneficio en P1.
- En P4, el paso de MFA y los cambios de rol también rotarán el token. Queda registrado en ADR-015.

**Vencimientos comprobados en el servidor** (propuesta inicial del propietario):
- **Inactividad:** 30 minutos. `idle_expires_at = last_seen_at + 30 min`, sin superar nunca el vencimiento absoluto. `last_seen_at` se actualiza como mucho una vez por minuto.
- **Total:** 8 horas. `absolute_expires_at = created_at + 8 h`. No se extiende.
- **Consulta única por petición:** `token_hash` coincide, `revoked_at` es nulo, los dos vencimientos son posteriores al instante actual y el usuario está `ACTIVE`. El instante lo da el reloj inyectado de la app; en las pruebas es controlable.
- La cookie no lleva `Max-Age` ni `Expires`. Aunque el navegador la conserve, por ejemplo al restaurar la sesión, el servidor la rechaza al vencer.
- **Sin caché de sesiones en memoria:** una revocación surte efecto en la petición siguiente.
- Una sesión vencida, revocada o desconocida responde 401 `UNAUTHENTICATED` y borra la cookie.

**Revocación:**

| Causa | Alcance | `revoke_reason` |
|---|---|---|
| `POST /api/v1/auth/logout` (requiere CSRF; responde 204) | La sesión actual | `LOGOUT` |
| Login correcto con una cookie previa | La sesión anterior | `LOGIN_REPLACED` |
| Cambio de contraseña (CLI) | Todas las del usuario | `PASSWORD_CHANGED` |
| Desactivación del usuario (CLI), mediante trigger en la misma transacción | Todas las del usuario | `USER_DISABLED` |
| `revoke-sessions` (CLI) | Todas las del usuario | `ADMIN_REVOKED` |

- `revoked_at` y `revoke_reason` se escriben una sola vez: una sesión revocada no se reactiva.
- El vencimiento no necesita escritura: la consulta lo excluye.
- Las filas vencidas se purgan en P7, con la política de retención.

**MFA y SSO:** P4 (docs/03), como exige docs/07 para administradores y publicadores en producción. Mientras no existan, la API no arranca en producción (§5.2).

### 5.7 Cookie en local y en HTTPS

| Entorno | Protocolo y URL | Cookie | Comportamiento esperado del navegador |
|---|---|---|---|
| `development` local, desde P3 | HTTP. Panel en `http://localhost:5173` (`ADMIN_ORIGIN`, como en `.env.example`); el proxy de Vite reenvía `/api` a `http://127.0.0.1:4000` | `sc_dev_session`: `HttpOnly`, `SameSite=Strict`, `Path=/`, sin `Secure`, sin `Domain`, sin `Max-Age` | Chrome, Edge, Firefox y Safari la guardan y la envían en cada pedido a `http://localhost:5173`. Para el navegador el pedido es del mismo origen, así que no hay CORS |
| `development` en P1-T4, sin panel | HTTP a `http://127.0.0.1:4000`, con curl o pruebas, enviando `Origin: http://localhost:5173` | La misma | No interviene un navegador. Las pruebas manejan la cookie a mano |
| `test` (pruebas automáticas) | HTTP en `127.0.0.1`, puerto efímero | Las dos variantes, según la configuración de cada prueba | — |
| `staging` y `production` (P7) | HTTPS en el dominio del panel | `__Host-sc_session`: `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, sin `Domain`, sin `Max-Age` | Solo se envía por HTTPS al mismo host. El prefijo impide que un subdominio la reemplace |

**Por qué en local no se usa `Secure`:**
- MDN documenta que los navegadores ignoran el requisito de HTTPS cuando una cookie `Secure` la fija `localhost`.
- Pero en Safari las cookies `Secure` no se envían a `http://localhost` (WebKit bug 281149, según los datos de compatibilidad de MDN). El prefijo `__Host-` exige además un origen seguro.
- Depender de esa excepción haría que el login funcione en un navegador y falle en otro.
- HTTPS local, por ejemplo con mkcert, requiere instalar una autoridad de certificación en el sistema. Queda fuera de lo autorizado y se puede reconsiderar en P3 o P6.

**Límites del modo local:**
- Las cookies no se aíslan por puerto: el navegador también enviará `sc_dev_session` a otros servicios de `http://localhost`. `HttpOnly` impide leerla desde JavaScript, y el nombre distinto evita confundirla con la de HTTPS.
- La cookie es del host que se usa: si el panel se abre en `127.0.0.1` en lugar de `localhost`, es otra cookie, y el control de `Origin` la rechaza. Hay que usar el host de `ADMIN_ORIGIN`.

**Regla de configuración:**
- El modo sin `Secure` se activa solo si se cumplen las tres condiciones: `APP_ENV` es `development` o `test`, `ADMIN_ORIGIN` es `http` con host loopback, y `API_HOST` es loopback.
- En cualquier otro caso se usa `__Host-sc_session` con `Secure`, y `ADMIN_ORIGIN` debe ser `https`.
- Una prueba recorre todas las combinaciones.

### 5.8 CSRF, origen y CORS

- **Token sincronizador por sesión** (§5.6). El cliente lo envía en la cabecera `X-CSRF-Token` en todo método que no sea `GET`, `HEAD` ni `OPTIONS`. Se compara el hash en tiempo constante.
- **Origen:** las mutaciones exigen `Origin` igual a `ADMIN_ORIGIN`. Si falta, se rechaza.
- **Login:** todavía no hay sesión ni token. Se protege con el control de `Origin` y con `Content-Type: application/json`: un formulario HTML de otro sitio no puede enviarlo sin preflight CORS, y la API no responde preflights.
- **Rechazos:** 403 `FORBIDDEN`, sin detalle.
- **Sin CORS.** El panel llega a la API por el mismo origen: proxy en desarrollo (§5.7) y el mismo dominio en producción (P7). Las cookies y las respuestas no quedan disponibles para otros orígenes.

### 5.9 Login: enumeración, bloqueo provocado y agotamiento de recursos

**Orden de `POST /api/v1/auth/login`.** Los controles baratos van antes que el hash:
1. Cuerpo JSON de hasta 16 KiB, con email de hasta 254 caracteres y contraseña de 1 a 128. Si no, 413 o 400.
2. `Origin` igual a `ADMIN_ORIGIN`. Si no, 403.
3. Límite por red.
4. Límite por par email y red.
5. Límite por email.
6. Un lugar en el límite de Argon2 (§5.5). Si no hay, 503.
7. Buscar un usuario `ACTIVE` por email normalizado y verificar la contraseña. Si el usuario no existe o está desactivado, se verifica contra un hash ficticio calculado al arrancar con los mismos parámetros.
8. Registrar el fallo, o el éxito con la rotación de §5.6.

**Enumeración de cuentas.** Que exista o no una cuenta no cambia nada visible:
- **Respuestas:** incorrecto, inexistente y desactivado dan el mismo 401 `UNAUTHENTICATED`, con el mismo cuerpo y las mismas cabeceras (solo cambia el `requestId`).
- **Trabajo:** siempre se hace exactamente una verificación Argon2. El tiempo depende de esa verificación, no de la existencia del usuario.
- **Límites:** se calculan con el email normalizado y la red, sin consultar si el usuario existe. Un 429 o un 503 no revela nada.
- **Superficie:** P1 no tiene registro, recuperación de contraseña ni otra ruta que consulte cuentas. La CLI es local.
- **Pruebas:** comparan las respuestas y comprueban, con un doble del verificador, que cada camino hace una sola verificación. No se miden tiempos, para evitar pruebas inestables.

**Bloqueo provocado de cuentas ajenas.** Los umbrales **mitigan** que alguien deje afuera a un administrador, pero **no lo impiden por completo** (precisión del propietario, 21/10/2026). Ningún bloqueo es permanente:

| Límite | Clave | Umbral (propuesta) | Efecto | Dónde |
|---|---|---|---|---|
| Por red | Dirección del cliente | 20 intentos en 15 min | 429 para esa red | Memoria del proceso |
| Por par | Email normalizado y red | 5 fallos en 15 min | 429 solo para ese email desde esa red, hasta que termina la ventana | Memoria del proceso |
| Por email | SHA-256 del email normalizado | 30 fallos en 1 h, desde cualquier red | 429 para ese email desde cualquier red, hasta que termina la ventana | PostgreSQL (`admin_login_throttle`) |

- **Un atacante desde una sola red** solo bloquea el par: como mucho 20 fallos por hora para un email, por debajo del umbral global de 30. El administrador legítimo, desde otra red, sigue entrando.
- **El umbral global** frena un ataque distribuido y no se reinicia al reiniciar la API.
- **Limitaciones de la mitigación:**
  - un atacante con al menos dos redes alcanza el umbral global y bloquea la cuenta para todos, también para quien conoce la contraseña, hasta que termina la ventana de 1 hora, y puede repetirlo;
  - desde la misma red que el administrador (NAT, oficina o loopback en P1) bloquea el par durante 15 minutos;
  - los límites en memoria se pierden al reiniciar.
- **En P1 todo llega desde loopback,** así que atacante y usuario comparten la red. Es aceptable en local. `unlock` (CLI) limpia el límite persistente por email; los de memoria vencen solos o al reiniciar.
- **Puesta en cero:** un login correcto pone en cero el contador del par, no el global.
- **Al exponerse a la red (P7)** se agregan cookies de dispositivo (OWASP): un navegador que ya inició sesión con éxito no queda afectado por el límite del par.
- **Respuesta:** 429 `RATE_LIMITED` con `Retry-After`.
- **Memoria acotada:** los contadores en memoria tienen vencimiento y un máximo de 10.000 claves. Al llenarse, se descartan primero las más viejas, y el límite por red sigue aplicándose.

**Agotamiento por verificaciones de contraseñas:**
- El tamaño de entrada del hash está acotado a 128 caracteres y 16 KiB de cuerpo.
- Los límites de los pasos 3 a 5 descartan antes de Argon2.
- Como mucho 2 cálculos simultáneos, cola de 8 y plazo de 2 s (§5.5). Los intentos que exceden reciben 503 `SERVICE_UNAVAILABLE` con `Retry-After: 1` y no reservan memoria.
- El hash ficticio y la actualización del hash consumen del mismo límite: no hay un camino sin control.
- **Prueba:** 50 logins concurrentes con contraseña incorrecta. Se comprueba que nunca hay más de 2 cálculos a la vez, que el exceso recibe 503 con `Retry-After`, y que `/health/live` sigue respondiendo durante la ráfaga.

### 5.10 HTTP: errores, límites y cabeceras

- **`requestId`** generado por el servidor en cada petición, con el formato de `internalIdSchema`. Va en la cabecera `X-Request-Id` y en todo error. Se ignora el valor que mande el cliente.
- **Errores:**
  - siempre `apiErrorResponseSchema` de `contracts`;
  - ruta inexistente: 404 `NOT_FOUND`;
  - método no admitido: 404 (§13);
  - excepción no controlada: 500 `INTERNAL_ERROR`, con mensaje genérico, sin stack ni detalle.
- **Cuerpo:**
  - solo JSON (`express.json` con `strict: true`);
  - **16 KiB** como máximo en las rutas de P1-T4, que superados dan 413 `PAYLOAD_TOO_LARGE`;
  - `inflate: false`: un cuerpo comprimido se rechaza, sin descomprimirlo (relevante también para §6);
  - JSON mal formado: 400 `REQUEST_INVALID`, sin repetir el contenido recibido;
  - otro `Content-Type`: 400 `REQUEST_INVALID` con motivo `CONTENT_TYPE` (§13).
- **Cabeceras:**
  - `helmet`, con `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`;
  - `X-Content-Type-Options: nosniff` y `Referrer-Policy: no-referrer`;
  - `Cache-Control: no-store` en toda respuesta de la API;
  - sin `X-Powered-By`;
  - HSTS solo cuando haya HTTPS (P7).
- **Servidor:** `requestTimeout`, `headersTimeout` y `keepAliveTimeout` explícitos, y `trust proxy` desactivado: en P1 no hay proxy delante de la API, así que la red del cliente es la dirección del socket.

### 5.11 Modelo de datos: migración `0006_admin_auth`

Migración nueva; las aplicadas no se tocan.

| Tabla | Columnas principales | Restricciones |
|---|---|---|
| `admin_users` | `id`, `email_normalized`, `password_hash`, `status`, `password_changed_at`, `disabled_at`, `created_at`, `updated_at` | `UNIQUE (email_normalized)`; `CHECK` de longitud y forma del email; `CHECK` del estado y su coherencia con `disabled_at`; sin `DELETE` ni `TRUNCATE` (trigger) |
| `admin_sessions` | `id`, `user_id`, `token_hash`, `csrf_token_hash`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `revoke_reason` | `token_hash` único de 32 bytes; FK `RESTRICT`; `idle_expires_at <= absolute_expires_at`; `absolute_expires_at > created_at`; columnas fijas; `revoked_at` y su motivo se escriben una sola vez, con motivos de la lista de §5.6 |
| `admin_login_throttle` | `key_hash`, `failures`, `window_started_at` | Clave primaria `key_hash` de 32 bytes; `failures >= 0`. Solo guarda el hash del email, nunca el email ni la red |

Invariantes con trigger:
- **Desactivación:** pasar un usuario a `DISABLED` revoca sus sesiones activas (`USER_DISABLED`) en la misma transacción.
- **Sesión revocada:** no se reactiva.

Se regeneran los tipos (`db:types`) y la verificación de divergencia los cubre.

### 5.12 Contratos

En `packages/contracts`:
- **Errores:** `INTERNAL_ERROR` (500), sin `details`.
- **DTO de autenticación:**
  - `loginRequestSchema`: email de hasta 254 caracteres y contraseña de 1 a 128;
  - `sessionResponseSchema`: `user.id`, `user.email`, `permissions` (lista vacía en P1) y `csrfToken`.
- **Documentación:** se actualizan `docs/05` y el README de `contracts`.

### 5.13 Usuarios locales: CLI

`pnpm --filter @sistema-chatbot/api run admin -- <comando> --email …`, con los comandos `create`, `set-password`, `disable`, `revoke-sessions` y `unlock`.
- Rechaza `APP_ENV=production` y pasa por las guardas de base.
- Lee la contraseña de la terminal sin eco, nunca de un argumento, porque quedaría en el historial.
- `set-password`, `disable` y `revoke-sessions` revocan sesiones según §5.6.

Es una herramienta del operador local, no seed. El seed ficticio es de P1-T6. Para datos de demo se recomiendan direcciones `@example.com` (AGENTS.md).

### 5.14 Logs

- **Formato:** una línea JSON por petición, con `requestId`, método, ruta declarada (no la URL con parámetros), estado y duración. En eventos de autenticación se registra el `userId` del login correcto y el motivo de cada revocación.
- **Nunca se registran:** cookies, cabeceras `Authorization` o `X-CSRF-Token`, cuerpos, contraseñas, tokens ni el email de un intento fallido.
- **Sin dependencia nueva:** se usa un logger propio y mínimo. La observabilidad completa es de P7.

### 5.15 Apagado ordenado

Con `SIGTERM` o `SIGINT`:
1. `ready` pasa a 503;
2. se dejan de aceptar conexiones;
3. se esperan las peticiones en curso con un plazo, que se mide en las pruebas;
4. se cierra el pool y el proceso termina con 0.

La API no tiene llamadas externas en curso: el drenaje de efectos de ADR-002 es del worker (P2).

### 5.16 Scripts y CI

- **Raíz:**
  - `pnpm api:dev`: compila y arranca contra el contenedor local;
  - `check` incluye las pruebas de la API que no usan base;
  - `check:db` agrega las pruebas de base de la API.
- **CI:** el job `db` ejecuta también las pruebas de base de la API. No cambian las acciones ni sus permisos.
- **`.env.example`:** agrega `API_HOST` y los vencimientos de sesión, sin valores secretos.

## 6. Aviso de seguridad de Node (octubre de 2026)

**Fuentes oficiales** (consultadas el 21/10/2026):
- **Preanuncio** en `nodejs.org/en/blog/vulnerability/october-2026-security-releases`, del 14/10/2026:
  - publicación de nuevas versiones de las líneas 26.x, 24.x y 22.x;
  - la severidad más alta corregida es **HIGH** en cada línea;
  - las versiones fuera de soporte (End-of-Life) están siempre afectadas.

  A esta fecha, la entrada no se actualizó con el detalle de cada CVE.
- **Release v24.22.1** en GitHub (`nodejs/node`), publicada el 21/10/2026 con su changelog. Versiones corregidas según `nodejs.org/dist/index.json`: v26.12.1, v24.22.1 y v22.23.4, todas con OpenSSL 3.5.9.

**Versiones afectadas:**
- todas las anteriores a esas, en las tres líneas, incluidas las del proyecto: 24.21.0 (fijada en el repositorio y la CI) y 24.18.0 (Node del sistema);
- todas las líneas fuera de soporte.

**Impacto para el proyecto.** La severidad de cada CVE todavía no está publicada; el análisis parte de los títulos del changelog y se revisa cuando se actualice el aviso.

| CVE | Componente | Hoy (`db`: CLI y pruebas) | P1-T4 propuesta | Más adelante |
|---|---|---|---|---|
| CVE-2026-105481 | Cliente HTTP (`http.Agent`) | No se usa: `pg` usa TCP propio | No hace pedidos salientes | Adaptadores de correo y WhatsApp (P5 y P6) |
| CVE-2026-105482 | `dns.resolve*` con bytes nulos | No se usa | No se usa | Bajo |
| CVE-2026-105483, CVE-2026-106069 | TLS: normalización de direcciones IP | Sin TLS: conexión local | Sin TLS en P1 | TLS hacia la base y los proveedores (P5 a P7) |
| CVE-2026-106073 | Modelo de permisos (`--permission`) | No se usa | No se usa | — |
| CVE-2026-106074 | `crypto`: cachés de números aleatorios con snapshots de arranque | No se usan snapshots | Tokens de sesión con `randomBytes`, sin snapshots | Solo si se adoptaran snapshots o ejecutables únicos |
| CVE-2026-111497 | Descompresión brotli (zlib) | No se usa | `inflate: false`: no descomprime cuerpos | Respuestas comprimidas de proveedores (P5 y P6) |
| Sin CVE asignado | OpenSSL 3.5.9, undici 7.30.1, c-ares 1.34.9, certificados raíz | OpenSSL respalda Argon2 y TLS | Argon2 (§5.5) | — |

Hoy no hay ningún servicio expuesto: el contenedor escucha en `127.0.0.1` y la API todavía no existe.

**Recomendación concreta: no exceptuar la espera de 7 días.**
1. Adoptar **v24.22.1 el 28/10/2026**, primer día en que cumple la política, en una tarea corta y separada:
   - `.node-version` en 24.22.1 y `engines` en `>=24.22.1 <25`;
   - CI;
   - addendum de ADR-009;
   - verificación del checksum;
   - vector de RFC 9106 y `check` y `check:db` completos.
2. Si P1-T4 se autoriza antes, se desarrolla en 24.21.0, solo en loopback. Su PR no se fusiona hasta que la actualización esté en `main`.
3. **Motivo:**
   - ninguno de los componentes afectados está en un camino que el proyecto use hoy;
   - no hay nada expuesto;
   - la propia 24.22.1 corrige una regresión de TLS de una versión anterior ("tls: fix ip normalization regression"), que es justo el riesgo que la espera mitiga.
4. **Exceptuar la espera** si antes del 28/10 pasa alguna de estas cosas:
   - el aviso actualizado muestra una severidad HIGH en algo que el proyecto ejecuta: servidor HTTP, zlib sobre entradas, generación de números aleatorios sin snapshots, u OpenSSL en Argon2;
   - algo del proyecto pasa a escuchar fuera de loopback.
5. El propietario actualiza el Node del sistema, que sigue en 24.18.0, a 24.22.1 cuando cumpla el plazo.

## 7. Medidas de seguridad

| Amenaza | Control | Prueba |
|---|---|---|
| Arrancar en producción con efectos simulados | Configuración que rechaza producción en P1 y cada modo simulado | Un error por modo, con su clave |
| Credencial filtrada en logs o errores de configuración | Errores por clave sin valor; logs sin cuerpos ni cabeceras sensibles | Un valor secreto no aparece en la salida |
| API expuesta en la red local sin TLS | `API_HOST` solo loopback en P1 | `0.0.0.0` rechazado |
| Robo o reutilización de sesión | Token aleatorio con hash en la base; cookie `HttpOnly` y `SameSite=Strict`, con `Secure` y `__Host-` fuera del modo local; vencimientos en el servidor; revocación | Sesión revocada, vencida, de usuario desactivado o con cookie alterada: 401 |
| Fijación de sesión | Token nuevo en cada login; la sesión anterior se revoca | La cookie previa deja de valer |
| Cookie sin `Secure` fuera de local | Modo local solo con las tres condiciones de §5.7 | Combinaciones de entorno, origen y host |
| CSRF | Token sincronizador, `Origin` obligatorio, JSON obligatorio y sin CORS | Mutación sin token, con token ajeno o de otro origen: 403 |
| Fuerza bruta | Límites por red, por par y por email; Argon2id | 429 con `Retry-After` |
| Bloqueo provocado (mitigación, no garantía) | Límite global por encima de lo que logra una sola red; bloqueos temporales; `unlock` | Una red no bloquea la cuenta para otra; varias redes sí la bloquean hasta que vence la ventana (limitación documentada) |
| Enumeración de cuentas | Misma respuesta, una sola verificación por intento y límites independientes de la existencia | Respuestas idénticas y una verificación por camino |
| Agotamiento por Argon2 | 2 cálculos a la vez, cola acotada y controles baratos primero | Ráfaga de 50: nunca más de 2 a la vez, 503 con `Retry-After`, `live` responde |
| Cuerpos abusivos | 16 KiB, sin descompresión y JSON estricto | 413 y 400 sin eco |
| Filtración por errores | Errores de `contracts`, 500 genérico | Sin stack ni detalle interno |
| Contenido interpretado por el navegador | CSP restrictiva, `nosniff`, `no-store` | Cabeceras presentes |
| Base equivocada | Guardas de `packages/db` | Ya probado en P1-T3; la API no las evita |
| Runtime vulnerable | Actualización a 24.22.1 (§6) | Vector de RFC 9106 y checks en la versión nueva |

Fuera de P1-T4, con su etapa:
- P4: MFA o SSO, rotación por cambio de privilegios, permisos y auditoría;
- P7: TLS, HSTS, límites compartidos entre instancias, cookies de dispositivo, rol de base con mínimos privilegios y lista de contraseñas filtradas.

## 8. Pruebas de salida

Cada prueba comprueba aceptación y rechazo. Los conteos se informan al terminar; no se anticipan.

**Sin base** (`pnpm run check`):
- **Configuración:**
  - una de desarrollo válida se acepta;
  - en producción, cada modo simulado da `SIMULATED_MODE_IN_PRODUCTION` con su clave (salida de §9 de docs/15);
  - producción da además `PRODUCTION_NOT_SUPPORTED`;
  - se rechazan `APP_ENV` desconocido, puerto fuera de rango, host no loopback, `ADMIN_ORIGIN` con ruta o con `http` fuera de lo permitido, vencimientos fuera de rango y claves faltantes;
  - modo de cookie según las combinaciones de §5.7;
  - los errores no contienen valores.
- **Argon2:**
  - vector de RFC 9106;
  - formato PHC;
  - verificación correcta e incorrecta;
  - actualización del hash si cambian los parámetros;
  - política de 15 a 128 caracteres en el alta;
  - límite de 2 cálculos, cola y plazo.
- **Límites de login,** con reloj inyectado:
  - por red, por par y por email;
  - puesta en cero del par;
  - una red no alcanza el umbral global;
  - `Retry-After`;
  - máximo de claves en memoria.
- **HTTP**, con dependencias simuladas:
  - 404, 413 y 400 por JSON inválido, comprimido o con otro tipo;
  - 500 sin detalle;
  - errores válidos según `apiErrorResponseSchema`;
  - cabeceras de seguridad;
  - `requestId` en la cabecera y en el error.
- **Límites entre paquetes:** `api` solo depende de `contracts` y `db`.

**Con PostgreSQL** (`pnpm run check:db`, job `db`):
- **Migración `0006`:**
  - email único normalizado;
  - sin borrado de usuarios;
  - revocación escrita una vez y con motivo válido;
  - desactivar revoca las sesiones;
  - columnas fijas;
  - `token_hash` único;
  - coherencia de vencimientos.
- **Login:**
  - el correcto pone la cookie con los atributos de cada modo y no devuelve el token en el cuerpo;
  - la base no contiene el token en claro;
  - incorrecto, inexistente y desactivado responden igual y hacen una sola verificación.
- **Rotación:** un login con una cookie previa revoca esa sesión (`LOGIN_REPLACED`); el cambio de contraseña revoca todas.
- **Vencimientos,** con reloj inyectado:
  - por inactividad a los 30 minutos;
  - absoluto a las 8 horas, aunque haya actividad;
  - la actividad extiende la inactividad sin pasar el absoluto;
  - `last_seen_at` se escribe como mucho una vez por minuto.
- **Revocación:** cada causa de la tabla de §5.6 deja la sesión inutilizable en la petición siguiente, con 401 y la cookie borrada.
- **CSRF (parte de T20):** logout sin token, con token de otra sesión o con otro `Origin`: 403, y la sesión sigue activa.
- **Límite por email:** persiste entre dos instancias de la app y responde 429 también para un email inexistente.
- **Ráfaga de logins:** la de §5.9.
- **Health:**
  - `live` sin base;
  - `ready` 200 con la base migrada;
  - 503 con una base sin la última migración, con la base cerrada y durante el apagado.
- **CLI:** los cinco comandos contra una base temporal. Rechaza producción.

T18 ("simulación intenta correo real") sigue en P3 y P5. P1-T4 aporta solo el rechazo de modos simulados en producción.

## 9. Listas `enum` de `flow-schema`: diagnóstico y tarea separada

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

**Tarea separada propuesta:** en la rama `p1/flow-schema-enum-limit`, con su propio PR, solo en `flow-schema` y su documentación. No va dentro de P1-T4, que no toca definiciones. Debe estar fusionada antes de que cualquier endpoint reciba definiciones (P3).

**Cambios:**
1. **Límite.** Nuevo `enumValues = 50` en `FLOW_LIMITS` y en `RULE_LIMITS`, alineado con `valuesPerList`: así cualquier `in` sobre todos los valores sigue siendo expresable.
   - Se comprueba en `checkSizeLimits` de flujos y reglas, antes de las comprobaciones semánticas.
   - Error: `FLOW_LIMIT_EXCEEDED` o `RULE_LIMIT_EXCEEDED` con `details.limit = "enumValues"`, `max` y `actual`, en la ruta `variables.<nombre>.values` o `contextVariables.<nombre>.values`.
   - Sin códigos nuevos. `contracts` ya acepta cualquier nombre de límite en `details.limit` (texto corto), así que no cambia.
2. **Complejidad.** Reemplazar las búsquedas lineales por `Set`, como defensa adicional aunque el límite ya acote el costo. Los problemas que se informan no cambian.
3. **Documentos:**
   - tablas de límites de ADR-003 y ADR-012, con addendum;
   - README de `flow-schema`;
   - docs/13 y PROJECT_STATUS.

**Pruebas de frontera:**
- **Flujo:**
  - una variable `enum` con 1 valor y otra con 50: sin problema de límite;
  - con 51: exactamente un `FLOW_LIMIT_EXCEEDED` para esa variable, con `limit = "enumValues"`, `max = 50`, `actual = 51` y su ruta.
- **Reglas:** lo mismo en `contextVariables`, con `RULE_LIMIT_EXCEEDED`.
- **Varias variables por encima del límite:** un problema por variable, en orden determinista.
- **Casos que no cambian:**
  - 0 valores, o valores repetidos dentro de 50: siguen dando `ENUM_VALUES_INVALID`;
  - 51 valores con repetidos: solo el límite, porque se comprueba antes.
- **`validatePublication`:** el límite llega al informe, y `toValidationReport` de `contracts` lo acepta.
- **Mutación temporal:** con el límite en 51, la prueba de 51 valores tiene que fallar. Se restaura el archivo y se comprueba con `cmp`, como en P1-T2.

**Pruebas de entradas excesivas:**
- **120.000 valores en el flujo y en las reglas,** el caso medido:
  - solo los problemas de límite, sin `EMAIL_CONTEXT_MISMATCH` ni otros semánticos;
  - menos de 1 s en la CI, con margen amplio frente a los 6,7 s actuales, para que la prueba no sea inestable;
  - el criterio principal es que no se ejecute la fase semántica, porque no depende del tiempo.
- **250.000 valores,** el máximo de un borrador según `contracts`: el mismo resultado.
- **Un `enum` grande junto con otro límite de totales** (más de 100 nodos): se mantiene el corte temprano actual.
- **Semántica con `Set`:** `NOT_IN_ENUM` en opciones y predicados, y `EMAIL_CONTEXT_MISMATCH` con motivo `ENUM_VALUES`, dan los mismos problemas que hoy con listas de hasta 50 valores.

**Compatibilidad con los ejemplos existentes:**
- Los tres JSON de `examples/` no declaran variables `enum`: el flujo usa `companyRef`, `documentTypeRef` y `documentRefList`, y las reglas `companyRef` y `documentTypeRef`. Siguen validando sin problemas, y la prueba de fixtures existente lo comprueba.
- Las suites de `flow-schema` y `contracts` pasan sin modificar sus expectativas, salvo las nuevas.
- Ninguna definición publicada se invalida: todavía no hay datos en ninguna base. El cambio de límite se documenta en el addendum de ADR-003 y ADR-012, como exige `limits.ts`. `schemaVersion` no cambia, porque el esquema no cambia, solo el límite de validación.

**Alternativas descartadas:**
- **`.max()` en el esquema zod:** daría un error estructural en lugar del código de límite estable que usan los demás límites.
- **Confiar solo en el tamaño del cuerpo HTTP o en el `CHECK` de 4 MiB:** la medición muestra que un flujo de 1 MiB ya alcanza para 6,7 s.

## 10. Candidatos históricos frente al adjunto por envío

Son dos límites distintos, y hoy dos documentos los mezclan:

| Concepto | Valor | Qué cuenta | Dónde se aplica |
|---|---|---|---|
| **Cupo histórico de candidatos por trámite** (ADR-014 §2 y §11) | 3, con hasta 30 MB almacenados | Cada `Document` candidato creado en el trámite completo, con cualquier nodo o ejecución, incluidos los rechazados, inconclusos, con descarga fallida, reemplazados, descartados y purgados. El cupo nunca se devuelve | Base: `candidate_count` de 0 a 3, `candidate_seq` único y sin borrado desde `0005`. Host: reserva condicional en P2 (`CANDIDATE_LIMIT_REACHED`) |
| **Adjunto por envío** (ADR-007, ADR-013 y ADR-014 §11) | 1 | El documento `SELECTED`, confirmado y aprobado que lleva la entrega | `flow-schema`: `ATTACHMENTS_PER_SEND = 1` (`FILE_ATTACHMENT_COUNT_INVALID`). Entrega: P5 |

**Ambigüedades actuales:**
- `.env.example` tiene `MAX_FILES_PER_SUBMISSION=1`. Por su nombre parece el cupo del trámite, pero su valor es el del adjunto por envío.
- ADR-003 tiene la fila "Archivos por trámite: 1", que no coincide con ADR-014.

**Nombres propuestos**, sin implementar todavía:

| Nombre | Valor | Regla |
|---|---|---|
| `MAX_CANDIDATE_FILES_PER_SUBMISSION` | 3 | Reemplaza a `MAX_FILES_PER_SUBMISSION`. Entero de 1 a 3: la base no admite más de 3, y subirlo exige migración y una modificación de ADR-014 |
| `MAX_CANDIDATE_BYTES_PER_SUBMISSION` | 31457280 | Los "30 MB almacenados" de ADR-014 §11. Se propone 30 MiB, coherente con `MAX_FILE_BYTES=10485760` (10 MiB). Hay que confirmar si son MB decimales o MiB |
| Adjuntos por envío | Sin variable de entorno | Es fijo en V1 (`ATTACHMENTS_PER_SEND = 1` en la DSL). Una variable que solo admite 1 sugeriría que es configurable. Si alguna vez hiciera falta, se llamaría `MAX_ATTACHMENTS_PER_DELIVERY` y requeriría un ADR |

**Al implementarlo:**
- la configuración del host rechaza `MAX_FILES_PER_SUBMISSION` si está definida, con un mensaje que nombra la clave nueva, para que un `.env` viejo no se interprete en silencio;
- la fila de ADR-003 pasa a "Adjuntos por envío: 1", con referencia al cupo de ADR-014, en un addendum.

**Cuándo:** se propone cambiar `.env.example` y ADR-003 dentro del PR de P1-T4, que de todos modos modifica `.env.example`. La lectura y validación de las claves va en P2, donde vive la reserva de candidatos. P1-T4 no las lee.

## 11. Fuera de alcance

- MFA, SSO, recuperación de cuenta, roles y matriz de permisos, auditoría (P4).
- Panel y proxy de desarrollo (P3).
- Endpoints de flujos, simulaciones, directorio, contactos, trámites y descargas (P3 y P4).
- Webhooks (P6).
- Adaptadores (P1-T5).
- Seed y CI completa (P1-T6).
- Despliegue, TLS, límites compartidos entre instancias, cookies de dispositivo y rol de base con mínimos privilegios (P7).
- La tarea de `enumValues` (§9) y la actualización de Node (§6), que son separadas.
- OpenAPI: docs/05 la prevé al implementar. Con tres rutas de autenticación y dos de health, se propone generarla en P4, cuando haya recursos administrativos (§13).

## 12. Archivos previstos

- **Nuevos:**
  - `apps/api/` (§5.1);
  - `packages/db/migrations/0006_admin_auth.sql` y sus pruebas en `packages/db/test/db/`;
  - `docs/adr/ADR-015-autenticacion-administrativa.md`.
- **Modificados:**
  - `packages/db/src/generated/database.ts`;
  - `packages/contracts` (§5.12);
  - `pnpm-workspace.yaml`, `scripts/check-workspace-boundaries.mjs`, `eslint.config.js`, `package.json` raíz, `.github/workflows/ci.yml` y `.env.example` (§5.16 y §10);
  - documentación: ADR-001, ADR-003 y ADR-009 (addenda), docs/04, 05, 07, 09, 10 y 13, README, PROJECT_STATUS y una sección de implementación en este plan.

## 13. Decisiones

**Resueltas por el propietario** (21/10/2026, al autorizar la implementación sobre `2567f10`):

| # | Tema | Decisión |
|---|---|---|
| 1 | Plan y P1-T4 | Aprobados, con precisiones (§15). Orden: Node, límite de `enum` y API, en ramas y PR separados |
| 2 | Node 24.22.1 (§6) | Excepción autorizada a la espera de 7 días, por ser una actualización de seguridad (addendum de ADR-009) |
| 3 | `enumValues = 50` (§9) | Implementar en flujos y reglas. El criterio es el rechazo antes del análisis costoso, sin pruebas de tiempo rígidas |
| 4 | Candidatos y adjuntos (§10) | 3 candidatos históricos; 10 MiB (10485760 bytes) por archivo y 30 MiB (31457280) por trámite. Renombrar la configuración ambigua; la aplicación del cupo sigue en P2 |
| 5 | Límites de login (§5.9) | Los propuestos, como valores iniciales |
| 6 | Sesiones | 30 minutos de inactividad y 8 horas en total |
| 7 | Contraseñas | 15 a 128 caracteres, sin reglas de composición |
| 8 | Argon2id, cookie local y `helmet` | Según el plan |
| 9 | Métodos no admitidos y tipo de contenido | 404 y 400 `REQUEST_INVALID` (propuesta por defecto) |
| 10 | OpenAPI | En P4, documentando los contratos actuales (docs/05, "API implementada") |

## 14. Riesgos

- **Límites en memoria:** el límite por red y el del par se pierden al reiniciar y no se comparten entre procesos. Se acepta en P1 (un proceso, loopback). El límite por email sí persiste. Se revisa en P7.
- **Bloqueo provocado:** los umbrales lo mitigan sin impedirlo. Un atacante con varias redes puede bloquear la cuenta durante la ventana de 1 hora; en loopback, quien tenga acceso a la máquina bloquea el par durante 15 minutos. Las mitigaciones adicionales (cookies de dispositivo, límites compartidos y alertas) son de P7. Detalle en ADR-015.
- **Argon2 nativo de Node:** depende de mantener Node actualizado (§6). A cambio evita un módulo nativo con scripts de instalación.
- **Cookie de desarrollo sin `Secure`:** solo bajo las tres condiciones de §5.7. Las cookies de `localhost` se comparten entre puertos.
- **Aviso de Node incompleto:** el impacto de §6 se dedujo de los títulos del changelog. Se revisa cuando se publique la severidad de cada CVE.
- **Usuarios sin MFA:** aceptable solo en local. La API se niega a arrancar en producción hasta P4/P7.
- **Configuración solo en la API:** si el worker la necesita, extraerla tiene costo. Se hace en P2 con su addendum.
- **Este plan no prueba nada:** las medidas de §7 cuentan recién cuando sus pruebas pasen.

## 15. Implementación (21/10/2026)

Rama `p1/t4-api`, sobre `p1/flow-schema-enum-limit`, que a su vez sale de `p1/node-24.22.1` y de `p1/t4-plan`. Evidencia en `PROJECT_STATUS.md` y `docs/reviews/PR-P1-T4-api.md`. Decisiones en ADR-015.

**Precisiones del propietario incorporadas:**
- **Token CSRF después de recargar:**
  - Es un HMAC-SHA256 del token de sesión y no se guarda.
  - `GET /api/v1/auth/me` lo devuelve con la cookie, sin otro login. Las pestañas comparten la cookie y el token, así que una consulta no invalida a las demás.
  - Pruebas: recarga, dos pestañas y otro dispositivo.
- **Admisión concurrente del login**, antes del trabajo costoso: red, par email-red y email (en la base, con un `INSERT … ON CONFLICT` condicional y atómico), y después la compuerta de Argon2.
  - Cada límite reserva el intento antes de evaluarlo, y se devuelven las reservas de los pasos que no llegaron a evaluarse.
  - Pruebas de ráfaga: 12 intentos a la misma clave dan 5 verificaciones y 7 respuestas 429, sin ningún 503; 15 emails distintos a la vez dan 10 que entran a la compuerta y 5 respuestas 503 con `Retry-After: 1`, sin ningún 429.
- **Bloqueo provocado:** se corrigió la afirmación de §5.9. Los umbrales son una mitigación con limitaciones (§5.9, §7, §14 y ADR-015).
- **Login concurrente con desactivación o cambio de contraseña:**
  - La base administra `credential_version`, que sube con cada cambio de contraseña (`password_changed_at`) o de estado. El mismo cambio revoca las sesiones en la misma transacción.
  - La sesión solo se inserta con la versión verificada si sigue vigente y el usuario está activo. El trigger de inserción bloquea la fila del usuario (`FOR SHARE`).
  - Pruebas en la base y en la API: verificación detenida a mitad, sesión creada antes y varios logins con una desactivación.

**Diferencias con §5:**
- **CSRF:** sin columna `csrf_token_hash` (§5.6 y §5.11), porque el token se deriva de la sesión.
- **Versión de credenciales:** `admin_users.credential_version` y `admin_sessions.credential_version`, con sus triggers, son nuevos (no estaban en §5.11). Recalcular el hash con parámetros nuevos no cambia `password_changed_at`, así que no revoca sesiones.
- **Configuración:** validación explícita por clave en lugar de un esquema zod, para informar códigos estables sin valores.
- **`unlock` (CLI):** limpia el límite persistente por email. Los de memoria son del proceso de la API (§5.13).
- **Scripts de la raíz:**
  - `api:dev` y `api:admin` ejecutan la app con `pnpm -C apps/api`. Con `pnpm --filter` el proceso no recibía la terminal ni la entrada estándar; lo detectó la prueba de humo, porque la CLI recibía una contraseña vacía.
  - La CLI ignora un `--` inicial.
- **Health `ready`:** comprueba la base leyendo `kysely_migration`, con un plazo de 1 s, y compara contra los archivos de migración.
- **Preflight `OPTIONS`:** 404, igual que un método no admitido.
- **Configuración de candidatos:** `.env.example` reemplaza `MAX_FILES_PER_SUBMISSION` por `MAX_CANDIDATE_FILES_PER_SUBMISSION=3` y `MAX_CANDIDATE_BYTES_PER_SUBMISSION=31457280`, con addenda de ADR-003 y ADR-014. La API no lee esas claves.

**Verificación local adicional:** prueba de humo con el proceso real (`dist/main.js`) contra la base de desarrollo del contenedor:
- CLI `create` con la contraseña por la entrada estándar;
- live y ready;
- login con y sin `Origin`;
- `me` con el mismo token CSRF;
- logout con y sin CSRF;
- `me` después del logout;
- login incorrecto;
- `SIGTERM` con apagado completo.

El log no contiene el email. El usuario de prueba (`smoke@example.com`) quedó desactivado.
