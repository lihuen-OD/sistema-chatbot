# @sistema-chatbot/db

Base de datos del proyecto (P1-T3; ADR-010): migraciones SQL, verificación de checksums, guardas de conexión, tipos generados y pruebas de restricciones contra PostgreSQL real aislado. Plan aprobado: `docs/plans/P1-T3-base-de-datos.md`.

No incluye repositorios ni las transacciones del host (reserva de candidato, creación de entregas, cola, fencing): son de P2.

## Entorno local

Requiere un motor compatible con la API de Docker y `docker compose` (Docker Desktop o Colima). El proyecto no instala ni configura el motor.

1. Copiar `.env.example` a `.env` en la raíz y completar `POSTGRES_PASSWORD`, `SISTEMA_CHATBOT_DEV_PASSWORD` y `SISTEMA_CHATBOT_TEST_PASSWORD` con contraseñas locales nuevas. Repetir las de los roles dentro de `DATABASE_URL` y `TEST_DATABASE_URL`.
2. `pnpm db:up` levanta `postgres:18.6-trixie` (fijada por digest) en `127.0.0.1:55432`. El script `docker/postgres/initdb/10-roles.sh` crea, al inicializar el volumen, el rol y la base de desarrollo y el rol de pruebas.
3. `pnpm db:migrate` aplica las migraciones a la base de desarrollo.
4. `pnpm db:down` detiene el contenedor. No borra el volumen.

## Comandos

| Comando (raíz) | Qué hace |
|---|---|
| `pnpm run check` | Incluye las pruebas de este paquete que no necesitan base: validador de SQL, archivos de migración y guardas |
| `pnpm run check:db` | Build, control de divergencia de tipos y pruebas contra PostgreSQL. Requiere `TEST_DATABASE_URL` y el contenedor en ejecución |
| `pnpm db:migrate` | Migra la base de desarrollo (`DATABASE_URL`) |
| `pnpm db:types` | Migra una base temporal vacía y regenera `src/generated/database.ts` |
| `pnpm db:types:verify` | Igual, pero falla si el archivo versionado difiere y muestra la salida esperada |
| `pnpm --filter @sistema-chatbot/db run test:cleanup` | Lista bases temporales que quedaron de una ejecución interrumpida. Para borrar hay que nombrar cada una: `-- --drop <nombre> …` |

Sin `TEST_DATABASE_URL`, las pruebas de base fallan con un error explícito: nunca se omiten en silencio.

## Migraciones

- Archivos `migrations/NNNN_descripcion.sql`, en SQL plano, revisados en PR y solo hacia adelante. Las aplicadas no se editan: se corrigen con una nueva.
- Ejecutor: Migrator de Kysely (`kysely/migration`) con un proveedor que lee los `.sql` y una verificación de checksums propia.
  - Kysely toma un `pg_advisory_lock` de sesión, comprueba orden y faltantes y aplica todas las pendientes en una sola transacción.
  - Cada migración registra su SHA-256 en `schema_migration_checksums` dentro de esa transacción.
  - La verificación definitiva de checksums corre en `acquireMigrationLock`, ya con el bloqueo tomado y antes de que Kysely lea el estado. Detiene la ejecución si una migración aplicada cambió, falta, no tiene checksum o quedó fuera de orden.
