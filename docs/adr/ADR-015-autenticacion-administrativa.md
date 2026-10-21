# ADR-015 — Autenticación administrativa local: sesiones, CSRF y límites de login

- Fecha: 21/10/2026
- Estado: Aceptada por el propietario al aprobar el plan de P1-T4 (`docs/plans/P1-T4-api-minima.md`, commit `2567f10`), con las precisiones del 21/10/2026.
- Responsable: propietario del proyecto
- Revisión: en P4 (MFA o SSO, roles y auditoría) y en P7 (despliegue con varias instancias, TLS y exposición a la red).

## Contexto

docs/07 pide sesiones opacas revocables, Argon2id, cookies seguras, CSRF, límites de intentos sin enumeración, revocación al desactivar y MFA para administradores en producción. docs/03 pedía en P0 un ADR de autenticación, que no se escribió. P1-T4 implementa la primera API con sesiones locales, sin MFA ni roles, y P1 no habilita producción.

## Alternativas

| Alternativa | Motivo de descarte |
|---|---|
| JWT en el navegador | No se revoca sin una lista de bloqueo; un token robado vale hasta vencer |
| Tokens en `localStorage` | Accesibles desde JavaScript; docs/07 lo prohíbe |
| Token CSRF guardado por sesión | No se puede devolver después de una recarga si solo se guarda su hash; guardarlo en claro agrega un secreto más |
| Token CSRF rotado en cada consulta | Invalida a las otras pestañas del mismo navegador |
| Módulo nativo `argon2` de npm | Requiere scripts de instalación; Node 24 trae Argon2 estable en `node:crypto` |
| Bloqueo permanente de la cuenta tras N fallos | Permite que cualquiera deje afuera a un administrador |
| Redis para los límites | Servicio nuevo sin necesidad en P1 (un proceso en loopback) |

## Decisión

**Sesión opaca en la base:**
- Token de 32 bytes aleatorios en base64url, solo en una cookie `HttpOnly`. La base guarda su SHA-256 (`admin_sessions.token_hash`, único).
- Vencimientos comprobados en el servidor en cada petición: 30 minutos de inactividad y 8 horas en total (propuesta inicial del propietario). La cookie no lleva `Max-Age` ni `Expires`.
- Sin caché de sesiones: una revocación surte efecto en la petición siguiente.

**Rotación y revocación:**
- **Rotación:** cada login correcto emite un token nuevo y revoca la sesión que traía la petición (`LOGIN_REPLACED`), así no hay fijación de sesión. No hay rotación periódica: el vencimiento absoluto acota cada token. En P4, MFA y los cambios de rol también rotarán el token.
- **Revocación:** logout (`LOGOUT`), cambio de contraseña (`PASSWORD_CHANGED`, todas), desactivación (`USER_DISABLED`, todas) y revocación por el operador (`ADMIN_REVOKED`, todas). Una sesión revocada no se modifica ni se reactiva.
- **Invariantes en la base** (migración `0006`):
  - un cambio de contraseña o de estado sube `credential_version` y revoca las sesiones activas en la misma transacción;
  - una sesión solo se inserta con la versión vigente de un usuario activo. El trigger bloquea la fila del usuario (`FOR SHARE`).

  Así un login que verificó la contraseña antes de una desactivación o de un cambio de contraseña no deja una sesión que eluda la revocación.

**Cookie:**

| Modo | Cuándo | Cookie |
|---|---|---|
| `secure` | Cualquier caso salvo el local | `__Host-sc_session`, con `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` y sin `Domain` |
| `local-http` | Solo con `APP_ENV` `development` o `test`, `ADMIN_ORIGIN` HTTP de loopback y API en loopback | `sc_dev_session`, con los mismos atributos salvo `Secure` |

En local no se depende de que el navegador acepte `Secure` en `http://localhost`: Safari no envía esas cookies (WebKit bug 281149) y `__Host-` exige origen seguro.

**CSRF:**
- El token es un HMAC-SHA256 del token de sesión con una etiqueta fija (`sistema-chatbot/csrf/v1`), en base64url.
- Login y `GET /api/v1/auth/me` lo devuelven. El panel lo envía en `X-CSRF-Token` en toda mutación, y se compara en tiempo constante.
- **Estrategia para recargas y pestañas:** el token se deriva de la sesión y no se guarda. Después de recargar, el panel llama a `GET /api/v1/auth/me` con la cookie y obtiene el mismo token, sin otro login. Varias pestañas comparten la cookie y, por lo tanto, el token: consultar en una no invalida a las otras. El token cambia cuando cambia la sesión.
- **Origen:** toda mutación exige además `Origin` igual a `ADMIN_ORIGIN`.
- **Login:** antes de que exista una sesión, se protege con ese mismo control de origen y con `Content-Type: application/json`.
- **Sin CORS:** el panel llega por el mismo origen (proxy en desarrollo y el mismo dominio en producción), y los preflight reciben 404.

