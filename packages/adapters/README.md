# @sistema-chatbot/adapters

Adaptadores locales de desarrollo y prueba (plan de P1-T5, `docs/plans/P1-T5-adaptadores-locales.md`): carpeta privada, captura de correo sin entrega real y scanner simulado etiquetado. Según ADR-001 depende solo de `contracts` y `flow-schema`, sin dependencias de npm nuevas ni acceso a la base.

## Alcance parcial (§14, pasos 1 a 7)

Esta versión incluye:

- **La base del paquete (pasos 1 y 2):** guardas de entorno, configuración validada sobre la forma declarada y límites de dependencias.
- **El almacenamiento local (bloque 2):** el puerto `ObjectStorage` (`ports/storage.ts`), la raíz privada con sus controles reales de sistema de archivos (§6), el área de trabajo con su `instance.json`, la limpieza en ejecución y el ciclo de vida (§7.1, §7.2 y §7.5), y la implementación `LocalPrivateFolderStorage` (§8).
- **La captura local de correo (bloque 3):** el puerto `EmailSender` (`ports/email.ts`) y la captura en disco sin entrega real (§9), con el bloqueo por clave entre instancias y procesos (§9.4), `readCapture`, `purgeCaptures`, `recoverWorkArea` y `close`.

**No incluye todavía** (bloques siguientes de P1-T5): el scanner (§10), la composición (`createLocalAdapters`, `assertSafeComposition`, con la prueba de enlace duro retirada de la raíz del repositorio, §11) ni el comando de mantenimiento (§7.3, que incluye el punto de entrada `@sistema-chatbot/adapters/maintenance`). La captura depende de ese mantenimiento para recuperar bloqueos abandonados por una caída (ver las limitaciones).

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

## Almacenamiento local (plan §6, §7.1–7.2, §7.5 y §8)

`createLocalPrivateFolderStorage(appEnv, options)` construye `LocalPrivateFolderStorage`, que implementa el puerto `ObjectStorage` (`put`, `open`, `delete`, `listObjects`, `resolveUncertainPublication`) sobre una **raíz privada**: `<raíz>/objects/<clave>`, `tmp/<instancia>/` y `.reclaim/`.

