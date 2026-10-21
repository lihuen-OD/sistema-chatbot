# Plan de P1-T3 — `packages/db`

- Fecha: 19/10/2026
- Estado: **aprobado el 20/10/2026 sobre `41c0234`, con precisiones del propietario; implementado en la rama `p1/t3-db` (§11).**
  - Precisiones:
    - Migrator de Kysely más checksums, con la verificación definitiva dentro del mismo bloqueo;
    - `jobs` diferida a P2;
    - validador de SQL que admite bloques BEGIN/END y no usa búsqueda de palabras;
    - guardas alineadas con `sc_test_<runId>_<n>`;
    - versiones verificadas al comenzar.
  - Contenedores: Docker Desktop, cuando el propietario lo confirme.
- Fuentes:
  - `docs/15_PLAN_CONSOLIDADO_P0.md` §5 y §9;
  - `docs/04_MODELO_DATOS.md`;
  - `docs/09_PRUEBAS_Y_ACEPTACION.md` (gate P1);
  - `docs/10_ENTORNOS_Y_OPERACION.md`;
  - ADR-001, ADR-002, ADR-004, ADR-009, ADR-010, ADR-011, ADR-012 y ADR-014.
- Criterios iniciales del propietario (19/10/2026), incorporados:
  - puerto `127.0.0.1:55432`;
  - `check` sin base y `check:db` separado, ambos en CI;
  - entorno compatible con Docker y con Colima;
  - en `jobs` y `outbox_actions`, separar lo decidido de lo que depende de P2;
  - kysely-codegen con compatibilidad comprobada;
  - pruebas significativas de restricciones y de concurrencia.

## 1. Objetivo y salida verificable

Alcance según §9: PostgreSQL local en contenedor, ejecutor de migraciones y migraciones iniciales con las invariantes de §5. Incluye:
- cupo y secuencia de candidatos por trámite;
- confirmación y entrega única;
- generación única y vinculación inmutable;
- generación de tipos y control de divergencia.

Salida: pruebas de restricciones contra PostgreSQL real aislado. Cubren la parte de base del gate P1:
- T29;
- candidatos, confirmación y entrega única de T37/T45;
- cupo y secuencia de T48;
- entrega por confirmación de T49;
- generación y vinculación de T51.

Estas pruebas no completan esos casos. La parte de ejecución sigue en P2 y P5.

Desviación propuesta respecto de §5 y §9: la invariante "escrituras de jobs condicionadas por `fencingToken`" pasa a P2, junto con la decisión de la cola (§5.5). Requiere aprobación.

## 2. Herramientas instaladas (relevadas el 19/10/2026, sin modificar nada)

| Herramienta | Estado | Consecuencia para P1-T3 |
|---|---|---|
| macOS 27.0.1, arm64 | — | Imágenes `linux/arm64` |
| Node.js global | 24.18.0, rechazada por `engines` (`>=24.21.0 <25`) | Hasta que se actualice, se trabaja con el runtime aislado 24.21.0 |
| pnpm | No instalado globalmente; se usa 12.12.1 vía corepack | Sin cambios |
| Docker Desktop | 29.7.2 y Compose v5.5.0 instalados; daemon detenido | Una opción posible (§5.1) |
| Colima | No instalado | Otra opción posible (§5.1) |
| Postgres.app | 2.9.5 con PostgreSQL 18.4, en ejecución en `localhost:5432`; binarios fuera del PATH | Cluster del usuario: no se usa ni se modifica, y las guardas lo excluyen (§5.7). PostgreSQL 18 vigente: 18.6 |
| Homebrew | 7.0.9; sin PostgreSQL ni libpq | No hace falta `psql` local |
| `gh` | No instalado | Sin impacto |

## 3. Qué necesita el propietario

1. Aprobar este plan (§9) y autorizar P1-T3.
2. Elegir el motor de contenedores, instalarlo si hace falta, aceptar sus términos y dejarlo en ejecución. Yo no instalo software ni acepto términos.

No hay servicios que contratar. Se descargan paquetes de npm y la imagen oficial `postgres` de Docker Hub.

