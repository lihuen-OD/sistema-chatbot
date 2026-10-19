# Plan de P1-T3 — `packages/db`

- Fecha: 19/10/2026
- Estado: **propuesto, pendiente de aprobación del propietario.** Este documento no autoriza implementar.
- Fuentes:
  - `docs/15_PLAN_CONSOLIDADO_P0.md` §5 y §9;
  - `docs/04_MODELO_DATOS.md`;
  - `docs/09_PRUEBAS_Y_ACEPTACION.md` (gate P1);
  - `docs/10_ENTORNOS_Y_OPERACION.md`;
  - ADR-001, ADR-002, ADR-004, ADR-009, ADR-010, ADR-011, ADR-012 y ADR-014.

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

## 2. Herramientas instaladas (relevadas el 19/10/2026, sin modificar nada)

| Herramienta | Estado | Consecuencia para P1-T3 |
|---|---|---|
| macOS 27.0.1, arm64 | — | Imágenes `linux/arm64` |
| Node.js global | 24.18.0, rechazada por `engines` (`>=24.21.0 <25`) | Hasta que se actualice, se trabaja con el runtime aislado 24.21.0 de la sesión |
| pnpm | No instalado globalmente; se usa 12.12.1 vía corepack | Sin cambios |
| Docker Desktop | 29.7.2 y Compose v5.5.0 instalados; **daemon detenido** | Hay que abrirlo (ver §9) |
| Postgres.app | 2.9.5 con PostgreSQL 18.4, **en ejecución en `localhost:5432`**; binarios fuera del PATH | Es un cluster del usuario. No se usa ni se modifica. El puerto 5432 está ocupado. La versión vigente de PostgreSQL 18 es 18.6 |
| Homebrew | 7.0.9; sin fórmulas de PostgreSQL ni libpq | No hace falta `psql` local: las pruebas usan `pg`, y la inspección manual se hace con `docker compose exec` |
| `gh` | No instalado | Sin impacto |

## 3. Qué necesita el propietario

1. Autorizar P1-T3.
2. Abrir Docker Desktop, o elegir una alternativa (§9, decisión 1).
3. Aceptar o cambiar las recomendaciones de §9.

No hay que contratar servicios ni crear cuentas. Se descargan paquetes de npm y la imagen oficial `postgres` de Docker Hub.

## 4. Versiones candidatas

Política del repositorio: publicadas hace al menos 7 días. Se vuelven a verificar al iniciar.

| Componente | Candidata | Publicada | Nota |
|---|---|---|---|
| PostgreSQL | 18.6, imagen `postgres:18.6-trixie` fijada por digest | 13/08/2026 (release); imagen actualizada el 07/10/2026 | `uuidv7()` nativo desde la 18 |
| kysely | 0.29.6 | 16/09/2026 | 0.29.7 tiene 2 días. Requiere Node `>=22`. En 0.x, una minor puede romper: versión exacta |
| pg | 8.23.1 | 30/09/2026 | Driver de ADR-010 |
| @types/pg | 8.23.1 | 17/08/2026 | — |
| kysely-codegen (solo desarrollo) | 0.20.0 | 16/02/2026 | Tiene `--verify` para el control de divergencia. Lleva 8 meses sin releases; la alternativa es kanel 4.0.4 + kanel-kysely 4.0.0 |

Descartadas como ejecutor de migraciones:
- `postgres-migrations`: última versión de 2021;
- `graphile-migrate`: última versión estable de 2022;
- `node-pg-migrate` 9.0.0: no documenta checksum, que exige ADR-010.

## 5. Diseño propuesto

### 5.1 Entorno local

- `compose.yaml` con un servicio `postgres`:
  - imagen fijada por digest;
  - puerto `127.0.0.1:55432:5432`, solo loopback y distinto del 5432 de Postgres.app;
  - volumen con nombre;
  - `healthcheck` con `pg_isready`.
- La contraseña local sale de `.env`, que no se versiona. `.env.example` se actualiza con el puerto nuevo y `TEST_DATABASE_URL`.
- Scripts:
  - `db:up` (`docker compose up -d --wait`);
  - `db:down`, que detiene el contenedor sin borrar el volumen;
  - ningún script borra datos de desarrollo.