- **Construcción (§6):** guarda de entorno; forma de la ruta (`ROOT_PATH_SHAPE`); recorrido de la ruta configurada (sin enlaces de usuario, `ANCESTOR_SYMLINK`) y de la canónica hasta el padre de la raíz (antecesores de root o del usuario, sin escritura de grupo ni de otros salvo la excepción sticky, `ANCESTOR_*`); raíz y subdirectorios del usuario del proceso con modo exacto `0700` (`ROOT_*`, `SUBDIRECTORY_*`), nunca corregidos en silencio; prueba de enlace duro en `tmp/` (`HARD_LINK_UNSUPPORTED`); área de trabajo con `instance.json` (0600, sin datos personales).
- **Creación de lo que falta (§6.4):** antes de crear un directorio se validan los antecesores existentes, incluida la ruta canónica del último, que va a ser su padre. Cada directorio se pide a `mkdir` con `0700` (nunca existe con más permisos) y se reafirma con `chmod` porque la umask puede recortarlo; un componente recién creado que no resulta del usuario detiene la creación. Si `mkdir` da `EEXIST` porque otra instancia lo creó en el medio, se comprueba como existente.
- **Ausencia:** solo `ENOENT` cuenta como "no existe". `EACCES`, `EIO` y los demás errores del sistema se propagan, o se informan en la fase que corresponde (`BEFORE_REMOVE` en `delete`); nunca se tratan como ausencia.
- **Cada operación (§6.5):** verifica `dev`/`ino`/tipo/dueño/modo de la raíz y de los subdirectorios que usa (`*_REPLACED`, `UNEXPECTED_ENTRY_TYPE`). Los antecesores se recorren al construir y en cada limpieza, sin crear nada: si la raíz desapareció, la limpieza falla con `ROOT_REPLACED` y no la vuelve a crear.
- **Claves (§8.2):** 32 hexadecimales en minúscula generados por el adaptador (`^[0-9a-f]{32}$`); ningún dato del llamador forma la ruta.
- **Publicación (§8.3–8.4):** temporal con `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` y modo `0600`; copia con escritura completa (si `write` escribe menos de lo pedido, el bucle sigue con los bytes realmente escritos y una escritura sin progreso falla con `BEFORE_PUBLISH`), conteo de bytes y SHA-256 sobre lo escrito; límite aplicado durante la escritura (deja de leer al superarlo); publicación solo con `link(temporal, objects/<clave>)`, que nunca reemplaza un destino existente (`KEY_COLLISION`). Los resultados por fase son `StorageWriteError` con `phase` `BEFORE_PUBLISH`, `AFTER_PUBLISH` (`key` y `objectState` `WITHDRAWN` o `LEFT_IN_PLACE`), `BEFORE_REMOVE` y `AFTER_REMOVE`. Si `fsync` del directorio falla después del `link`, el adaptador retira el objeto; si el retiro también falla, informa `LEFT_IN_PLACE` para que el host registre la clave (P2).
- **Propiedad del temporal (§8.3):** una operación solo borra el temporal que ella creó. Si la apertura con `O_EXCL` falla (también con `EEXIST`), la entrada que ya estaba no se toca. El id de operación se registra de forma exclusiva: una colisión hace fallar la operación nueva sin tocar el temporal ni el registro de la otra.
- **Publicación incierta (§8.4.1, decisión B2 del propietario):** si `link` falla y el `lstat` que compara `dev`/`ino` también falla, no se sabe si bajo la clave quedó nada, este objeto o un objeto anterior. El resultado es `UncertainPublicationError` con la clave: no es `AFTER_PUBLISH`, no es un objeto propio confirmado y no autoriza a borrarla.
  - El temporal queda retenido como prueba de pertenencia: sigue enlazado al inodo de los bytes escritos, así que ningún otro archivo puede tener su `dev`/`ino`.
  - La única recuperación es `resolveUncertainPublication(clave)`, en la misma instancia. Da `WITHDRAWN` si bajo la clave está ese mismo inodo (lo retira de forma exclusiva), `NOT_PUBLISHED` si la clave está vacía, `KEY_HELD_BY_OTHER` si hay otra entrada (que no se toca) y `NOT_RETAINED` si no hay nada pendiente. Si la comparación vuelve a fallar o la prueba se perdió, sigue incierta y no retira nada.
  - Mientras está pendiente, `delete` de esa clave rechaza con el mismo error; la limpieza no toca la prueba; `close` conserva el directorio de la instancia e informa `retainedEntries`.
- **Cancelación (§8.3):** con `AbortSignal`, mientras se reciben bytes y hasta justo antes del `link`; la última comprobación ocurre sin ninguna espera entre ella y la publicación. Después de un `link` exitoso se ignora, porque el objeto ya existe. Una cancelación no espera a la fuente: se le pide `return()` sin esperarlo, el descriptor se cierra y el temporal se borra. Al agotarse la fuente no se llama a `return()` (protocolo de iteración).
- **Durabilidad:** los objetos y los borrados se confirman con `fsync` del archivo (paso 4) y de `objects/` (paso 6); un `ALREADY_ABSENT` que concluye sin error confirma con el `fsync` la durabilidad de un borrado anterior.
- **Lectura (§8.5):** `open` comprueba con `fstat` sobre el descriptor (regular del usuario, `0600`, `O_NOFOLLOW`; no carga el archivo en memoria) y una interrupción del recorrido cierra el descriptor; si se borra un objeto mientras se lee, la lectura en curso sigue (semántica POSIX).
- **Borrado con retiro exclusivo (§8.5, decisión B1 del propietario):** `delete` crea con `mkdir` (exclusivo) un destino privado de la operación, `tmp/<instancia>/del-<op>/`, y retira el objeto con `rename(objects/<clave>, del-<op>/<clave>)`.
  - Antes del traslado, el directorio recién creado se reafirma en 0700 con `chmod` (la umask puede dejarlo en 000) y se verifica tipo, dueño y modo.
  - Si eso falla, el error es `BEFORE_REMOVE`, el objeto queda intacto y se retira solo ese directorio vacío (`rmdir`); si no se puede, queda retenido.
  - Un `del-<op>/` que ya existía (`EEXIST`) no se modifica ni se borra.
  - Ese `rename` es el punto en que el objeto deja de estar disponible. Después vienen el `fsync` de `objects/`, el resultado `DELETED` y el borrado físico.
  - Entre dos borrados concurrentes, también de dos instancias o procesos sobre la misma raíz, solo un `rename` encuentra el origen: el otro da `ALREADY_ABSENT`. No es un bloqueo en memoria ni hay bloqueos que romper.
  - Lo trasladado se compara con lo comprobado (`dev`/`ino`). Si cambió, se restituye y se rechaza con `TARGET_CHANGED`, sin borrar nada.
  - Si falla el borrado físico, `delete` da `DELETED` igual y emite `DELETED_OBJECT_RESIDUE`. La limpieza propia lo retoma.
  - Es repetible: después de `DELETED` o `AFTER_REMOVE`, el reintento da `ALREADY_ABSENT`.