## 4. Versiones candidatas

Política del repositorio: publicadas hace al menos 7 días. Se vuelven a verificar al iniciar.

| Componente | Candidata | Publicada | Compatibilidad comprobada en los metadatos publicados |
|---|---|---|---|
| PostgreSQL | 18.6, imagen oficial `postgres:18.6-trixie` fijada por digest | 13/08/2026; imagen actualizada el 07/10/2026 | `uuidv7()` nativo desde la 18 |
| kysely | 0.29.6 | 16/09/2026 | Node `>=22`; sin dependencias. La 0.29.7 tiene 2 días. En 0.x una minor puede romper: versión exacta |
| pg | 8.23.1 | 30/09/2026 | Node `>= 16` |
| @types/pg | 8.23.1 | 17/08/2026 | — |
| kysely-codegen (desarrollo) | 0.20.0 | 16/02/2026 | Ver detalle abajo |

kysely-codegen 0.20.0, según sus metadatos:
- requiere `kysely` `>=0.27.0 <1.0.0` y, de forma opcional, `pg` `>=8.8.0 <9.0.0`;
- Node `>=20`;
- licencia MIT y sin scripts de instalación;
- depende de `zod ^4.3.6`, que admite la 4.6.6 del repositorio;
- tiene `--verify`, `--exclude-pattern` y `--url`;
- carga `.env` con dotenv, por eso se invoca siempre con `--url` explícita (§5.6).

La instalación real con las políticas de pnpm (antigüedad, `trustPolicy`, `strictDepBuilds`) se comprueba al iniciar. Si falla, se presenta la evidencia antes de proponer un reemplazo.

## 5. Diseño propuesto

### 5.1 Entorno local, compatible con Docker y Colima

- `compose.yaml` funciona con cualquier motor compatible con la API de Docker y `docker compose`, sin funciones exclusivas de un producto.
  - Docker Desktop ya está instalado. Sus condiciones de licencia para uso comercial las evalúa el propietario.
  - Colima es software libre (MIT) y se instalaría con Homebrew.
- Servicio `postgres`:
  - imagen fijada por digest;
  - puerto `127.0.0.1:55432:5432`, solo loopback;
  - volumen con nombre;
  - `healthcheck` con `pg_isready`;
  - `cluster_name=sistema_chatbot_local` como marca verificable (§5.7);
  - un script de inicialización versionado que crea los roles de §5.7 la primera vez que se crea el volumen.
- La CI usa el mismo `compose.yaml` en el runner, con la misma marca y los mismos roles.
- La contraseña del superusuario del contenedor está solo en `.env`, que no se versiona. Las pruebas y la aplicación no la usan.
- Scripts:
  - `db:up` (`docker compose up -d --wait`);
  - `db:down` detiene el contenedor sin borrar el volumen;
  - ningún script ejecuta `down -v` ni `docker volume rm`.

### 5.2 Ejecutor de migraciones: comparación

Requisitos de ADR-010 que se conservan:
- archivos SQL planos revisados en PR;
- solo hacia adelante;
- un ejecutor que registra orden y checksum;
- elección documentada con motivo;
- nunca `db push`.

Evidencia: código publicado de cada paquete (descargado y leído, sin ejecutarlo) y metadatos y README del registro de npm, consultados el 19/10/2026.

