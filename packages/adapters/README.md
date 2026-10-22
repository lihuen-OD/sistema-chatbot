# @sistema-chatbot/adapters

Adaptadores locales de desarrollo y prueba (plan de P1-T5, `docs/plans/P1-T5-adaptadores-locales.md`): carpeta privada, captura de correo sin entrega real y scanner simulado etiquetado. Según ADR-001 depende solo de `contracts` y `flow-schema`, sin dependencias de npm nuevas ni acceso a la base.

## Alcance parcial (§14, pasos 1, 2 y 3)

Esta versión incluye:

- **La base del paquete (pasos 1 y 2):** guardas de entorno, configuración validada sobre la forma declarada y límites de dependencias.
- **El almacenamiento local (paso 3):** el puerto `ObjectStorage` (`ports/storage.ts`), la raíz privada con sus controles reales de sistema de archivos (§6), el área de trabajo con su `instance.json` y la limpieza en ejecución (§7.1–7.2), y la implementación `LocalPrivateFolderStorage` (§8).

**No incluye todavía** (bloques siguientes de P1-T5): la captura de correo (§9), el scanner (§10), la composición (`createLocalAdapters`, `assertSafeComposition`, con la prueba de enlace duro retirada de la raíz del repositorio, §11) ni el comando de mantenimiento (§7.3, que incluye el punto de entrada `@sistema-chatbot/adapters/maintenance`).

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
| `LOCAL_STORAGE_DIR` | Separa los problemas por clave: `UNSAFE_PATH` (byte nulo o caracteres de control), `NOT_ABSOLUTE`, `NOT_NORMALIZED`, `ROOT_DIR_NOT_ALLOWED` (`/`) y `OUTSIDE_REPOSITORY_STORAGE` (dentro del repositorio pero fuera de `storage/`, incluida la raíz del repositorio, cuando el host pasa el `repoRoot`) | `storage/documents` del repositorio, resuelto por la composición |
| `LOCAL_MAIL_CAPTURE_DIR` | Las mismas reglas | `storage/mail-captures` del repositorio, resuelto por la composición |
| `LOCAL_MAIL_CAPTURE_RETENTION_DAYS` | Entero de 1 a 30 | 7 |
| `LOCAL_MAIL_CAPTURE_RECORD_DAYS` | Entero de 1 a 365 y no menor que el anterior (`RECORD_DAYS_BEFORE_RETENTION`) | 30 |
| `MAX_FILE_BYTES` | Entero de 1 a 10485760 (límite del plan §8.3; el límite real por objeto lo fija `maxBytes` de `put`) | 10485760 |
| `SCANNER_SIMULATED_SCENARIO` | Uno de §10.2 salvo `DELAYED`, que se elige por inyección en pruebas | `INCONCLUSIVE` (decisión A2): un valor olvidado no vuelve distribuible ningún documento; `APPROVED` debe elegirse explícitamente |

Los plazos se cuentan desde `capturedAt` del registro de la captura (plan §9.8): el contenido (`payload/`) vence antes que el registro sin datos personales, que define el alcance temporal de la idempotencia local de captura.

## Almacenamiento local (plan §6, §7.1–7.2 y §8)

`createLocalPrivateFolderStorage(appEnv, options)` construye `LocalPrivateFolderStorage`, que implementa el puerto `ObjectStorage` (`put`, `open`, `delete`, `listObjects`) sobre una **raíz privada**: `<raíz>/objects/<clave>`, `tmp/<instancia>/` y `.reclaim/`.