### 5.2 Ejecutor de migraciones (recomendación: propio y pequeño)

- Archivos `packages/db/migrations/NNNN_nombre.sql`, en SQL plano y solo hacia adelante. No hay `down`.
- Tabla `schema_migrations(version, name, sha256, applied_at)`.
- `pg_advisory_lock` durante toda la ejecución: dos ejecutores concurrentes se serializan.
- Antes de aplicar, compara lo aplicado con los archivos. Se detiene sin cambios ante:
  - un archivo aplicado que falta o cuyo checksum cambió;
  - una versión aplicada desconocida;
  - una migración nueva con versión menor que la última aplicada;
  - números repetidos.
- Cada migración se aplica en su transacción, junto con su registro. Si falla, no queda nada de ella.
- La CLI (`db:migrate`) rechaza `APP_ENV=production`: P1 no habilita producción.

Motivo: el Migrator de Kysely y `node-pg-migrate` no registran checksum, y las herramientas con checksum están sin mantenimiento. Costo: unas 150 líneas propias con sus pruebas. Se registra en un addendum de ADR-010.

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
| `0004_effects` | `message_events`, `deliveries`, `outbox_actions`, `jobs` |

Columnas: las de docs/04 para estas tablas. Las tablas restantes llegan con la etapa que las usa (§6).

### 5.5 Invariantes, mecanismo y prueba

| # | Invariante | Mecanismo en la base | Prueba |
|---|---|---|---|
| 1 | Una identidad de canal activa pertenece a un solo empleado (ADR-011) | Índice único parcial `(provider, kind, scope_type, scope_id, normalized_value) WHERE status = 'ACTIVE'` | Rechaza la misma identidad activa en otro empleado. Permite una revocada más una activa nueva y el mismo valor en otro ámbito (T29/T30, parte de base) |
| 2 | Un trámite activo por empleado y número (ADR-011) | Índice único parcial `submissions(employee_id, channel_id)` sobre los 8 estados activos; `employee_id NOT NULL` | Rechaza el segundo activo aunque llegue por otra identidad. Con dos transacciones concurrentes, confirma exactamente una (T29) |
| 3 | Generación única (ADR-014 §12) | `UNIQUE (employee_id, channel_id, generation)`, `CHECK (generation >= 1)` | Rechaza una generación repetida (T51) |
| 4 | Datos fijados del trámite (ADR-004, ADR-012) | Trigger: no cambian empleado, número, generación, tipo, original corregido ni versiones fijadas. `applied_classification` se escribe una vez. `candidate_count` no decrece | Rechaza cada cambio (T32 y T48, parte de base) |
| 5 | Cupo y secuencia de candidatos (ADR-014 §2) | `CHECK (candidate_count BETWEEN 0 AND 3)`. En candidatos: `CHECK (candidate_seq BETWEEN 1 AND 3)`, `UNIQUE (submission_id, candidate_seq)`, `UNIQUE (submission_id, received_event_id)`, y un trigger que exige `candidate_seq <= candidate_count` | Rechaza un cuarto candidato aunque se inserte directamente. Con `candidate_count = 2`, dos reservas concurrentes con el `UPDATE` condicional de referencia dan un solo `candidate_seq = 3`. Reprocesar el evento no reserva otro lugar. Rechazar o purgar no devuelve cupo (T45, T48) |
| 6 | Un seleccionado por paso documental y del mismo trámite | Índice único parcial `(submission_id, node_id, execution_instance_id) WHERE selection = 'SELECTED'`. FK compuesta de `submissions.selected_document_id` | Rechaza un segundo `SELECTED` y la selección de un documento de otro trámite (T45) |
| 7 | Una confirmación por revisión, solo inserción (ADR-014) | `UNIQUE (submission_id, context_revision)`, FK compuesta al documento del trámite y trigger contra `UPDATE` y `DELETE` | Rechaza la confirmación repetida, la de un documento de otro trámite y cualquier modificación (T37) |
| 8 | Una entrega por confirmación, con identidad derivada (ADR-014) | `UNIQUE (confirmation_id)`, FK compuesta `(confirmation_id, submission_id)` y `action_key` como columna generada desde `confirmation_id`, única | Rechaza la segunda entrega de una confirmación. Una confirmación nueva después de cancelar da otra `action_key`. La clave no se puede escribir (T37, T49) |
| 9 | Una entrega cancelada nunca se despacha (docs/04) | Guardas de estado: en `deliveries`, `CANCELLED` solo desde `PENDING` y terminal; `CANCELLED` terminal en `outbox_actions` y `jobs` | Rechaza reactivar algo cancelado (T49, parte de base) |
| 10 | Evento externo único y vinculación escrita una vez (ADR-014 §12) | `UNIQUE (channel_id, external_event_key)`, `CHECK` de coherencia de los campos de vinculación, FK compuesta `(bound_submission_id, bound_generation)` y trigger de escritura única | Rechaza el evento repetido, la reescritura de la vinculación y una generación que no corresponde al trámite (T04 y T51, parte de base) |
| 11 | Acción lógica única; trabajos sin reasignación; fencing monótono (ADR-002) | `UNIQUE (logical_key)`. En `jobs`: FK compuesta `(submission_id, generation)`, y un trigger que impide cambiarlos y que `fencing_token` decrezca | Rechaza la clave repetida, la reasignación y un token menor (T09 y T51, parte de base) |
| 12 | Versiones publicadas inmutables (ADR-004) | Unicidad por (id, versión) y triggers contra `UPDATE`, `DELETE` y `TRUNCATE` | Rechaza modificar o borrar una versión (T03, parte de base) |
| 13 | Un prompt `ACTIVE` por trámite (docs/04) | Índice único parcial | Rechaza el segundo activo (T46, parte de base) |
| 14 | Corrección vinculada (ADR-014) | `CHECK` (`kind = 'CORRECTION'` ⇔ hay original), FK compuesta `(corrects_submission_id, employee_id, channel_id)` y trigger de inserción que exige el original `COMPLETED` | Rechaza una corrección sin original, de otro empleado o sobre un original no completado (T43, parte de base) |
| 15 | Sin borrado físico de lo referenciado (docs/04) | FK `RESTRICT` y trigger contra `DELETE` en entregas y confirmaciones | Rechaza borrar un empleado con trámites o una entrega |