| Opción | Qué aporta (verificado) | Qué falta y cuánto código propio | Costo |
|---|---|---|---|
| **A. Ejecutor propio** sobre `pg` | — | Todo: lectura de archivos, orden, lock, transacción, registro y checksum. Unas 150 líneas con sus pruebas | Mantener y probar lock, orden y transacciones propios |
| **B. Migrator de Kysely 0.29.6 + verificación de checksums** | En PostgreSQL toma `pg_advisory_lock` de sesión con `lock_timeout` de 1 hora. Ejecuta todas las migraciones pendientes en **una sola transacción**. Falla si falta una migración ejecutada o si una nueva queda antes de la última aplicada (`allowUnorderedMigrations` en `false` por defecto). Registra `kysely_migration(name, timestamp)` | Sin checksum (ningún uso de hash en `dist/migration`). El proveedor de archivos importa módulos `.js`/`.ts`, no `.sql`. Hace falta un proveedor que lea `.sql` y una capa de checksum: unas 60 líneas | Depende de la API del Migrator en una 0.x; tres tablas de control (`kysely_migration`, `kysely_migration_lock` y la de checksums) |
| **C. node-pg-migrate 9.0.0 + verificación de checksums** | Archivos `.sql` con marcas `-- Up Migration` / `-- Down Migration`. Lock configurable (`pg_advisory_lock` o `pg_try_advisory_lock`) y opción `singleTransaction`. Registra `pgmigrations(id, name, run_on)` | Sin checksum (ningún uso de hash en `dist`). La capa de checksum queda fuera de la transacción de la herramienta, salvo con su API programática | Dependencia nueva con `glob`, `jiti` y `yargs` |
| D. Herramientas con verificación de hash incorporada | `postgres-migrations` documenta hash checks en su README; su última versión publicada es la 5.3.0, de 07/2021. `graphile-migrate` tiene como estable la 1.4.1, de 12/2022, y la 2.0 en release candidate (rc.6, 14/10/2026) | No se evaluó en detalle el modelo de `graphile-migrate`: usa `current.sql` y base sombra, distinto de archivos numerados. Usar una RC o una versión de 2021 choca con la política de versiones mantenidas | — |

No se evaluaron herramientas fuera de Node (por ejemplo Flyway, Atlas o Sqitch): agregarían otro runtime al proyecto.

**Recomendación: B.**
- ADR-010 la nombra como primera candidata.
- Kysely ya es una dependencia del proyecto y publicó versiones el 17/10/2026.
- Resuelve lock, orden y atomicidad.
- El código propio se reduce al proveedor y al checksum.

Si al implementar el Migrator no ejecuta correctamente archivos con varias sentencias, se presenta la evidencia y se vuelve a la opción A. Se registra en un addendum de ADR-010.

Diseño de B:
- Archivos `packages/db/migrations/NNNN_nombre.sql`. El proveedor solo define `up`: no hay `down`, y la CLI no expone bajar migraciones.
- `schema_migration_checksums(name, sha256)`: cada `up` ejecuta el SQL e inserta su checksum en la misma transacción del Migrator.
- Antes de migrar, se comparan los checksums guardados con los archivos. Se detiene sin cambios si:
  - un archivo aplicado cambió o falta;
  - hay una migración aplicada sin checksum;
  - un nombre está repetido.
- La CLI (`db:migrate`) rechaza `APP_ENV=production`: P1 no habilita producción.

### 5.3 Convenciones del esquema

- Claves `uuid DEFAULT uuidv7()`, `timestamptz` en UTC y columnas `snake_case`. En TypeScript se exponen en camelCase con `CamelCasePlugin`.
- Estados y códigos como `text` con `CHECK` y las listas de docs/04, no como `ENUM`: así agregar valores es más simple con expand/contract.
- Claves foráneas `ON DELETE RESTRICT`. Las compuestas (`id`, `submission_id`) impiden referencias cruzadas entre trámites.
- Los triggers rechazan con SQLSTATE de clase 23 y un nombre de restricción estable, para que P2 los pueda traducir.
- `CHECK` de tamaño en JSONB. Valores iniciales propuestos:
  - 4 MiB para definiciones y borradores (una definición en los límites de `FLOW_LIMITS` ocupa 2,3 MB como texto);
  - 64 KiB para `options_snapshot`.

  Se ajustan con el límite HTTP de P4.

### 5.4 Tablas de las migraciones iniciales

| Migración | Tablas |
|---|---|
| `0001_base` | `organizations`, `companies`, `employees`, `employee_company_scopes`, `channels` (número empresarial), `channel_identities` |
| `0002_versions` | `flows`, `flow_drafts`, `flow_versions`, `rule_set_versions`, `document_catalog_versions` |
| `0003_submissions` | `conversations`, `submissions`, `submission_rule_set_versions`, `prompts`, `documents` (candidatos), `document_confirmations` |
| `0004_effects` | `message_events`, `deliveries`, `outbox_actions` (estructura mínima, §5.5) |