**Contraseñas:**
- **Algoritmo:** Argon2id de `node:crypto` (estable desde Node 24.19.0; el proyecto fija 24.22.1), con 64 MiB, t=3 y p=4 (RFC 9106 §4), sal de 16 bytes, tag de 32 y formato PHC. Si los parámetros cambian, el hash se recalcula en el siguiente login correcto, sin revocar sesiones.
- **Política:** de 15 a 128 caracteres en puntos de código después de NFKC, sin reglas de composición.
- **Concurrencia:** como mucho 2 cálculos simultáneos, cola de 8 y espera de hasta 2 s. Lo que excede recibe 503 `SERVICE_UNAVAILABLE` con `Retry-After: 1`.

**Admisión del login.** Va antes del trabajo costoso y en este orden:
1. límite por red: 20 intentos en 15 minutos, en memoria;
2. límite por par email-red: 5 en 15 minutos, en memoria;
3. límite por email: 30 en 1 hora, en PostgreSQL y compartido entre procesos;
4. lugar en la compuerta de Argon2.

Cada límite reserva el intento antes de evaluarlo, así que una ráfaga sobre la misma clave no pasa entera por la comprobación. Si un paso posterior rechaza, se devuelven las reservas de los pasos que no llegaron a evaluarse. Un límite que rechaza responde 429 `RATE_LIMITED` con `Retry-After`; la compuerta saturada responde 503.

**Enumeración:**
- Contraseña incorrecta, usuario inexistente y usuario desactivado dan el mismo 401, con el mismo cuerpo y las mismas cabeceras.
- Siempre hay exactamente una verificación de Argon2: contra el hash ficticio si la cuenta no existe o está desactivada.
- Los límites usan el email normalizado (su SHA-256 en la base), exista o no la cuenta.

**Producción:** con `APP_ENV=production` la API no arranca en P1. Tampoco arranca con un modo simulado. MFA o SSO llegan en P4.

## Límites de la mitigación contra el bloqueo provocado

Los umbrales **mitigan** que alguien deje afuera a un administrador; **no lo impiden por completo**.
- **Atacante distribuido:** con al menos dos redes (6 redes con 5 fallos cada una), puede alcanzar el límite por email y bloquear la cuenta, también para quien conoce la contraseña, hasta que termina la ventana de 1 hora. Puede repetirlo en cada ventana.
- **Red compartida:** desde la misma red que el administrador (NAT, la misma oficina o, en P1, loopback), bloquea el par durante 15 minutos.
- **Reinicio:** los límites en memoria se pierden al reiniciar la API y no se comparten entre procesos. El límite por email sí persiste.
- **Desbloqueo:** `unlock` (CLI) limpia solo el límite persistente. Los límites en memoria vencen solos o al reiniciar.
- **Mitigaciones pendientes para P7,** al exponer la API: cookies de dispositivo (OWASP), para que un navegador que ya inició sesión no quede afectado; límites compartidos entre instancias; y alertas por ráfagas.

## Costos

- La revocación depende de triggers y de una versión de credenciales: más lógica en la base, con pruebas propias.
- Una consulta a la base por petición autenticada, más una escritura como mucho por minuto.
- Los límites en memoria no sirven con varias instancias sin cambios.

## Consecuencias

- La API solo arranca en desarrollo, pruebas o staging, contra el contenedor local (guardas de `packages/db`).
- El panel (P3) debe pedir `/auth/me` al cargar para obtener el token CSRF, y enviarlo en `X-CSRF-Token`.
- `INTERNAL_ERROR` (500) pasa a formar parte del catálogo de errores de `contracts`.

## Invariantes

- Ninguna sesión válida pertenece a un usuario desactivado ni a una versión de credenciales vieja.
- El token de sesión no se guarda ni se registra en ningún lado; el token CSRF no se guarda.
- Ningún límite de login depende de que la cuenta exista.

## Pruebas

- `apps/api/test`:
  - configuración, Argon2 (incluido el vector de RFC 9106), admisión, tokens y HTTP sin base;
  - login, sesiones, ráfagas de admisión, concurrencia con desactivación y cambio de contraseña, health y CLI contra PostgreSQL.
- `packages/db/test/db/admin-auth.test.ts`: restricciones y carreras de la migración `0006`.
- Cubre la parte de sesión y CSRF de T20. La parte de roles es de P4.

## Documentos afectados

`docs/04_MODELO_DATOS.md`, `docs/05_CONTRATOS_API.md`, `docs/07_SEGURIDAD.md`, `docs/09_PRUEBAS_Y_ACEPTACION.md`, `docs/10_ENTORNOS_Y_OPERACION.md`, `docs/13_TRAZABILIDAD.md`, `docs/plans/P1-T4-api-minima.md`, `apps/api/README.md`.