- Antes de ejecutar, un analizador léxico separa las sentencias de nivel superior respetando literales, comentarios anidados, cadenas con dólar y cuerpos `BEGIN ATOMIC … END`.
  - Acepta funciones, triggers y bloques `DO` con `BEGIN … END`.
  - Rechaza `BEGIN`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`, `SAVEPOINT`, `RELEASE`, `START TRANSACTION` y `PREPARE TRANSACTION` de nivel superior, y sentencias que no pueden ir dentro de una transacción (`CONCURRENTLY`, `VACUUM`, `CREATE/DROP DATABASE`, `ALTER SYSTEM`).
  - Como defensa adicional, el ejecutor comprueba que la transacción siga abierta después de cada archivo.
- `.gitattributes` fija LF en los `.sql`, porque el checksum se calcula sobre los bytes.

## Protecciones

| Riesgo | Mecanismo |
|---|---|
| Dos ejecutores a la vez | Bloqueo de migración de Kysely; la verificación de checksums corre dentro de él |
| Migración aplicada a medias | Una transacción por ejecución; validador de SQL; comprobación de transacción abierta |
| Conexión a Postgres.app u otra base | URL explícita; host loopback; puerto 55432; rol y base por uso; `APP_ENV` distinto de `production`; marca `cluster_name = sistema_chatbot_local` antes de escribir; todos los parámetros explícitos a `pg` |
| Borrado de una base ajena | Rol de pruebas sin superusuario (PostgreSQL solo deja borrar bases propias); bases `sc_test_<runId>_<n>` y `sc_test_<runId>_template`; cada instancia borra solo los nombres exactos que creó |
| Borrado de datos de desarrollo | Ningún script borra volúmenes |

## Invariantes y pruebas

Cada invariante tiene pruebas de aceptación y de rechazo, con el SQLSTATE y el nombre de la restricción. Los triggers rechazan con `23000` y el nombre de la restricción en el campo `constraint` del error.

| # | Invariante | Mecanismo | Pruebas |
|---|---|---|---|
| 1 | Identidad canónica activa en un solo empleado; un empleado con varias identidades (ADR-011) | Índice único parcial sobre (`provider`, `kind`, `scope_type`, `scope_id`, `normalized_value`) `WHERE status = 'ACTIVE'`, columnas `NOT NULL`, `CHECK` por tipo, sin reasignación ni borrado | `identities.test.ts`, con activación concurrente |
| 2 | Un trámite activo por empleado y número (ADR-011) | Índice único parcial sobre los 8 estados activos | `submissions.test.ts`, con creación concurrente (T29) |
| 3 | Generación única (ADR-014 §12) | `UNIQUE (employee_id, channel_id, generation)` | `submissions.test.ts` |
| 4 | Datos fijados del trámite | Trigger de columnas fijas; clasificación aplicada escrita una vez; cupo que no decrece | `submissions.test.ts` |
| 5 | Cupo y secuencia de candidatos (ADR-014 §2) | `CHECK` 0–3 y 1–3, unicidad de secuencia y de evento, trigger de lugar reservado | `candidates.test.ts`, con reserva concurrente (T48) |
| 6 | Un seleccionado por paso, del mismo trámite | Índice único parcial; FK compuesta | `candidates.test.ts` |
| 7 | Una confirmación por revisión, solo inserción | Unicidad, FK compuestas, triggers | `confirmations-deliveries.test.ts` |
| 8 | Una entrega por confirmación con identidad derivada | Unicidad; `action_key` generada desde `confirmation_id` | `confirmations-deliveries.test.ts` |
| 9 | Una entrega o acción cancelada no vuelve atrás | Triggers de estado | `confirmations-deliveries.test.ts`, `events-outbox.test.ts` |
| 10 | Evento único y vinculación escrita una vez | Unicidad, `CHECK` de coherencia, FK `(submission, generation)`, trigger | `events-outbox.test.ts` |
| 11 | Acción lógica única sin reasignación | Unicidad, FK `(submission, generation)`, trigger | `events-outbox.test.ts` |
| 12 | Versiones publicadas inmutables (ADR-004) | Triggers contra `UPDATE`, `DELETE` y `TRUNCATE` | `versions.test.ts` |
| 13 | Un prompt activo por trámite | Índice único parcial | `candidates.test.ts` |
| 14 | Corrección vinculada a un original completado | `CHECK`, FK compuesta y trigger | `submissions.test.ts` |
| 15 | Sin borrado físico de lo referenciado | FK `RESTRICT` y triggers | `submissions.test.ts`, `confirmations-deliveries.test.ts` |

Además: `migrations.test.ts` (inicialización desde una base vacía, ejecutores concurrentes, checksums dentro del bloqueo, faltantes, orden y fallos sin efectos) y `protections.test.ts` (marca, rol de pruebas y borrado por nombre exacto).

## Fuera de alcance y diferencias con el plan

- `jobs` no se crea: su forma depende de la cola que se elija en P2 (ADR-002). La outbox tiene solo la estructura mínima acordada (plan §5.5).
- Las tablas quedan en cuatro migraciones como en el plan; `message_events` está en `0003_submissions` porque los candidatos la referencian.
- La verificación de tipos usa la API programática de kysely-codegen (`generate` con una instancia de Kysely que pasó las guardas) y compara la salida con el archivo versionado. Equivale a `--verify` sin pasar URL ni leer `.env`.
- Las pruebas de restricciones no prueban el host: serialización por clave, reclamos, fencing ni comprobaciones de creación de entregas.