- **Construcción (§6):** guarda de entorno; forma de la ruta (`ROOT_PATH_SHAPE`); recorrido de la ruta configurada (sin enlaces de usuario intermedios, `ANCESTOR_SYMLINK`) y del canónico hasta el padre de la raíz (dueños antiguos, sin escritura de otros, `ANCESTOR_*`); raíz y subdirectorios del usuario del proceso con modo exacto `0700` (`ROOT_*`, `SUBDIRECTORY*`), nunca corregidos en silencio; prueba de enlace duro en `tmp/` (`HARD_LINK_UNSUPPORTED`); área de trabajo con `instance.json` (0600, sin datos personales). Cada operación reactiva el recorrido de antecesores y verifica `dev`/`ino`/tipo/dueño/modo de raíz y subdirectorios (`*_REPLACED`, `UNEXPECTED_ENTRY_TYPE`).
- **Claves (§8.2):** 32 hexadecimales en minúscula generados por el adaptador (`^[0-9a-f]{32}$`); ningún dato del llamador forma la ruta.
- **Publicación (§8.3–8.4):** temporal con `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` y modo `0600`, copia con conteo de bytes y SHA-256 incremental, límite aplicado durante la escritura (deja de leer al superarlo), y publicación solo con `link(temporal, objects/<clave>)`, que nunca reemplaza un destino existente (`KEY_COLLISION`). Los resultados por fase son `StorageWriteError` con `phase` `BEFORE_PUBLISH`, `AFTER_PUBLISH` (`key` y `objectState` `WITHDRAWN` o `LEFT_IN_PLACE`), `BEFORE_REMOVE` y `AFTER_REMOVE`. Si `fsync` del directorio falla después del `link`, el adaptador retira el objeto; si el retiro también falla lo deja marcado como `LEFT_IN_PLACE` para que el host registre la clave (P2).
- **Cancelación (§8.3):** una señal `AbortSignal` suspende mientras se reciben bytes y hasta justo antes de publicar; después de un `link` exitoso se ignora, porque el objeto ya existe.
- **Durabilidad:** los objetos y los borrados se confirman con `fsync` del archivo (paso 4) y de `objects/` (paso 6); un `ALREADY_ABSENT` que concluye sin error confirma con el `fsync` la durabilidad de un borrado anterior.
- **Lectura y borrado (§8.5):** `open` comprueba con `fstat` sobre el descriptor (regular del usuario, `0600`, `O_NOFOLLOW`; no carga el archivo en memoria) y una interrupción del recorrido cierra el descriptor; si se borra un objeto mientras se lee, la lectura en curso sigue (semántica POSIX). `delete` es `unlink` + `fsync` y es repetible.
- **Limpieza en ejecución (§7.2):** `recoverWorkArea()` retoma los restos propios (temporales y `lock-<op>` de operaciones que ya no están activas, sin tocar `instance.json`) y drena `.reclaim/`. Con la misma regla del principio A4, nunca toca temporales ni bloqueos de otras instancias, por viejos que sean: la antigüedad no prueba abandono. `close()` es la misma limpieza y borra el directorio de la instancia si no quedan operaciones activas; con operaciones en marcha no interfiere.

Las inyecciones internas (`fileOps`, `instanceId`, `timing`, `randomHex128`, `onMaintenanceEvent`) solo existen para las pruebas y no son parte del contrato público; el opción `onMaintenanceEvent` informa eventos sin datos (`PUBLISHED_TEMPORARY_RESIDUE` cuando el temporal publicado quedase sin borrar y la limpieza en ejecución lo retoma).

## Límites de dependencias

- `contracts` y `flow-schema`, controlados en `scripts/check-workspace-boundaries.mjs` y en ESLint.
- Los módulos de `src/local/**` y `src/maintenance/**` no pueden importar módulos de red ni procesos (`net`, `tls`, `http`, `https`, `http2`, `dgram`, `dns`, `child_process`, con y sin `node:`); el resto de módulos de Node sí.
- El punto de entrada `@sistema-chatbot/adapters/maintenance` se agrega en el mismo bloque que implementa el mantenimiento; no hay exportaciones sin implementación.

## Limitaciones de este bloque (§6.6, verificadas con las pruebas)

- **Etapas y alcance:** este bloque no envía ni recibe nada: solo archivos locales de la propia máquina, con datos de demo. La entrega real depende de P2+.
- **Mismo usuario:** quién puede leer qué documento es una autorización del host (P4); dentro del mismo usuario, un código arbitrario puede reemplazar entradas (`objects/<clave>`, la instancia de `tmp/`). Las guardas detectan reemplazos de raíz y subdirectorios, y los objetos en curso siguen legibles si la entrada la reemplaza otro archivo.
- **ACL de macOS:** una entrada sin permiso de otros en el modo Unix puede aún ser legible vía ACL, y `lstat` no la examina; es una limitación conocida del plan (§6.6), no corregida aquí.
- **`unlink` duplicado concurrente en APFS (observación de las pruebas):** dos `delete` concurrentes del mismo objeto pueden informar `DELETED` dos veces en APFS/macOS, donde dos `unlink` simultáneos del mismo nombre devuelven éxito; el resultado observable es el contrato: resultados del tipos del puerto, el objeto queda ausente y el reintento confirma `ALREADY_ABSENT`. En Linux el par `DELETED`/`ALREADY_ABSENT` esperado del plan §8.5 se mantiene.
- **Evento de mantenimiento limitado:** solo `PUBLISHED_TEMPORARY_RESIDUE`; el mantenimiento completo con consumidores detenidos (flujo pausado, `utimes` de prueba, restos de otras instancias) pertenece al comando de mantenimiento de §7.3, en un bloque posterior.
- **La limpieza en ejecución no borra `tmp/<instancia>` ajeno:** el retiro de restos de otras instancias corresponde al mantenimiento con consumidores detenidos; hasta entonces se conservan.
- **`listObjects` solo enumera:** la conciliación de huérfanos (marcar datos dudosos, P2) todavía no existe; el listado nunca intenta borrar ni transformar lo que encuentra.

## Pruebas

`pnpm run test` en este paquete (vitest): guardas de entorno con cambio posterior detectado y configuración con rechazos por clave, sin base de datos.
