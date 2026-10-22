# @sistema-chatbot/adapters

Adaptadores locales de desarrollo y prueba (plan de P1-T5, `docs/plans/P1-T5-adaptadores-locales.md`): carpeta privada, captura de correo sin entrega real y scanner simulado etiquetado. Según ADR-001 depende solo de `contracts` y `flow-schema`, sin dependencias de npm nuevas ni acceso a la base.

## Alcance parcial (§14, pasos 1 y 2)

Esta versión contiene **solo la base del paquete**: guardas de entorno y configuración validada. **No incluye todavía** (bloques siguientes de P1-T5): los puertos, la raíz privada y sus controles de sistema de archivos, el almacenamiento, la captura de correo, el scanner, la composición (`createLocalAdapters`, `assertSafeComposition`) ni el mantenimiento.

En particular: la validación de configuración es **sobre la forma declarada**; la comprobación real del sistema de archivos (recorrido de antecesores, enlaces, dueños y modos, plan §6) pertenece a la construcción de la raíz y todavía no existe.

## Entornos (plan §5)

Los adaptadores locales y su mantenimiento existen solo en `development` y `test`. Se comprueba en dos capas distintas:

1. **Configuración** (`loadLocalAdaptersConfig`): rechaza `APP_ENV` fuera de la lista — `staging`, `production`, valores desconocidos y la ausencia de valor; informa la clave, nunca el valor.
2. **Guarda de ejecución** (`assertLocalAdapterEnvironment`): la usarán las fábricas y cada operación; exige el valor explícito en la lista y que `process.env.APP_ENV` esté definido y sea igual. Así una llamada con `development` dentro de un proceso con otro entorno falla, y un cambio posterior del entorno lo detecta la llamada siguiente. No hay ningún valor por defecto que habilite.

Un detalle deliberado: la configuración recorta espacios de `process.env`/valores declarados (igual que la API), pero la guarda no recorta el valor **explícito** que recibe: si un host le pasa una cadena con espacios, falla.

Error: `AdapterEnvironmentError` (`LOCAL_ADAPTER_FORBIDDEN_ENVIRONMENT`), con un `reason` interno (`EXPLICIT_ENVIRONMENT_FORBIDDEN`, `PROCESS_APP_ENV_MISSING`, `PROCESS_APP_ENV_MISMATCH`) y sin el valor en conflicto, ni explícito ni el de `process.env`.

## Configuración (plan §12)

| Clave | Regla | Por defecto |
|---|---|---|
| `APP_ENV` | Exactamente `development` o `test`; si falta o es otro valor, rechaza | — |
| `LOCAL_STORAGE_DIR` | Separa los problemas por clave: `UNSAFE_PATH` (byte nulo o caracteres de control), `NOT_ABSOLUTE`, `NOT_NORMALIZED`, `ROOT_DIR_NOT_ALLOWED` (`/`) y `OUTSIDE_REPOSITORY_STORAGE` (dentro del repositorio pero fuera de `storage/`, cuando el host pasa el `repoRoot`) | `storage/documents` del repositorio, resuelto por la composición |
| `LOCAL_MAIL_CAPTURE_DIR` | Las mismas reglas | `storage/mail-captures` del repositorio, resuelto por la composición |
| `LOCAL_MAIL_CAPTURE_RETENTION_DAYS` | Entero de 1 a 30 | 7 |
| `LOCAL_MAIL_CAPTURE_RECORD_DAYS` | Entero de 1 a 365 y no menor que el anterior (`RECORD_DAYS_BEFORE_RETENTION`) | 30 |
| `MAX_FILE_BYTES` | Entero de 1 a 2147483647 (cota de la configuración, no es un límite de negocio; el límite real por objeto lo fija `put`) | 10485760 |
| `SCANNER_SIMULATED_SCENARIO` | Uno de §10.2 salvo `DELAYED`, que se elige por inyección en pruebas | `INCONCLUSIVE` (decisión A2): un valor olvidado no vuelve distribuible ningún documento; `APPROVED` debe elegirse explícitamente |

Los plazos se cuentan desde `capturedAt` del registro de la captura (plan §9.8): el contenido (`payload/`) vence antes que el registro sin datos personales, que define el alcance temporal de la idempotencia local de captura.

## Límites de dependencias

- `contracts` y `flow-schema`, controlados en `scripts/check-workspace-boundaries.mjs` y en ESLint.
- Los módulos de `src/local/**` y `src/maintenance/**` no pueden importar módulos de red ni procesos (`net`, `tls`, `http`, `https`, `http2`, `dgram`, `dns`, `child_process`, con y sin `node:`); el resto de módulos de Node sí.
- El punto de entrada `@sistema-chatbot/adapters/maintenance` se agrega en el mismo bloque que implementa el mantenimiento; no hay exportaciones sin implementación.

## Pruebas

`pnpm run test` en este paquete (vitest): guardas de entorno con cambio posterior detectado y configuración con rechazos por clave, sin base de datos.
