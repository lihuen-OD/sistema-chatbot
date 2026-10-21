# Plan de P1-T5 — adaptadores locales (`packages/adapters`)

- Fecha: 21/10/2026
- Estado: **propuesto, pendiente de aprobación del propietario.** Solo planificación: no se implementó ningún adaptador ni se cambió código, dependencias, configuración ni migraciones.
- Base: `main` en `aaf0002` (P1-T1 a P1-T4 cerradas; CI #34 aprobada en los dos jobs).
- Fuentes:
  - `docs/15_PLAN_CONSOLIDADO_P0.md` §9;
  - ADR-001, ADR-005, ADR-006, ADR-007, ADR-009 y ADR-014;
  - docs/04, 05, 07, 09 y 10;
  - `packages/contracts` (eventos `JOB` y `SIMULATOR`);
  - `packages/flow-schema` (límites de asunto y destinatarios);
  - `apps/api/src/config.ts` (modos simulados);
  - `.env.example`.

## 1. Objetivo y salida verificable

Alcance según §9 y lo acordado con el propietario:
- almacenamiento en carpeta privada local;
- captura local de correo, sin entrega real;
- scanner simulado, etiquetado como simulación;
- controles que impiden usar estos adaptadores con `APP_ENV=production`.

La salida que fija §9 es "tests que impiden usarlos con `APP_ENV=production`". Este plan agrega las pruebas de los controles de cada adaptador (§11), con archivos reales en disco donde corresponde.

**Fuera de esta tarea:**
- motor, worker, jobs y cola;
- panel y simulador;
- seed general;
- WhatsApp, correo real y scanner real;
- detección de tipo por firma de bytes (P5);
- servicios contratados y dependencias nuevas.

P1-T5 no conecta los adaptadores a ninguna ruta de la API: su primer consumidor es el host de P2 o P3.

## 2. Estado de partida (21/10/2026)

**Comprobado por mí en esta sesión:**
- `main` local y `origin/main` en `aaf0002`, con los merges de los PR #7 a #10. Su árbol es idéntico al de `38fab2d`, la última rama revisada de P1-T4.
- CI #34 sobre `aaf0002`: success en los dos jobs (consultada en la API de GitHub).
- **Verificación local en `main`**, ya informada en la entrega anterior:
  - `pnpm install --frozen-lockfile`, `check` (62, 132, 191 y 58 pruebas), `db:up`, `db:migrate` (sin pendientes) y `check:db` (93 y 44): todos con código 0;
  - sin bases temporales sobrantes.
- **Terminal:** en un shell de login nuevo, Node v24.22.1 (`/usr/local/bin/node`, paquete `org.nodejs.node.pkg` v24.22.1) y pnpm 12.12.1 (`/usr/local/bin/pnpm`).
- **`.env` local:** tiene `MAX_CANDIDATE_FILES_PER_SUBMISSION` y `MAX_CANDIDATE_BYTES_PER_SUBMISSION`, y ya no tiene `MAX_FILES_PER_SUBMISSION`. Lo comprobé por los nombres de las claves, sin leer valores sensibles.
- `.gitignore` incluye `/storage/`.
- No existen `packages/adapters` ni `packages/domain`.

**Informado por el propietario:** la actualización de Node en su terminal la hizo él con el instalador oficial. Lo que verifiqué yo es el resultado.

**Hechos que condicionan el diseño:**
- El evento `DOCUMENT_SCAN_RESULT` de `contracts` no indica la procedencia del resultado (real o simulado).
- Los estados de `deliveries` (`0004`) no tienen uno para una captura local.
- `flow-schema` exporta `lineBreakPosition`, `SUBJECT_MAX_LENGTH` (200) y `RULE_LIMITS.recipientsPerDelivery` (20).
- `documents.storage_key` admite de 1 a 512 caracteres, y `documents.sha256` exige 64 hexadecimales en minúscula.

## 3. Dependencias y límites

- **Requiere** (cerradas): `contracts` (resultados de análisis y motivos de rechazo) y `flow-schema` (límites de asunto y destinatarios).
- **No requiere** `db` ni la API: los adaptadores no tocan la base.
- **Habilita:**
  - el host de P2, que registra documentos y entregas y aplica el cupo del trámite;
  - el simulador de P3;
  - P1-T6, porque el seed no usa adaptadores, pero la CI completa sí corre sus pruebas;
  - P5, que agrega los adaptadores reales detrás de los mismos puertos.
- **Sin dependencias de npm nuevas:** solo módulos de Node (`node:fs`, `node:crypto`, `node:path` y `node:stream`).
- **Sin migraciones:** no se tocan las aplicadas ni se agregan nuevas. Lo que necesite la base (procedencia del análisis y estado de captura) es de P2 (§16).

## 4. Ubicación y estructura

```
packages/adapters/
  src/
    index.ts
    environment.ts            guardas de entorno (§5)
    config.ts                 claves de configuración de los adaptadores locales (§10)
    ports/
      storage.ts              ObjectStorage y errores
      email.ts                EmailSender, OutgoingEmail y EmailSendResult
      scanner.ts              DocumentScanner y ScanOutcome
    local/
      fs-safety.ts            raíz privada, claves, aperturas sin seguir enlaces
      private-folder-storage.ts
      capture-email-sender.ts
      simulated-scanner.ts
    compose.ts                createLocalAdapters y assertSafeComposition (§9)
  test/                       pruebas sin base (entran en `pnpm run check`)
```

- **Paquete:** `packages/adapters`, como prevé ADR-001.
- **Dependencias internas:** `contracts` y `flow-schema`. Se agregan a `scripts/check-workspace-boundaries.mjs` y a ESLint.
- **Puertos en `adapters` por ahora:**
  - ADR-001 dice que los adaptadores implementan interfaces declaradas en `domain` o `contracts`;
  - `domain` todavía no existe, y `contracts` no puede usar APIs ni tipos de Node, mientras que los puertos usan flujos de bytes;
  - por eso los puertos viven en `adapters/src/ports` hasta P2, cuando se crea `domain`. Se registra en un addendum de ADR-001.
  - El motor nunca depende de `adapters`.
- **Sin red ni procesos:** ESLint prohíbe en `packages/adapters/src/local/**` importar `net`, `tls`, `http`, `https`, `http2`, `dgram`, `dns` y `child_process` (con y sin `node:`). Una prueba además reemplaza `fetch`, `net.connect` y `http.request` por funciones que fallan, y comprueba que ningún adaptador local las llama.
- **Plataformas:** solo POSIX (macOS y Linux, el de la CI). Los permisos y `O_NOFOLLOW` no tienen equivalente en Windows, que no se admite.

## 5. Guardas de entorno

**Entornos permitidos** para los adaptadores locales: exactamente `development` y `test`.
- `staging` y `production` se rechazan.
- Cualquier otro valor, o un valor ausente, también: no hay valor por defecto que habilite.

**Dónde se comprueba:**
1. **Configuración** (`config.ts` del paquete): rechaza `APP_ENV` fuera de la lista, informando la clave, sin el valor, como la API.
   - **Propuesta para la API (decisión 2 de §16):** en `staging`, los modos locales de esta tarea (`STORAGE_MODE=local_private`, `EMAIL_MODE=capture` y `SCANNER_MODE=fake_development_only`) pasan a ser un error (`SIMULATED_MODE_OUTSIDE_LOCAL`), además del de producción que ya existe. `CHANNEL_MODE` queda como está: es de P3 y P6.
   - **Cambio de comportamiento:** hoy la API arranca con `APP_ENV=staging` y modos simulados contra el contenedor local, porque las guardas de base no rechazan `staging`. Con el cambio, `staging` deja de tener configuración válida hasta que existan los adaptadores reales (P5). Si el propietario prefiere no tocar la API, las guardas de la configuración del paquete, de construcción y de cada operación alcanzan por sí solas: el host falla al componer.
2. **Construcción:** cada fábrica pública recibe `appEnv` explicitamente y exige que se cumplan las dos condiciones:
   - el valor recibido está en la lista;
   - `process.env.APP_ENV` está definido y es igual.

   Así una llamada con `"development"` dentro de un proceso de producción falla aunque se olvide la configuración. Las clases no se exportan, de modo que no hay `new` que eluda la fábrica.
3. **Cada operación:** `put`, `open`, `delete`, `send` y `scan` vuelven a leer `process.env.APP_ENV` antes de actuar. Es barato, y evita depender de una única comprobación hecha al iniciar la API.

**Error:** `AdapterEnvironmentError`, con código `LOCAL_ADAPTER_FORBIDDEN_ENVIRONMENT`. Sin el valor recibido.

## 6. Almacenamiento en carpeta privada

### 6.1 Puerto

```ts
interface ObjectStorage {
  readonly kind: "LOCAL_PRIVATE_FOLDER"; // P5: almacenamiento de objetos privado
  put(content: AsyncIterable<Uint8Array>, options: { maxBytes: number; signal?: AbortSignal }): Promise<StoredObject>;
  open(key: string): Promise<{ sizeBytes: number; stream: AsyncIterable<Uint8Array> }>;
  delete(key: string): Promise<"DELETED" | "ALREADY_ABSENT">;
}
interface StoredObject { key: string; sizeBytes: number; sha256: string }
```

Errores tipados:
- `InvalidObjectKeyError`;
- `ObjectTooLargeError`;
- `EmptyObjectError`;
- `ObjectNotFoundError`;
- `StorageIntegrityError` (raíz, tipo, dueño o enlace inesperado);
- `StorageWriteError`.

### 6.2 Raíz privada y permisos

- **Ubicación:** `LOCAL_STORAGE_DIR`; por defecto, `<repositorio>/storage/objects`, que Git ignora.
- **Rutas admitidas:** absoluta después de resolverla. Dentro del repositorio solo se admite debajo de `storage/`; fuera, cualquier ruta que cumpla los controles. Eso evita carpetas versionadas o servidas (por ejemplo, un `public/` del panel en P3).
- **Al construir:**
  - crea `objects/` y `tmp/` con modo `0700` si no existen;
  - si existen, exige que no sean enlaces simbólicos (`lstat`), que sean del usuario del proceso y que no tengan permisos de grupo ni de otros. Si no, falla con `StorageIntegrityError`: no corrige permisos en silencio.
- **Archivos:** se crean con `0600`, y el modo se fija con `fchmod`, sin depender de la `umask`.

### 6.3 Claves y rutas

- **Claves opacas:** las genera el adaptador, con 128 bits de `randomBytes` en 32 hexadecimales en minúscula. Quien llama no elige la clave. Caben en `documents.storage_key`.
- **Ningún dato de entrada se usa para formar rutas:** ni el nombre original del archivo, ni el MIME, ni ids. La ruta es `<raíz>/objects/<clave>`, sin subdirectorios.
- **Validación previa:** antes de cualquier operación de archivos, la clave se valida contra `^[0-9a-f]{32}$`. Eso descarta `..`, separadores, rutas absolutas, bytes nulos, Unicode y codificaciones, sin depender de normalizar rutas.

### 6.4 Escritura

1. Crea un temporal `tmp/<aleatorio>.part` con `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW` y modo `0600`.
   - `O_EXCL` falla si ya existe algo con ese nombre, incluido un enlace simbólico.
   - `O_NOFOLLOW` impide seguir un enlace en el último componente.
2. **Copia el flujo** contando bytes y calculando el SHA-256.
   - Si supera `maxBytes` (por defecto `MAX_FILE_BYTES`, 10485760), corta la lectura de inmediato, cierra, borra el temporal y lanza `ObjectTooLargeError`. El límite se aplica a los bytes recibidos, no al tamaño declarado.
   - Un objeto vacío se rechaza (`EmptyObjectError`).
3. `fsync` del archivo.
4. **Publicación sin sobrescribir:** `link(temporal, objects/<clave>)`. El enlace duro falla con `EEXIST` si el destino existe, y nunca reemplaza un objeto; `rename` sí lo haría. Después borra el temporal y hace `fsync` del directorio.
5. Ante cualquier error (del flujo, de `AbortSignal`, de disco o de permisos), cierra y borra el temporal. No queda un objeto parcial visible.

### 6.5 Lectura y borrado

- **Lectura (`open`):** abre con `O_RDONLY | O_NOFOLLOW` y comprueba con `fstat` sobre el descriptor abierto, no sobre la ruta, que sea un archivo regular del usuario del proceso. Así la comprobación y el uso son el mismo objeto.
  - Fuera de eso, o si no existe: `ObjectNotFoundError` o `StorageIntegrityError`.
  - Si se borra un objeto que se está leyendo, la lectura en curso sigue (semántica POSIX), y una lectura nueva da `ObjectNotFoundError`.
- **Borrado (`delete`):** `unlink`, previa validación de la clave.
  - **Repetición documentada:** el primer borrado devuelve `DELETED` y los siguientes `ALREADY_ABSENT`, sin error. Dos borrados concurrentes dan uno de cada.
- **Objetos propios:** lectura y borrado se limitan a claves con el formato del adaptador, dentro de su raíz, archivos regulares y del usuario del proceso. Quién puede leer qué documento es una autorización del host (P4).

### 6.6 Temporales, repetición y errores

- **Limpieza de temporales:** `cleanupTemporaryFiles(olderThanMs)` borra solo archivos de `tmp/` con el patrón `<aleatorio>.part` y más antiguos que el plazo, nunca objetos. Pensado para el arranque del host.
- **`put` no es idempotente:** cada llamada genera una clave nueva. Si el host falla después de `put` y antes de registrar la clave, queda un objeto huérfano. El host lo concilia en P2/P7 contra `documents.storage_key`. El adaptador no promete otra cosa.
- **Registros:** los errores no incluyen contenido ni rutas completas, solo la clave y el código.

### 6.7 Qué hace el adaptador y qué hace el host

| Control | Adaptador (P1-T5) | Host (P2) o etapa posterior |
|---|---|---|
| Clave opaca, rutas seguras, permisos, sin sobrescritura | Sí | — |
| Límite de bytes de un objeto durante la escritura | Sí | Fija `maxBytes` |
| Cupo del trámite: 3 candidatos históricos y 30 MiB acumulados (31457280) | No | P2, con `candidate_count` y la suma de `size_bytes` |
| Un solo adjunto por envío | No | DSL (`ATTACHMENTS_PER_SEND`) y entrega (P2/P5) |
| Tipo real por firma de bytes | No | P5 |
| Estados del documento (cuarentena, aprobado, purgado) | No | P2 |
| Autorización de lectura y URL temporales | No | P4/P5 |
| Retención y purga programada | Expone `delete` | P2/P7 |
| Conciliación de huérfanos | — | P2/P7 |

## 7. Captura local de correo

### 7.1 Puerto y resultado

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
  | { outcome: "CAPTURED"; captureId: string; duplicate: boolean; delivered: false }
  | { outcome: "REJECTED"; reason: EmailRejectionReason };
  // P5 agrega PROVIDER_ACCEPTED y UNKNOWN para el proveedor real (ADR-006).
```

- **`CAPTURED` es un resultado propio, distinto de `PROVIDER_ACCEPTED` y de `DELIVERED`.** Lleva `delivered: false` en el tipo.
- **El adaptador nunca abre conexiones:** ni SMTP ni proveedores.
- **Mapeo en P2:** cómo refleja P2 una captura en `deliveries` es una decisión de esa etapa (§16).

### 7.2 Validación antes de escribir

`REJECTED`, sin escribir nada, si:
- **Asunto:** contiene CR o LF en su valor final (`SUBJECT_LINE_BREAK`, con `lineBreakPosition` de `flow-schema`), está vacío o supera 200 caracteres. Cubre la parte del adaptador de T53.
- **Destinatarios:** alguno no tiene forma de email, contiene CR o LF o caracteres de control, se repite, o hay 0 o más de 20 (`RULE_LIMITS.recipientsPerDelivery`).
- **Cuerpo:** está vacío, supera 64 KiB o contiene caracteres de control distintos de salto de línea y tabulador.
- **Adjunto:**
  - el nombre tiene CR, LF o separadores de ruta, o supera 255 caracteres;
  - el MIME no es PDF, JPEG o PNG (`ALLOWED_MIME_TYPES` de `flow-schema`);
  - los bytes superan `MAX_FILE_BYTES`.

  El nombre del archivo es solo un metadato del mensaje: nunca forma una ruta.

### 7.3 Formato en disco y protección

- **Ubicación:** `LOCAL_MAIL_CAPTURE_DIR`; por defecto, `<repositorio>/storage/mail-captures`. Tiene los mismos controles de raíz, permisos (`0700` y `0600`), dueño y enlaces que el almacenamiento (§6.2).
- **Una captura es un directorio** `<captureId>/` con:
  - **`message.json`:**
    - `format: "LOCAL_CAPTURE_V1"`, `delivery: "NOT_SENT_LOCAL_CAPTURE"` y `delivered: false`;
    - `capturedAt`, `idempotencyKeySha256`, `to`, `subject` y `textBody`;
    - `attachment`: `fileName`, `mimeType`, `sizeBytes` y `sha256`, o `null`;
    - `contentSha256`: hash del mensaje normalizado, para detectar conflictos.
  - **`attachment.bin`:** copia de los bytes del adjunto, si hay, escrita con el mismo procedimiento que el almacenamiento (§6.4).
- **Inspección:** el directorio se lee con cualquier editor. Una función `readCapture(captureId)` sirve a las pruebas y al simulador de P3. No se genera `.eml` (§16).
- **Datos sensibles:** las capturas contienen emails y documentos. No se registran en logs, no se exponen por HTTP en P1-T5, y `purgeCaptures(olderThanMs)` las borra. El plazo por defecto es de 7 días, y la llamada queda a cargo del host o del operador.

### 7.4 Repeticiones y fallos parciales

- **`captureId` determinista:** son los primeros 32 hexadecimales de `SHA-256(idempotencyKey)`. La clave de idempotencia es la de la entrega (ADR-006: derivada de la acción lógica). La clave en claro no se guarda en disco.
- **Escritura atómica:** se escribe primero en `tmp/<aleatorio>/` con `fsync`, y después se publica con `rename(tmp, <captureId>)`.
  - En macOS y Linux, `rename` de un directorio sobre otro existente y no vacío falla, así que nunca se mezcla con una captura previa.
  - Si la publicación falla, se borra el temporal. Una caída antes de publicar deja un temporal que limpia `cleanupTemporaryFiles`.
- **Llamada repetida:** el hash del contenido incluye el del adjunto, así que se conoce al terminar de escribir el temporal. Si la publicación encuentra una captura con ese `captureId`, se compara el `contentSha256` de su `message.json` y se borra el temporal.
  - Con el mismo contenido: devuelve el mismo `captureId` con `duplicate: true`, sin publicar una segunda captura ni modificar la existente.
  - Con otro contenido: `REJECTED` con `IDEMPOTENCY_CONFLICT`, sin modificar la existente, para no ocultar un error del host.
  - Dos llamadas concurrentes con la misma clave publican una sola captura: la segunda encuentra el destino ocupado y sigue la misma regla.
- **Sin estados inciertos:** como la captura es local, no hay `UNKNOWN`. Un fallo de disco lanza `CaptureWriteError` y no deja una captura visible.
- **Lo que no promete:** la captura no dice nada sobre entrega, rebote ni recepción. No reemplaza las pruebas del proveedor real (P5): codificación MIME, tamaño codificado, idempotencia del proveedor y webhooks.

## 8. Scanner simulado

### 8.1 Puerto y resultado con procedencia

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

- **No lee el contenido:** el scanner simulado no recibe acceso al almacenamiento y nunca lee bytes. No detecta malware, y su etiqueta lo dice.
- **Rechazos:** un rechazo con motivo `MALWARE` es un escenario elegido por quien prueba, no una detección.
- **Compatibilidad con los contratos:** los valores de `result` y `rejectionReason` salen de `contracts` (`SCAN_RESULTS` y los motivos de `DOCUMENT_SCAN_RESULT`). La entrada usa las referencias existentes: `documentId` (`internalIdSchema`) y la clave del almacenamiento. Construir `DOCUMENT_SCAN_RESULT` y el trabajo que lo produce es de P2.

### 8.2 Escenarios deterministas

| Escenario | Resultado |
|---|---|
| `APPROVED` | Aprobación simulada |
| `REJECTED_MALWARE`, `REJECTED_TYPE_MISMATCH`, `REJECTED_ENCRYPTED` | Rechazo simulado con ese motivo |
| `INCONCLUSIVE` | `SCAN_INCONCLUSIVE` simulado |
| `UNAVAILABLE` | Lanza `ScannerUnavailableError`: el host deja el documento pendiente (ADR-007) |
| `DELAYED` | Resuelve el escenario indicado después de `delayMs`, con un temporizador inyectable (pruebas con reloj falso) |

- **Selección:**
  - un valor por defecto de la configuración (`SCANNER_SIMULATED_SCENARIO`, por defecto `APPROVED`);
  - opcionalmente, una función `scenarioFor(request)` inyectada por las pruebas o por el host de simulación de P3.
- **Sin azar:** el mismo pedido con la misma configuración da siempre el mismo resultado.

### 8.3 Separación de resultados reales y envíos reales

- **En el adaptador (P1-T5):**
  - todo resultado lleva `provenance: "SIMULATED"` y la etiqueta, y el tipo no admite otra procedencia;
  - el scanner simulado no se puede construir en `staging` ni en `production` (§5).
- **En la composición (P1-T5, §9):** `assertSafeComposition` rechaza un conjunto que combine el scanner simulado con un emisor de correo que entrega de verdad (`deliversExternally: true`). En P1-T5 solo existe la captura; la prueba usa un doble con `deliversExternally: true`.
- **En P2:** el host debe guardar la procedencia con el resultado y no tratar nunca uno simulado como análisis real. Como hoy `DOCUMENT_SCAN_RESULT` y `documents` no tienen dónde guardarlo, se propone agregarlo en P2 con una migración nueva (§16).

## 9. Composición

- **`createLocalAdapters`:**
  - recibe `appEnv` y la configuración de §10;
  - devuelve `{ storage, email, scanner, mode: "LOCAL_SIMULATED" }`, congelado;
  - aplica las guardas de §5 y llama a `assertSafeComposition`.
- **`assertSafeComposition`:** también es pública. La usarán los hosts de P2, P3 y P5 al combinar adaptadores reales y simulados.

## 10. Configuración

**Claves nuevas en `.env.example`**, sin valores secretos:

| Clave | Regla | Por defecto |
|---|---|---|
| `LOCAL_STORAGE_DIR` | Ruta privada (§6.2) | `storage/objects` dentro del repositorio |
| `LOCAL_MAIL_CAPTURE_DIR` | Ruta privada (§6.2) | `storage/mail-captures` dentro del repositorio |
| `SCANNER_SIMULATED_SCENARIO` | Uno de §8.2, salvo `DELAYED` | `APPROVED` |

**Se reutilizan:** `APP_ENV`, `STORAGE_MODE=local_private`, `EMAIL_MODE=capture`, `SCANNER_MODE=fake_development_only` y `MAX_FILE_BYTES`.

**Cupo del trámite:** `MAX_CANDIDATE_FILES_PER_SUBMISSION` y `MAX_CANDIDATE_BYTES_PER_SUBMISSION` son del host (P2). P1-T5 no las lee.

**Validación:** igual que la API, por clave, sin valores y con todos los problemas juntos. En P1-T5 la API no compone adaptadores; solo se alinea la regla de `staging` (§5).

## 11. Pruebas

Todas sin base de datos: entran en `pnpm run check`. Usan directorios temporales creados por cada prueba con `mkdtemp`, con archivos reales.

**Entorno:**
- `production`, `staging`, un valor desconocido o ausente, y un valor recibido distinto de `process.env.APP_ENV`: cada fábrica rechaza (salida de §9 de docs/15).
- `APP_ENV` cambiado a `production` después de construir: cada operación falla.
- Si se aprueba la decisión 2: la API rechaza los tres modos locales en `staging` y sigue aceptándolos en `development` y `test`.

**Almacenamiento**, con bytes reales:
- **Ida y vuelta:** `put`, `open` y `delete` conservan los bytes y el SHA-256.
- **Límites:** 1 byte y `maxBytes` exacto se aceptan; `maxBytes + 1` y 0 bytes se rechazan.
- **Corte del flujo:** al superar el límite deja de leer, comprobado con un flujo que cuenta lo que entrega.
- **Errores a mitad:** un flujo que falla a la mitad y una cancelación con `AbortSignal` no dejan temporales ni objetos.
- **Claves inválidas:** `../x`, absolutas, con separadores, `%2e%2e`, byte nulo, Unicode, mayúsculas o largo distinto dan `InvalidObjectKeyError` antes de tocar el disco.
- **Enlaces simbólicos:**
  - un enlace plantado en el destino de la publicación: falla sin sobrescribir;
  - en `tmp/`: `O_EXCL` y `O_NOFOLLOW` fallan;
  - en el lugar de un objeto: `open` lo rechaza;
  - `objects/` como enlace: la construcción falla.
- **Carrera entre comprobación y apertura:** reemplazar un objeto por un enlace entre dos operaciones no cambia lo que lee un descriptor ya abierto, y una apertura nueva lo rechaza.
- **Permisos:** directorios en `0700` y archivos en `0600` aunque la `umask` sea permisiva. Una raíz preexistente con permisos de grupo u otros se rechaza.
- **Sin sobrescritura:** una publicación sobre un destino existente (choque forzado con un generador de claves inyectado) falla con `EEXIST`, y el original queda intacto.
- **Concurrencia:** 50 `put` en paralelo dan claves distintas. Dos `delete` concurrentes dan un `DELETED` y un `ALREADY_ABSENT`.
- **Disco:** un error de disco (directorio sin escritura) da `StorageWriteError` y limpia el temporal.
- **Limpieza:** `cleanupTemporaryFiles` borra solo temporales vencidos.

**Captura de correo:**
- **Inspección:** una captura completa con adjunto real; `message.json` y `attachment.bin` coinciden con lo enviado (destinatarios, asunto, cuerpo, SHA-256 y tamaño).
- **Rechazos:** CR o LF en el asunto final, en un destinatario o en el nombre del adjunto, y los demás casos de §7.2 dan `REJECTED` sin escribir.
- **Repetición:** con el mismo contenido da `duplicate: true` sin publicar otra captura; con otro contenido, `IDEMPOTENCY_CONFLICT` y la original intacta. Dos llamadas concurrentes con la misma clave dejan una sola captura.
- **Fallo parcial:** una falla inyectada antes de publicar no deja una captura visible, y la limpieza borra el temporal.
- **Permisos y purga:** permisos, y `purgeCaptures` solo con capturas vencidas.
- **Sin red:** con `fetch`, `net.connect` y `http.request` reemplazados por funciones que fallan, la captura funciona, porque nunca los llama.

**Scanner simulado:**
- cada escenario da el resultado esperado, siempre con `provenance: "SIMULATED"` y la etiqueta;
- `UNAVAILABLE` lanza;
- `DELAYED` resuelve solo después del plazo, con reloj falso;
- no lee el almacenamiento: no lo recibe, y una prueba lo confirma con un almacenamiento espía;
- los valores pasan por los esquemas de `contracts`.

**Composición:** el scanner simulado más un emisor con `deliversExternally: true` se rechaza; los adaptadores locales juntos se aceptan.

**Límites entre paquetes y lint:** `adapters` solo depende de `contracts` y `flow-schema`, y los módulos locales no importan red ni procesos.

**Lo que sigue sin cubrirse** hasta P5, o P3 y P6 según el caso:
- tipo real por firma de bytes y extensión o MIME falsos (T14);
- descarga por red con límites, redirecciones y SSRF (T15, parte de red);
- antimalware real, EICAR y PDF cifrado (T16);
- autorización de descarga y URL firmadas (T17);
- bloqueo de correo real desde la simulación de punta a punta (T18, P3);
- retención y purga programada (T27);
- asunto interpolado por el renderizado (T53, parte de renderizado);
- media de Meta (P6);
- proveedor de correo real: MIME, tamaño codificado, idempotencia y webhooks;
- almacenamiento de objetos S3.

Las pruebas de P1-T5 no reemplazan ninguna de esas. docs/09 exige bytes reales en un entorno aislado para T13–T16, con descarga y análisis. Los archivos reales de P1-T5 cubren solo la parte de almacenamiento: el corte por límite de T15 y la escritura privada. T18 recibe la guarda de construcción y de composición; la prueba de punta a punta sigue en P3.

## 12. Secuencia de implementación

1. Esqueleto de `packages/adapters`, límites de ADR-001, reglas de ESLint (sin red) y la prueba de límites.
2. Guardas de entorno y configuración (§5 y §10), con sus pruebas. Regla de `staging` en la API, si se aprueba la decisión 2.
3. Puertos (§6.1, §7.1 y §8.1).
4. `fs-safety` y almacenamiento (§6), con las pruebas de seguridad.
5. Captura de correo (§7).
6. Scanner simulado (§8).
7. Composición (§9).
8. Documentos:
   - addenda de ADR-001 (paquete y ubicación de los puertos), ADR-006 (resultado `CAPTURED`) y ADR-007 (controles de la carpeta privada);
   - docs/10 y `.env.example`;
   - README del paquete;
   - docs/09 y 13;
   - PROJECT_STATUS y la descripción del PR.
9. `check`, `check:db` (sin cambios esperados), checkout limpio y CI.

## 13. Criterios de salida

- Los adaptadores locales no se pueden construir ni usar con `APP_ENV` fuera de `development` o `test`, comprobado en la configuración, en la construcción y en cada operación. Es la salida de §9.
- Los controles de §6, §7 y §8 tienen sus pruebas de §11 en verde, con archivos reales.
- Ningún módulo local importa red ni procesos, comprobado por lint y por prueba.
- Sin dependencias nuevas, sin migraciones nuevas ni modificadas, y sin cambios en el motor, la API (salvo la regla de `staging`, si se aprueba) ni los contratos.
- `check` y `check:db` en verde, en local, en checkout limpio y en la CI.
- La documentación del §12 está actualizada.

## 14. Riesgos

- **Sin `openat` en Node:** las aperturas son por ruta. `O_NOFOLLOW` protege el último componente y las comprobaciones de directorio se hacen con `lstat`, pero un atacante con el mismo usuario puede reemplazar un directorio entre comprobaciones. Fuera del modelo de amenazas local: con el mismo usuario ya puede leer todo. En producción no se usa este adaptador (P5/P7).
- **Enlaces duros:** `link` requiere un sistema de archivos que los admita (APFS y ext4 sí; algunos montajes de red o exFAT no). La construcción lo comprueba y falla con un error claro.
- **Huérfanos:** si el host falla entre `put` y su registro. Se concilian en P2/P7.
- **Datos personales en capturas:** mitigado con permisos, purga y ningún log. Sigue siendo responsabilidad del operador no copiar capturas fuera de la máquina.
- **Simulación tomada por real:** mitigado con tipos, etiqueta, guardas y composición. La persistencia de la procedencia depende de P2.
- **Diferencias entre macOS y Linux:** el comportamiento de `rename` de directorios y de `O_NOFOLLOW`. Las pruebas corren en los dos (local y CI).

## 15. Archivos previstos

- **Nuevos:** `packages/adapters/` (§4), con su `package.json` sin dependencias externas, tsconfig, vitest y README.
- **Modificados:**
  - `scripts/check-workspace-boundaries.mjs` y `eslint.config.js`;
  - `apps/api/src/config.ts` y sus pruebas (regla de `staging`, solo si se aprueba la decisión 2);
  - `.env.example`;
  - ADR-001, ADR-006 y ADR-007 (addenda);
  - docs/09, 10 y 13;
  - `PROJECT_STATUS.md`;
  - la descripción del PR.

## 16. Decisiones

**Cambia comportamiento existente: requiere confirmación explícita del propietario:**

| # | Tema | Propuesta |
|---|---|---|
| 2 | API en `staging` con modos locales | Error (`SIMULATED_MODE_OUTSIDE_LOCAL`) para `STORAGE_MODE`, `EMAIL_MODE` y `SCANNER_MODE`. Hoy la API arranca así contra el contenedor local; después no arrancaría en `staging` hasta P5. Alternativa: no tocar la API y confiar en las guardas del paquete (§5) |

**Propuestas por defecto,** que se aceptan al aprobar el plan salvo objeción:

| # | Tema | Propuesta |
|---|---|---|
| 1 | Entornos de los adaptadores locales | Solo `development` y `test`; `staging`, `production`, desconocido y ausente se rechazan |
| 3 | Ubicación de los puertos | `packages/adapters/src/ports` hasta que exista `domain` (P2), con un addendum de ADR-001 |
| 4 | Directorios | `storage/objects` y `storage/mail-captures` dentro del repositorio, ignorados por Git, con `0700` |
| 5 | Formato de captura | `message.json` más `attachment.bin`, sin `.eml` |
| 6 | Purga de capturas | Función con plazo por defecto de 7 días; su invocación periódica es del host u operador |
| 7 | Escenario simulado por defecto | `APPROVED` |
| 8 | Plataformas | Solo macOS y Linux |

**A decidir antes de P2,** porque cambian el comportamiento del host y no el de P1-T5:
- **Cómo se registra una captura en `deliveries`.** Propuesta: un estado propio `CAPTURED`, en una migración nueva de P2, que nunca cuente como `PROVIDER_ACCEPTED` ni como `DELIVERED`. En local, el trámite puede completarse con `CAPTURED` (ADR-006 completa V1 con `PROVIDER_ACCEPTED`).
- **Procedencia del análisis en `DOCUMENT_SCAN_RESULT` y en `documents`.** Propuesta: agregar `provenance` (`SIMULATED` o `ENGINE`) en P2, con migración nueva, y que P5 exija `ENGINE` para entregar con un correo real.