Columnas: las de docs/04 para estas tablas. Las tablas restantes llegan con la etapa que las usa (§6). `jobs` no se crea en P1-T3 (§5.5).

### 5.5 `outbox_actions` y `jobs`: qué está decidido y qué depende de P2

ADR-002 deja para el inicio de P2 la elección entre una cola propia y una biblioteca. Una biblioteca puede aportar su propia tabla, sus estados y su forma de reclamar trabajos. Por eso P1-T3 solo fija lo que no depende de esa elección.

| Elemento | Decidido (fuente) | En P1-T3 |
|---|---|---|
| `outbox_actions.logical_key` única | Acción lógica única (ADR-002, docs/04) | Sí |
| Trámite y generación de la acción, fijados al crear | Ningún trabajo se reasigna (ADR-014 §12, T51) | Sí, con FK compuesta `(submission_id, generation)` y trigger que impide cambiarlos |
| `CANCELLED` terminal en la outbox; los ejecutores nunca reclaman acciones canceladas | docs/04, ADR-014, T49 | Estado terminal sí; la condición de reclamo, en P2 |
| Estados de la outbox (`PENDING`, `CLAIMED`, `DONE`, `CANCELLED`) | docs/04 | `CHECK` con esa lista. Los datos y la mecánica del reclamo, en P2 |
| Formato del payload | No decidido | P2 |
| Tabla `jobs`: estados, lease, `fencing_token`, intentos, `run_after`, prioridad, clave de serialización e índices de reclamo | Semántica en ADR-002; implementación sin elegir | **P2.** No se crea en P1-T3 |
| Invariantes que P2 debe garantizar con cualquier cola | Escrituras condicionadas por `fencingToken` (ADR-002, T09); trabajos que conservan trámite y generación (T51); acciones canceladas nunca reclamadas (T49) | P2, con el addendum de ADR-002 |

### 5.6 Invariantes, mecanismo y prueba

**Identidades (contrastado con ADR-011).** Precisiones:
- Un empleado puede tener varias identidades: teléfono y BSUID, o varios números. No hay unicidad por `employee_id`.
- La identidad canónica es (`provider`, `kind`, `scope_type`, `scope_id`, `normalized_value`). Puede haber como máximo una fila `ACTIVE` por identidad canónica. Por lo tanto, no puede estar activa en empleados distintos, ni duplicada en el mismo. Coincide con ADR-011, "Unicidad" e invariante "Una identidad activa pertenece a un solo empleado".
- Las cinco columnas son `NOT NULL`. Un índice único trata los `NULL` como distintos, así que un ámbito nulo permitiría eludirlo.
- Los `CHECK` coinciden con `contracts` y con `examples/directorio_demo.json`:
  - `provider = 'WHATSAPP'`;
  - `PHONE_E164` ⇒ `scope_type = 'E164'`, `scope_id = 'global'` y valor E.164;
  - `WHATSAPP_BSUID` ⇒ `scope_type = 'BUSINESS'`. El formato del BSUID se verifica en P6.
- El mismo valor con otro ámbito es otra identidad: los valores no se comparan entre ámbitos (ADR-011).
- Las identidades `PENDING_VERIFICATION` y `REVOKED` no participan del índice. El conflicto aparece al activar, y ADR-011 prohíbe revincular automáticamente.
- Se conserva el trámite activo único por empleado y número, sin importar la identidad usada (ADR-011).