### 5.6 Tipos generados y divergencia

- `kysely-codegen` contra una base temporal recién migrada genera `packages/db/src/generated/database.ts`, que se versiona. Excluye `schema_migrations`.
- `db:types:verify` ejecuta lo mismo con `--verify` y falla si el archivo versionado difiere.

### 5.7 Aislamiento de las pruebas

- `TEST_DATABASE_URL` apunta al cluster de prueba: el contenedor local o el servicio de la CI. El rol de prueba tiene `CREATEDB`.
- El `globalSetup` de Vitest crea `sc_test_<runId>_template` y la migra. Cada archivo de pruebas crea su base desde la plantilla y la borra al terminar.
- La limpieza borra solo bases con ese prefijo y ese `runId`.
- Guardas:
  - solo host loopback;
  - rechazo con `APP_ENV=production`;
  - rechazo si coincide con `DATABASE_URL`.
- Sin la variable, `test:db` falla con un mensaje explícito. Las pruebas de base nunca se omiten en silencio.
- Concurrencia con dos conexiones y transacciones explícitas. El bloqueo se detecta consultando `pg_locks`, sin esperas fijas.

### 5.8 Scripts y CI

- `pnpm run check` sigue sin requerir base. Incluye las pruebas puras de `db`: nombres, checksum y guardas.
- `pnpm run check:db`: migra una base vacía, verifica los tipos y ejecuta las pruebas de base.
- CI: el job actual no cambia. Se agrega un job `db` con un servicio `postgres` (misma imagen y digest) que ejecuta `check:db`. Acciones fijadas por SHA, como hoy.
- Límites entre paquetes:
  - `@sistema-chatbot/db` sin dependencias internas en P1-T3;
  - puede usar APIs de Node (`fs`, `crypto`);
  - se actualizan `scripts/check-workspace-boundaries.mjs`, ESLint y ADR-001.

## 6. Fuera de alcance

