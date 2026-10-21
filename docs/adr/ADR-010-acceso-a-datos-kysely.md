# ADR-010 — Acceso a datos con Kysely + pg y migraciones SQL revisadas

- Fecha: 19/10/2026
- Estado: Aceptada
- Responsable: propietario del proyecto
- Revisión: si el costo de mantener SQL y tipos a mano frena el desarrollo, o si el equipo pasa a preferir un esquema declarativo.

## Contexto

El diseño apoya varias invariantes en construcciones específicas de PostgreSQL:

- índices únicos parciales (un trámite activo por empleado y número; una identidad activa por empleado);
- `FOR UPDATE SKIP LOCKED` y locks transaccionales por clave;
- actualizaciones condicionadas por `fencingToken`;
- triggers o privilegios que impiden modificar versiones publicadas;
- CTE y transacciones con aislamiento explícito.

El kit proponía Prisma. El 14/10/2026 se recomendó Kysely. Esta decisión registra ese cambio como una elección técnica con costos y alternativas, **no como una incompatibilidad de Prisma** (corrección 6).

## Alternativas

| Alternativa | Ventajas | Costos para este diseño |
|---|---|---|
| Prisma ORM | Esquema declarativo, migraciones generadas, cliente tipado, ecosistema y documentación amplios | Varias invariantes quedarían en SQL crudo o en migraciones editadas a mano, con dos fuentes de verdad (esquema Prisma + SQL); el soporte declarativo de algunas construcciones depende de la versión y debe verificarse; paso de generación del cliente en build y CI |
| Drizzle ORM | Esquema en TypeScript, consultas cercanas a SQL, migraciones generadas | Compromiso similar: esquema TS como fuente de verdad y construcciones avanzadas en SQL embebido |
| pg con SQL a mano, sin query builder | Control total y mínima dependencia | Sin tipado de consultas; más código repetitivo y más errores de columnas en tiempo de ejecución |
| Kysely + pg | Consultas tipadas sin modelo propio; SQL como fuente de verdad | Ver costos abajo |

Las cuatro alternativas son técnicamente viables. La elección responde a costo y beneficio para un diseño con muchas invariantes en la base.

## Decisión

- Acceso a datos con Kysely sobre el driver `pg`, en el paquete `packages/db`.
- Migraciones en archivos SQL planos, revisadas en PR, solo hacia adelante y aplicadas por un ejecutor que registra orden y checksum. El ejecutor se elige en la tarea de base de P1 entre el Migrator de Kysely leyendo archivos SQL u otra herramienta mantenida que trabaje con SQL plano; la elección se documenta con motivo.
- Los tipos TypeScript de la base se generan desde el esquema migrado. CI comprueba que no haya divergencia: migrar una base vacía, generar los tipos y exigir diff vacío.
- Expand/contract para cambios que afectan a API y worker de versiones distintas. Nunca `db push` ni migraciones destructivas automáticas en producción.

## Costos de mantenimiento

- SQL escrito y revisado a mano: las revisiones requieren conocimiento de SQL y de PostgreSQL.
- Paso de generación de tipos y control de divergencia en CI.
- Sin relaciones ni escrituras anidadas automáticas: los repositorios se escriben explícitamente.
- Ecosistema y documentación más chicos que Prisma, y menos mantenedores. Hay que revisar la actividad del proyecto al fijar la versión en P1.
- Pruebas de repositorios contra PostgreSQL real aislado, necesarias de todos modos para probar las invariantes.

## Consecuencias

- `docs/04_MODELO_DATOS.md` orienta las migraciones SQL, no un esquema Prisma.
- Si en el futuro se adopta un ORM declarativo, las migraciones SQL existentes se conservan como historial y el nuevo esquema se obtiene por introspección.

## Invariantes

- Las migraciones aplicadas no se editan; se corrigen con una migración nueva.
- Las invariantes críticas tienen una restricción en la base, no solo una validación en código.

## Pruebas

Migración de base vacía en CI; control de divergencia de tipos; pruebas de restricciones (por ejemplo, el segundo trámite activo del mismo empleado y número es rechazado por la base).

## Documentos afectados

`README.md`, `docs/02_ARQUITECTURA.md` §3, `docs/04_MODELO_DATOS.md`, `docs/10_ENTORNOS_Y_OPERACION.md`.

## Addendum P1-T3 — ejecutor, tipos y control de divergencia (20/10/2026)

Registro previsto por la decisión: el ejecutor se elige en la tarea de base de P1 y se documenta con su motivo. No cambia la decisión. La comparación completa, con la evidencia, está en `docs/plans/P1-T3-base-de-datos.md` §5.2.

**Ejecutor: Migrator de Kysely 0.29.6 más una verificación de checksums propia.**

- **Qué aporta Kysely:** está en `kysely/migration` desde la 0.29. Toma un `pg_advisory_lock` de sesión, rechaza migraciones aplicadas que faltan o quedan fuera de orden, y aplica todas las pendientes en una sola transacción.
- **Qué falta:** Kysely no registra checksum; no hay código de hash en su `dist/migration`. Tampoco lee archivos `.sql`.
- **Lo que se agregó:**
  - un proveedor que lee `migrations/NNNN_descripcion.sql`, después de pasarlos por un validador léxico (`src/sql-validation.ts`);
  - la tabla `schema_migration_checksums`. Cada migración inserta su SHA-256 en la misma transacción del lote;
  - la verificación definitiva de checksums. Corre en `acquireMigrationLock`, dentro de un adaptador derivado de `PostgresAdapter`, con el mismo bloqueo ya tomado y antes de que Kysely lea el estado;
  - una comprobación, después de cada archivo, de que la transacción del lote siga abierta.
- **Motivo:** Kysely ya es dependencia y está mantenido. Resuelve el bloqueo, el orden y la atomicidad, y el código propio queda en el proveedor y el checksum.
- **Alternativas descartadas:**
  - un ejecutor propio: más código con lock, orden y transacciones que mantener;
  - `node-pg-migrate` 9.0.0: no registra checksum y agrega dependencias;
  - herramientas con hash incorporado, cuyas últimas versiones estables son de 2021 y 2022 o que solo tienen release candidates.

**Tipos:** kysely-codegen 0.20.0, solo en desarrollo, usado por su API programática.

- `generate` recibe una instancia de Kysely que pasó las guardas. Así no recibe una URL ni lee `.env`.
- `db:types` escribe `src/generated/database.ts`.
- `db:types:verify` compara la salida con el archivo versionado, que es lo mismo que hace `--verify`, y muestra la salida esperada si difieren.

**Control de divergencia en CI.** El job `db` levanta `compose.yaml` en el runner. Ejecuta las pruebas contra PostgreSQL, que incluyen la migración desde una base vacía, y la verificación de tipos.

**Consecuencias:**

- `uuidv7()` exige PostgreSQL 18 o posterior en todos los entornos.
- Una migración que necesite `CONCURRENTLY` u otra sentencia fuera de transacción requiere su propio addendum, porque el validador la rechaza.
