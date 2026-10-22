# P1-T5 (parcial): base de `packages/adapters`, configuración y guardas de entorno

## Destino del PR

`main` (`d993830`, PR #11 del plan ya fusionado). La rama `p1/t5-base-y-config` sale de `main` actualizada y no depende de otra rama abierta.

## Problema resuelto

Al autorizarse el primer bloque de P1-T5, el paquete `packages/adapters` no existía: faltaba la base declarada por el plan (§14, pasos 1 y 2) con sus límites de dependencias, y la API todavía aceptaba los modos locales de archivos, correo y scanner en `APP_ENV=staging` (decisión A1 aprobada, plan §18.1).

## Alcance

**Entrega parcial de P1-T5** (los controles reales de directorios y archivos, los puertos y los adaptadores corresponden a los bloques siguientes). Incluye:

1. **`packages/adapters` nuevo**, con TypeScript estricto, lint, pruebas (vitest) y build integrados al workspace y a la CI, siguiendo las convenciones de `contracts`.
2. **Límites de dependencias (plan §3):** `contracts` y `flow-schema`, declarados en `scripts/check-workspace-boundaries.mjs` y en ESLint; sin dependencias de npm nuevas y sin acceso a la base.
3. **Reglas que impiden importar módulos de red y procesos** desde `src/local/**` y `src/maintenance/**`: `net`, `tls`, `http`, `https`, `http2`, `dgram`, `dns` y `child_process`, con o sin prefijo `node:` y con submódulos (por ejemplo `dns/promises`).
4. **Guarda reutilizable de entorno** (`environment.ts`): `assertLocalAdapterEnvironment` exige `development` o `test` y coincidencia entre el valor explícito y `process.env.APP_ENV`; un cambio posterior del entorno lo detecta la llamada siguiente. Sin valores en los errores (`AdapterEnvironmentError`, `LOCAL_ADAPTER_FORBIDDEN_ENVIRONMENT`, con `reason` interno).
5. **Configuración validada** (`config.ts`, plan §12): `APP_ENV` local, rutas (`LOCAL_STORAGE_DIR`, `LOCAL_MAIL_CAPTURE_DIR`) en su forma declarada, plazos de retención con su invariante (`RECORD_DAYS_BEFORE_RETENTION`), `MAX_FILE_BYTES`, y `SCANNER_SIMULATED_SCENARIO` con `INCONCLUSIVE` por defecto (decisión A2) y `DELAYED` excluido del entorno. La validación es sobre la forma: la comprobación real del sistema de archivos es del próximo bloque.
6. **API: regla de staging (A1):** con `APP_ENV=staging`, `EMAIL_MODE`, `STORAGE_MODE` y `SCANNER_MODE` locales quedan rechazados con `SIMULATED_MODE_OUTSIDE_LOCAL`; `CHANNEL_MODE` no cambia. Consecuencia: en P1 la API no arranca con staging; arrancará cuando existan los adaptadores reales (P5).

## Fuera de alcance (próximos bloques)

- Puertos (plan §8.1, §9.1 y §10.1), raíz privada y antecesores (plan §6), área de trabajo y limpieza (§7), almacenamiento (§8), captura de correo (§9), scanner (§10), composición (§11) y mantenimiento (§7.3).
- El punto de entrada `@sistema-chatbot/adapters/maintenance` se declara en la misma tarea que implementa el mantenimiento: no hay exportaciones sin implementación.
- Sin cambios en contratos, migraciones, `.env` local ni credenciales.

## Cambios relevantes

- **`packages/adapters/`:** `package.json` (solo `contracts` y `flow-schema` más las dependencias de desarrollo ya existentes en el workspace), tsconfig, vitest, README con alcance parcial, `src/environment.ts`, `src/config.ts`, `src/index.ts` y `src/types.ts`, con 68 pruebas.
- **`scripts/check-workspace-boundaries.mjs` y `eslint.config.js`:** matriz de ADR-001 y los dos bloques de reglas.
- **`apps/api/src/config.ts`:** `SIMULATED_MODE_OUTSIDE_LOCAL` en staging (A1), con pruebas.
- **`.env.example`:** claves nuevas del plan §12, sin valores secretos.
- **`apps/api/README.md`, ADR-001 (addendum), docs/15 §9, `PROJECT_STATUS.md`:** documentación breve de la entrega parcial.

## Validación

- `pnpm install --frozen-lockfile`: código 0, lockfile con la única diferencia esperada (importador de `packages/adapters`, sin dependencias externas nuevas) y políticas de cadena de suministro aprobadas.
- `pnpm run check`: código 0. Typecheck, lint, formato, límites, 62 pruebas de `db`, 132 de `flow-schema`, 191 de `contracts`, 68 de `adapters` y 60 de la API, y build.
- **Mutaciones temporales** (contra este bloque, todas retiradas después con `cmp` sin diferencias):
  - un archivo temporal en `packages/adapters/src/local/` con `node:net`, `node:child_process` y `@sistema-chatbot/db`: ESLint rechaza los tres;
  - las formas sin prefijo (`net`, `child_process`) y el submódulo `dns/promises`: ESLint los rechaza; `node:fs/promises` y `node:crypto` (permitidos) pasan;
  - declarar `@sistema-chatbot/db` en el manifiesto de `adapters`: el script de límites sale con código 1 y señala el paquete.
- **Checkout limpio:** del SHA publicado, con `pnpm install --frozen-lockfile` desde store propio y `pnpm run check`; resultado en el informe de la entrega.
- **CI:** del SHA final publicado, en el informe de la entrega.

## Correcciones de revisión (22/10/2026, segunda pasada sobre la misma rama)

Dos hallazgos de revisión del bloque, corregidos con regresiones primero (fallan antes del arreglo, pasan después):

1. **Ruta igual a la raíz del repositorio:** `relative(repoRoot, raw)` devuelve cadena vacía cuando la ruta es el repositorio mismo, y la regla "dentro del repositorio" no la consideraba, así que la aceptaba. Ahora la raíz exacta se rechaza con `OUTSIDE_REPOSITORY_STORAGE`, igual que una carpeta interna fuera de `storage/` (`LOCAL_STORAGE_DIR` y `LOCAL_MAIL_CAPTURE_DIR`). `storage/` y sus descendientes siguen aceptados, y las rutas externas válidas del plan también (regresión: raíz exacta rechazada, carpeta interna fuera de `storage/` rechazada y `storage/` aceptada, para las dos claves).
2. **`MAX_FILE_BYTES`:** la ampliación del rango de configuración (1 a 2147483647) se retira; el máximo es el límite acordado del plan, 10485760 (regresión: 1 y 10485760 aceptados; 0, 10485761 y 2147483647 rechazados). README, esta descripción y el estado ya no mencionan la cota ampliada; las entradas históricas de `PROJECT_STATUS.md` se conservan.

El alcance no cambia: sigue siendo el primer bloque de P1-T5, corregido en la misma rama con commits nuevos (sin amend ni force push).

## Limitaciones

- **Verificación contra PostgreSQL no ejecutada en local para esta entrega:** el cambio de la API es de configuración (cubierto por sus pruebas unitarias sin base), no toca la base ni sus guardas, y en esta sesión el daemon de Docker no está en marcha. El mismo conjunto corre en la CI.
- La configuración solo valida la forma declarada; el modelo de amenazas de antecesores, enlaces, dueños y permisos (plan §6) queda para el bloque siguiente.
- El rango de configuración de `MAX_FILE_BYTES` coincide con el límite del plan (1 a 10485760); el límite real por objeto lo fija `maxBytes` de `put` (P2/P5).
- La regla del repositorio (debajo de `storage/`, incluida la raíz del repositorio, que se rechaza con `OUTSIDE_REPOSITORY_STORAGE`) se aplica solo si el host pasa `repoRoot`; la composición (próximo bloque) siempre lo pasará.
- Los detalles del sistema de archivos del plan (§6–§9.9) no tienen prueba de concepto todavía: se verifican con su bloque.
