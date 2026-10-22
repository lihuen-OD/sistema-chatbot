# P1-T5 (parcial): almacenamiento local — raíz privada, área de trabajo y `ObjectStorage`

## Destino del PR

`main` (`274b2d5`, PRs #12 y #13 ya fusionados). La rama `p1/t5-private-storage` sale de `main` actualizado y no depende de otra rama abierta.

## Problema resuelto

Los adaptadores existentes solo validaban la forma declarada de la configuración (bloque anterior): el puerto `ObjectStorage` del plan §8 (§14, paso 3, subpasos 1…2) y la raíz privada con sus controles reales de sistema de archivos (§6, §7.1–7.2) no existían. Sin embargo, ya se había decidido que la publicación con `link` es compatible desde macOS y Linux; una implementación de demo con `rename` corrompería los invariantes del modelo de fases de §8.4.

## Alcance

**Entrega parcial de P1-T5** (solo el bloque 2 del plan: almacenamiento). Incluye:

1. **Puerto `ObjectStorage` (`src/ports/storage.ts`):** `put` (con `maxBytes` y `AbortSignal`), `open`, `delete` y `listObjects`; errores tipados (`StorageIntegrityError` con `reason`, `StorageWriteError` con `phase`/`key`/`objectState`/`failureReason`, `ObjectTooLargeError`, `EmptyObjectError`, `ObjectNotFoundError`, `InvalidObjectKeyError`); los errores y resultados llevan la clave y códigos, nunca contenido ni rutas completas.
2. **Raíz privada (§6) en `src/local/private-root.ts`:** forma de la ruta (`ROOT_PATH_SHAPE`, `PATH_COMPONENT_NOT_DIRECTORY`); recorrido de la ruta configurada (sin enlaces de usuario intermedios, con componentes del usuario con escritura de otros rechazados, `ANCESTOR_*`) y del canónico hasta el padre de la raíz; raíz y subdirectorios del usuario del proceso, enlazadas con modo exacto `0700`, que si existen con otro modo o dueño rechazan la construcción (`ROOT_*`, `SUBDIRECTORY_*`) y nunca se corrigen en silencio; context con `verify(names)` que revalida `dev`/`ino`/tipo/dueño/modo en cada operación (`ROOT_REPLACED`, `SUBDIRECTORY_REPLACED`, `UNEXPECTED_ENTRY_TYPE`).
3. **Área de trabajo (§7.1–7.2) en `src/local/work-area.ts`:** `tmp/<instancia>/` con `instance.json` (0600, sin datos personales), registro en memoria de operaciones activas, y `cleanLeftovers()` con retiro a `.reclaim/` y drenaje (un `ENOENT` de una carrera entre instancias cuenta como borrado). La limpieza nunca toca lo de otras instancias, por viejos que sea (principio A4, aprobado).
4. **Implementación (§8) en `src/local/private-folder-storage.ts`:**
   - temporal con `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` y `0600` por `fchmod` (§6.4), copia con conteo de bytes y SHA-256 incremental, límite aplicado sobre los bytes recibidos (deja de leer al superarlo, comprobado con un flujo que cuenta trozos), sin `eval`, sin rutas arbitrarias.
   - publicación solo con `link(temporal, objects/<clave>)` (nunca `rename`): el `link` no reemplaza destino; un error espurio se resuelve comparando `dev`/`ino`. Durabilidad con `fsync` del archivo (paso 4), del directorio `objects/` (paso 6) y del decreto de `ALREADY_ABSENT` (te inicio de un borrado anterior).
   - resultados por fase: `BEFORE_PUBLISH` (temporal borrido; solo `link` crea el objeto), `AFTER_PUBLISH` (`key` y `objectState`: `WITHDRAWN` o `LEFT_IN_PLACE` para que el host registre la clave en P2), `BEFORE_REMOVE` y `AFTER_REMOVE`. Un `fsync` fallido tras un `unlink` deja el objeto no visible y el reintento confirma la durabilidad.
   - cancelación (`AbortSignal`) mientras se reciben bytes y hasta justo antes del `link`; después de un `link` existoso se ignora (`put` resuelve y el objeto queda).
   - lectura con `O_RDONLY | O_NOFOLLOW`, `fstat` sobre el descriptor (regular del usuario, `0600`, nota §8.5), stream por trozos (no carga el archivo en memoria) con cierre determinista al interrumpir el recorrido (break/throw/return); la lectura en curso sigue si la entrada la reemplaza el mismo usuario (semántica POSIX, limitación documentada).
   - claves 32 hex minúscula generadas internamente (`^[0-9a-f]{32}$`); `listObjects` salta entradas que no son claves u objetos del propio usuario.
   - eventos de mantenimiento sin datos (`PUBLISHED_TEMPORARY_RESIDUE`) cuando el temporal publicado quedase sin borrar.
5. **Prueba de compatibilidad (§6.4):** la construcción prueba un enlace duro en `tmp/` y falla con `HARD_LINK_UNSUPPORTED` si el sistema de archivos no lo admite (exFAT, algunos montajes de red), limpiando sus residuos.
6. **FileOps inyectable (`src/local/file-ops.ts`):** interfaz mínima con implementación por defecto (Node), que inhabilita las pruebas de уголов sin toques al disco real y revisable; las pruebas la decoran.

## Fuera de alcance (bloques siguientes)

- Captura de correo (§9), scanner (§10), composición de `createLocalAdapters` con su guardra de rutas (§11), comando de mantenimiento §7.3 (incluido el punto de entrada `@sistema-chatbot/adapters/maintenance`), conciliación de huérfanos (P2), API, motor y migraciones.
- P1-T5 sigue en curso; este PR no cierra el paquete.

## Cambios relevantes

- `packages/adapters/src/`: `ports/storage.ts`, `local/file-ops.ts`, `local/private-root.ts`, `local/work-area.ts`, `local/private-folder-storage.ts`, y `index.ts` ampliado con los exports públicos del bloque (los módulos `local/*` no se exportan fuera del paquete).
- `packages/adapters/test/`: `support.ts` (directorios reales con `mkdtemp`, decoradores de `FileOps`, compuertas para operaciones lentas), `private-root-decisions.test.ts` (18), `private-root.test.ts` (12), `storage.test.ts` (20), `storage-phases.test.ts` (10), `storage-cleanup.test.ts` (7) y `environment-guards.test.ts` (4).
- `packages/adapters/README.md` actualizado con el alcance nuevo y las limitaciones de §6.6.

## Validación

- `pnpm run check` del repositorio: código 0 (typecheck, lint, formato, límites de dependencias, tests y build; bloques finales: 139 pruebas del paquete `adapters` con archivos reales bajo `mkdtemp`, y sin regresiones en `db`, `flow-schema`, `contracts` y la API).
- **Pruebas de esta característica diseñadas para detectar regresiones:** en cada caso se modifica el sistema de archivos de forma realista (reemplazos de subdirectorios, enlaces plantados, cambio de modos, descritores pausados, utimes envejecidos) y se afirma lo que cambia antes (con sensación de que la prueba falla) y lo qué queda después.
- **Checkout limpio y CI:** del SHA final publicado, en el informe de la entrega.

## Decisiones de diseño (documentadas en el README y el plan, sin cambio de dirección)

- `operationId`, `instanceId` y `key` son 128 bits hex; en las pruebas `randomHex128` inyectable hace predecibles opId y clave (misma fuente).
- `HARD_LINK_UNSUPPORTED` en la construcción; el `link` ajeno como `KEY_COLLISION` (integridad, no `StoredObject` que reemplace).
- El error de la fuente de `put` (excepto los tipados del puerto) se envuelve como `StorageWriteError` `BEFORE_PUBLISH` con `cause`, coherentemente §8.4 fila 2 a 4.
- `listObjects` es una enumeración segura; la conciliación de huérfanos es de P2.
- Sin `eval`, sin `child_process`, sin red, sin rutas arbitrarias (reglas de dependencias e lint del bloque anterior siguen siendo la última línea de defensa).

## Limitaciones

- **Mismo usuario:** un código del mismo usuario puede reemplazar entradas dentro de la raíz (§6.6); las guardas lo detectan para raíz y subdirectorios y los objetos en curso siguen legibles, pero la autorización de lectura por documento es del host (P4).
- **ACL de macOS:** `lstat` no examina ACL; una entrada sin permiso de otros en el modo Unix puede aún ser legible vía ACL. Limitación reconocida del plan, no corregida aquí.
- **APFS y `unlink` duplicado concurrente (observación de las pruebas):** en macOS dos `unlink` simultáneos del mismo nombre devuelven éxito, así que dos `delete` concurrentes pueden informar `DELETED` dos veces; el plan §8.5 pide `DELETED` + `ALREADY_ABSENT`, y la letra observable (resultados del contrato, objeto ausente, reintento que confirma) es la que se afirma; el par exacto permanece en Linux.
- **Evento de mantenimiento limitado:** solo `PUBLISHED_TEMPORARY_RESIDENTE`; el mantenimiento completo (flujos pausados, `utimes` de prueba, otros restos) es de §7.3.
- **Pruebas de corte de energía no ejecutas:** no hay afirmaciones de supervivencia a cortes reales; la durabilidad es la de `fsync` comprobada en archivo y directorios, y se deja anotado qué no está probado.

## Próxima tarea concreta (bloque 3 de P1-T5, con autorización)

Captura de correo (§9) sobre la mismo raíz con los invariantes ya implementados.