- **Entorno en lo diferido (§5.4):** `listObjects()` vuelve a comprobar `APP_ENV` al empezar a consumirse y al reanudarse; el stream de `open` lo comprueba antes de cada lectura y cierra el descriptor si rechaza; `put` lo comprueba otra vez justo antes del `link`, porque la fuente puede tardar.
- **Limpieza en ejecución (§7.2):** `recoverWorkArea()` retoma los restos propios (temporales, `del-<op>/` y `lock-<op>` de operaciones que ya no están activas ni retenidas, sin tocar `instance.json`) y drena `.reclaim/`. Con la misma regla del principio A4, nunca toca temporales ni bloqueos de otras instancias, por viejos que sean: la antigüedad no prueba abandono. Si la construcción falla al escribir `instance.json`, se borra el directorio de esa instancia.
- **Ciclo de vida y cierre (§7.5):**
  - `close()` pasa la instancia a `CLOSING` antes de cualquier espera: desde ahí, `put`, `open`, `delete`, `listObjects` (al empezar a consumirse), `resolveUncertainPublication` y `recoverWorkArea` rechazan con `StorageClosedError`, sin efectos;
  - espera a las operaciones admitidas antes, que conservan su temporal y su destino privado;
  - después limpia y borra `tmp/<instancia>/`, salvo que haya entradas retenidas (informa `retainedEntries`);
  - las llamadas concurrentes comparten el intento, y las posteriores devuelven el mismo informe sin tocar el disco;
  - un cierre fallido deja la instancia sin admitir operaciones, y el siguiente `close()` reintenta;
  - los streams abiertos antes del cierre siguen leyendo.

Las inyecciones internas (`fileOps`, `instanceId`, `timing`, `randomHex128`, `onMaintenanceEvent`) solo existen para las pruebas y no son parte del contrato público; la opción `onMaintenanceEvent` informa eventos sin datos: `PUBLISHED_TEMPORARY_RESIDUE` cuando el temporal publicado queda sin borrar y `DELETED_OBJECT_RESIDUE` cuando falla el borrado físico de un objeto ya retirado. La limpieza en ejecución retoma los dos.

## Captura local de correo (plan §9)

`createLocalCaptureEmailSender(appEnv, { rootPath, retentionDays?, recordDays?, maxFileBytes? })` construye `LocalCaptureEmailSender`, que implementa `EmailSender` con `kind: "LOCAL_CAPTURE"` y `deliversExternally: false`.

Nunca entrega un correo ni abre conexiones. El resultado es `CAPTURED` con `delivered: false`: no equivale a `PROVIDER_ACCEPTED` ni a `DELIVERED`, y su registro en `deliveries` es de P2 (decisión A3).

