# P1-T5 (parcial): almacenamiento local — raíz privada, área de trabajo y `ObjectStorage`

## Destino del PR

`main` (`274b2d5`, PRs #12 y #13 ya fusionados). La rama `p1/t5-private-storage` sale de `main` actualizado y no depende de otra rama abierta.

## Estado

En revisión del propietario, sin fusionar. Las dos decisiones que estaban pendientes se aprobaron el 27/10/2026 (B1 y B2 del plan §18.1) y están implementadas. Las pruebas del paquete pasan en macOS (APFS) y en Linux (CI); los resultados por SHA están en `PROJECT_STATUS.md` y en la entrega.

## Problema resuelto

El primer bloque de P1-T5 solo validaba la forma de la configuración. Faltaban el puerto `ObjectStorage` del plan §8 y la raíz privada con sus controles reales sobre el sistema de archivos (§6, §7.1–7.2), que son el paso 3 de §14. La publicación tenía que hacerse con `link`, que existe en macOS y en Linux: con `rename` se podría reemplazar un destino existente y se romperían las fases de §8.4.

## Alcance

**Entrega parcial de P1-T5** (solo el bloque 2 del plan: almacenamiento). Incluye:

1. **Puerto `ObjectStorage` (`src/ports/storage.ts`):** `put` (con `maxBytes` y `AbortSignal`), `open`, `delete`, `listObjects` y `resolveUncertainPublication`; errores tipados (`StorageIntegrityError` con `reason`, `StorageWriteError` con `phase`/`key`/`objectState`/`failureReason`, `UncertainPublicationError` con `key`, `StorageClosedError`, `ObjectTooLargeError`, `EmptyObjectError`, `ObjectNotFoundError`, `InvalidObjectKeyError`). Los errores y resultados llevan la clave y códigos, nunca contenido ni rutas completas.
2. **Raíz privada (§6) en `src/local/private-root.ts`:**
   - forma de la ruta (`ROOT_PATH_SHAPE`, `PATH_COMPONENT_NOT_DIRECTORY`);
   - recorrido de la ruta configurada (sin enlaces de usuario; componentes con escritura de otros rechazados, `ANCESTOR_*`) y de la canónica hasta el padre de la raíz;
   - antes de crear un directorio, validación de los antecesores existentes, incluida la ruta canónica del último; cada directorio nace `0700` desde `mkdir` y se reafirma con `chmod`; un `EEXIST` de otra instancia se vuelve a comprobar (§6.4);
   - raíz y subdirectorios del usuario del proceso con modo exacto `0700`; si existen con otro modo o dueño, la construcción falla (`ROOT_*`, `SUBDIRECTORY_*`) y nada se corrige en silencio;
   - un contexto con `verify(names)` que revalida `dev`/`ino`/tipo/dueño/modo en cada operación (`ROOT_REPLACED`, `SUBDIRECTORY_REPLACED`, `UNEXPECTED_ENTRY_TYPE`);
   - solo `ENOENT` se trata como ausencia; los demás errores del sistema se propagan.
3. **Área de trabajo y ciclo de vida (§7.1, §7.2 y §7.5) en `src/local/work-area.ts`:**
   - `tmp/<instancia>/` con `instance.json` (0600, sin datos personales, escrito completo);
   - registro exclusivo en memoria de operaciones activas y de entradas retenidas;
   - `cleanLeftovers()` con retiro a `.reclaim/` y drenaje (un `ENOENT` de una carrera entre instancias cuenta como borrado). La limpieza nunca toca lo de otras instancias, por viejo que sea (principio A4, aprobado), ni lo activo ni lo retenido;
   - estados `OPEN`, `CLOSING` y `CLOSED`, con la admisión de operaciones y la espera del cierre.
4. **Implementación (§8) en `src/local/private-folder-storage.ts`:**
   - temporal con `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` y `0600` reafirmado con `fchmod` (§6.4); copia con escritura completa (los `write` parciales se completan y una escritura sin progreso falla), conteo de bytes y SHA-256 incremental sobre lo escrito; sin `eval` ni rutas arbitrarias;
   - publicación solo con `link(temporal, objects/<clave>)`, nunca con `rename`: el `link` no reemplaza destinos, y un error espurio se resuelve comparando `dev`/`ino`. Durabilidad con `fsync` del archivo (paso 4) y del directorio `objects/` (paso 6); también en `ALREADY_ABSENT`, que así confirma la durabilidad de un borrado anterior;
   - resultados por fase: `BEFORE_PUBLISH` (temporal borrado; solo `link` crea el objeto), `AFTER_PUBLISH` (`key` y `objectState`: `WITHDRAWN` o `LEFT_IN_PLACE`, para que el host registre la clave en P2), `BEFORE_REMOVE` y `AFTER_REMOVE`. Un `fsync` fallido después de un `unlink` deja el objeto no visible, y el reintento confirma la durabilidad;
   - cancelación (`AbortSignal`) mientras se reciben bytes y hasta justo antes del `link`, sin esperar a una fuente que no responde; después de un `link` exitoso se ignora (`put` resuelve y el objeto queda);
   - publicación incierta (§8.4.1): si `link` y la comparación de `dev`/`ino` fallan, `UncertainPublicationError`, con el temporal retenido como prueba de pertenencia y la conciliación con `resolveUncertainPublication`;
   - solo se borra el temporal que la operación creó (§8.3);
   - lectura con `O_RDONLY | O_NOFOLLOW`, `fstat` sobre el descriptor (regular del usuario, `0600`, §8.5) y stream por trozos (no carga el archivo en memoria), con cierre determinista al interrumpir el recorrido (`break`/`throw`/`return`). Si el mismo usuario reemplaza la entrada, la lectura en curso sigue (semántica POSIX, limitación documentada);
   - borrado con retiro exclusivo (§8.5): `rename` a `tmp/<instancia>/del-<op>/`, comprobación posterior, `fsync` de `objects/` y borrado físico. Un `DELETED` y un `ALREADY_ABSENT` entre borrados concurrentes, también en APFS y entre instancias;
   - claves de 32 hex en minúscula generadas internamente (`^[0-9a-f]{32}$`); `listObjects` salta las entradas que no son claves u objetos del propio usuario;
   - guardas de entorno en cada operación y en lo diferido: `listObjects` al consumirse y reanudarse, el stream de `open` antes de cada lectura, y `put` justo antes del `link`;
   - eventos de mantenimiento sin datos: `PUBLISHED_TEMPORARY_RESIDUE`, cuando el temporal publicado queda sin borrar, y `DELETED_OBJECT_RESIDUE`, cuando falla el borrado físico de un objeto ya retirado.
5. **Prueba de compatibilidad (§6.4):** la construcción prueba un enlace duro en `tmp/` y falla con `HARD_LINK_UNSUPPORTED` si el sistema de archivos no lo admite (exFAT, algunos montajes de red), limpiando sus residuos.
6. **`FileOps` inyectable (`src/local/file-ops.ts`):** interfaz mínima con implementación por defecto sobre `node:fs/promises`. Las pruebas la decoran para inyectar fallos y pausas en cada paso, siempre con archivos reales.

## Fuera de alcance (bloques siguientes)

- Captura de correo (§9), scanner (§10), composición de `createLocalAdapters` con su guarda de rutas (§11), comando de mantenimiento de §7.3 (incluido el punto de entrada `@sistema-chatbot/adapters/maintenance`), conciliación de huérfanos (P2), API, motor y migraciones.
- P1-T5 sigue en curso; este PR no cierra el paquete.

## Cambios relevantes

- `packages/adapters/src/`: `ports/storage.ts`, `local/file-ops.ts`, `local/private-root.ts`, `local/work-area.ts`, `local/private-folder-storage.ts`, e `index.ts` ampliado con los exports públicos del bloque (los módulos `local/*` no se exportan fuera del paquete).
- `packages/adapters/test/`:
  - `support.ts`: directorios reales con `mkdtemp`, borrados al terminar cada prueba; decoradores de `FileOps`; compuertas; plazos; ids deterministas;
  - pruebas: `private-root-decisions.test.ts` (18), `private-root.test.ts` (25), `storage.test.ts` (21), `storage-phases.test.ts` (50), `storage-cleanup.test.ts` (12) y `environment-guards.test.ts` (9); además `config.test.ts` (49) y `environment.test.ts` (19) del bloque anterior. Total del paquete: 203.
- `packages/adapters/README.md`: alcance, comportamiento y limitaciones de §6.6.
- `docs/plans/P1-T5-adaptadores-locales.md`: §7.1, §7.2, §7.4, §7.5 (nuevo), §8.1, §8.4, §8.4.1 (nuevo), §8.5, §8.6, §13, §16 y §18.1 (B1 y B2).
- `scripts/evidence/apfs-dup-unlink-repro.mjs`: reproducción aislada de los borrados concurrentes con llamadas reales, incluido el retiro a directorios privados, también con dos hilos simultáneos.

## Correcciones de revisión, primera ronda (27/10/2026, `b450156`)

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
| D5 | Errores del sistema tratados como ausencia o como otra cosa: `verify` (cualquier error → `*_REPLACED`), `open` (→ `TARGET_TYPE`), la reconciliación del `link` (→ destino ausente) | Solo `ENOENT` es ausencia; `verify` y `open` propagan; `delete` informa `BEFORE_REMOVE` con clave; el `link` no verificable informaba `AFTER_PUBLISH` con clave y `LEFT_IN_PLACE` (o `KEY_COLLISION` si fue `EEXIST`). **Esto último era un defecto: lo reemplazó la segunda ronda (abajo).** |
| E | Prueba de reemplazo dependiente de que el sistema no reutilice el inodo | El original se conserva con `rename`; con contenido real; variante para la raíz |
| F | Afirmación sobre APFS apoyada en una reproducción defectuosa (imprimía cada éxito como `"RECHAZADO"`) y prueba del contrato debilitada | Reproducción corregida y medida; prueba estricta restituida. La corrección del borrado está en la segunda ronda |

En esa ronda, cada corrección tiene una regresión que pasa con la corrección y falla sin ella. 19 fallaron contra el árbol anterior a estas correcciones (`f6dd311` más los cambios locales sin commit que había). Las demás se comprobaron con 4 mutaciones temporales del código corregido, retiradas después (`cmp` sin diferencias): esperar `return()` al cancelar, quitar la comprobación de cancelación antes del `link`, tratar como ausencia un error de `lstat` en `listObjects` y crear directorios sin modo. Algunas regresiones ya pasaban con esos cambios locales y quedan como protección: las variantes "queda pendiente" y "rechaza" de `return()`, y `listObjects` con `EACCES`.

## Correcciones de revisión, segunda ronda (27/10/2026, `89d7afb`)

Decisiones del propietario (plan §18.1):
- **B1:** conservar el contrato del borrado concurrente (un `DELETED` y un `ALREADY_ABSENT`), también en macOS/APFS.
- **B2:** representar de forma explícita una publicación cuyo resultado no se pudo determinar, sin clasificarla como objeto propio confirmado ni autorizar su eliminación sin comprobar pertenencia.

| # | Defecto reproducido en la revisión | Corrección |
|---|---|---|
| 1 | `link` y su comparación fallan con `EIO` sobre una clave con un objeto anterior. Se informaba `AFTER_PUBLISH`/`LEFT_IN_PLACE`, y seguir la recuperación indicada (borrar la clave) borraba el objeto anterior | `UncertainPublicationError` con la clave (§8.4.1). El temporal queda retenido como prueba de pertenencia: ningún otro archivo puede tener su `dev`/`ino`. `resolveUncertainPublication` retira solo si la clave tiene ese inodo (`WITHDRAWN`); si está vacía, `NOT_PUBLISHED`; si hay otra entrada, `KEY_HELD_BY_OTHER` y no la toca. `delete` de la clave rechaza mientras esté pendiente |
| 2 | `close()` comprobaba las operaciones activas y después esperaba el `rm`: un `put` que entraba en ese momento abría su temporal y fallaba con `ENOENT` | Ciclo de vida `OPEN`/`CLOSING`/`CLOSED` (§7.5). `close` pasa a `CLOSING` antes de esperar; las operaciones nuevas rechazan con `StorageClosedError`; las admitidas antes terminan y `close` las espera; las llamadas concurrentes comparten el intento; un cierre fallido se reintenta |
| 3 | Con `<op>.part` preexistente, `openTempForWrite` daba `EEXIST` y el `catch` de `put` borraba el archivo ajeno. Una colisión de id además quitaba del registro la operación activa | Registro exclusivo de ids (la operación nueva falla sin tocar la otra) y propiedad explícita: solo se borra lo que la operación creó. Si falla `fchmod` después de crear, la apertura borra lo suyo |
| 4 | En APFS, dos `unlink` concurrentes del mismo nombre dan éxito los dos, y `delete` informaba `DELETED` dos veces | Retiro exclusivo (§8.5): `mkdir` exclusivo de `tmp/<instancia>/del-<op>/` y `rename` del objeto ahí; comprobación posterior de `dev`/`ino` con restitución (`TARGET_CHANGED`); `fsync` de `objects/`; borrado físico. La exclusión es del sistema de archivos, no un mutex en memoria |

**Regresiones:** 25 pruebas fallan con los módulos de `589f683` (`private-folder-storage`, `work-area` y `file-ops`) y pasan con la corrección. Se ejecutó con el puerto nuevo para que los tipos existieran, y los archivos se restauraron después (`cmp` sin diferencias). Con el código anterior, los cuatro escenarios de la revisión fallan por la causa esperada:
- la publicación incierta daba `StorageWriteError` (`AFTER_PUBLISH`);
- el `put` admitido durante el cierre terminaba en `StorageWriteError` porque `close` había borrado su directorio;
- el `.part` preexistente desaparecía;
- el borrado concurrente daba `DELETED+DELETED` en 99 de 100 rondas.

## Corrección de revisión, tercera ronda (27/10/2026, `afc789c`): permisos del destino privado

- **Defecto:** el destino privado del retiro se creaba con `mkdir(del-<op>, 0o700)`, y la umask puede recortar ese modo. Con umask 0777 quedaba en 000 y el `rename` del retiro fallaba con `EACCES`, así que `delete` y la conciliación de una publicación incierta no podían terminar.
- **Corrección (plan §8.5, paso 2):** antes de trasladar nada, el directorio recién creado se reafirma en 0700 con `chmod` y se verifica con `lstat` que sea un directorio, del usuario del proceso y con modo exactamente 0700, como en §6.4.
  - Si la preparación falla: `BEFORE_REMOVE` (o, en la conciliación, la publicación sigue incierta) y el objeto intacto bajo su clave.
  - Se retira solo el directorio vacío que creó esta operación, con `rmdir`, que nunca se lleva contenido. Si no se puede, queda retenido y ninguna limpieza lo toca.
  - Un `del-<op>/` que ya existía (`EEXIST`) no se modifica ni se borra.
- **Regresiones (8 nuevas, más una afirmación en la prueba de `EEXIST`):**
  - umask 0777 en `delete` y en la conciliación. La umask se cambia solo durante esa llamada, se restaura siempre (también si falla) y cada archivo de pruebas corre en su propio proceso;
  - fallos de `chmod`, modo, dueño y tipo;
  - directorio no retirable retenido después de `recoverWorkArea` y de `close`.
- **Detección:**
  - con el código de `a7c7d12`, las 7 regresiones de comportamiento fallan; la de umask, con `EACCES` en el `rename`;
  - 3 mutaciones temporales de la corrección se detectaron y se retiraron (`cmp` sin diferencias): sin `chmod`, sin verificación y sin retener cuando `rmdir` falla.

## Validación

**Local, tercera ronda (macOS 27.0.1, APFS; Node 24.22.1, pnpm 12.12.1), sobre `afc789c`:** `pnpm run check` con código 0: `db` 62, `flow-schema` 132, `contracts` 191, `api` 64 y `adapters` 203. Suite de `adapters` repetida dos veces más: 203/203.

**CI, tercera ronda:** CI #50 sobre `afc789c`, los dos jobs en verde, con `adapters` 203/203 en Linux (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/40536911505).

**Local (macOS 27.0.1, APFS, arm64; Node 24.22.1, pnpm 12.12.1), sobre `89d7afb`:**
- `pnpm install --frozen-lockfile` y `pnpm run check`: código 0. Typecheck, lint, formato, límites, build y pruebas: `db` 62, `flow-schema` 132, `contracts` 191, `api` 64 y `adapters` 195. Incluye las dos pruebas estrictas de §8.5 (100 rondas desde una instancia y desde dos).
- Suite de `adapters` repetida tres veces: 195/195 en las tres.
- `scripts/evidence/apfs-dup-unlink-repro.mjs`: `unlink` concurrente con `OK+OK` en 4962 de 5000 pares; retiro con `rename` a directorios privados, `ENOENT+OK` en 5000 de 5000 con `fs.promises` y en 3000 de 3000 con dos hilos simultáneos.
- `check:db`: no ejecutado en local, porque Docker estaba detenido y el bloque no toca la base ni la API. Lo cubre el job `db` de la CI.

**CI (Linux) y checkout limpio:** por SHA en `PROJECT_STATUS.md` y en la entrega.

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
- **Publicación incierta:** el registro es de la instancia. Después de un cierre o una caída con pendientes, solo queda la prueba en `tmp/<instancia>/<op>.part`, para el mantenimiento (§7.3, bloque posterior): el enlace se hizo si y solo si `objects/<clave>` comparte inodo con ella. `listObjects` puede listar un objeto propio pendiente: la conciliación de P2 tiene que excluir las claves inciertas.
- **Retiro y mismo usuario:** la comprobación posterior del retiro compara `dev`/`ino` con la comprobación previa. Un proceso del mismo usuario que borre y recree la entrada entre las dos podría obtener el mismo inodo (§6.6).
- **Cierre retenido:** `close` espera a las operaciones admitidas; un `put` sin señal con una fuente que no responde lo retiene (se cancela con `AbortSignal`).
- **Contenido borrado después de una caída:** si la instancia cae después del retiro y antes del borrado físico, el contenido queda en `tmp/<instancia>/del-<op>/` hasta el mantenimiento.
- **Coordinación entre procesos:** la exclusión del borrado es del sistema de archivos. Se probó con dos instancias en un proceso y, en la evidencia, con dos hilos con llamadas simultáneas; no con procesos separados de verdad.
- **Mantenimiento:** es de §7.3, en un bloque posterior.
- **Sin pruebas de corte de energía:** no hay afirmaciones de supervivencia a cortes reales; la durabilidad es la de `fsync` sobre archivo y directorios.
- **Coordinación entre procesos:** se emula con varias instancias en un mismo proceso sobre el mismo sistema de archivos (plan §13).

## Próxima tarea concreta

Revisión del PR por el propietario. Después, con autorización, el bloque 3 de P1-T5: captura de correo (§9) sobre la misma raíz.