| # | Invariante | Mecanismo en la base | Prueba |
|---|---|---|---|
| 1 | Identidad canónica activa en un solo empleado; un empleado con varias identidades (ADR-011) | Índice único parcial `(provider, kind, scope_type, scope_id, normalized_value) WHERE status = 'ACTIVE'`, columnas `NOT NULL` y `CHECK` por tipo | Acepta un empleado con teléfono y BSUID. Rechaza la misma identidad activa en otro empleado. Acepta el mismo valor en otro ámbito y una identidad revocada más una activa nueva. Rechaza un ámbito nulo. Con dos activaciones concurrentes en empleados distintos, confirma solo una (T29/T30, parte de base) |
| 2 | Un trámite activo por empleado y número (ADR-011) | Índice único parcial `submissions(employee_id, channel_id)` sobre los 8 estados activos; `employee_id NOT NULL` | Rechaza el segundo activo aunque llegue por otra identidad. Con dos transacciones concurrentes, confirma exactamente una. Acepta un trámite nuevo después de uno terminal (T29) |
| 3 | Generación única (ADR-014 §12) | `UNIQUE (employee_id, channel_id, generation)`, `CHECK (generation >= 1)` | Rechaza una generación repetida (T51) |
| 4 | Datos fijados del trámite (ADR-004, ADR-012) | Trigger: no cambian empleado, número, generación, tipo, original corregido ni versiones fijadas. `applied_classification` se escribe una vez. `candidate_count` no decrece | Rechaza cada cambio (T32 y T48, parte de base) |
| 5 | Cupo y secuencia de candidatos (ADR-014 §2) | `CHECK (candidate_count BETWEEN 0 AND 3)`. En candidatos: `CHECK (candidate_seq BETWEEN 1 AND 3)`, `UNIQUE (submission_id, candidate_seq)`, `UNIQUE (submission_id, received_event_id)`, y un trigger que exige `candidate_seq <= candidate_count` | Rechaza un cuarto candidato aunque se inserte directamente. Con `candidate_count = 2`, dos reservas concurrentes con el `UPDATE` condicional de referencia dan un solo `candidate_seq = 3`. Reprocesar el evento no reserva otro lugar. Rechazar o purgar no devuelve cupo (T45, T48) |
| 6 | Un seleccionado por paso documental y del mismo trámite | Índice único parcial `(submission_id, node_id, execution_instance_id) WHERE selection = 'SELECTED'`. FK compuesta de `submissions.selected_document_id` | Rechaza un segundo `SELECTED` y la selección de un documento de otro trámite (T45) |
| 7 | Una confirmación por revisión, solo inserción (ADR-014) | `UNIQUE (submission_id, context_revision)`, FK compuesta al documento del trámite y trigger contra `UPDATE` y `DELETE` | Rechaza la confirmación repetida, la de un documento de otro trámite y cualquier modificación (T37) |
| 8 | Una entrega por confirmación, con identidad derivada (ADR-014) | `UNIQUE (confirmation_id)`, FK compuesta `(confirmation_id, submission_id)` y `action_key` como columna generada desde `confirmation_id`, única | Rechaza la segunda entrega de una confirmación. Una confirmación nueva después de cancelar da otra `action_key`. La clave no se puede escribir (T37, T49) |
| 9 | Una entrega cancelada no vuelve a un estado activo (docs/04) | `CANCELLED` solo desde `PENDING` y terminal en `deliveries`; terminal en `outbox_actions` | Rechaza reactivar algo cancelado (T49, parte de base) |
| 10 | Evento externo único y vinculación escrita una vez (ADR-014 §12) | `UNIQUE (channel_id, external_event_key)`, `CHECK` de coherencia de los campos de vinculación, FK compuesta `(bound_submission_id, bound_generation)` y trigger de escritura única | Rechaza el evento repetido, la reescritura de la vinculación y una generación que no corresponde al trámite (T04 y T51, parte de base) |
| 11 | Acción lógica única, sin reasignación (§5.5) | `UNIQUE (logical_key)`; trámite y generación fijados | Rechaza la clave repetida y la reasignación (T51, parte de base) |
| 12 | Versiones publicadas inmutables (ADR-004) | Unicidad por (id, versión) y triggers contra `UPDATE`, `DELETE` y `TRUNCATE` | Rechaza modificar o borrar una versión (T03, parte de base) |
| 13 | Un prompt `ACTIVE` por trámite (docs/04) | Índice único parcial | Rechaza el segundo activo (T46, parte de base) |
| 14 | Corrección vinculada (ADR-014) | `CHECK` (`kind = 'CORRECTION'` ⇔ hay original), FK compuesta `(corrects_submission_id, employee_id, channel_id)` y trigger de inserción que exige el original `COMPLETED` | Rechaza una corrección sin original, de otro empleado o sobre un original no completado (T43, parte de base) |
| 15 | Sin borrado físico de lo referenciado (docs/04) | FK `RESTRICT` y trigger contra `DELETE` en entregas y confirmaciones | Rechaza borrar un empleado con trámites o una entrega |

