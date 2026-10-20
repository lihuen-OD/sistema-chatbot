# P1-T3 — `packages/db`: migraciones, checksums, guardas y pruebas de restricciones

## Dependencia

Esta rama sale de `p1/t2-cierre` (`41c0234`), todavía no fusionada. Por eso sus dos primeros commits (`8d61205` y `41c0234`) son solo documentación: el cierre de P1-T2 y el plan de P1-T3.

- Conviene revisar y fusionar primero `p1/t2-cierre`. Después, la comparación con `main` muestra solo P1-T3.
- Mientras tanto, el diff exclusivo de P1-T3 está en https://github.com/lihuen-OD/sistema-chatbot/compare/p1/t2-cierre...p1/t3-db.

## Problema resuelto

El gate de P1 exige restricciones de base para las invariantes de identidad, trámite activo, candidatos, confirmación, entrega y vinculación, probadas contra PostgreSQL real aislado. Además, ADR-010 pide migraciones SQL con orden y checksum, y tipos con control de divergencia.

## Alcance

Plan aprobado: `docs/plans/P1-T3-base-de-datos.md`; la implementación y sus diferencias están en su §11.

- **Entorno:** `compose.yaml` con PostgreSQL 18.6 fijado por digest en `127.0.0.1:55432`, compatible con Docker y Colima. Roles de desarrollo y de pruebas creados al inicializar el volumen.
- **Ejecutor:** Migrator de Kysely 0.29.6 más checksums. La verificación definitiva corre dentro del bloqueo de migración, el checksum se registra en la misma transacción y todas las pendientes se aplican en una sola transacción.
- **Validador léxico de SQL:**
  - acepta funciones, triggers y `DO` con `BEGIN … END`, y cuerpos `BEGIN ATOMIC`;
  - rechaza el control de transacciones de nivel superior y las sentencias que no pueden ir dentro de una transacción.
- **Migraciones:** cuatro migraciones con las 15 invariantes del plan. `jobs` queda para P2 (ADR-002, addendum) y la outbox tiene solo la estructura mínima acordada.
- **Guardas:**
  - URL explícita, loopback, puerto 55432, rol y base por uso;
  - `APP_ENV` distinto de `production`;
  - marca `cluster_name` comprobada antes de escribir;
  - bases temporales `sc_test_<runId>_<n>`, borradas solo por nombre exacto con un rol que no es superusuario.
- **Tipos:** generados con kysely-codegen 0.20.0 y verificados en CI.
- **CI:** job `db`, además del job de checks existente.

Fuera de alcance: repositorios y transacciones del host (P2), usuarios y sesiones (P1-T4), seed (P1-T6), tablas de P4 y P5, y producción. No se usó Postgres.app ni ninguna base externa.

## Validación

- **Local:**
  - `pnpm install --frozen-lockfile` y `pnpm run check` con código 0;
  - 62 pruebas de `db` sin base, 112 de `flow-schema` y 182 de `contracts`;
  - las CLI con URL faltante, hacia el puerto 5432 o hacia un host remoto fallan con la guarda, sin conectarse;
  - `test:db` sin `TEST_DATABASE_URL` falla con un error explícito.
- **CI** (job `db` del run #13 sobre `88687ee`): contenedor sano, 8 archivos y 76 pruebas contra PostgreSQL aprobadas, y "Tipos de la base al día". El job de checks también aprobó. Los runs #11 y #12 fallaron y se corrigieron (ver `PROJECT_STATUS.md`).

## Limitaciones

- Las pruebas locales contra el contenedor no se ejecutaron: esperan la confirmación de Docker Desktop. Las mismas pruebas corren en la CI.
- Las restricciones de base no prueban el host: serialización por clave, reclamos, fencing, comprobaciones de creación de entregas ni cancelación atómica.
- `uuidv7()` exige PostgreSQL 18 o posterior en todos los entornos.
