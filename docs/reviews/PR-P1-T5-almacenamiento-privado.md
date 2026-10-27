# P1-T5 (parcial): almacenamiento local — raíz privada, área de trabajo y `ObjectStorage`

## Destino del PR

`main` (`274b2d5`, PRs #12 y #13 ya fusionados). La rama `p1/t5-private-storage` sale de `main` actualizado y no depende de otra rama abierta.

## Estado

**No listo para fusionar.** Queda una decisión del propietario (borrados concurrentes en APFS, más abajo) y, mientras no se tome, la prueba del contrato de §8.5 falla en macOS. En Linux (CI) pasa. El resto de las correcciones de revisión están aplicadas y verificadas.

## Problema resuelto

El primer bloque de P1-T5 solo validaba la forma de la configuración. Faltaban el puerto `ObjectStorage` del plan §8 y la raíz privada con sus controles reales sobre el sistema de archivos (§6, §7.1–7.2), que son el paso 3 de §14. La publicación tenía que hacerse con `link`, que existe en macOS y en Linux: con `rename` se podría reemplazar un destino existente y se romperían las fases de §8.4.

## Alcance

**Entrega parcial de P1-T5** (solo el bloque 2 del plan: almacenamiento). Incluye:

1. **Puerto `ObjectStorage` (`src/ports/storage.ts`):** `put` (con `maxBytes` y `AbortSignal`), `open`, `delete` y `listObjects`; errores tipados (`StorageIntegrityError` con `reason`, `StorageWriteError` con `phase`/`key`/`objectState`/`failureReason`, `ObjectTooLargeError`, `EmptyObjectError`, `ObjectNotFoundError`, `InvalidObjectKeyError`). Los errores y resultados llevan la clave y códigos, nunca contenido ni rutas completas.
2. **Raíz privada (§6) en `src/local/private-root.ts`:**
   - forma de la ruta (`ROOT_PATH_SHAPE`, `PATH_COMPONENT_NOT_DIRECTORY`);
   - recorrido de la ruta configurada (sin enlaces de usuario; componentes con escritura de otros rechazados, `ANCESTOR_*`) y de la canónica hasta el padre de la raíz;
   - antes de crear un directorio, validación de los antecesores existentes, incluida la ruta canónica del último; cada directorio nace `0700` desde `mkdir` y se reafirma con `chmod`; un `EEXIST` de otra instancia se vuelve a comprobar (§6.4);
   - raíz y subdirectorios del usuario del proceso con modo exacto `0700`; si existen con otro modo o dueño, la construcción falla (`ROOT_*`, `SUBDIRECTORY_*`) y nada se corrige en silencio;
   - un contexto con `verify(names)` que revalida `dev`/`ino`/tipo/dueño/modo en cada operación (`ROOT_REPLACED`, `SUBDIRECTORY_REPLACED`, `UNEXPECTED_ENTRY_TYPE`);
   - solo `ENOENT` se trata como ausencia; los demás errores del sistema se propagan.
3. **Área de trabajo (§7.1–7.2) en `src/local/work-area.ts`:** `tmp/<instancia>/` con `instance.json` (0600, sin datos personales, escrito completo), registro en memoria de operaciones activas y `cleanLeftovers()` con retiro a `.reclaim/` y drenaje (un `ENOENT` de una carrera entre instancias cuenta como borrado). La limpieza nunca toca lo de otras instancias, por viejo que sea (principio A4, aprobado).
4. **Implementación (§8) en `src/local/private-folder-storage.ts`:**
   - temporal con `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` y `0600` reafirmado con `fchmod` (§6.4); copia con escritura completa (los `write` parciales se completan y una escritura sin progreso falla), conteo de bytes y SHA-256 incremental sobre lo escrito; sin `eval` ni rutas arbitrarias;
   - publicación solo con `link(temporal, objects/<clave>)`, nunca con `rename`: el `link` no reemplaza destinos, y un error espurio se resuelve comparando `dev`/`ino`. Durabilidad con `fsync` del archivo (paso 4) y del directorio `objects/` (paso 6); también en `ALREADY_ABSENT`, que así confirma la durabilidad de un borrado anterior;
   - resultados por fase: `BEFORE_PUBLISH` (temporal borrado; solo `link` crea el objeto), `AFTER_PUBLISH` (`key` y `objectState`: `WITHDRAWN` o `LEFT_IN_PLACE`, para que el host registre la clave en P2), `BEFORE_REMOVE` y `AFTER_REMOVE`. Un `fsync` fallido después de un `unlink` deja el objeto no visible, y el reintento confirma la durabilidad;
   - cancelación (`AbortSignal`) mientras se reciben bytes y hasta justo antes del `link`, sin esperar a una fuente que no responde; después de un `link` exitoso se ignora (`put` resuelve y el objeto queda);
   - lectura con `O_RDONLY | O_NOFOLLOW`, `fstat` sobre el descriptor (regular del usuario, `0600`, §8.5) y stream por trozos (no carga el archivo en memoria), con cierre determinista al interrumpir el recorrido (`break`/`throw`/`return`). Si el mismo usuario reemplaza la entrada, la lectura en curso sigue (semántica POSIX, limitación documentada);
   - claves de 32 hex en minúscula generadas internamente (`^[0-9a-f]{32}$`); `listObjects` salta las entradas que no son claves u objetos del propio usuario;
   - guardas de entorno en cada operación y en lo diferido: `listObjects` al consumirse y reanudarse, el stream de `open` antes de cada lectura, y `put` justo antes del `link`;
   - evento de mantenimiento sin datos (`PUBLISHED_TEMPORARY_RESIDUE`) cuando el temporal publicado queda sin borrar.
5. **Prueba de compatibilidad (§6.4):** la construcción prueba un enlace duro en `tmp/` y falla con `HARD_LINK_UNSUPPORTED` si el sistema de archivos no lo admite (exFAT, algunos montajes de red), limpiando sus residuos.
6. **`FileOps` inyectable (`src/local/file-ops.ts`):** interfaz mínima con implementación por defecto sobre `node:fs/promises`. Las pruebas la decoran para inyectar fallos y pausas en cada paso, siempre con archivos reales.

## Fuera de alcance (bloques siguientes)

- Captura de correo (§9), scanner (§10), composición de `createLocalAdapters` con su guarda de rutas (§11), comando de mantenimiento de §7.3 (incluido el punto de entrada `@sistema-chatbot/adapters/maintenance`), conciliación de huérfanos (P2), API, motor y migraciones.
- P1-T5 sigue en curso; este PR no cierra el paquete.

## Cambios relevantes

- `packages/adapters/src/`: `ports/storage.ts`, `local/file-ops.ts`, `local/private-root.ts`, `local/work-area.ts`, `local/private-folder-storage.ts`, e `index.ts` ampliado con los exports públicos del bloque (los módulos `local/*` no se exportan fuera del paquete).
- `packages/adapters/test/`: `support.ts` (directorios reales con `mkdtemp`, borrados al terminar cada prueba; decoradores de `FileOps`; compuertas; plazos), `private-root-decisions.test.ts` (18), `private-root.test.ts` (25), `storage.test.ts` (20), `storage-phases.test.ts` (29), `storage-cleanup.test.ts` (7) y `environment-guards.test.ts` (9); además `config.test.ts` (49) y `environment.test.ts` (19) del bloque anterior. Total del paquete: 176.
- `packages/adapters/README.md`: alcance, comportamiento y limitaciones de §6.6.
- `scripts/evidence/apfs-dup-unlink-repro.mjs`: reproducción aislada de los borrados concurrentes con llamadas reales.

## Correcciones de revisión (27/10/2026)

La entrega inicial (`f6dd311`) se publicó con la CI en rojo: la run #45 falló en Linux porque la prueba de reemplazo de `objects/` recibió `EmptyObjectError` en vez de `SUBDIRECTORY_REPLACED` (el directorio recreado reutilizó el inodo). Defectos encontrados y corregidos:

| # | Defecto | Corrección |
|---|---|---|
| A | `write` parcial ignorado en la copia y en `instance.json` | Escritura completa con control de progreso; `instance.json` sin progreso: construcción fallida, descriptor cerrado y directorio de la instancia borrado |
| B1 | Al agotarse la fuente se esperaba su `return()`: una fuente cuyo `return()` no responde bloqueaba un `put` terminado | No se llama a `return()` después de `done` (protocolo de iteración) |
| B2 | Un `return()` que lanza o no devuelve promesa convertía la cancelación en un error crudo; un `next()` sin promesa daba `TypeError` con señal | Abandono de la fuente sin esperarla y tolerante a esos casos; `Promise.resolve` sobre `next()` |
| B3 | Cancelación durante una espera anterior al `link` | Comprobación de cancelación y de entorno sin ninguna espera entre ellas y el `link` |
| C | El stream de `open` y `put` seguían actuando después de cambiar `APP_ENV` | Guarda antes de cada lectura del stream (cierra el descriptor) y antes del `link` |
| D1 | Directorios creados bajo un antecesor que la ruta canónica rechazaba (enlace de root a un directorio con escritura de otros) | Ruta canónica del último antecesor existente validada antes de crear |
| D2 | Se había quitado el control de dueño de los componentes creados | Restituido: un componente creado que no es del usuario detiene la creación |
| D3 | `EEXIST` de otra instancia hacía fallar la construcción (§6.4 pide volver a comprobar) | Se vuelve a comprobar como existente; dos y cuatro construcciones simultáneas terminan |
| D4 | Las limpiezas recreaban la raíz si había desaparecido | Recorrido sin creación: `ROOT_REPLACED`, sin efectos sobre disco |
| D5 | Errores del sistema tratados como ausencia o como otra cosa: `verify` (cualquier error → `*_REPLACED`), `open` (→ `TARGET_TYPE`), la reconciliación del `link` (→ destino ausente) | Solo `ENOENT` es ausencia; `verify` y `open` propagan; `delete` informa `BEFORE_REMOVE` con clave; el `link` no verificable informa `AFTER_PUBLISH` con clave y `LEFT_IN_PLACE` (o `KEY_COLLISION` si fue `EEXIST`) |
| E | Prueba de reemplazo dependiente de que el sistema no reutilice el inodo | El original se conserva con `rename`; con contenido real; variante para la raíz |
| F | Afirmación sobre APFS apoyada en una reproducción defectuosa (imprimía cada éxito como `"RECHAZADO"`) y prueba del contrato debilitada | Reproducción corregida y medida; prueba estricta restituida; decisión pendiente (abajo) |

Cada corrección tiene una regresión que pasa con la corrección y falla sin ella. 19 fallaron contra el árbol anterior a estas correcciones (`f6dd311` más los cambios locales sin commit que había). Las demás se comprobaron con 4 mutaciones temporales del código corregido, retiradas después (`cmp` sin diferencias): esperar `return()` al cancelar, quitar la comprobación de cancelación antes del `link`, tratar como ausencia un error de `lstat` en `listObjects` y crear directorios sin modo. Algunas regresiones ya pasaban con esos cambios locales y quedan como protección: las variantes "queda pendiente" y "rechaza" de `return()`, y `listObjects` con `EACCES`.

## Validación

**Local (macOS 27.0.1, APFS, arm64; Node 24.22.1, pnpm 12.12.1):**
- `pnpm install --frozen-lockfile`: código 0.
- `typecheck`, `lint`, `format:check`, `check:boundaries` y `build`: código 0.
- Pruebas: `db` 62, `flow-schema` 132, `contracts` 191, `api` 64, todas aprobadas. `adapters`: 175 de 176. Falla solo la prueba del par `DELETED`/`ALREADY_ABSENT` de §8.5 (`{"DELETED+DELETED": 98, "ALREADY_ABSENT+DELETED": 2}` en una corrida). Por eso `pnpm run check` termina con código 1 en macOS.
- `check:db`: no ejecutado en local (Docker detenido; el bloque no toca la base ni la API). Lo cubre el job `db` de la CI.

**CI (Linux):** se informa por SHA en `PROJECT_STATUS.md` y en la entrega.

**Checkout limpio:** del SHA final, en la entrega.

## Decisión pendiente del propietario: borrados concurrentes en APFS

- **Contrato (§8.5):** dos borrados concurrentes dan un `DELETED` y un `ALREADY_ABSENT`.
- **Medición (27/10/2026, macOS 27.0.1 / xnu-13432.1.9, APFS, Node 24.22.1; Python 3.9.6 como control):** dos `unlink` concurrentes del mismo nombre devuelven éxito los dos en la gran mayoría de los pares (entre el 95 % y el 99,9 % según la corrida). El nombre desaparece y `nlink` no baja dos veces. El `unlink` secuencial da siempre `ENOENT`. En cambio, `rename` del mismo origen a dos destinos y `link` al mismo destino fueron exclusivos en todos los pares medidos.
- **Consecuencia:** en macOS, `delete` informa `DELETED` dos veces. La prueba del contrato falla, y no se debilitó.
- **Opciones, sin implementar:**
  1. cambiar `delete` para que el `unlink` no decida la exclusión, por ejemplo con un `rename` previo a `.reclaim/`, que fue exclusivo en la medición; cambia el algoritmo de §8.5 y su durabilidad, y requiere pruebas propias;
  2. aceptar la diferencia de plataforma y modificar el contrato de §8.5 (al menos un `DELETED`, objeto ausente y el reintento confirma `ALREADY_ABSENT`).

## Otra decisión a confirmar

Cuando el `link` falla con un error distinto de `EEXIST` y el `lstat` de reconciliación también falla, el estado no se puede verificar. Se informa `AFTER_PUBLISH` con la clave y `LEFT_IN_PLACE`, en lugar de `BEFORE_PUBLISH`. Así se cumple §15 ("ningún fallo posterior a la publicación se informa como si el destino estuviera ausente"), y el host puede borrar la clave con `delete`, que es repetible. El tipo del puerto no tiene un valor propio para "no verificable". Si el propietario prefiere uno (por ejemplo `UNKNOWN`), es un cambio de contrato.

## Decisiones de diseño (documentadas en el README y el plan, sin cambio de dirección)

- `operationId`, `instanceId` y `key` son de 128 bits en hexadecimal. En las pruebas, `randomHex128` inyectable hace predecibles el `operationId` y la clave (misma fuente).
- `HARD_LINK_UNSUPPORTED` en la construcción; un `link` con `EEXIST` sobre una entrada ajena es `KEY_COLLISION` (integridad), nunca un `StoredObject` que la reemplace.
- El error de la fuente de `put` (salvo los tipados del puerto) se envuelve como `StorageWriteError` `BEFORE_PUBLISH` con `cause`, de acuerdo con las filas 2 a 4 de §8.4.
- `listObjects` es una enumeración segura; la conciliación de huérfanos es de P2.
- Sin `eval`, `child_process`, red ni rutas arbitrarias; las reglas de dependencias y de lint del bloque anterior siguen aplicándose.

## Limitaciones

- **Mismo usuario:** un proceso del mismo usuario puede reemplazar entradas dentro de la raíz (§6.6). Las guardas lo detectan para la raíz y los subdirectorios mientras el inodo cambie; un directorio borrado y recreado puede reutilizar el inodo (observado en la CI de Linux). La autorización de lectura por documento es del host (P4).
- **ACL de macOS:** `lstat` no examina ACL; una entrada sin permiso de otros en el modo Unix puede seguir siendo legible vía ACL. Limitación reconocida del plan, no corregida aquí.
- **Fuentes que no cooperan:** el adaptador no puede obligar a una fuente a liberar sus recursos; su espera pendiente queda abandonada. Una escritura en disco ya iniciada no se interrumpe: la cancelación se observa entre trozos y antes del `link`.
- **Evento de mantenimiento limitado:** solo `PUBLISHED_TEMPORARY_RESIDUE`; el mantenimiento completo es de §7.3.
- **Sin pruebas de corte de energía:** no hay afirmaciones de supervivencia a cortes reales; la durabilidad es la de `fsync` sobre archivo y directorios.
- **Coordinación entre procesos:** se emula con varias instancias en un mismo proceso sobre el mismo sistema de archivos (plan §13).

## Próxima tarea concreta

Decisión del propietario sobre §8.5 en APFS y revisión del PR. Después, con autorización, el bloque 3 de P1-T5: captura de correo (§9) sobre la misma raíz.