- **Raíz:** `<raíz>/captures/`, `locks/`, `tmp/` y `.reclaim/`. Tiene las mismas guardas de §6 que el almacenamiento: antecesores, 0700 y 0600 aun con la umask restrictiva, y verificación por `dev`/`ino` en cada operación.
- **Validación previa (§9.2), `REJECTED` sin escribir nada:**
  - clave de idempotencia: ASCII imprimible, de 1 a 200 caracteres;
  - asunto final: no vacío, hasta 200 caracteres y sin CR ni LF (`SUBJECT_LINE_BREAK`, con `lineBreakPosition`). Es la parte del adaptador de T53;
  - destinatarios: de 1 a 20, con forma de email, sin caracteres de control y sin repetir;
  - cuerpo: no vacío, hasta 64 KiB y sin caracteres de control salvo tabulador y LF;
  - adjunto: nombre sin control, `/` ni `\`, de 1 a 255 caracteres, y MIME de `ALLOWED_MIME_TYPES`.
  - Un adjunto que supera `maxFileBytes` se rechaza durante la copia (`ATTACHMENT_TOO_LARGE`), que deja de leer.
- **Formato (§9.3):**
  - `captures/<captureId>/record.json`: solo hashes, `publicationId`, fecha y constantes, sin datos personales ni la clave en claro;
  - `payload/message.json`, con destinatarios, asunto, cuerpo y metadatos del adjunto;
  - `payload/attachment.bin`.
  - `captureId` son los primeros 32 hexadecimales del SHA-256 de la clave. Ni la clave ni el nombre original forman rutas.
- **Envío (§9.5):**
  1. Prepara sin bloqueo `tmp/<instancia>/lock-<op>/` con `owner.json` y la captura completa en `staged/`. El adjunto se copia por streaming, con el límite y el SHA-256 de los bytes reales; cada archivo y directorio tiene `fsync`.
  2. Toma el bloqueo de la clave con un único `rename` a `locks/<captureId>`, que lleva lo preparado consigo.
  3. Bajo el bloqueo, publica con `rename(staged, captures/<id>)` (es el punto de publicación), hace `fsync` de `captures/` y libera.
  - Fases: `BEFORE_PUBLISH`, `AFTER_PUBLISH` (la captura se conserva y el reintento la confirma) y `PUBLISH_UNCERTAIN` (no se sabe si se publicó; el reintento con la misma clave lo resuelve).
- **Idempotencia (§9.6):**
  - con la misma clave y el mismo contenido, `duplicate: true`, verificando tamaños y hashes de lo guardado;
  - con otro contenido, `IDEMPOTENCY_CONFLICT`, sin tocar la existente;
  - una entrada corrupta, ajena o sin `record.json` (aunque esté vacía) es `CaptureIntegrityError` y nunca se sobrescribe.
- **Bloqueo por clave (§9.4):**
  - la exclusión la da el `rename` del sistema de archivos, así que vale entre instancias y entre procesos. No es un mutex en memoria;
  - `send` y la comprobación de `readCapture` esperan de 20 a 200 ms, hasta 5 s (`CAPTURE_LOCK_WAIT`), y si no lo obtienen dan `CaptureKeyBusyError` (`KEY_BUSY`);
  - la purga no espera y omite la clave;
  - no hay ruptura automática: ni por antigüedad, ni por pid, ni por inactividad aparente. Un titular pausado conserva el bloqueo, y solo el titular lo libera, después de comprobar que sigue siendo el suyo.
- **Lectura (§9.7):** `readCapture` lee sin bloqueo y valida todo contra `contentSha256`. Ante cualquier anomalía decide bajo el bloqueo. Devuelve los datos íntegros, el registro sin contenido o `CaptureNotFoundError`, nunca una mezcla.
- **Retención (§9.8):** `purgeCaptures()` cuenta los plazos desde `capturedAt`: 7 días para el contenido y 30 para el registro, configurables. Relee bajo el bloqueo y compara `publicationId`, así nunca borra una captura recreada. Purgar el contenido conserva la deduplicación.
- **Limpieza y cierre:** `recoverWorkArea()` y `close()` tienen la misma regla y el mismo ciclo de vida que el almacenamiento (§7.2 y §7.5). Además reintentan liberar los bloqueos propios cuya liberación falló; nunca tocan los ajenos.
  - `send`, `readCapture`, `purgeCaptures` y `recoverWorkArea` se admiten al empezar, y `close` los espera.
  - Los bloqueos que toman `readCapture` (cuando decide bajo el bloqueo) y la purga (uno por candidato) son pasos internos: se registran con la admisión de su operación, sin volver a pedirla. Si el cierre empieza durante el escaneo o entre candidatos, la operación termina y el cierre la espera; no borra lo que la operación preparó.
  - Una operación nueva rechaza con `CaptureClosedError` desde que empieza el cierre.
- **Guardas de entorno durante la operación (§5.4):** además de al empezar, el entorno se comprueba:
  - antes de cada intento de adquisición, después de la copia del adjunto y de cada espera del bloqueo;
  - justo antes del `rename` de publicación y de cada traslado de la purga, sin esperas en el medio;
  - en `readCapture`, antes de entregar.

  Un rechazo en esos puntos (`AdapterEnvironmentError`) no publica ni traslada nada, retira lo preparado y libera el bloqueo propio: la liberación y la limpieza nunca se condicionan al entorno. Después del `rename` de publicación no hay más controles: `send` termina (`fsync` y liberación) y devuelve `CAPTURED`, nunca `BEFORE_PUBLISH`.

## Límites de dependencias

- `contracts` y `flow-schema`, controlados en `scripts/check-workspace-boundaries.mjs` y en ESLint.
- Los módulos de `src/local/**` y `src/maintenance/**` no pueden importar módulos de red ni procesos (`net`, `tls`, `http`, `https`, `http2`, `dgram`, `dns`, `child_process`, con y sin `node:`); el resto de módulos de Node sí.
- El punto de entrada `@sistema-chatbot/adapters/maintenance` se agrega en el mismo bloque que implementa el mantenimiento; no hay exportaciones sin implementación.

## Limitaciones de este bloque (§6.6, verificadas con las pruebas)

- **Etapas y alcance:** este bloque no envía ni recibe nada: solo archivos locales de la propia máquina, con datos de demo. La entrega real depende de P2+.
- **Mismo usuario:** quién puede leer qué documento es una autorización del host (P4); dentro del mismo usuario, un código arbitrario puede reemplazar entradas (`objects/<clave>`, la instancia de `tmp/`). Las guardas detectan reemplazos de raíz y subdirectorios por `dev`/`ino`, y los objetos en curso siguen legibles si la entrada la reemplaza otro archivo.
- **Identidad por inodo:** un directorio borrado y vuelto a crear puede recibir el mismo número de inodo; entonces `dev`/`ino` no distinguen el reemplazo. Se observó en la CI de Linux (run #45, 22/10/2026) con `rm` + `mkdir` de `objects/`. Es el caso de un proceso del mismo usuario, fuera del modelo de amenazas (§6.6); la prueba conserva el original con `rename` para que el reemplazo tenga otro inodo.
- **ACL de macOS:** una entrada sin permiso de otros en el modo Unix puede aún ser legible vía ACL, y `lstat` no la examina; es una limitación conocida del plan (§6.6), no corregida aquí.
- **Fuentes que no cooperan:** al cancelar o al fallar, `put` le pide `return()` a la fuente sin esperarlo. El adaptador no puede obligarla a liberar lo que tenga abierto: si nunca responde, su espera queda abandonada (sin consumirse ni producir rechazos sin manejar). Una escritura en disco ya iniciada tampoco se interrumpe: la cancelación se observa entre trozos y antes del `link`.
- **Borrados concurrentes en APFS:** dos `unlink` concurrentes del mismo nombre devuelven éxito los dos en la gran mayoría de los pares (entre el 95 % y el 99,9 % según la corrida; medido el 27/10/2026 en macOS 27.0.1, APFS, Node 24.22.1, con `scripts/evidence/apfs-dup-unlink-repro.mjs`). Por eso `delete` ya no decide con `unlink`, sino con el retiro exclusivo por `rename`. En la misma medición, ese retiro fue exclusivo en todos los pares: 5000 con `fs.promises` y 3000 con dos hilos simultáneos, a directorios privados distintos. La prueba del contrato corre en macOS y en Linux sin excepciones.
- **Identidad por inodo en el retiro:** la comprobación posterior del retiro compara `dev`/`ino` con los de la comprobación previa. Un proceso del mismo usuario que borre y recree la entrada entre las dos podría obtener el mismo inodo (§6.6). La prueba de una publicación incierta no tiene ese límite, porque el temporal retenido mantiene el inodo ocupado.
- **Publicación incierta y reinicios:** el registro de publicaciones inciertas es de la instancia y se pierde con una caída o con el cierre. Queda la prueba en `tmp/<instancia>/<op>.part`: el enlace se hizo si y solo si `objects/<clave>` comparte inodo con ella (`nlink` 2). La conciliación de P2 tiene que excluir las claves inciertas de los huérfanos.
- **Cierre retenido:** `close()` espera a las operaciones admitidas; un `put` sin señal con una fuente que nunca responde lo retiene (se cancela con `AbortSignal`).
- **Contenido de objetos borrados después de una caída:** si la instancia cae después del retiro y antes del borrado físico, el contenido queda en `tmp/<instancia>/del-<op>/` hasta el mantenimiento (§7.3).
- **Mantenimiento limitado:** el mantenimiento completo con consumidores detenidos (restos de otras instancias, pruebas retenidas, `del-<op>/` de instancias caídas) pertenece al comando de §7.3, en un bloque posterior.
- **Captura y bloqueos abandonados:** si un proceso cae con el bloqueo de una clave tomado, esa clave da `KEY_BUSY` y la purga la omite hasta el mantenimiento de §7.3, que todavía no existe. Es la pérdida de disponibilidad aceptada en A4, a cambio de no romper bloqueos de procesos pausados pero vivos.
- **Captura e idempotencia:** deduplica por clave mientras existe el registro (30 días por defecto). Después, la misma clave crea otra captura con otro `publicationId`. La idempotencia durable de las entregas es del host (P2).
- **Captura y mismo usuario:** un proceso del mismo usuario que actúe fuera del protocolo (por ejemplo, plantando un directorio vacío en `captures/<id>` entre la comprobación y la publicación) queda fuera del modelo de amenazas (§6.6). Lo que alcanza a una entrada se detecta como `CaptureIntegrityError` cuando se lee, sin garantía de detectarlo siempre.
- **Captura y datos personales:** el contenido (`payload/`) tiene destinatarios, asunto, cuerpo y adjunto ficticios en desarrollo. Está protegido con 0700 y 0600 y se purga a los 7 días; no se registra en logs ni se expone por HTTP.
- **La limpieza en ejecución no borra `tmp/<instancia>` ajeno:** el retiro de restos de otras instancias corresponde al mantenimiento con consumidores detenidos; hasta entonces se conservan.
- **`listObjects` solo enumera:** la conciliación de huérfanos (marcar datos dudosos, P2) todavía no existe; el listado nunca intenta borrar ni transformar lo que encuentra.

## Pruebas

`pnpm run test` en este paquete (vitest), sin base de datos: configuración y guardas de entorno; raíz privada con archivos reales bajo `mkdtemp` (borrados al terminar cada prueba) y casos sintéticos para lo que requiere otro usuario o root; almacenamiento con ida y vuelta, límites, fases por inyección de `FileOps`, cancelación, fuentes que no cooperan, errores del sistema, publicación incierta, propiedad de temporales, borrados concurrentes reales (una y dos instancias), ciclo de vida con compuertas y limpieza en ejecución. La captura de correo tiene sus pruebas en `test/capture-*.test.ts`:
- validación, formato y permisos;
- duplicados, conflictos y corrupción;
- fases de §9.5 y orden de los `fsync`;
- bloqueo con reloj manual, titular pausado y proceso caído;
- envíos simultáneos y una prueba con un proceso hijo real (`test/fixtures/`);
- lectura y purga concurrentes, retención y los escenarios de la purga pausada;
- ciclo de vida y guardas, incluidos el cierre durante el escaneo y entre candidatos de la purga, el cierre mientras `readCapture` pasa al camino con bloqueo, y el cambio de entorno durante la copia, la espera del bloqueo, antes de publicar, durante la lectura y durante la purga.