- **Repositorios y transacciones del host (P2):**
  - reserva de candidato;
  - creación de la entrega con sus comprobaciones (revisión vigente, `SELECTED`, `APPROVED`, objeto presente, sha256);
  - reclamos con `SKIP LOCKED`, escrituras condicionadas por `fencingToken` y cancelación atómica.

  Las pruebas de P1-T3 usan sentencias SQL de referencia, que no son una API.
- **Tablas de otras etapas:**
  - usuarios y sesiones (P1-T4);
  - contactos, grupos, roles y auditoría (P4);
  - respuestas, mensajes salientes, intentos y observaciones (P2/P5);
  - simulaciones (P3).
- Seed (P1-T6).
- Privilegios separados de migración y de aplicación, backups, PITR y producción (P7).
- El Postgres.app del usuario y cualquier base externa.

## 7. Cómo se verifica

1. Reverificar versiones y digest (al menos 7 días) y registrarlas en ADR-009 y ADR-010.
2. Para cada invariante, escribir primero la prueba negativa y verla fallar sin la restricción. Después, agregar la restricción.
3. Mutaciones temporales: quitar un índice o un trigger debe hacer fallar su prueba. Se restaura comprobando con `cmp`.
4. Local:
   - `pnpm install --frozen-lockfile` y `pnpm run check`;
   - `pnpm db:up` y `pnpm run check:db`.
5. Checkout limpio con store vacío y volumen nuevo.
6. CI del SHA final, en ambos jobs.
7. Evidencia en `PROJECT_STATUS.md` y `docs/reviews/PR-P1-T3-db.md`. Las limitaciones se declaran explícitamente: restricciones de base no son pruebas del host ni de concurrencia de aplicación.

## 8. Archivos previstos

- `packages/db/`:
  - `package.json` y `tsconfig*.json`;
  - `vitest.config.ts`, con configuración separada para las pruebas de base;
  - `README.md`;
  - `src/` con el ejecutor, la CLI, la conexión, las guardas y `generated/database.ts`;
  - `migrations/0001…0004`;
  - `test/`.
- Raíz: `compose.yaml`, `.env.example`, `package.json` (scripts), `pnpm-lock.yaml`, `eslint.config.js`, `scripts/check-workspace-boundaries.mjs` y `.github/workflows/ci.yml`.
- Documentos:
  - ADR-001, ADR-009 y ADR-010 (addendum);
  - docs/04 (decisiones físicas), docs/09 (estado), docs/10 (entorno local) y docs/15 §9;
  - `PROJECT_STATUS.md` y `docs/reviews/PR-P1-T3-db.md`.

## 9. Decisiones del propietario

| # | Decisión | Recomendación | Alternativa |
|---|---|---|---|
| 1 | Motor de contenedores | Docker Desktop, ya instalado. Según los términos publicados por Docker, es gratuito para organizaciones con menos de 250 empleados y menos de USD 10 millones de facturación anual; si no, requiere suscripción. Verificar | Colima con Homebrew: sin costo y compatible con Compose |
| 2 | Ejecutor de migraciones | Propio, con checksum (§5.2) | Migrator de Kysely leyendo SQL, sin checksum. Exige modificar ADR-010 |
| 3 | Checks | `check` sin base + `check:db` (local con Docker y job de CI) | Un único `check` que exija la base siempre |
| 4 | Puerto local | `127.0.0.1:55432` | Otro puerto libre |
| 5 | `jobs` y `outbox_actions` | Crearlas ahora con la semántica de ADR-002, porque §5 lista sus invariantes. Si P2 adopta una biblioteca de cola, su addendum define la migración | Diferirlas a P2 junto con la decisión de la cola |
| 6 | Generador de tipos | kysely-codegen 0.20.0 | kanel 4.0.4 + kanel-kysely 4.0.0 |

## 10. Riesgos

- **Kysely 0.x:** una minor puede romper; versión exacta y lockfile.
- **kysely-codegen:** sin releases recientes. Si no es compatible con Kysely 0.29, se pasa a kanel.
- **`uuidv7()` exige PostgreSQL 18 o posterior:** el hosting de producción (P7) debe ofrecerlo; si no, se generan los ID en la aplicación.
- **Triggers:** agregan lógica en la base. Cada uno tiene su prueba y su documentación.
- **Uso de recursos de Docker Desktop:** contenedor detenido cuando no se usa (`db:down`).