### 5.7 Protecciones

Este plan solo describe los mecanismos; no están implementados.

**Dos ejecutores al mismo tiempo.**
- El Migrator toma un `pg_advisory_lock` de sesión antes de leer el estado. Un segundo ejecutor espera hasta que el primero termina y entonces no encuentra pendientes.
- La verificación de checksums no escribe nada: solo lee.
- Prueba: dos ejecuciones simultáneas sobre una base vacía terminan bien, y cada migración y su checksum quedan registrados una sola vez.

**Migración aplicada a medias.**
- PostgreSQL admite DDL transaccional. El Migrator ejecuta todas las migraciones pendientes y sus checksums en una sola transacción: si una falla, no queda nada de esa ejecución.
- Antes de ejecutar, el proveedor rechaza archivos con:
  - control de transacciones: `BEGIN`, `START TRANSACTION`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`;
  - sentencias que no pueden ir dentro de una transacción: `CONCURRENTLY`, `CREATE DATABASE`, `DROP DATABASE`, `VACUUM`, `ALTER SYSTEM`.

  Un `COMMIT` dentro de un archivo cerraría la transacción del Migrator antes de tiempo. Si una migración futura necesita alguna de esas sentencias, requiere su propio addendum.
- Prueba: una migración que falla en su segunda sentencia no deja objetos ni registros, ni de ella ni de las anteriores de esa ejecución.

**Conexiones accidentales a Postgres.app u otras bases.**
- Cada uso exige una URL explícita: `DATABASE_URL` para desarrollo y `TEST_DATABASE_URL` para pruebas.
- El código pasa todos los parámetros de conexión de forma explícita. Así `pg` no completa valores con `PGHOST`, `PGPORT`, `PGUSER` ni `PGDATABASE`, que podrían apuntar a `localhost:5432`.
- Antes de conectar se exige:
  - host loopback (`127.0.0.1`, `::1` o `localhost`);
  - puerto `55432`. Postgres.app usa el 5432;
  - usuario y base con prefijo del proyecto (`sistema_chatbot_dev`, `sistema_chatbot_test`);
  - `APP_ENV` distinto de `production`;
  - en pruebas, una URL distinta de `DATABASE_URL`.
- Después de conectar y antes de cualquier escritura, se exige `current_setting('cluster_name') = 'sistema_chatbot_local'`. La marca la fija el contenedor. Postgres.app u otro servidor no la tienen, y la conexión se cierra con un error explícito.
- kysely-codegen se invoca siempre con `--url` hacia la base temporal recién migrada, nunca con el `.env` de desarrollo.

**Borrado de bases ajenas durante las pruebas.**
- Las pruebas se conectan con el rol `sistema_chatbot_test`:
  - `LOGIN CREATEDB`, sin superusuario ni `CREATEROLE`;
  - PostgreSQL solo deja borrar una base a su dueño o a un superusuario, así que ese rol no puede borrar la base de desarrollo ni ninguna que no haya creado.
- El harness genera un `runId` aleatorio y crea bases `sc_test_<runId>_<n>`. Guarda en memoria los nombres que creó y solo borra esos, por nombre exacto. Nunca borra por patrón a partir del catálogo.
- Si una ejecución se interrumpe, un script manual lista las bases `sc_test_` de ese rol y pide una confirmación explícita antes de borrarlas.
- No se borran volúmenes de Docker (§5.1).
- Sin `TEST_DATABASE_URL`, `test:db` falla con un mensaje explícito: nunca omite pruebas en silencio.

### 5.8 Tipos generados y divergencia

- `kysely-codegen --dialect postgres --camel-case --url <base temporal migrada>` genera `packages/db/src/generated/database.ts`, que se versiona. Excluye las tablas de control de migraciones.
- `db:types:verify` ejecuta lo mismo con `--verify` y falla si el archivo versionado difiere.

### 5.9 Scripts y CI

- `pnpm run check` sigue sin requerir base. Incluye las pruebas puras de `db`: proveedor, sentencias prohibidas, checksum y guardas.
- `pnpm run check:db`: migra una base vacía, verifica los tipos y ejecuta las pruebas de base.
- CI:
  - el job actual no cambia;
  - un job nuevo levanta `compose.yaml` en el runner y ejecuta `check:db`;
  - acciones fijadas por SHA.

  Al iniciar se verifica que el runner tenga `docker compose` disponible.
- Límites entre paquetes:
  - `@sistema-chatbot/db` sin dependencias internas en P1-T3;
  - puede usar APIs de Node;
  - se actualizan `scripts/check-workspace-boundaries.mjs`, ESLint y ADR-001.

## 6. Fuera de alcance

- **Repositorios y transacciones del host (P2):**
  - reserva de candidato;
  - creación de la entrega con sus comprobaciones (revisión vigente, `SELECTED`, `APPROVED`, objeto presente, sha256);
  - cola y reclamos;
  - escrituras condicionadas por `fencingToken` y cancelación atómica.

  Las pruebas de P1-T3 usan sentencias SQL de referencia, que no son una API.
- **Tablas de otras etapas:**
  - `jobs` (P2);
  - usuarios y sesiones (P1-T4);
  - contactos, grupos, roles y auditoría (P4);
  - respuestas, mensajes salientes, intentos y observaciones (P2/P5);
  - simulaciones (P3).
- Seed (P1-T6).
- Privilegios separados de migración y de aplicación en producción, backups, PITR y producción (P7).
- Postgres.app y cualquier base externa.

## 7. Cómo se verifica

1. Reverificar versiones y digest (al menos 7 días) e instalar con las políticas de pnpm. Registrarlo en ADR-009 y ADR-010.
2. **Pruebas de restricciones:** cada invariante de §5.6 con al menos un caso aceptado y uno rechazado. Se comprueban el SQLSTATE y el nombre de la restricción.
3. **Pruebas de concurrencia** con dos conexiones y transacciones explícitas:
   - trámite activo;
   - activación de identidad;
   - reserva del tercer candidato;
   - dos ejecutores de migraciones.

   El bloqueo se detecta consultando `pg_locks`, sin esperas fijas.
4. **Pruebas de las protecciones** de §5.7:
   - URL, puerto, prefijos y marca del cluster;
   - el rol de prueba no puede borrar una base ajena;
   - archivo con sentencias prohibidas;
   - migración fallida sin efectos;
   - checksum alterado.
5. **Local:**
   - `pnpm install --frozen-lockfile` y `pnpm run check`;
   - `pnpm db:up` y `pnpm run check:db`.
6. Checkout limpio con store vacío y volumen nuevo.
7. CI del SHA final, en ambos jobs.
8. Evidencia en `PROJECT_STATUS.md` y `docs/reviews/PR-P1-T3-db.md`. Las limitaciones se declaran: restricciones de base no son pruebas del host.

## 8. Archivos previstos

- `packages/db/`:
  - `package.json` y `tsconfig*.json`;
  - `vitest.config.ts`, con configuración separada para las pruebas de base;
  - `README.md`;
  - `src/` con el proveedor, la verificación de checksums, la CLI, la conexión, las guardas y `generated/database.ts`;
  - `migrations/0001…0004`;
  - `test/`.
- Raíz: `compose.yaml`, el script de inicialización de roles, `.env.example`, `package.json` (scripts), `pnpm-lock.yaml`, `eslint.config.js`, `scripts/check-workspace-boundaries.mjs` y `.github/workflows/ci.yml`.
- Documentos:
  - ADR-001, ADR-002 (nota sobre `jobs` en P2), ADR-009 y ADR-010 (addenda);
  - docs/04, docs/09, docs/10 y docs/15 §9, que registra la desviación de `jobs`;
  - `PROJECT_STATUS.md` y `docs/reviews/PR-P1-T3-db.md`.

## 9. Decisiones

| # | Tema | Estado |
|---|---|---|
| 1 | Puerto local | Conforme: `127.0.0.1:55432` |
| 2 | Checks | Conforme: `check` sin base + `check:db`, ambos en CI |
| 3 | Motor de contenedores | Criterio fijado: compatible con Docker y con Colima. El propietario elige, instala y acepta términos |
| 4 | Ejecutor de migraciones | **A confirmar:** recomendación B, Migrator de Kysely + verificación de checksums (§5.2) |
| 5 | `outbox_actions` y `jobs` | **A confirmar:** estructura mínima de la outbox en P1-T3 y `jobs` en P2, con su desviación registrada (§5.5) |
| 6 | Generador de tipos | Criterio fijado: kysely-codegen 0.20.0 con compatibilidad comprobada; reemplazo solo con evidencia |

## 10. Riesgos

- **Kysely 0.x:** una minor puede cambiar la API del Migrator; versión exacta y pruebas del proveedor.
- **Varias sentencias por archivo:** la ejecución de archivos `.sql` con varias sentencias a través de Kysely se comprueba primero; si falla, se vuelve a la opción A con evidencia.
- **kysely-codegen:** sin releases desde 02/2026. Se mantiene mientras su compatibilidad declarada y la instalación lo permitan.
- **`uuidv7()` exige PostgreSQL 18 o posterior:** el hosting de producción (P7) debe ofrecerlo.
- **Triggers:** agregan lógica en la base. Cada uno tiene su prueba y su documentación.

## 11. Implementación (20/10/2026)

Rama `p1/t3-db`, creada desde `p1/t2-cierre` (`41c0234`), que todavía no estaba fusionada. Evidencia en `PROJECT_STATUS.md` y `docs/reviews/PR-P1-T3-db.md`.

- **Versiones verificadas al comenzar:** las candidatas de §4 siguen vigentes y se instalaron con las políticas de pnpm sin excepciones. Detalle en ADR-009.
- **Ejecutor:**
  - Kysely 0.29 exporta el Migrator desde `kysely/migration`.
  - La verificación definitiva de checksums corre en `acquireMigrationLock`, dentro de un adaptador derivado de `PostgresAdapter` y con el bloqueo de Kysely ya tomado. Una prueba altera un checksum mientras el segundo ejecutor espera el bloqueo y comprueba que igual lo detecta.
- **Validador de SQL:** analizador léxico. Para los cuerpos `BEGIN ATOMIC … END` usa la regla de psql, restringida a `BEGIN` seguido de `ATOMIC`: así, una función llamada `begin` no oculta un `COMMIT` posterior.
- **Diferencias con §5:**
  - `message_events` está en `0003_submissions`, porque los candidatos la referencian. `0004_effects` tiene entregas y outbox.
  - Borrar algo referenciado con `ON DELETE RESTRICT` responde `23001`, no `23503`.
  - La verificación de tipos usa la API programática de kysely-codegen con una instancia de Kysely que pasó las guardas, y compara la salida con el archivo versionado, que es lo mismo que `--verify`. Así no se pasa una URL ni se lee `.env`.
  - Todos los pools registran un manejador de `error`. La CI #11 mostró que, si no, `DROP DATABASE … WITH (FORCE)` puede terminar el proceso al cortar un cliente que se estaba cerrando.
  - **Corrección de la revisión (21/10/2026):** el mecanismo de la invariante 5 no impedía borrar candidatos. Borrar uno liberaba su `candidate_seq` y otro archivo podía ocuparlo, aunque `candidate_count` no bajara. `0005_candidates_no_delete` rechaza `DELETE` y `TRUNCATE` en `documents`; la purga sigue siendo estado y `object_deleted_at`. Tiene regresiones de borrado, purga y `TRUNCATE`.
- **Verificaciones pendientes:** las pruebas locales contra el contenedor esperan la confirmación de Docker Desktop. Las mismas pruebas corren en el job `db` de la CI.
