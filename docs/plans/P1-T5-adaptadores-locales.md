# Plan de P1-T5 — adaptadores locales (`packages/adapters`)

- Fecha: 21/10/2026
- Estado: **en revisión.** El propietario aprobó cuatro decisiones el 21/10/2026 (§18.1). El resto del plan sigue pendiente de aprobación.
- Alcance de este documento: solo planificación. Ningún control descrito acá está implementado: no se cambió código, dependencias, configuración ni migraciones.
- Base: `main` en `aaf0002` (P1-T1 a P1-T4 cerradas; CI #34 aprobada en los dos jobs).
- Versiones:
  - `0683af0` (CI #35): primera versión publicada;
  - `baad744` (CI #36): decisiones aprobadas y precisiones sobre fallos después de publicar, raíz y antecesores, y limpieza y retención;
  - `ceb46d3` (CI #37): coordinación por clave entre purga, publicación y verificación, y entrada sin registro;
  - esta versión: simplificación del bloqueo, aprobada por el propietario (A4):
    - sin ruptura automática ni cercado;
    - recuperación de bloqueos abandonados solo por mantenimiento con los consumidores detenidos (§7.3 y §9.4);
    - separación entre la limpieza en ejecución y el mantenimiento (§7).
- Fuentes:
  - `docs/15_PLAN_CONSOLIDADO_P0.md` §9;
  - ADR-001, ADR-005, ADR-006, ADR-007, ADR-009 y ADR-014;
  - docs/02, 04, 05, 07, 09 y 10;
  - `packages/contracts` (eventos `JOB` y `SIMULATOR`) y `packages/flow-schema` (límites de asunto y destinatarios);
  - `apps/api/src/config.ts` (modos simulados) y `.env.example`.

## 1. Objetivo y salida verificable

Alcance según docs/15 §9 y lo acordado con el propietario:
- almacenamiento en carpeta privada local;
- captura local de correo, sin entrega real;
- scanner simulado, etiquetado como simulación;
- controles que impiden usar estos adaptadores con `APP_ENV=production`.

**Salida:**
- la de docs/15 §9: "tests que impiden usarlos con `APP_ENV=production`";
- además, las pruebas de los controles de cada adaptador (§13), con archivos reales en disco donde corresponde.

**Fuera de esta tarea:**
- motor, worker, jobs y cola;
- panel y simulador;
- seed general;
- WhatsApp, correo real y scanner real;
- detección de tipo por firma de bytes (P5);
- servicios contratados y dependencias nuevas.

P1-T5 no conecta los adaptadores a ninguna ruta de la API. Su primer consumidor es el host de P2 o P3. La única modificación de la API es la regla de `staging` aprobada (§5).

## 2. Estado de partida (21/10/2026)

**Comprobado por mí:**
- `main` local y `origin/main` en `aaf0002`, con los merges de los PR #7 a #10. Su árbol es idéntico al de `38fab2d`, la última rama revisada de P1-T4.
- CI #34 sobre `aaf0002`: success en los dos jobs (consultada en la API de GitHub).
- Verificación local en `main`, ya informada: `pnpm install --frozen-lockfile`, `check`, `db:up`, `db:migrate` y `check:db`, todos con código 0.
- Node v24.22.1 y pnpm 12.12.1 en un shell de login nuevo.
- **`.env` local:** tiene las claves nuevas del cupo de candidatos y ya no tiene `MAX_FILES_PER_SUBMISSION`. Lo comprobé por los nombres de las claves, sin leer valores.
- `.gitignore` incluye `/storage/`. No existen `packages/adapters` ni `packages/domain`.
- **Directorios temporales de este equipo (macOS):**
  - `os.tmpdir()` es `/var/folders/<..>/<..>/T`;
  - `/var` y `/tmp` son enlaces simbólicos de root dentro de `/`, que apuntan a `/private/var` y `/private/tmp`;
  - `/private/tmp` es de root con modo `1777` (bit sticky);
  - `~/Desktop` tiene una ACL `group:everyone deny delete`.

  En Linux (CI), `/tmp` es un directorio real de root con modo `1777`.

**Informado por el propietario:** la actualización de Node la hizo él con el instalador oficial. Lo que verifiqué yo es el resultado.

**Hechos que condicionan el diseño:**
- **Procedencia del análisis:** el evento `DOCUMENT_SCAN_RESULT` de `contracts` no la indica. Los estados de `deliveries` (`0004`) no tienen uno para una captura local. Las dos cosas quedan para P2 (§18.1).
- **Análisis inconcluso:** ADR-007 y ADR-014 establecen que nunca se aprueba automáticamente y que no es seleccionable.
- **Límites en `flow-schema`:** exporta `lineBreakPosition`, `SUBJECT_MAX_LENGTH` (200), `RULE_LIMITS.recipientsPerDelivery` (20) y `ALLOWED_MIME_TYPES`.
- **Columnas de `documents`:** `storage_key` admite de 1 a 512 caracteres, y `sha256` exige 64 hexadecimales en minúscula.
- **Guardas de base:** no rechazan `APP_ENV=staging`. Hoy la API arranca con `staging` y modos simulados contra el contenedor local.

## 3. Dependencias y límites

- **Requiere** (cerradas): `contracts` y `flow-schema`.
- **No requiere** `db`: los adaptadores no tocan la base.
- **Habilita:**
  - el host de P2, que registra documentos y entregas y aplica el cupo del trámite;
  - el simulador de P3;
  - P1-T6, porque la CI completa corre sus pruebas;
  - P5, que agrega los adaptadores reales detrás de los mismos puertos.
- **Sin dependencias de npm nuevas:** solo módulos de Node (`node:fs`, `node:crypto`, `node:path` y `node:stream`).
- **Sin migraciones:** no se tocan las aplicadas ni se agregan nuevas.

## 4. Ubicación y estructura

```
packages/adapters/
  src/
    index.ts
    environment.ts            guardas de entorno (§5)
    config.ts                 configuración de los adaptadores locales (§12)
    ports/
      storage.ts              ObjectStorage y errores
      email.ts                EmailSender, OutgoingEmail y EmailSendResult
      scanner.ts              DocumentScanner y ScanOutcome
    local/
      private-root.ts         raíz privada y directorios antecesores (§6)
      work-area.ts            temporales y limpieza en ejecución (§7.2)
      capture-key-lock.ts     bloqueo por clave de las capturas (§9.4)
      file-ops.ts             operaciones de archivos, sustituibles en las pruebas (interno)
      private-folder-storage.ts
      capture-email-sender.ts
      simulated-scanner.ts
    compose.ts                createLocalAdapters y assertSafeComposition (§11)
    maintenance/
      recover-stopped-root.ts mantenimiento con los consumidores detenidos (§7.3)
      cli.ts                  comando del mantenimiento
  test/                       pruebas sin base (entran en `pnpm run check`)
```

- **Paquete:** `packages/adapters`, como prevé ADR-001.
- **Dependencias internas:** `contracts` y `flow-schema`. Se declaran en `scripts/check-workspace-boundaries.mjs` y en ESLint.
- **Puntos de entrada:**
  - `@sistema-chatbot/adapters`: puertos, composición y adaptadores;
  - `@sistema-chatbot/adapters/maintenance`: solo el mantenimiento de §7.3. Está separado para que un host no lo llame por accidente al componer.
- **Puertos en `adapters` por ahora:**
  - ADR-001 pide interfaces en `domain` o `contracts`;
  - `domain` no existe todavía, y `contracts` no usa APIs ni tipos de Node, mientras que los puertos manejan flujos de bytes;
  - por eso los puertos viven en `adapters/src/ports` hasta P2. Se registra en un addendum de ADR-001.
  - El motor nunca depende de `adapters`.
- **Sin red ni procesos:**
  - ESLint prohíbe en `packages/adapters/src/local/**` y `src/maintenance/**` importar `net`, `tls`, `http`, `https`, `http2`, `dgram`, `dns` y `child_process` (con y sin `node:`);
  - una prueba reemplaza `fetch`, `net.connect` y `http.request` por funciones que fallan, y comprueba que ningún adaptador local las llama.
- **Operaciones de archivos:**
  - pasan por una interfaz interna (`file-ops.ts`), que no exporta el paquete;
  - las pruebas la sustituyen para inyectar fallos o pausas en cada paso (§13);
  - en ejecución normal es `node:fs/promises`, sin capas extra.
- **Plataformas:** solo POSIX: macOS y Linux, que es el de la CI. Permisos, `O_NOFOLLOW` y enlaces duros no tienen equivalente en Windows.

## 5. Guardas de entorno

**Entornos permitidos** para los adaptadores locales y su mantenimiento: exactamente `development` y `test`. Se rechazan:
- `staging` y `production`;
- cualquier otro valor;
- un valor ausente: no hay valor por defecto que habilite.

**Dónde se comprueba:**
1. **Configuración del paquete** (`config.ts`): rechaza `APP_ENV` fuera de la lista. Informa la clave, sin el valor.
2. **Configuración de la API (aprobada, §18.1):**
   - con `APP_ENV=staging`, `STORAGE_MODE=local_private`, `EMAIL_MODE=capture` y `SCANNER_MODE=fake_development_only` son un error (`SIMULATED_MODE_OUTSIDE_LOCAL`), además del de producción que ya existe;
   - `CHANNEL_MODE` no cambia: es de P3 y P6;
   - consecuencia: la API deja de arrancar con `staging` hasta que existan los adaptadores reales (P5).
3. **Construcción:** cada fábrica pública recibe `appEnv` explícitamente y exige dos condiciones:
   - el valor recibido está en la lista;
   - `process.env.APP_ENV` está definido y es igual.

   Así, una llamada con `"development"` dentro de un proceso de producción falla aunque se olvide la configuración. Las clases no se exportan, de modo que no hay `new` que eluda la fábrica.
4. **Cada operación:** las operaciones públicas vuelven a leer `process.env.APP_ENV` antes de actuar. Eso incluye `put`, `open`, `delete`, `listObjects`, `send`, `readCapture`, `scan` y las de limpieza y mantenimiento. No depende de una única comprobación al iniciar.

**Error:** `AdapterEnvironmentError` (`LOCAL_ADAPTER_FORBIDDEN_ENVIRONMENT`), sin el valor recibido.

## 6. Raíces privadas y directorios antecesores

Rige para las dos raíces: la del almacenamiento (§8) y la de las capturas (§9).

### 6.1 Forma de la ruta

- **Absoluta y normalizada:** sin componentes `.` o `..`, sin bytes nulos, e igual a `path.normalize` de sí misma.
- **Valor por defecto:** lo calcula la composición a partir de la raíz del repositorio, que le pasa el host:
  - almacenamiento: `storage/documents`;
  - capturas: `storage/mail-captures`.
- **Dentro del repositorio:** si la ruta cae dentro del repositorio, debe estar debajo de `storage/`, que Git ignora. Así se evitan carpetas versionadas o servidas, como un `public/` del panel en P3.

### 6.2 Recorrido de la ruta configurada

Se recorre desde `/` con `lstat` en cada prefijo. Un componente que es enlace simbólico solo se acepta si cumple las dos condiciones:
- el enlace es de root;
- el directorio que lo contiene cumple la regla de §6.3.

Eso admite `/tmp → private/tmp` y `/var → private/var` de macOS por sus propiedades, sin nombrarlos ni crear una lista de excepciones. Se rechaza cualquier enlace de un usuario, incluido el propio, aunque apunte a un lugar válido: quien opera configura la ruta canónica.

### 6.3 Recorrido de la ruta canónica

Después se obtiene la ruta canónica con `realpath` y se recorre de nuevo desde `/` hasta el padre de la raíz. Cada antecesor debe:
- ser un directorio, comprobado con `lstat`. Si aparece un enlace, la ruta cambió durante el recorrido, y falla;
- ser de root o del usuario del proceso;
- no tener permiso de escritura para el grupo ni para otros.

**Única excepción, por propiedad:** un directorio de root con bit sticky (`1777`), como `/tmp` en Linux y `/private/tmp` en macOS.
- Con el bit sticky, otros usuarios pueden crear entradas, pero no renombrar ni borrar las ajenas.
- El componente siguiente debe ser del usuario del proceso. Si otro usuario creó antes `/tmp/<nombre>`, la regla de dueño lo rechaza.
- Un directorio con bit sticky que no es de root no recibe la excepción.

### 6.4 La raíz y sus subdirectorios

- **Subdirectorios:**
  - almacenamiento: `objects/`, `tmp/` y `.reclaim/`;
  - capturas: `captures/`, `locks/`, `tmp/` y `.reclaim/`.
- **Requisitos de la raíz y los subdirectorios:** no ser enlaces, ser del usuario del proceso y tener modo exactamente `0700`.
- **Si faltan:** se crean de a un componente con `mkdir` y modo `0700`, que después se fija con `chmod` porque la `umask` no lo garantiza. Si `mkdir` falla con `EEXIST`, se vuelve a comprobar con `lstat`.
- **Si existen con otro modo o dueño:** la construcción falla con `StorageIntegrityError` (o `CaptureIntegrityError`). Nunca corrige en silencio.
- **Archivos:** se crean con `0600`, y el modo se fija con `fchmod` sobre el descriptor.
- **Compatibilidad del sistema de archivos:** la construcción prueba un enlace duro en `tmp/`. Si el sistema de archivos no lo admite, falla con un error claro.

### 6.5 Comprobación en cada operación

- **Al construir:** se registran el dispositivo e inodo (`dev` e `ino`) de la raíz y de cada subdirectorio.
- **En cada operación:** antes de actuar, se repite `lstat` de la raíz y del subdirectorio que usa, y se comparan `dev`, `ino`, tipo, dueño y modo. Si algo cambió, la operación falla sin escribir ni borrar.
- **Antecesores:** no se recorren en cada operación. Se recorren al construir, en cada limpieza y en el mantenimiento (§7.2, §7.3 y §9.8).

### 6.6 Limitaciones explícitas

- **Procesos del mismo usuario:** quedan fuera del modelo de amenazas.
  - Node no tiene `openat` ni resolución sin enlaces (`RESOLVE_NO_SYMLINKS`).
  - Entre una comprobación y la apertura, `link` o `rename` por ruta, un proceso del mismo usuario puede reemplazar un directorio propio.
  - Otros usuarios no pueden, porque cada antecesor solo es modificable por root o por el usuario, o está protegido por el bit sticky.
  - `O_NOFOLLOW` protege solo el último componente. El resto lo cubren los recorridos de §6.2 y §6.3 y la comparación de §6.5, no `O_NOFOLLOW`.
  - Un proceso del mismo usuario también puede leer los archivos directamente.
- **ACL:**
  - En Linux, una ACL que dé escritura aparece en los bits de grupo (la máscara), y la regla la rechaza.
  - En macOS las ACL no se reflejan en el modo, y Node no las expone. No se inspeccionan. El README indicará revisarlas con `ls -led`.
  - La ACL de `~/Desktop` observada niega borrar, no otorga permisos.
- **Uso:** el adaptador sirve para desarrollo y pruebas locales. En producción no se usa (P5/P7).

## 7. Área de trabajo, limpieza en ejecución y mantenimiento

Rige para las dos raíces.

**Principio (A4, §18.1):** un proceso pausado puede seguir vivo y conservar operaciones en curso, sea por un depurador, `SIGSTOP`, un bucle de eventos bloqueado o el equipo suspendido. Por eso:
- ni la antigüedad de un archivo ni un plazo prueban que algo está abandonado;
- no hay arrendamientos ni plazos de abandono;
- en ejecución solo se limpia lo que no puede pertenecer a una operación viva;
- lo demás espera a un mantenimiento con los consumidores detenidos.

### 7.1 Estructura

```
<raíz>/tmp/<instancia>/instance.json   identificación de la instancia (informativa)
<raíz>/tmp/<instancia>/<op>.part       temporal de una escritura del almacenamiento; también la
                                       prueba retenida de una publicación incierta (§8.4.1)
<raíz>/tmp/<instancia>/del-<op>/       destino privado de un retiro exclusivo (§8.5), con el
                                       objeto retirado hasta su borrado físico
<raíz>/tmp/<instancia>/lock-<op>/      bloqueo preparado, con su material (capturas, §9.4)
<raíz>/.reclaim/<aleatorio>/           material ya desprendido de toda operación, pendiente de borrar
```

- **Instancia:** cada adaptador construido recibe un `instanceId` de 128 bits aleatorios. Sus temporales viven en `tmp/<instanceId>/`.
  - `instance.json` guarda `instanceId`, `pid` y la fecha de creación.
  - Solo sirve como información para el informe del mantenimiento. No prueba si el proceso vive: un `pid` se reutiliza.
- **Operaciones activas:** cada instancia lleva un registro en memoria de sus operaciones y bloqueos. La operación agrega su temporal antes de crearlo y lo quita después de publicar o de limpiar.
  - **Registro exclusivo (revisión del 27/10/2026):** si el id ya está registrado (activo o retenido), la operación nueva falla antes de tocar el disco y no altera el registro de la otra.
  - **Propiedad de las entradas:** una operación solo borra lo que ella misma creó (el `open` con `O_EXCL` o el `mkdir` tuvieron éxito). Si la creación falla, incluso con `EEXIST`, la entrada preexistente no se modifica ni se borra.
  - **Entradas retenidas:** la prueba de una publicación incierta (§8.4.1) y el material de un retiro que no se pudo restituir (§8.5) quedan registrados como retenidos. Ninguna limpieza en ejecución los toca.
- **Material retenido por un bloqueo:** vive en `locks/<captureId>/` (§9.4), nunca en `tmp/`. La adquisición lo traslada desde `tmp/` con el mismo `rename` que toma el bloqueo. Así, ninguna limpieza de temporales puede borrarlo ni invalidarlo.

### 7.2 Limpieza en ejecución (`recoverWorkArea`)

Se puede ejecutar con consumidores activos: al construir, al cerrar y cuando el host lo programe. Solo toca lo que no puede pertenecer a una operación viva:
1. **Temporales de la propia instancia** que no están en su registro de operaciones activas ni retenidas. Son restos de una limpieza fallida.
2. **Bloqueos de la propia instancia** que no usa ninguna operación activa, por ejemplo una liberación que falló (§9.5). Se liberan normalmente.
3. **Contenido de `.reclaim/`.** Ahí solo llega material que su dueño ya desprendió. Si otra instancia lo borra al mismo tiempo, `ENOENT` cuenta como borrado.

**Nunca toca, por viejo que sea:**
- `tmp/<instancia>/` de otras instancias;
- `locks/` de otras instancias, ni el material que conservan;
- `captures/` ni `objects/`.

`close()` hace la misma limpieza y borra el directorio de la instancia. Su ciclo de vida está en §7.5.

### 7.3 Mantenimiento con consumidores detenidos (`recoverStoppedRoot`)

Recupera lo que deja una caída: temporales de otras instancias y bloqueos abandonados, con su material.

**Invocación:**
- Es una operación explícita. Solo se llega a ella por el punto de entrada `@sistema-chatbot/adapters/maintenance` y su comando: `pnpm -C packages/adapters run maintenance -- --root <ruta>`.
- `createLocalAdapters` no la expone, la construcción no la llama y `recoverWorkArea` tampoco.
- Aplica las guardas de entorno (§5) y de raíz (§6).

**Precondición:** ningún proceso usa esa raíz, desde que empieza hasta que termina. El adaptador no puede verificarla: la garantiza quien opera, con el procedimiento.

**Procedimiento:**
1. Detener todos los consumidores de la raíz: API, worker, simulador, ejecuciones de pruebas y scripts, en todas las terminales.
2. Comprobar con herramientas del sistema que no quede ninguno; por ejemplo, `ps` para los procesos de Node del proyecto y `lsof +D <raíz>` para los archivos abiertos.
   - Son una ayuda para quien opera, no una prueba.
   - Tampoco demuestran la precondición el tiempo transcurrido, la antigüedad de los archivos, el `pid` de `instance.json` ni una opción de confirmación del comando.
3. Ejecutar el comando, que hace lo siguiente:
   - muestra la precondición;
   - recorre la raíz y sus antecesores (§6);
   - lista lo que va a recuperar, con los datos de `instance.json` y `owner.json` (instancia, `pid` y fecha) solo como referencia;
   - recupera:
     - borra los directorios de `tmp/` de todas las instancias, con un `rename` a `.reclaim/` y después el borrado;
     - en la raíz de capturas, revisa cada bloqueo de `locks/`. Descarta `staged/`, que nunca se publicó porque la publicación lo saca del bloqueo. Termina de borrar `entry/` o `payload/` que una purga ya había reclamado. Después quita el bloqueo;
     - vacía `.reclaim/`;
     - no modifica entradas de `captures/` ni objetos de `objects/`;
   - informa qué recuperó: claves, cantidades y bytes, sin contenido.
4. Recién después se vuelven a iniciar los consumidores.

**Si se viola la precondición:** con un consumidor activo, el mantenimiento puede borrar material de una operación en curso o quitar un bloqueo vigente, y así romper la exclusión por clave (§9.4). Por eso nunca es automático. El adaptador no lo puede impedir, y queda documentado.

**Mientras no se ejecute,** después de una caída:
- las claves con un bloqueo abandonado devuelven `KEY_BUSY` en `send` y en la comprobación de `readCapture`;
- la purga las omite;
- los temporales de la instancia caída ocupan disco.

### 7.4 Qué se limpia en cada caso

| Material | Limpieza en ejecución (§7.2) | Mantenimiento con consumidores detenidos (§7.3) |
|---|---|---|
| Temporales propios sin operación activa | Sí | Sí |
| Temporales de otras instancias | No, por viejos que sean | Sí |
| Bloqueos propios sin operación activa | Sí, se liberan | Sí |
| Bloqueos de otras instancias y su material (`staged/`, `entry/` y `payload/`) | No | Sí |
| `.reclaim/` | Sí | Sí |
| Entradas de `captures/` y objetos de `objects/` | No. Solo los modifican la purga, bajo bloqueo, y `delete` | No |
| Prueba retenida de una publicación incierta (§8.4.1) y material de un retiro no restituido (§8.5) | No | Sí, con la comprobación de §8.4.1; nunca borra `objects/` por eso |
| Destino privado `del-<op>/` de un retiro sin operación activa | Sí (restos propios) | Sí |

**Requisito para el mantenimiento (revisión del 27/10/2026):** una publicación incierta pendiente deja su temporal en `tmp/<instancia>/<op>.part`. El enlace se hizo si y solo si `objects/<clave>` comparte `dev` e inodo con ese temporal (los dos con `nlink` 2). El mantenimiento puede borrar el temporal, que solo pierde la prueba, pero nunca borra un objeto de `objects/` por este motivo: un objeto sin prueba queda como huérfano para la conciliación de P2. Un `del-<op>/` de una instancia caída contiene el objeto de un `delete` ya retirado de su clave; el mantenimiento lo borra.

### 7.5 Ciclo de vida de la instancia y cierre (revisión del 27/10/2026)

**Estados:** `OPEN` → `CLOSING` → `CLOSED`, en memoria de cada instancia.

**Admisión:** `put`, `delete`, `resolveUncertainPublication` y `recoverWorkArea` se registran al empezar, antes de cualquier espera. `open` y `listObjects` comprueban el estado al empezar (en `listObjects`, al empezar a consumirse): no usan recursos de la instancia.

**`close()`:**
1. Comprueba el entorno (§5.4) y pasa a `CLOSING` antes de cualquier espera.
2. Desde ese momento, toda operación nueva rechaza con `StorageClosedError`, sin efectos sobre disco.
3. Espera a que terminen las operaciones admitidas antes. Ninguna pierde su temporal ni su destino privado.
4. Recorre los antecesores y verifica la raíz (§6.5), limpia los restos propios y `.reclaim/` (§7.2) y borra `tmp/<instancia>/`, salvo que haya entradas retenidas (§7.1): en ese caso deja el directorio con ellas e informa la cantidad.
5. Pasa a `CLOSED`.

**Llamadas repetidas y concurrentes:**
- las concurrentes comparten el mismo intento;
- después de `CLOSED`, `close()` devuelve el mismo informe sin tocar el disco;
- si un intento falla, la instancia sigue en `CLOSING` (no admite operaciones nuevas) y una llamada posterior reintenta los pasos 3 a 5.

**Después del cierre:** los streams de `open` abiertos antes siguen leyendo (usan su propio descriptor). Un recorrido de `listObjects` ya empezado termina. Todo lo demás rechaza con `StorageClosedError`.

**Límite:** `close` espera a las operaciones admitidas. Un `put` sin señal cuya fuente nunca responde retiene el cierre; el host lo cancela con `AbortSignal`, que no espera a la fuente (§8.3).

## 8. Almacenamiento en carpeta privada

### 8.1 Puerto

```ts
interface ObjectStorage {
  readonly kind: "LOCAL_PRIVATE_FOLDER"; // P5: almacenamiento de objetos privado
  put(content: AsyncIterable<Uint8Array>, options: { maxBytes: number; signal?: AbortSignal }): Promise<StoredObject>;
  open(key: string): Promise<{ sizeBytes: number; stream: AsyncIterable<Uint8Array> }>;
  delete(key: string): Promise<"DELETED" | "ALREADY_ABSENT">;
  listObjects(): AsyncIterable<{ key: string; sizeBytes: number }>; // conciliación de huérfanos (P2)
  // Conciliación de una publicación incierta (§8.4.1; revisión del 27/10/2026)
  resolveUncertainPublication(key: string): Promise<
    "WITHDRAWN" | "NOT_PUBLISHED" | "KEY_HELD_BY_OTHER" | "NOT_RETAINED"
  >;
}
interface StoredObject { key: string; sizeBytes: number; sha256: string }
```

**Errores tipados:**
- `InvalidObjectKeyError`;
- `ObjectTooLargeError`;
- `EmptyObjectError`;
- `ObjectNotFoundError`;
- `StorageIntegrityError`: raíz, tipo, dueño o enlace inesperado;
- `StorageWriteError`, con `phase`: `BEFORE_PUBLISH`, `AFTER_PUBLISH`, `BEFORE_REMOVE` o `AFTER_REMOVE`. Con `AFTER_PUBLISH` lleva siempre `key` y `objectState` (`WITHDRAWN` o `LEFT_IN_PLACE`), y el objeto es propio, confirmado por el `link` o por `dev` e inodo;
- `UncertainPublicationError` (revisión del 27/10/2026), con `key`: el resultado de la publicación no se pudo determinar (§8.4.1). No es un objeto propio confirmado ni autoriza borrar la clave;
- `StorageClosedError` (revisión del 27/10/2026): la instancia está cerrando o cerrada (§7.5).

**Limpieza:**
- el adaptador local expone además `recoverWorkArea()` y `close()` (§7.2), que no forman parte del puerto: P5 no las necesita;
- el mantenimiento de §7.3 es aparte.

**Sin bloqueos por clave:** las claves son aleatorias y nunca se reutilizan, así que no existe la recreación con la misma clave que coordina §9.4. La exclusión entre borrados concurrentes la da el traslado exclusivo de §8.5, no un bloqueo.

### 8.2 Claves y rutas

- **Claves opacas:**
  - las genera el adaptador con 128 bits de `randomBytes`, en 32 hexadecimales en minúscula;
  - quien llama no elige la clave;
  - caben en `documents.storage_key`.
- **Rutas:** la ruta es `<raíz>/objects/<clave>`, sin subdirectorios. Ningún dato de entrada forma rutas: ni el nombre original, ni el MIME, ni ids.
- **Validación previa:** antes de tocar el disco, la clave se valida contra `^[0-9a-f]{32}$`. Eso descarta `..`, separadores, rutas absolutas, bytes nulos, Unicode y codificaciones, sin depender de normalizar rutas.

### 8.3 Escritura

1. Comprueba la raíz (§6.5) y registra la operación (§7.1).
2. **Temporal:** crea `tmp/<instancia>/<op>.part` con `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW` y modo `0600`.
3. **Copia del flujo:** cuenta bytes y calcula el SHA-256.
   - Si supera `maxBytes` (por defecto `MAX_FILE_BYTES`, 10485760), deja de leer de inmediato. El límite se aplica a los bytes recibidos, no al tamaño declarado.
   - Un objeto vacío se rechaza.
4. `fsync` del archivo y cierre.
5. **Publicación:** `link(temporal, objects/<clave>)`. El enlace duro nunca reemplaza un destino existente, y `rename` sí lo haría.
6. `fsync` de `objects/`.
7. Borra el temporal, que es un segundo enlace al mismo inodo, y quita la operación del registro.

**El punto de publicación es el éxito de `link`.** Desde ahí el objeto es visible y completo bajo su clave, porque su contenido ya tenía `fsync`. Una cancelación con `AbortSignal` después de ese punto se ignora: la operación termina los pasos 6 y 7.

### 8.4 Resultados por fase

| Paso que falla | Resultado para quien llama | Destino | Recuperación |
|---|---|---|---|
| Entorno o raíz (1) | `AdapterEnvironmentError` o `StorageIntegrityError` | No se crea | Ninguna |
| Temporal, copia, límite, vacío, cancelación, disco lleno o `fsync` del archivo (2 a 4) | `ObjectTooLargeError`, `EmptyObjectError` o `StorageWriteError` (`BEFORE_PUBLISH`) | No se crea: solo `link` lo crea, y no se llegó | Se borra el temporal. Si eso falla, lo borra la limpieza en ejecución de la propia instancia (§7.2), o el mantenimiento si la instancia terminó (§7.3) |
| `link` con `EEXIST` (5) | `StorageIntegrityError`: con 128 bits aleatorios, un choque indica una entrada ajena | El existente queda intacto | Se borra el temporal |
| `link` con otro error (5) | Se compara el `dev` e `ino` del destino con los del temporal. Si no es el nuestro: `StorageWriteError` (`BEFORE_PUBLISH`). Si es el nuestro: sigue en el paso 6 como publicado | Ausente o ajeno; o publicado | Según el caso |
| `link` con cualquier error y la comparación también falla (5; revisión del 27/10/2026) | `UncertainPublicationError` con la clave. No es `AFTER_PUBLISH`: no se sabe si el destino es nuestro | Desconocido: ausente, propio o un objeto anterior | El temporal se conserva como prueba y el host concilia con `resolveUncertainPublication` (§8.4.1), nunca con `delete` |
| `fsync` de `objects/` (6) | Como nadie conoce todavía la clave, el adaptador retira el objeto (`unlink`) y lanza `StorageWriteError` (`AFTER_PUBLISH`, `key`) con `objectState: "WITHDRAWN"`. Si el retiro también falla: `"LEFT_IN_PLACE"` | Retirado, o visible y completo | El host registra la clave para borrarla (P2). Después de una caída, un objeto retirado puede reaparecer como huérfano, porque el retiro tampoco tiene `fsync`. Se resuelve con `listObjects` y la conciliación de P2 |
| Borrar el temporal (7) | Ninguno: `put` resuelve normalmente y emite un evento de mantenimiento | Visible y durable | La limpieza en ejecución de la propia instancia borra el segundo enlace, sin tocar el objeto. Si la instancia terminó antes, lo hace el mantenimiento |

**Visibilidad y durabilidad:**
- **Visibilidad atómica:** quien lee ve el objeto completo o no lo ve. Se publica por `link` de un archivo ya escrito y con `fsync`.
- **Durabilidad:** `put` resuelve solo después del `fsync` del archivo y del directorio.
  - Una caída antes de eso puede dejar dos resultados: ningún objeto, o un objeto completo cuya clave el host no recibió (un huérfano para la conciliación de P2).
  - Nunca deja un objeto parcial.
  - Depende de que el sistema de archivos respete `fsync`, también sobre directorios. Las pruebas no simulan cortes de energía (§16).

**Propiedad del temporal (revisión del 27/10/2026):** el temporal se borra solo si esta operación lo creó. Si `openTempForWrite` falla (también con `EEXIST`), no se borra nada. Si `fchmod` falla después de crearlo, la propia apertura lo borra antes de informar el error.

### 8.4.1 Publicación incierta y conciliación (revisión del 27/10/2026, decisión del propietario)

**Cuándo:** `link` falla, con cualquier código, y el `lstat` que compara `dev` e inodo también falla. No se puede saber si `objects/<clave>` quedó con nuestro inodo, si sigue ausente o si hay un objeto anterior con esa clave. Un error distinto de `EEXIST` no prueba que el destino sea nuestro.

**Resultado:** `UncertainPublicationError` con `key`. No se clasifica como objeto propio confirmado (`AFTER_PUBLISH`) ni como destino ausente (`BEFORE_PUBLISH`), y no autoriza borrar la clave.

**Información conservada:**
- el temporal no se borra: sigue enlazado al inodo de los bytes escritos y, mientras exista, ningún otro archivo puede tener ese `dev` e inodo;
- la instancia registra en memoria la clave, la operación y ese `dev` e inodo, y retiene el temporal (§7.1).

Esa es la prueba de pertenencia. No se usan como prueba el formato de la clave, el dueño del archivo ni la improbabilidad de una colisión.

**Conciliación:** `resolveUncertainPublication(clave)`, en la misma instancia.

| Estado observado | Resultado | Efecto |
|---|---|---|
| El temporal retenido ya no tiene su `dev` e inodo (prueba perdida) | `UncertainPublicationError` | Nada se toca; el registro sigue |
| `lstat` de `objects/<clave>` falla otra vez | `UncertainPublicationError` | Nada se toca; el registro sigue y se puede reintentar |
| `objects/<clave>` ausente | `NOT_PUBLISHED`, con `fsync` de `objects/` | Se borra el temporal retenido |
| `objects/<clave>` con el `dev` e inodo del temporal retenido | `WITHDRAWN` | Retiro exclusivo con comprobación posterior (§8.5), `fsync` de `objects/` y borrado del temporal |
| `objects/<clave>` con otro `dev` e inodo | `KEY_HELD_BY_OTHER` | El objeto anterior no se toca; se borra el temporal retenido |
| La instancia no tiene registro de esa clave | `NOT_RETAINED` | Ningún efecto. Las llamadas repetidas después de resolver devuelven esto |

**Mientras está pendiente:**
- `delete` de esa clave en la misma instancia rechaza con `UncertainPublicationError`: nunca borra a ciegas;
- la limpieza en ejecución no toca el temporal retenido;
- `close` no borra `tmp/<instancia>/` e informa cuántas entradas quedaron retenidas (§7.5).

**Después de una caída o de un cierre con pendientes:** el temporal queda en `tmp/<instancia>/<op>.part` para el mantenimiento (§7.4). El registro en memoria se pierde.

**Límites:** el registro es de la instancia: la conciliación se pide a la que recibió el error. Entre la comprobación y el retiro, un proceso del mismo usuario podría reemplazar la entrada (§6.6); la comprobación posterior del retiro lo detecta y restituye.

### 8.5 Lectura y borrado

- **Lectura (`open`):**
  - abre con `O_RDONLY | O_NOFOLLOW`;
  - con `fstat` sobre el descriptor, no sobre la ruta, comprueba que sea un archivo regular, del usuario del proceso, con modo `0600`;
  - si no cumple o no existe: `ObjectNotFoundError` o `StorageIntegrityError`;
  - si se borra un objeto que se está leyendo, la lectura en curso sigue (semántica POSIX), y una lectura nueva da `ObjectNotFoundError`.
- **Borrado (`delete`):** valida la clave, retira el objeto con un traslado exclusivo y después hace `fsync` de `objects/`.
  - Si encuentra el objeto y lo retira: `DELETED`.
  - Si no lo encuentra: `ALREADY_ABSENT`. También hace el `fsync`, así un reintento confirma la durabilidad de un borrado anterior.
  - Si el retiro falla por otra causa: `StorageWriteError` (`BEFORE_REMOVE`). El objeto sigue bajo su clave, o el reintento lo resuelve.
  - Si el `fsync` falla después del retiro: `StorageWriteError` (`AFTER_REMOVE`, `key`). El objeto ya no es visible, pero el borrado puede revertirse con una caída. El host reintenta `delete` hasta que termine sin error.
  - Dos borrados concurrentes dan un `DELETED` y un `ALREADY_ABSENT`, también entre instancias o procesos sobre la misma raíz y también en macOS (APFS).

**Retiro exclusivo (revisión del 27/10/2026, decisión del propietario de conservar el contrato).** Antes, el resultado salía de `unlink`. En APFS, dos `unlink` concurrentes del mismo nombre devuelven éxito los dos (medido el 27/10/2026), así que no daba el par exacto. Un mutex en memoria no alcanza, porque puede haber varias instancias o procesos sobre la misma raíz. La exclusión la da `rename` del mismo origen, que fue exclusivo en todas las mediciones de APFS y que el kernel serializa en Linux.

1. **Comprobación:** `lstat` de `objects/<clave>`.
   - Ausente (`ENOENT`): `fsync` de `objects/` y `ALREADY_ABSENT`.
   - Otro error: `BEFORE_REMOVE`.
   - Enlace, entrada que no es un archivo regular o archivo de otro usuario: `StorageIntegrityError`, sin tocarlo.
   - Clave con una publicación incierta pendiente en la instancia: `UncertainPublicationError` (§8.4.1).
2. **Destino privado:** la operación registra su id (de forma exclusiva, §7.1) y crea con `mkdir` (0700, falla si ya existe) `tmp/<instancia>/del-<op>/`.
   - Es propiedad de esta operación: otras instancias nunca tocan `tmp/<instancia>/` (A4), la limpieza propia lo omite mientras la operación está activa y `close` espera a las operaciones admitidas (§7.5).
   - Si el `mkdir` falla, también con `EEXIST`: `BEFORE_REMOVE`, sin borrar la entrada existente.
   - `tmp/` y `objects/` están en el mismo sistema de archivos: la publicación con `link` ya lo exige.
3. **Retiro:** `rename(objects/<clave>, tmp/<instancia>/del-<op>/<clave>)`. **Es el punto en que el objeto deja de estar disponible:** un `open` nuevo da `ObjectNotFoundError`, y las lecturas ya abiertas siguen hasta cerrar su descriptor (semántica POSIX), incluso después del borrado físico.
   - Entre dos borrados concurrentes, solo un `rename` encuentra el origen. El otro recibe `ENOENT`, comprueba que la clave quedó vacía y da `ALREADY_ABSENT`.
   - Si `rename` falla con otro error, se comprueba el destino privado. Si el objeto llegó, se sigue. Si no, `BEFORE_REMOVE`.
4. **Comprobación posterior:** el `dev` e inodo de lo trasladado deben ser los comprobados en el paso 1. Si no coinciden o no se pueden leer (un reemplazo entre los pasos 1 y 3, solo posible para un proceso del mismo usuario, §6.6), se restituye con `link` (que no reemplaza) y se rechaza con `StorageIntegrityError` (`TARGET_CHANGED`). Si no se puede restituir, el material queda retenido en el destino privado: nunca se borra y ninguna limpieza en ejecución lo toca.
5. **Durabilidad:** `fsync` de `objects/`, que hace durable la salida del nombre. Recién después, `DELETED`. Si falla: `AFTER_REMOVE`. El destino privado no necesita `fsync`: su contenido se descarta.
6. **Borrado físico:** se borra `del-<op>/`. Si falla, `delete` igual da `DELETED`, porque el objeto ya no está bajo su clave y su salida es durable. Emite el evento `DELETED_OBJECT_RESIDUE`, y lo retoma la limpieza propia (§7.2) o, si la instancia terminó, el mantenimiento (§7.3).

**Recuperación después de una caída:**
- Antes del paso 3: el objeto queda intacto.
- Entre los pasos 3 y 5: el `rename` puede no ser durable. Después de reiniciar, el objeto está bajo su clave, y el reintento lo borra, o en el `del-<op>/` de la instancia caída, y el reintento da `ALREADY_ABSENT`.
- Después del paso 5: el material queda en `tmp/<instancia caída>/del-<op>/` hasta el mantenimiento, con el contenido del documento borrado. Es el mismo caso que los temporales de una instancia caída (§7.4).

**Reintentos:** después de `DELETED`, `ALREADY_ABSENT`. Después de `AFTER_REMOVE`, `ALREADY_ABSENT` con `fsync`. Después de `BEFORE_REMOVE`, un borrado normal.

**Sin bloqueos:** la exclusión es del sistema de archivos. No hay bloqueos que romper, ni por antigüedad ni por `pid`.
- **Objetos propios:** lectura y borrado se limitan a claves con el formato del adaptador, dentro de su raíz, que sean archivos regulares del usuario del proceso. Quién puede leer qué documento es una autorización del host (P4).
- **Registros:** los errores y eventos llevan la clave y un código, nunca contenido ni rutas completas.

### 8.6 Qué hace el adaptador y qué hace el host

| Control | Adaptador (P1-T5) | Host (P2) o etapa posterior |
|---|---|---|
| Clave opaca, rutas seguras, raíz y antecesores, permisos, sin sobrescritura | Sí | — |
| Límite de bytes de un objeto durante la escritura | Sí | Fija `maxBytes` |
| Resultados por fase y retiro del objeto si falla el `fsync` del directorio | Sí | Registra las claves `LEFT_IN_PLACE` para borrarlas |
| Publicación incierta (§8.4.1) | Conserva la prueba y expone `resolveUncertainPublication` | Registra la clave como incierta y la concilia en la misma instancia; nunca la borra con `delete` |
| Limpieza en ejecución (§7.2) | Sí, al llamarla | Programa las llamadas |
| Mantenimiento con consumidores detenidos (§7.3) | Expone el procedimiento y el comando | Lo ejecuta un operador, con los consumidores detenidos |
| Cupo del trámite: 3 candidatos históricos y 30 MiB acumulados (31457280) | No | P2, con `candidate_count` y la suma de `size_bytes` |
| Un solo adjunto por envío | No | DSL (`ATTACHMENTS_PER_SEND`) y entrega (P2/P5) |
| Tipo real por firma de bytes | No | P5 |
| Estados del documento (cuarentena, aprobado, purgado) | No | P2 |
| Autorización de lectura y URL temporales | No | P4/P5 |
| Retención y purga de documentos | Expone `delete` | P2/P7 |
| Conciliación de huérfanos | Expone `listObjects` | P2/P7 |

`put` no es idempotente: cada llamada genera una clave nueva. Si el host cae entre `put` y el registro de la clave, queda un huérfano, que se concilia según la tabla.

## 9. Captura local de correo

### 9.1 Puerto y resultado

```ts
interface EmailSender {
  readonly kind: "LOCAL_CAPTURE";
  readonly deliversExternally: false;
  send(idempotencyKey: string, message: OutgoingEmail): Promise<EmailSendResult>;
}
interface OutgoingEmail {
  to: readonly string[];       // 1 a 20, sin repetidos
  subject: string;             // asunto final, ya interpolado
  textBody: string;            // hasta 64 KiB
  attachment?: { fileName: string; mimeType: string; content: AsyncIterable<Uint8Array> }; // 0 o 1
}
type EmailSendResult =
  | { outcome: "CAPTURED"; captureId: string; duplicate: boolean; payloadAvailable: boolean; delivered: false }
  | { outcome: "REJECTED"; reason: EmailRejectionReason };
  // P5 agrega PROVIDER_ACCEPTED y UNKNOWN para el proveedor real (ADR-006).
```

- **`CAPTURED` es un resultado propio,** distinto de `PROVIDER_ACCEPTED` y de `DELIVERED`, y lleva `delivered: false` en el tipo. Cómo lo registra `deliveries` es de P2, antes de integrar el adaptador al host (§18.1).
- **El adaptador nunca abre conexiones:** ni SMTP ni proveedores.
- **Errores:**
  - `CaptureWriteError`, con `phase` `BEFORE_PUBLISH` o `AFTER_PUBLISH`, y con `captureId` en el segundo caso. El host lo reintenta;
  - `CaptureKeyBusyError` (`KEY_BUSY`), con `captureId`: la clave siguió bloqueada durante toda la espera (§9.4). Lo lanzan `send`, antes de publicar, y la comprobación de `readCapture`. Es reintentable. Si persiste, puede indicar un bloqueo abandonado que requiere mantenimiento (§7.3);
  - `CaptureIntegrityError`, con `captureId`. No se reintenta: queda para un operador (§9.7);
  - `CaptureNotFoundError`, solo en `readCapture`.
- **Limpieza y lectura:** `readCapture(captureId)`, `purgeCaptures()`, `recoverWorkArea()` y `close()`. El mantenimiento de §7.3 es aparte.

### 9.2 Validación antes de escribir

`REJECTED`, sin escribir nada, si:
- **Clave de idempotencia:** no es ASCII imprimible de 1 a 200 caracteres. Nunca forma rutas: se usa su hash.
- **Asunto:** contiene CR o LF en su valor final (`SUBJECT_LINE_BREAK`, con `lineBreakPosition` de `flow-schema`), está vacío o supera 200 caracteres. Es la parte del adaptador de T53.
- **Destinatarios:** alguno no tiene forma de email, contiene CR, LF u otros caracteres de control, o se repite; o hay 0, o más de 20.
- **Cuerpo:** está vacío, supera 64 KiB o contiene caracteres de control distintos de salto de línea y tabulador.
- **Adjunto:**
  - el nombre tiene CR, LF o separadores de ruta, o supera 255 caracteres;
  - el MIME no está en `ALLOWED_MIME_TYPES`.

  El nombre del archivo es solo un metadato y nunca forma una ruta.

Si los bytes del adjunto superan `MAX_FILE_BYTES`, se detecta durante la copia: `REJECTED` (`ATTACHMENT_TOO_LARGE`) y se borra el temporal.

### 9.3 Formato en disco

```
<raíz de capturas>/captures/<captureId>/record.json             registro de idempotencia, sin datos personales
<raíz de capturas>/captures/<captureId>/payload/message.json    destinatarios, asunto, cuerpo y metadatos del adjunto
<raíz de capturas>/captures/<captureId>/payload/attachment.bin  bytes del adjunto, si hay
<raíz de capturas>/locks/<captureId>/...                        bloqueo de la clave y su material (§9.4)
```

- **`captureId`:** son los primeros 32 hexadecimales de `SHA-256(idempotencyKey)`. Es determinista, y la clave en claro no se guarda.
- **`record.json`:**
  - contiene `format: "LOCAL_CAPTURE_RECORD_V1"`, `captureId`, `publicationId`, `idempotencyKeySha256` (el hash completo), `contentSha256`, `capturedAt`, `delivery: "NOT_SENT_LOCAL_CAPTURE"` y `delivered: false`;
  - **`publicationId`:** 128 bits aleatorios por cada publicación. Distingue dos capturas que ocuparon el mismo `captureId` en distintos momentos, por ejemplo una creada después de que venció el registro de la anterior;
  - solo hashes, identificadores aleatorios, fechas y constantes. Una prueba comprueba que no contiene destinatarios, asunto, cuerpo ni nombre de archivo;
  - es la evidencia de deduplicación que sobrevive a la purga del contenido (§9.8).
- **`payload/message.json`:** contiene `format: "LOCAL_CAPTURE_V1"`, `delivered: false`, `to`, `subject`, `textBody` y `attachment` (`fileName`, `mimeType`, `sizeBytes` y `sha256`, o `null`).
- **`contentSha256`:** es el hash del mensaje normalizado, incluido el SHA-256 del adjunto.
- **Inspección:**
  - el directorio se lee con cualquier editor;
  - `readCapture` sirve a las pruebas y al simulador de P3;
  - no se genera `.eml`.
- **Protección:**
  - raíz, antecesores y permisos según §6;
  - nada de esto se registra en logs ni se expone por HTTP en P1-T5.

### 9.4 Bloqueo por clave entre instancias

**Problema que resuelve:** sin coordinación, una purga que leyó el registro vencido de una captura podría reclamar después una captura nueva, recreada con el mismo `captureId` por otra instancia.
- Una comprobación seguida de un `rename` no alcanza: entre las dos, la entrada puede cambiar.
- La solución es la exclusión por `captureId` entre instancias. La lectura que decide y la modificación ocurren bajo el mismo titular.

**Quién lo toma:** toda operación que decide sobre `captures/<captureId>` o lo modifica:
- la publicación y la verificación de `send`;
- la purga del contenido o de la entrada;
- la comprobación de `readCapture` cuando su lectura sin bloqueo encuentra una anomalía (§9.7).

**Estructura:** la clave está ocupada si existe `locks/<captureId>/`.

```
locks/<captureId>/owner.json   instancia, pid, token y fecha (información para el mantenimiento)
locks/<captureId>/staged/      captura preparada por send, todavía no publicada
locks/<captureId>/entry/       entrada reclamada por la purga
locks/<captureId>/payload/     contenido reclamado por la purga
```

**Adquisición, atómica:**
1. Prepara `tmp/<instancia>/lock-<op>/` con `owner.json` y, en `send`, con la captura completa en `staged/`.
2. Lo publica con `rename(tmp/<instancia>/lock-<op>, locks/<captureId>)`:
   - si `locks/<captureId>` no existe, el `rename` tiene éxito. El bloqueo es propio, y su material quedó bajo él en el mismo paso;
   - si existe, falla con `EEXIST` o `ENOTEMPTY`: está ocupado. El bloqueo nunca está vacío, porque siempre tiene `owner.json`. Lo preparado sigue en el `tmp/` propio como operación activa, y se reintenta según la espera.
3. No hay comprobación previa: la adquisición es el `rename` mismo.

**Bajo el bloqueo,** solo el titular modifica `captures/<captureId>`:
- **publicar:** `rename(locks/<id>/staged, captures/<id>)`;
- **purgar el contenido:** `rename(captures/<id>/payload, locks/<id>/payload)`;
- **purgar la entrada:** `rename(captures/<id>, locks/<id>/entry)`.

Lo reclamado queda dentro del bloqueo hasta la liberación. La limpieza en ejecución no lo toca (§7.2).

**Liberación:** `rename(locks/<captureId>, .reclaim/<aleatorio>)` y después el borrado. Solo la hace el titular. Mientras haya consumidores activos, nadie más quita un bloqueo: ni la limpieza en ejecución ni un plazo (§7).

**Espera:**
- `send` y la comprobación de `readCapture` reintentan la adquisición con espera creciente, de 20 a 200 ms, hasta 5 s.
- Si no lo obtienen: `CaptureKeyBusyError` (`KEY_BUSY`). `send` borra lo que preparó, sin publicar, y el host reintenta.
- La purga no espera: si la clave está ocupada, la omite hasta la ejecución siguiente.

**Sin ruptura automática (A4):**
- Un bloqueo no se rompe por antigüedad, por un plazo ni por el estado aparente del titular.
- Un titular pausado, sea 120 s o cualquier otro tiempo, conserva el bloqueo y continúa al reanudarse.
- El bloqueo de un proceso caído queda hasta el mantenimiento con los consumidores detenidos (§7.3). Mientras tanto, esa clave da `KEY_BUSY` y la purga la omite.

**Por qué alcanza, y con qué supuesto:**
- Con consumidores activos, solo el titular modifica la entrada y solo el titular quita el bloqueo. Lo que la purga lee bajo el bloqueo sigue valiendo cuando reclama. Una captura recreada después de su escaneo tiene otro `publicationId` (§9.8).
- El supuesto deja de cumplirse con:
  - procesos del mismo usuario que actúan fuera del protocolo, o borrados manuales (§6.6);
  - un mantenimiento ejecutado con consumidores activos (§7.3).
- Cuando sus efectos alcanzan una entrada, se detectan como `CaptureIntegrityError` (§9.7). No hay garantía de detectarlos siempre.

### 9.5 Envío y resultados por fase

1. Validación (§9.2). Comprueba la raíz (§6.5) y registra la operación (§7.1).
2. **Preparación, sin bloqueo:** escribe `tmp/<instancia>/lock-<op>/` con `owner.json` y `staged/`. `staged/` contiene `record.json`, con un `publicationId` nuevo, `payload/message.json` y `payload/attachment.bin`.
   - Cada archivo se crea con `O_CREAT | O_EXCL | O_NOFOLLOW` y modo `0600`, con `fsync`. Después se hace `fsync` de cada directorio.
   - El hash del contenido se conoce al terminar de copiar el adjunto.
3. **Adquisición** del bloqueo de `captureId` (§9.4). En el mismo `rename`, la captura preparada queda bajo el bloqueo.
4. **Bajo el bloqueo,** `lstat(captures/<captureId>)`:
   - **no existe:** `rename(locks/<id>/staged, captures/<id>)`;
   - **existe:** verificación (§9.6).
5. `fsync` de `captures/`.
6. Libera el bloqueo y quita la operación del registro.

**El punto de publicación es el éxito del `rename` del paso 4.** Desde ahí la captura es visible y completa: registro y contenido juntos.

| Paso que falla | Resultado para quien llama | Destino | Recuperación |
|---|---|---|---|
| Validación (1) | `REJECTED` | No se escribe nada | Ninguna |
| Preparación o copia (2) | `CaptureWriteError` (`BEFORE_PUBLISH`), o `REJECTED` por tamaño | Esta llamada no publica nada | Se borra lo preparado. Si eso falla, la limpieza en ejecución propia (§7.2) |
| Clave ocupada durante toda la espera de 5 s (3) | `CaptureKeyBusyError` (`KEY_BUSY`) | No se publica nada | Se borra lo preparado; el host reintenta. Si el titular cayó, persiste hasta el mantenimiento (§7.3) |
| Adquisición con otro error (3) | Se compara el `dev` e `ino` de `locks/<captureId>` con los de lo preparado. Si es el nuestro: sigue en el paso 4 con el bloqueo tomado. Si no: `CaptureWriteError` (`BEFORE_PUBLISH`) | No se publica nada, o sigue | Según el caso |
| Publicación con `EEXIST` o `ENOTEMPTY` (4): apareció una entrada pese al bloqueo, es decir, un actor fuera del protocolo | `CaptureIntegrityError` | La existente no se modifica | `staged/` se descarta al liberar; queda para un operador |
| Publicación con `ENOENT` (4): falta `staged/` dentro del bloqueo propio, que alguien fuera del protocolo tocó | `CaptureIntegrityError` | Esta llamada no publica nada | Queda para un operador |
| Publicación con otro error (4) | Se compara el `dev` e `ino` de `captures/<captureId>` con los de `staged/`. Si es el nuestro: sigue en el paso 5 como publicada. Si no existe: `BEFORE_PUBLISH` | Según el caso | Según el caso |
| `fsync` de `captures/` (5) | `CaptureWriteError` (`AFTER_PUBLISH`, `captureId`) | Visible y completa, con durabilidad sin confirmar | El host reintenta con la misma clave: la verificación (§9.6) la reconoce, comprueba su contenido, repite el `fsync` y devuelve `duplicate: true` |
| Liberación del bloqueo (6) | Ninguno: el resultado ya está decidido, y se emite un evento de mantenimiento | No cambia | La instancia lo libera en su limpieza en ejecución o en `close` (§7.2). Mientras tanto, esa clave da `KEY_BUSY`. Si la instancia cae antes, lo libera el mantenimiento (§7.3) |

**Por qué la captura no se retira** cuando falla el `fsync`, a diferencia del almacenamiento: su `captureId` es determinista. El reintento la encuentra y la confirma sin duplicarla. Si el host nunca reintenta, queda como evidencia sin efecto.

**Visibilidad y durabilidad:**
- **Visibilidad atómica:** la entrada aparece completa, con registro y contenido, o no aparece.
- **Durabilidad:** un `CAPTURED` nuevo se devuelve solo después del `fsync` de archivos, directorios preparados y `captures/`. Una caída antes de eso puede dejar dos resultados:
  - ninguna captura, con lo preparado en `tmp/` o en un bloqueo abandonado, que recupera el mantenimiento;
  - una captura completa cuyo resultado el host no recibió. Su reintento devuelve `duplicate: true`, una vez que la clave esté libre.

  Nunca deja una captura parcial.

**Sin estados inciertos de proveedor:** como la captura es local, no hay `UNKNOWN`.
- Un `AFTER_PUBLISH` o un `KEY_BUSY` se resuelven con el reintento. Un `KEY_BUSY` causado por una caída necesita antes el mantenimiento.
- Un `CaptureIntegrityError`, no se resuelve reintentando.

### 9.6 Verificación de una captura existente

Se hace siempre bajo el bloqueo de la clave: en los reintentos y en los envíos concurrentes con la misma clave, que el bloqueo serializa.
1. **Entrada:** `lstat` de `captures/<captureId>`. Debe ser un directorio propio, de modo `0700` y no un enlace. Si no: `CaptureIntegrityError`.
2. **Registro:** lee `record.json` con `O_NOFOLLOW` y comprueba con `fstat` que sea un archivo regular propio, de modo `0600` y de hasta 4 KiB. Valida su esquema. Si falta, o si el directorio desaparece durante la verificación, se aplica §9.7.
3. **Clave:** si `idempotencyKeySha256` no coincide con el hash completo de la clave (un choque del prefijo de 128 bits, o un registro ajeno): `CaptureIntegrityError`.
4. **Contenido distinto:** si `contentSha256` no coincide: `REJECTED` con `IDEMPOTENCY_CONFLICT`. La existente no se modifica.
5. **Mismo contenido, con `payload/`:** relee `message.json` y `attachment.bin`, y recalcula el tamaño, los SHA-256 y `contentSha256`.
   - Si coinciden: hace `fsync` de `captures/` y devuelve `CAPTURED` con `duplicate: true` y `payloadAvailable: true`. Si ese `fsync` falla: `AFTER_PUBLISH`, de nuevo.
   - Si no coinciden, o falta un archivo del contenido: `CaptureIntegrityError`, sin modificar nada.
6. **Mismo contenido, sin `payload/`** (purgado): `CAPTURED` con `duplicate: true` y `payloadAvailable: false`.

En todos los casos, `staged/` de esta llamada se descarta al liberar. Diez envíos concurrentes con la misma clave publican una sola captura: el primero que obtiene el bloqueo publica, y los demás verifican o reciben `KEY_BUSY`.

### 9.7 Entrada sin registro y directorio ausente

**Directorio presente sin `record.json`, comprobado bajo el bloqueo:** `CaptureIntegrityError`.
- **No se interpreta como purga:** la purga reclama la entrada completa o solo `payload/`, siempre bajo bloqueo, y nunca borra `record.json` sola.
- **No se toca:** no se sobrescribe, no se borra y no se publica encima. Tampoco si el directorio está vacío, aunque `rename` podría reemplazarlo: la comprobación ocurre bajo el bloqueo y antes de cualquier `rename` sobre la entrada.
- **La purga** lo informa y lo omite.
- **El host** lo trata como incierto, y queda para un operador.

**Directorio ausente: depende de cuándo y con qué bloqueo:**

| Situación | Interpretación | Resultado |
|---|---|---|
| Ausente al comenzar la sección bajo bloqueo | No existió, o una purga legítima lo eliminó antes, con su propio bloqueo | `send` publica; la purga lo omite; `readCapture` da `CaptureNotFoundError` |
| Desaparece durante la sección bajo el bloqueo propio | Solo el titular modifica la entrada: lo quitó alguien fuera del protocolo | `CaptureIntegrityError`, sin publicar encima |
| Ausente en una lectura sin bloqueo (lectura normal de `readCapture` o escaneo de la purga) | Puede ser una purga legítima concurrente | `readCapture`: `CaptureNotFoundError`, y quien llama puede reintentar. La purga descarta el candidato |

**`readCapture`, sin bloqueo en el camino normal:**
- **Directorio ausente:** `CaptureNotFoundError`.
- **Directorio presente pero falla la lectura del registro o del contenido:** no concluye. Repite la lectura bajo el bloqueo (con la espera de §9.4, y `KEY_BUSY` si no lo obtiene) y recién ahí decide:
  - sin directorio: `CaptureNotFoundError`;
  - directorio sin registro: `CaptureIntegrityError`;
  - sin `payload/`: el registro con `payloadAvailable: false`;
  - `payload/` incompleto o con hashes distintos: `CaptureIntegrityError`.
- **Nunca devuelve datos mezclados:** el contenido devuelto se valida contra `contentSha256`.

**La purga:** lo que ve sin bloqueo durante el escaneo no decide nada. Toda anomalía se comprueba bajo el bloqueo (§9.8).

### 9.8 Retención, purga y alcance de la idempotencia

**Dos plazos, contados desde `capturedAt` del registro, no desde la fecha del archivo:**

| Qué | Plazo por defecto | Clave |
|---|---|---|
| Contenido (`payload/`) | 7 días | `LOCAL_MAIL_CAPTURE_RETENTION_DAYS`, de 1 a 30 |
| Registro (`record.json`), es decir, la entrada completa | 30 días | `LOCAL_MAIL_CAPTURE_RECORD_DAYS`, de 1 a 365, y no menor que el anterior |

**`purgeCaptures()`:**
1. **Escaneo sin bloqueo:** lista `captures/` y lee cada `record.json`. Anota `captureId`, `publicationId` y qué venció.
2. **Por cada candidato:** intenta el bloqueo sin esperar. Si está ocupado, lo omite. Eso incluye un bloqueo abandonado por una caída.
3. **Bajo el bloqueo, relee y decide:**
   - si no hay directorio, ya fue purgado: lo omite;
   - si hay directorio sin registro: §9.7, lo informa y lo omite;
   - si tiene otro `publicationId`, es una captura nueva con el mismo `captureId`: la omite;
   - si tiene el mismo `publicationId`, recalcula el vencimiento con el reloj actual y reclama el contenido o la entrada dentro del bloqueo (§9.4).
4. Hace `fsync` del directorio afectado, libera el bloqueo y borra lo reclamado.

Dos purgas concurrentes no fallan: la segunda encuentra la clave ocupada o la entrada ya purgada.

**Coordinación:**
- **Purga y publicación,** el escenario de la purga que se pausa:
  - **A se pausó después de leer en el escaneo, sin bloqueo:** en ese lapso, otra purga B elimina la entrada, y `send` publica una nueva con otro `publicationId`. Al continuar, A toma el bloqueo, ve otro `publicationId` y omite la nueva. La captura nueva se conserva.
  - **A se pausó con el bloqueo tomado,** sin importar cuánto: conserva el bloqueo. B omite la clave, y `send` espera hasta 5 s y recibe `KEY_BUSY`. Cuando A se reanuda, reclama la captura vieja y libera. El reintento de `send` publica la nueva.
  - **A cayó con el bloqueo tomado:** el bloqueo queda. B omite la clave, y `send` recibe `KEY_BUSY` hasta el mantenimiento con los consumidores detenidos (§7.3). El mantenimiento termina de borrar lo que A había reclamado y quita el bloqueo. Después, `send` publica.
- **Purga y lectura:**
  - `readCapture` ve la entrada completa, solo el registro o nada, según §9.7;
  - si ya había abierto los archivos, termina de leerlos (semántica POSIX) y valida el resultado contra `contentSha256`.
- **Purga y envío repetido:**
  - la purga del contenido no libera la entrada: un reintento encuentra `record.json` y recibe `duplicate: true` con `payloadAvailable: false`, o `IDEMPOTENCY_CONFLICT`;
  - la entrada se libera solo al vencer el registro, y bajo bloqueo.

**Alcance temporal de la idempotencia:**
- El adaptador deduplica por clave mientras existe el registro: 30 días desde la captura, por defecto.
- Borrar la entrada elimina su evidencia, sea por vencimiento o porque un operador la borró a mano. Después, la misma clave produce una captura nueva, con otro `publicationId`.
- Como solución local acotada, se conserva el registro sin datos personales más tiempo que el contenido. No hay base ni índice aparte.

**Lo que deberá garantizar el host en P2:**
- **Idempotencia durable en la base:**
  - clave de idempotencia única por entrega;
  - el resultado `CAPTURED` y el `captureId`, registrados en una transacción;
  - nunca volver a llamar a `send` para una entrega ya registrada como capturada.
- **Reintentos con la misma clave:** solo para entregas cuyo resultado no quedó registrado, por una caída entre `send` y la base o por `AFTER_PUBLISH` o `KEY_BUSY`. Siempre dentro del alcance de 30 días.
- **`KEY_BUSY`:** reintentar con espera creciente. Si persiste, alertar a un operador, porque puede indicar un bloqueo abandonado que requiere el mantenimiento de §7.3. El host no ejecuta ese mantenimiento por su cuenta.
- **Fuera del alcance de 30 días:** marcar la entrega `UNCERTAIN` para un operador, en lugar de reenviar.
- **`CaptureIntegrityError`:** se trata como incierto, nunca como entregado, y no se reintenta solo.
- **Limpieza programada:** `purgeCaptures` y `recoverWorkArea`.
- **Capturas viejas:** no depender de su contenido después de 7 días.

### 9.9 Lo que no promete

La captura no dice nada sobre entrega, rebote ni recepción. No reemplaza las pruebas del proveedor real (P5): codificación MIME, tamaño codificado, idempotencia del proveedor y webhooks.

## 10. Scanner simulado

### 10.1 Puerto y resultado con procedencia

```ts
interface DocumentScanner {
  readonly kind: "SIMULATED";
  readonly inspectsContent: false;
  scan(request: { documentId: string; storageKey: string; declaredMimeType: string; sizeBytes: number }): Promise<ScanOutcome>;
}
type ScanOutcome =
  | { provenance: "SIMULATED"; label: "SIMULATED_RESULT_NOT_A_SCAN"; scenario: SimulatedScenario; result: "APPROVED" | "SCAN_INCONCLUSIVE" }
  | { provenance: "SIMULATED"; label: "SIMULATED_RESULT_NOT_A_SCAN"; scenario: SimulatedScenario; result: "REJECTED"; rejectionReason: "MALWARE" | "TYPE_MISMATCH" | "ENCRYPTED" };
```

- **No lee el contenido:** no recibe acceso al almacenamiento y nunca lee bytes. No detecta malware, y su etiqueta lo dice.
- **Rechazos:** un rechazo con motivo `MALWARE` es un escenario elegido por quien prueba, no una detección.
- **Compatibilidad con los contratos:**
  - `result` y `rejectionReason` usan los valores de `contracts`: `SCAN_RESULTS` y los motivos de `DOCUMENT_SCAN_RESULT`;
  - la entrada usa referencias existentes: `documentId` (`internalIdSchema`) y la clave del almacenamiento;
  - construir `DOCUMENT_SCAN_RESULT` y el trabajo que lo produce es de P2.

### 10.2 Escenarios deterministas

| Escenario | Resultado |
|---|---|
| `INCONCLUSIVE` (**por defecto**, aprobado por el propietario) | `SCAN_INCONCLUSIVE` simulado |
| `APPROVED` (solo si se elige explícitamente) | Aprobación simulada |
| `REJECTED_MALWARE`, `REJECTED_TYPE_MISMATCH` y `REJECTED_ENCRYPTED` | Rechazo simulado con ese motivo |
| `UNAVAILABLE` | Lanza `ScannerUnavailableError`: el host deja el documento pendiente (ADR-007) |
| `DELAYED` | Resuelve el escenario indicado después de `delayMs`, con un temporizador inyectable (pruebas con reloj falso) |

**Selección:**
- el valor de `SCANNER_SIMULATED_SCENARIO`. Si falta, es `INCONCLUSIVE`;
- o una función `scenarioFor(request)` inyectada por las pruebas o por el host de simulación de P3.

**Por qué `INCONCLUSIVE` por defecto:** un resultado inconcluso nunca se aprueba automáticamente ni es seleccionable (ADR-007 y ADR-014). Una configuración olvidada no vuelve distribuible ningún documento. El recorrido de demostración tiene que elegir `APPROVED` explícitamente (P3).

**Sin azar:** el mismo pedido con la misma configuración da siempre el mismo resultado.

### 10.3 Separación de resultados reales y envíos reales

- **En el adaptador (P1-T5):**
  - todo resultado lleva `provenance: "SIMULATED"` y la etiqueta, y el tipo no admite otra procedencia;
  - no se construye fuera de `development` o `test` (§5).
- **En la composición (P1-T5, §11):** `assertSafeComposition` rechaza combinar el scanner simulado con un emisor que entrega de verdad (`deliversExternally: true`). En P1-T5 solo existe la captura, así que la prueba usa un doble.
- **En P2 (aprobado, §18.1):** contratos y base registran la procedencia antes de integrar el adaptador al host. Un resultado simulado nunca cuenta como análisis real.

## 11. Composición

- **`createLocalAdapters`:**
  - recibe `appEnv`, la raíz del repositorio y la configuración de §12;
  - aplica §5, §6 y la limpieza en ejecución de §7.2;
  - llama a `assertSafeComposition`;
  - devuelve `{ storage, email, scanner, maintenance, mode: "LOCAL_SIMULATED" }`, congelado.
- **`maintenance`:** agrupa `recoverWorkArea`, `purgeCaptures`, `readCapture` y `close`. No incluye `recoverStoppedRoot`, que solo está en el punto de entrada separado (§4 y §7.3).
- **`assertSafeComposition`:** es pública. La usarán los hosts de P2, P3 y P5 al combinar adaptadores reales y simulados.

## 12. Configuración

**Claves nuevas en `.env.example`**, sin valores secretos:

| Clave | Regla | Por defecto |
|---|---|---|
| `LOCAL_STORAGE_DIR` | Ruta absoluta y privada (§6) | `storage/documents` dentro del repositorio |
| `LOCAL_MAIL_CAPTURE_DIR` | Ruta absoluta y privada (§6) | `storage/mail-captures` dentro del repositorio |
| `LOCAL_MAIL_CAPTURE_RETENTION_DAYS` | Entero de 1 a 30 | 7 |
| `LOCAL_MAIL_CAPTURE_RECORD_DAYS` | Entero de 1 a 365, no menor que el anterior | 30 |
| `SCANNER_SIMULATED_SCENARIO` | Uno de §10.2, salvo `DELAYED` | `INCONCLUSIVE` |

- **Se reutilizan:** `APP_ENV`, `STORAGE_MODE=local_private`, `EMAIL_MODE=capture`, `SCANNER_MODE=fake_development_only` y `MAX_FILE_BYTES`.
- **Cupo del trámite:** `MAX_CANDIDATE_FILES_PER_SUBMISSION` y `MAX_CANDIDATE_BYTES_PER_SUBMISSION` son del host (P2). P1-T5 no las lee.
- **Constante con nombre, no configuración:** la espera del bloqueo por clave, de 20 a 200 ms y hasta 5 s.
- **Sin plazos de abandono:** no hay arrendamientos ni vencimientos de bloqueos (§7).
- **Validación:** igual que la API: por clave, sin valores y con todos los problemas juntos.

## 13. Pruebas

Todas sin base de datos: entran en `pnpm run check`. Usan directorios creados por cada prueba con `mkdtemp`, con archivos reales.

**Fallos y pausas inyectados:** donde un fallo o una intercalación no se puede provocar de forma determinista, la interfaz interna de archivos (§4) falla o se detiene en el paso elegido, hasta que la prueba la libera. Los archivos siguen siendo reales.

**Reloj inyectado:** las esperas largas, como una pausa de más de 120 s o la espera de 5 s del bloqueo, se recorren con un reloj falso.

**Varias instancias:** se emulan con dos o más adaptadores sobre la misma raíz, dentro del proceso de prueba. La coordinación (bloqueos y temporales) pasa solo por el sistema de archivos, así que ejercita el mismo camino que procesos separados.

**Caída de un proceso:** se emula con una instancia que se descarta sin `close` ni liberación, y cuyas operaciones quedan sin terminar.

**Precondición del mantenimiento:** en las pruebas, "consumidores detenidos" significa que la prueba cerró o descartó todas las instancias de esa raíz antes de llamar a `recoverStoppedRoot`. La prueba garantiza la precondición; el adaptador no la verifica.

**Entorno:**
- `production`, `staging`, un valor desconocido o ausente, y un valor recibido distinto de `process.env.APP_ENV`: cada fábrica rechaza. Es la salida de docs/15 §9.
- `APP_ENV` cambiado a `production` después de construir: cada operación falla.
- El mantenimiento también rechaza esos entornos.
- **API:** con `staging` rechaza `STORAGE_MODE`, `EMAIL_MODE` y `SCANNER_MODE` locales (`SIMULATED_MODE_OUTSIDE_LOCAL`). Sigue aceptándolos en `development` y `test`, y `CHANNEL_MODE` no cambia.

**Raíz y antecesores (§6), con archivos reales:**
- Enlace del usuario en un antecesor (`<tmp>/a → <tmp>/b`, con raíz `<tmp>/a/raiz`): se rechaza.
- La raíz como enlace, o `objects/`, `captures/` o `locks/` como enlace: se rechazan.
- **Antecesor modificable por terceros:**
  - con escritura de grupo (`0770`) o de otros (`0757`): se rechaza;
  - con `1777` pero del usuario, no de root: se rechaza.
- Raíz o subdirectorio existente con modo `0750`: se rechaza y no se corrige.
- **Rutas temporales legítimas:** una raíz en `mkdtemp(os.tmpdir())` se acepta.
  - En macOS pasa por `/var`, un enlace de root, y `/private/var/folders`.
  - En Linux, por `/tmp`, de root con `1777`.

  Corre en las dos plataformas: local y CI.
- Cambiar `objects/` o `captures/` por otro directorio o por un enlace después de construir: la operación siguiente falla sin escribir.
- **Casos que requieren otro usuario o root:** no se pueden crear sin privilegios. Se prueban con la función de decisión pura, alimentada con datos de `stat` sintéticos:
  - antecesor de otro usuario;
  - directorio de root con bit sticky y su siguiente componente de otro usuario;
  - enlace de root en un directorio confiable y en uno no confiable.

  Se indica en la prueba que no ejercita el sistema de archivos.

**Limpieza en ejecución y mantenimiento (§7):**
- **Operación lenta de otra instancia:** su flujo queda en pausa más de 120 s, y su temporal se envejece con `utimes` a varios días. La limpieza en ejecución de otra instancia no la toca. Al reanudarse, publica.
- **Restos propios:** se borran en la limpieza en ejecución propia y en `close`.
- **Restos de una instancia caída:** la construcción y la limpieza en ejecución de otras instancias no los tocan. El mantenimiento con consumidores detenidos los borra.
- **Material bajo un bloqueo** (`staged/`, y una entrada o un contenido reclamados): queda intacto después de `recoverWorkArea` de cualquier instancia. El titular publica o libera después.
- **`.reclaim/`:** la limpieza en ejecución lo vacía. Dos instancias que lo vacían a la vez no fallan.
- **Separación del mantenimiento:**
  - ni la construcción ni `recoverWorkArea` llaman a `recoverStoppedRoot` (comprobado con un espía);
  - `createLocalAdapters` no lo expone; solo está en el punto de entrada separado.
- **Lo que no toca el mantenimiento:** no modifica entradas de `captures/` ni objetos de `objects/`, y su informe no contiene contenido.

**Almacenamiento (§8):**
- **Ida y vuelta:** `put`, `open` y `delete` conservan los bytes y el SHA-256. `listObjects` lista lo publicado.
- **Límites:** 1 byte y `maxBytes` exacto se aceptan. `maxBytes + 1` y 0 bytes se rechazan. Al superar el límite deja de leer, comprobado con un flujo que cuenta lo que entrega.
- **Claves inválidas:** `../x`, absolutas, con separadores, `%2e%2e`, byte nulo, Unicode, mayúsculas o largo distinto dan `InvalidObjectKeyError` antes de tocar el disco.
- **Enlaces en el último componente:**
  - un enlace plantado en el destino falla sin sobrescribir;
  - en `tmp/`, `O_EXCL` y `O_NOFOLLOW` fallan;
  - en el lugar de un objeto, `open` lo rechaza;
  - un descriptor ya abierto sigue leyendo el objeto original.
- **Permisos:** `0700` y `0600` aunque la `umask` sea permisiva.
- **Fases (§8.4), una prueba por fila de la tabla:**
  - un fallo inyectado en la creación del temporal, la copia, el `fsync` del archivo o `link` deja el destino ausente, y el temporal borrado o recuperable;
  - `link` con `EEXIST` da `StorageIntegrityError` y el existente intacto;
  - `link` con otro error, en dos versiones: con el destino creado (sigue como publicado) y sin crearlo (`BEFORE_PUBLISH`);
  - si falla el `fsync` de `objects/`: `AFTER_PUBLISH` con `key` y `WITHDRAWN`, y el objeto ya no aparece en `listObjects`;
  - si además falla el retiro: `LEFT_IN_PLACE`, y el objeto visible y listado;
  - si falla el borrado del temporal: `put` resuelve, el objeto queda intacto y la limpieza en ejecución propia borra el temporal;
  - una cancelación después de `link` se ignora.
- **Borrado:**
  - un fallo inyectado en el retiro (`rename`) sin trasladar da `BEFORE_REMOVE` y el objeto presente; un error informado después de trasladar sigue y da `DELETED`;
  - un fallo en el `fsync` después del retiro da `AFTER_REMOVE`, y el reintento da `ALREADY_ABSENT` sin error;
  - si falla el borrado físico, `DELETED`, el evento `DELETED_OBJECT_RESIDUE` y la limpieza propia lo retoma;
  - una entrada reemplazada entre la comprobación y el retiro da `TARGET_CHANGED`, se restituye y no se borra;
  - dos borrados concurrentes dan un `DELETED` y un `ALREADY_ABSENT`, con llamadas reales en 100 rondas, desde una instancia y desde dos sobre la misma raíz, en macOS y en Linux, sin omitir plataformas; y con una compuerta que hace llegar a los dos al `rename`;
  - una lectura abierta antes del borrado sigue leyendo; una apertura nueva da `ObjectNotFoundError`.
- **Publicación incierta (§8.4.1):** `link` y comparación fallidas dan `UncertainPublicationError`, nunca `AFTER_PUBLISH`, con tres destinos: ausente (`NOT_PUBLISHED`), propio (`WITHDRAWN`) y un objeto anterior, con `link` con `EIO` y con `EEXIST` (`KEY_HELD_BY_OTHER`, intacto). Mientras está pendiente, `delete` de la clave rechaza y la limpieza no toca la prueba. Si la comparación sigue fallando o la prueba se perdió, nada se retira. Las conciliaciones concurrentes comparten el resultado. El cierre conserva la prueba.
- **Propiedad y registro (§7.1, §8.3):** un `<op>.part` o un `del-<op>/` preexistentes no se modifican ni se borran; una colisión de id con una operación activa no toca su temporal ni su registro; la limpieza no toca el destino privado de un `delete` activo.
- **Ciclo de vida (§7.5), con compuertas:** un `put` que empieza mientras `close` borra el directorio no se admite; `close` espera a un `put` y a un `delete` admitidos antes; las llamadas concurrentes y repetidas comparten intento e informe; después del cierre toda operación nueva rechaza y los streams abiertos siguen; un cierre fallido no readmite operaciones y el siguiente reintenta.
- **Concurrencia:** 50 `put` en paralelo dan claves distintas.

**Captura de correo (§9):**
- **Inspección:**
  - una captura con adjunto real: `payload/message.json` y `attachment.bin` coinciden con lo enviado;
  - `record.json` no contiene destinatarios, asunto, cuerpo ni nombre de archivo.
- **Rechazos:** CR o LF en el asunto final, en un destinatario o en el nombre del adjunto, y los demás casos de §9.2, dan `REJECTED` sin escribir.
- **Bloqueo por clave (§9.4):**
  - dos adquisiciones concurrentes de la misma clave: una obtiene el bloqueo y la otra lo ve ocupado;
  - la adquisición de `send` traslada `staged/` junto con el bloqueo: después del `rename`, la captura ya no está en `tmp/`;
  - **titular pausado más de 120 s,** con reloj inyectado:
    - conserva el bloqueo;
    - otra instancia recibe `KEY_BUSY` después de 5 s, y la purga omite la clave;
    - nada rompe el bloqueo;
    - al reanudarse, el titular termina su operación;
  - **liberación normal:** otra instancia puede continuar. Un `send` que estaba esperando adquiere el bloqueo y publica dentro de su espera, o lo hace un reintento posterior a un `KEY_BUSY`;
  - **proceso caído:** deja un bloqueo que no se rompe automáticamente. Persiste después de construir otras instancias y después de `recoverWorkArea`. `send` da `KEY_BUSY` y la purga omite la clave;
  - **mantenimiento con consumidores detenidos:**
    - con todas las instancias cerradas, `recoverStoppedRoot` quita el bloqueo abandonado, descarta `staged/` y termina de borrar la entrada reclamada;
    - informa lo recuperado;
    - después, `send` publica y la purga procesa la clave.
- **Purga pausada frente a una recreación, escenario pedido por el propietario,** con pausas inyectadas:
  - **A pausada después de leer en el escaneo, sin bloqueo:**
    1. la purga A lee el registro viejo (`publicationId` P1) y se pausa;
    2. la purga B elimina la entrada;
    3. `send` con la misma clave publica una captura nueva (P2);
    4. A continúa.

    Resultado: A toma el bloqueo, ve P2 y la omite. P2 queda intacta, con registro y contenido.
  - **A pausada con el bloqueo tomado, después de leer P1, durante más de 120 s:**
    1. B omite la clave;
    2. `send` recibe `KEY_BUSY`;
    3. A continúa, reclama P1 y libera;
    4. el reintento de `send` publica P2.

    Resultado: P2 queda intacta y A no la tocó.
  - **A cae con el bloqueo tomado, después de reclamar P1:**
    1. B omite la clave;
    2. `send` recibe `KEY_BUSY`;
    3. con las instancias detenidas, el mantenimiento termina de borrar P1 y quita el bloqueo;
    4. `send` publica P2.
- **Fases (§9.5), una prueba por fila de la tabla:**
  - un fallo inyectado en la preparación no deja una captura visible, y lo preparado se borra;
  - la clave ocupada durante toda la espera da `KEY_BUSY`, y lo preparado se borra;
  - la adquisición con otro error, en dos versiones: con el bloqueo creado (sigue) y sin crearlo (`BEFORE_PUBLISH`);
  - una entrada plantada bajo el bloqueo antes de publicar da `CaptureIntegrityError`, y la plantada no se modifica;
  - si `staged/` se quita del bloqueo antes de publicar (inyectado): `CaptureIntegrityError`, y nada publicado;
  - la publicación con otro error y la entrada creada: sigue como publicada;
  - si falla el `fsync` de `captures/`: `AFTER_PUBLISH` con `captureId`. El reintento con la misma clave y el mismo contenido da `duplicate: true` y `payloadAvailable: true`, sin una segunda entrada, y repite el `fsync`;
  - si falla la liberación: `send` resuelve, y otra instancia recibe `KEY_BUSY` hasta que la limpieza en ejecución propia libera el bloqueo. Después continúa.
- **Verificación (§9.6):**
  - el mismo contenido da `duplicate: true`;
  - otro contenido da `IDEMPOTENCY_CONFLICT`, con la original intacta;
  - un `attachment.bin` alterado o ausente da `CaptureIntegrityError` y no se sobrescribe;
  - un `record.json` con otro `idempotencyKeySha256` da `CaptureIntegrityError`;
  - diez envíos concurrentes con la misma clave dejan una sola entrada.
- **Entrada sin registro y directorio ausente (§9.7):**
  - `captures/<id>/` sin `record.json`, con `payload/` o vacío: `send` da `CaptureIntegrityError`, y la entrada queda igual (mismo inodo y mismo contenido). La purga la informa y la omite, y `readCapture` da `CaptureIntegrityError`;
  - directorio ausente al comenzar la sección bajo bloqueo: `send` publica;
  - directorio quitado durante la sección bajo el bloqueo propio (un actor fuera del protocolo, inyectado): `CaptureIntegrityError`, sin publicar encima;
  - `readCapture` sin bloqueo, con una purga legítima de la entrada completa inyectada entre la lectura del registro y la del contenido: `CaptureNotFoundError`, no `CaptureIntegrityError`;
  - `readCapture` con el contenido purgado entre esas dos lecturas: el registro con `payloadAvailable: false`, sin datos mezclados.
- **Retención (§9.8), con reloj inyectado:**
  - al vencer el contenido se borra `payload/` y queda `record.json`. Un reintento da `duplicate: true` y `payloadAvailable: false`;
  - al vencer el registro se borra la entrada. Un reintento posterior crea una captura nueva con otro `publicationId`: es el alcance documentado;
  - una configuración con el registro más corto que el contenido se rechaza;
  - dos purgas concurrentes eliminan cada elemento una vez, sin errores.
- **Sin red:** con `fetch`, `net.connect` y `http.request` reemplazados por funciones que fallan, la captura funciona.

**Scanner simulado (§10):**
- sin configuración el resultado es `SCAN_INCONCLUSIVE`, y `APPROVED` aparece solo si se configura o se inyecta;
- cada escenario da su resultado, siempre con `provenance: "SIMULATED"` y la etiqueta;
- `UNAVAILABLE` lanza, y `DELAYED` resuelve solo después del plazo, con reloj falso;
- no lee el almacenamiento: una prueba lo confirma con un almacenamiento espía;
- los valores pasan los esquemas de `contracts`.

**Composición, límites y lint:**
- el scanner simulado junto a un emisor con `deliversExternally: true` se rechaza;
- `adapters` solo depende de `contracts` y `flow-schema`;
- los módulos locales y los de mantenimiento no importan red ni procesos.

**Lo que sigue sin cubrirse** hasta P5, o hasta P3, P6 o P7 según el caso:
- tipo real por firma de bytes, y extensión o MIME falsos (T14);
- descarga por red con límites, redirecciones y SSRF (T15, parte de red);
- antimalware real, EICAR y PDF cifrado (T16);
- autorización de descarga y URL firmadas (T17);
- bloqueo de correo real desde la simulación, de punta a punta (T18, P3);
- retención y purga programada de documentos (T27, P7);
- asunto interpolado por el renderizado (T53, parte de renderizado);
- media de Meta (P6);
- proveedor de correo real: MIME, tamaño codificado, idempotencia y webhooks;
- almacenamiento de objetos S3;
- cortes de energía reales y durabilidad del disco;
- coordinación entre procesos separados de verdad. Se emula con instancias en un proceso, por el mismo sistema de archivos;
- verificar que no haya consumidores antes del mantenimiento. El adaptador no puede hacerlo: es responsabilidad de quien opera.

Las pruebas de P1-T5 no reemplazan ninguna de esas. docs/09 exige bytes reales en un entorno aislado para T13–T16, con descarga y análisis.
- Los archivos reales de P1-T5 cubren solo la parte de almacenamiento: el corte por límite de T15 y la escritura privada.
- T18 recibe la guarda de construcción y de composición.

## 14. Secuencia de implementación

1. Esqueleto de `packages/adapters`, sus dos puntos de entrada, límites de ADR-001, reglas de ESLint (sin red) y la prueba de límites.
2. Guardas de entorno y configuración (§5 y §12), con sus pruebas. Regla de `staging` en la API (aprobada).
3. Puertos (§8.1, §9.1 y §10.1) y la interfaz interna de archivos.
4. Raíz privada y antecesores (§6), con las pruebas reales y las sintéticas.
5. Área de trabajo y limpieza en ejecución (§7.1 y §7.2).
6. Almacenamiento (§8), con las pruebas por fase.
7. Captura de correo (§9): bloqueo por clave, publicación, verificación, entrada sin registro, retención y concurrencia.
8. Mantenimiento con consumidores detenidos (§7.3), con su comando y sus pruebas.
9. Scanner simulado (§10).
10. Composición (§11).
11. Documentos:
    - addenda de ADR-001 (paquete, puertos y puntos de entrada), ADR-005 (regla de `staging` de la API), ADR-006 (resultado `CAPTURED`, alcance de la idempotencia local y bloqueo por clave sin ruptura automática) y ADR-007 (controles de la carpeta privada y escenario por defecto);
    - docs/10, con el procedimiento de mantenimiento y sus precondiciones, y `.env.example`;
    - README del paquete, con la revisión de ACL en macOS y el mantenimiento;
    - docs/09 y 13;
    - `PROJECT_STATUS.md` y la descripción del PR.
12. `check` y `check:db` (sin cambios esperados), checkout limpio y CI.

## 15. Criterios de salida

- **Entorno:** los adaptadores locales y su mantenimiento no se pueden construir ni usar con `APP_ENV` fuera de `development` o `test`. Se comprueba en la configuración, en la construcción y en cada operación. Es la salida de docs/15 §9.
- **API:** con `staging` rechaza los tres modos locales, con pruebas.
- **Raíz y antecesores:** se comprueban según §6, con pruebas reales en macOS y Linux, y sintéticas para lo que requiere otros usuarios.
- **Fallos por fase:**
  - cada fila de las tablas de §8.4 y §9.5 tiene su prueba;
  - ningún fallo posterior a la publicación se informa como si el destino estuviera ausente;
  - los errores posteriores siempre identifican la clave o el `captureId`.
- **Limpieza:**
  - la limpieza en ejecución solo toca lo propio sin operación activa y `.reclaim/`;
  - nunca toca temporales de otras instancias, bloqueos ajenos ni el material que conservan, aunque sean viejos;
  - las dos cosas con pruebas.
- **Bloqueo por clave:**
  - toda decisión y modificación sobre una entrada de captura ocurre bajo el bloqueo de su `captureId`;
  - no hay ruptura automática: un titular pausado más de 120 s conserva el bloqueo;
  - un bloqueo abandonado da `KEY_BUSY` y la purga lo omite hasta el mantenimiento;
  - las tres variantes del escenario de la purga pausada conservan la captura nueva o hacen esperar su creación;
  - todo con pruebas deterministas.
- **Mantenimiento:**
  - es una operación explícita, separada de la composición, con su procedimiento y sus precondiciones documentados;
  - no se ejecuta al construir ni desde `recoverWorkArea`;
  - con los consumidores detenidos, recupera bloqueos y temporales abandonados, con pruebas.
- **Entrada sin registro y directorio ausente:**
  - una entrada sin registro da `CaptureIntegrityError`, sin sobrescribirla ni borrarla;
  - un directorio ausente se distingue según ocurra al comenzar, durante o fuera de la sección bajo bloqueo;
  - las dos cosas con pruebas.
- **Captura:**
  - los reintentos reconocen y verifican una captura publicada sin duplicarla;
  - la purga conserva el registro;
  - el alcance de la idempotencia está documentado y probado.
- **Scanner:** su valor por defecto es `INCONCLUSIVE`, con prueba.
- **Aislamiento:** ningún módulo local ni de mantenimiento importa red ni procesos, comprobado por lint y por prueba.
- **Sin cambios fuera de alcance:**
  - sin dependencias nuevas;
  - sin migraciones nuevas ni modificadas;
  - sin cambios en el motor ni en los contratos;
  - en la API, solo la regla de `staging`.
- **Checks:** `check` y `check:db` en verde, en local, en checkout limpio y en la CI.
- **Documentación:** la de §14 está actualizada.

## 16. Riesgos y limitaciones

- **Procesos del mismo usuario:** pueden reemplazar directorios propios entre una comprobación y su uso, porque Node no tiene `openat`, y también pueden leer los archivos. Fuera del modelo de amenazas local (§6.6).
- **ACL en macOS:** no se inspeccionan (§6.6).
- **Bloqueos abandonados (A4):**
  - después de una caída, las claves afectadas dan `KEY_BUSY` y la purga las omite hasta el mantenimiento con consumidores detenidos;
  - es una pérdida de disponibilidad aceptada para no romper bloqueos de procesos pausados pero vivos;
  - un titular vivo y lento también hace esperar a esa clave, como máximo 5 s por intento de `send`.
- **Temporales de instancias caídas:** ocupan disco hasta el mantenimiento. Cada operación está acotada por `MAX_FILE_BYTES`.
- **Mantenimiento con consumidores activos:** viola su precondición. Puede borrar material de operaciones en curso o quitar un bloqueo vigente, y romper la exclusión por clave.
  - El adaptador no lo puede detectar ni impedir.
  - Mitigación: nunca es automático, tiene un punto de entrada separado y un procedimiento documentado.
- **Fuera del protocolo:** procesos del mismo usuario, borrados manuales o un mantenimiento indebido pueden alterar entradas o bloqueos. Cuando sus efectos alcanzan una entrada, se detectan como `CaptureIntegrityError`, sin garantía de detectarlos siempre.
- **`rename` sobre un directorio vacío lo reemplaza (POSIX):** por eso la entrada se comprueba bajo el bloqueo antes de cualquier `rename`, y un directorio sin registro, aun vacío, es un error de integridad (§9.7).
- **Huérfanos:** quedan si el host cae después de publicar y antes de registrar, o si el retiro de §8.4 falla o se revierte por una caída. Se concilian en P2/P7 con `listObjects`.
- **Publicación incierta (§8.4.1):** el registro es de la instancia. Después de un cierre o una caída con pendientes, solo queda la prueba en disco, para el mantenimiento. `listObjects` puede listar un objeto propio de una publicación incierta pendiente: la conciliación de P2 tiene que excluir las claves inciertas.
- **Identidad por inodo en el retiro (§8.5):** la comprobación posterior compara `dev` e inodo con los de la comprobación previa. Un proceso del mismo usuario que borre y vuelva a crear la entrada entre las dos podría obtener el mismo inodo (§6.6). La prueba de pertenencia de §8.4.1 no tiene ese límite, porque el temporal retenido mantiene el inodo ocupado.
- **Contenido de objetos borrados después de una caída:** puede quedar en `tmp/<instancia caída>/del-<op>/` hasta el mantenimiento (§8.5).
- **Cierre retenido:** `close` espera a las operaciones admitidas; un `put` sin señal con una fuente que no responde lo retiene (§7.5).
- **Durabilidad:** depende de que el sistema de archivos respete `fsync` sobre archivos y directorios. Las pruebas verifican el orden de las operaciones y el resultado de cada fallo inyectado, no cortes de energía reales.
- **Enlaces duros:** algunos montajes de red o exFAT no los admiten. La construcción lo comprueba (§6.4).
- **Alcance de la idempotencia de la captura:** 30 días por defecto. Fuera de ese plazo, el control es del host (§9.8).
- **Datos personales en capturas:** mitigado con permisos, purga del contenido a los 7 días, un registro sin datos personales y ningún log. Sigue siendo responsabilidad del operador no copiar capturas fuera de la máquina.
- **Simulación tomada por real:** mitigado con tipos, etiqueta, valor por defecto `INCONCLUSIVE`, guardas y composición. La persistencia de la procedencia es de P2.
- **Diferencias entre macOS y Linux:** en `rename` de directorios, `O_NOFOLLOW`, bit sticky y rutas temporales. Las pruebas corren en los dos: local y CI.

## 17. Archivos previstos

- **Nuevos:** `packages/adapters/` (§4), con su `package.json` sin dependencias externas, tsconfig, vitest, README y el script `maintenance`.
- **Modificados:**
  - `scripts/check-workspace-boundaries.mjs` y `eslint.config.js`;
  - `apps/api/src/config.ts` y sus pruebas (regla de `staging`);
  - `.env.example`;
  - ADR-001, ADR-005, ADR-006 y ADR-007 (addenda);
  - docs/09, 10 y 13;
  - `PROJECT_STATUS.md`;
  - la descripción del PR.

## 18. Decisiones

### 18.1 Aprobadas por el propietario (21/10/2026)

Son decisiones de diseño, no controles implementados. Se implementan al autorizarse P1-T5, o en P2 según corresponda.

| # | Decisión | Dónde se aplica |
|---|---|---|
| A1 | La configuración de la API rechaza con `APP_ENV=staging` los modos locales de almacenamiento (`local_private`), captura de correo (`capture`) y scanner simulado (`fake_development_only`) | P1-T5: `apps/api/src/config.ts` (§5) |
| A2 | El escenario predeterminado del scanner simulado es `INCONCLUSIVE`. `APPROVED` debe elegirse explícitamente | P1-T5: §10.2 y §12 |
| A3 | El registro de `CAPTURED` en `deliveries` y la procedencia del análisis en contratos y base quedan para P2, antes de integrar estos adaptadores al host | P2, con migraciones nuevas |
| A4 | Simplificación del bloqueo de capturas. Ver el detalle debajo | P1-T5: §7 y §9.4 |

**Detalle de A4:**
- **Se elimina:**
  - la ruptura automática de bloqueos por vencimiento;
  - el uso del traslado del directorio del token como garantía de cercado.
- **Se conservan:**
  - la exclusión por `captureId` entre instancias;
  - la publicación, la verificación y la purga bajo ese bloqueo;
  - `publicationId` y la relectura del registro antes de purgar;
  - `CaptureIntegrityError` si falta `record.json`;
  - la espera acotada y `KEY_BUSY` en `send`;
  - la purga que omite claves ocupadas.
- **Recuperación de bloqueos abandonados:**
  - es una operación explícita de mantenimiento, que requiere detener antes todos los procesos que usan la raíz;
  - nunca es automática.

**Aprobadas por el propietario el 27/10/2026 (revisión del bloque 2):**

| # | Decisión | Dónde se aplica |
|---|---|---|
| B1 | Se conserva el contrato del borrado concurrente: un `DELETED` y un `ALREADY_ABSENT`, también en macOS/APFS. Se implementa con un traslado exclusivo, sin bloqueos y sin omitir pruebas por plataforma | §8.5 |
| B2 | Una publicación cuyo resultado no se pudo determinar se representa de forma explícita. No se clasifica como objeto propio confirmado ni autoriza su eliminación sin comprobar pertenencia | §8.1, §8.4 y §8.4.1 |

**Requisitos fijados por el propietario para el plan (21/10/2026):**
- una purga no puede eliminar una captura recreada después con el mismo `captureId` (§9.4 y §9.8);
- un directorio de captura sin `record.json` es `CaptureIntegrityError`, distinto de un directorio ausente por una purga legítima (§9.7).

### 18.2 Propuestas por defecto

Se aceptan al aprobar el plan, salvo objeción:

| # | Tema | Propuesta |
|---|---|---|
| 1 | Entornos de los adaptadores locales | Solo `development` y `test`. Se rechazan `staging`, `production`, valores desconocidos y la ausencia de valor |
| 2 | Ubicación de los puertos | `packages/adapters/src/ports` hasta que exista `domain` (P2), con un addendum de ADR-001 |
| 3 | Directorios | `storage/documents` y `storage/mail-captures`, dentro del repositorio, ignorados por Git, con `0700` |
| 4 | Antecesores (§6) | Enlaces solo de root en directorios confiables. Antecesores de root o del usuario, sin escritura de grupo ni de otros, salvo directorios de root con bit sticky |
| 5 | Fallo del `fsync` después de publicar | El almacenamiento retira el objeto e informa la clave. La captura queda publicada, y el reintento la confirma |
| 6 | Temporales (§7) | Aplica a los temporales el mismo criterio de A4. Directorio por instancia, sin arrendamientos. En ejecución se limpia solo lo propio sin operación activa y `.reclaim/`. Los temporales de otras instancias se recuperan solo en el mantenimiento con los consumidores detenidos |
| 7 | Formato de captura | `record.json` sin datos personales y con `publicationId`, más `payload/` con `message.json` y `attachment.bin`. Sin `.eml` |
| 8 | Retención de capturas | Contenido 7 días y registro 30 días, que es el alcance de la idempotencia local |
| 9 | Detalles del bloqueo (§9.4) | Adquisición con un `rename` atómico que traslada también el material preparado. Espera de 20 a 200 ms, hasta 5 s, en `send`. Mantenimiento con un punto de entrada separado y un comando |
| 10 | Plataformas | Solo macOS y Linux |

**Antes de P2,** con A3 ya aprobada: el diseño concreto del estado `CAPTURED` y de la procedencia. Propuesta:
- `CAPTURED` nunca cuenta como `PROVIDER_ACCEPTED` ni como `DELIVERED`;
- la procedencia toma los valores `SIMULATED` o `ENGINE`, y P5 exige `ENGINE` para entregar con un correo real.
