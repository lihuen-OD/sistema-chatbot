# P1-T5 (parcial): captura local de correo — `EmailSender` con bloqueo por clave entre instancias

## Destino del PR

`main` (`88880a2`, merge del PR #14). La rama `p1/t5-local-mail-capture` sale de `main` actualizado y no depende de otra rama abierta.

## Estado

En revisión del propietario, sin fusionar. Las pruebas del paquete pasan en macOS (APFS) y en Linux (CI). Los resultados por SHA están en `PROJECT_STATUS.md` y en la entrega. **P1-T5 no queda completa con este PR:** faltan el scanner (§10), la composición (§11) y el mantenimiento (§7.3).

## Problema resuelto

El plan de P1-T5 prevé un emisor de correo local para desarrollo y pruebas que no entregue nada y que se pueda inspeccionar (§9). Tiene que ser idempotente por clave entre instancias que comparten la raíz, sin bloqueos en memoria ni ruptura automática de bloqueos (principio A4). Es el bloque 3 del plan.

## Alcance

**Entrega parcial de P1-T5** (solo el bloque 3: captura local de correo). Incluye:

1. **Puerto `EmailSender` (`src/ports/email.ts`):**
   - `send(idempotencyKey, message)` devuelve `CAPTURED`, con `captureId`, `duplicate`, `payloadAvailable` y `delivered: false`; o `REJECTED`, con un motivo sin valores (la posición del salto de línea o el índice del destinatario, si corresponde);
   - el emisor declara `kind: "LOCAL_CAPTURE"` y `deliversExternally: false`;
   - errores tipados, que llevan el `captureId` y nunca contenido: `CaptureWriteError` con su fase (`BEFORE_PUBLISH`, `AFTER_PUBLISH` o `PUBLISH_UNCERTAIN`), `CaptureKeyBusyError` (`KEY_BUSY`), `CaptureIntegrityError` con su motivo, `CaptureNotFoundError`, `InvalidCaptureIdError` y `CaptureClosedError`.
2. **Validación antes de escribir (§9.2, `src/local/capture-message.ts`):**
   - asunto final sin CR ni LF, con la posición del salto: es la parte del adaptador de T53;
   - asunto no vacío y dentro de `SUBJECT_MAX_LENGTH`;
   - destinatarios: de 1 a `RULE_LIMITS.recipientsPerDelivery`, forma de email de la especificación HTML hasta 254 caracteres, sin repetidos (sin distinguir mayúsculas);
   - cuerpo no vacío, de hasta 64 KiB en UTF-8, con tabulador y LF como únicos caracteres de control;
   - adjunto opcional: nombre de 1 a 255 sin control, `/` ni `\`, y tipo de `ALLOWED_MIME_TYPES` de `flow-schema`. El tamaño se controla al copiar, con `maxFileBytes`.
3. **Captura (§9.3 y §9.5, `src/local/capture-email-sender.ts`):**
   - se prepara en `tmp/<instancia>/lock-<op>/`, con `owner.json` y `staged/` (`record.json` y `payload/`, con `message.json` y el `attachment.bin` opcional);
   - el adjunto se copia por streaming, con el límite y el SHA-256 de los bytes reales;
   - `record.json` no tiene datos personales: hashes de la clave y del contenido, `publicationId` aleatorio, fecha, `NOT_SENT_LOCAL_CAPTURE` y `delivered: false`;
   - el `captureId` son los primeros 32 hexadecimales del SHA-256 de la clave. Ni la clave ni los nombres de archivo forman rutas;
   - directorios 0700 y archivos 0600 reafirmados con `chmod`, también con una umask restrictiva;
   - `fsync` de cada archivo y directorio preparado antes de adquirir; publicación con `rename(locks/<id>/staged, captures/<id>)` bajo el bloqueo; `fsync` de `captures/` antes de liberar.
4. **Bloqueo por clave entre instancias (§9.4, `src/local/capture-key-lock.ts`):**
   - adquirir es el mismo `rename` del directorio preparado, no vacío, a `locks/<captureId>`. `EEXIST` o `ENOTEMPTY` significa ocupado;
   - `send` espera de 20 a 200 ms hasta 5 s (`CAPTURE_LOCK_WAIT`) y después da `KEY_BUSY`. La purga no espera: omite la clave;
   - sin ruptura automática: ni por antigüedad, ni por PID, ni por arrendamientos;
   - la liberación comprueba que `locks/<id>` sea el suyo (`dev`, inodo y el token de `owner.json`) antes de moverlo a `.reclaim/`. Si no lo es, no lo toca y emite `CAPTURE_LOCK_NOT_OWNED`. Una liberación fallida queda pendiente y se reintenta en `recoverWorkArea` y en `close`.
5. **Duplicados y conflictos (§9.6):**
   - la misma clave con el mismo contenido da `duplicate: true` después de verificar el registro, el hash de la clave y el del contenido, y el contenido si sigue disponible;
   - con otro contenido, `REJECTED` con `IDEMPOTENCY_CONFLICT`;
   - una entrada sin registro, con un registro inválido o con un contenido que no coincide da `CaptureIntegrityError` y no se sobrescribe.
6. **Lectura, purga y ciclo de vida:**
   - `readCapture(captureId)` (§9.7): sin bloqueo cuando la entrada es consistente, con una relectura final; ante cualquier anomalía decide bajo el bloqueo;
   - `purgeCaptures()` (§9.8): borra el contenido al vencer `retentionDays` (7 por defecto) y la entrada al vencer `recordDays` (30). Vuelve a leer bajo el bloqueo y compara el `publicationId`, así que nunca borra una captura recreada. Devuelve un `CapturePurgeReport` sin contenido;
   - `recoverWorkArea()` y `close()` usan el área de trabajo y el ciclo de vida de §7.2 y §7.5, compartidos con el almacenamiento.
7. **Guardas de entorno (§5):** construcción y cada operación solo en `development` y `test`. Sin red ni procesos en los módulos del adaptador.

## Reutilización del almacenamiento, sin cambiar su comportamiento

- La copia por streaming con límite, cancelación y SHA-256 (`src/local/byte-copy.ts`) se extrajo de `private-folder-storage.ts`.
- `writeNewFile` (`file-ops.ts`) y `createVerifiedPrivateDirectory` (`private-root.ts`): la escritura completa de un archivo nuevo y el directorio propio verificado, que ya usaban `instance.json` y el retiro exclusivo.
- `WorkArea.closeWith` (`work-area.ts`): el ciclo de vida memorizado del cierre, con el error de cierre de cada adaptador.
- `own-files.ts` (nuevo): lectura de archivos propios con `O_NOFOLLOW` y `fstat` (regular, del usuario, 0600), con `ENOENT` como única ausencia.

Las 203 pruebas del almacenamiento no se modificaron y siguen pasando.

## Fuera de alcance

- SMTP, proveedores reales, scanner (§10), WhatsApp, motor, panel, endpoints y la integración con `deliveries`. El estado `CAPTURED` en la base es de P2.
- El mantenimiento con consumidores detenidos (§7.3), incluido el punto de entrada `@sistema-chatbot/adapters/maintenance`, y la composición (§11).
- Dependencias, migraciones, `.env` y la API: sin cambios.

## Precisiones frente al plan (§9.10)

El bloque implementa §9 sin cambiar sus decisiones. Lo que el plan no definía quedó registrado en §9.10, con su motivo:

| Tema | Precisión |
|---|---|
| Publicación incierta | Si el `rename` de publicación y la comparación de la entrada fallan: `CaptureWriteError` con la fase nueva `PUBLISH_UNCERTAIN`. El reintento con la misma clave lo resuelve |
| Adquisición incierta | Si el `rename` de adquisición y la comparación fallan: `BEFORE_PUBLISH`, lo preparado queda retenido y `locks/<id>` no se toca |
| Liberación | Solo del titular verificado por `dev`, inodo y token |
| Errores de la raíz | `StorageIntegrityError`, del módulo común de §6. `CaptureIntegrityError` queda para las entradas de `captures/` |
| Cierre | `CaptureClosedError`, con el ciclo de vida de §7.5 |
| `readCapture` | `InvalidCaptureIdError` para un identificador mal formado; relectura final en el camino sin bloqueo |
| Registro ajeno | `IDEMPOTENCY_KEY_MISMATCH` si el hash de la clave no empieza con el `captureId`, también en `readCapture` |
| Duplicado sin contenido | También hace `fsync` de `captures/` |
| Validación | Los detalles del punto 2 de "Alcance" |
| Purga | Informe con cantidades, claves omitidas y entradas ilegibles. `EIO` y `EACCES` nunca son ausencia |
| Evidencia del bloqueo | Exclusión del `rename` de adquisición medida en APFS |

En §13 se precisa que la prueba entre procesos separados lanza un proceso hijo desde la suite. Los módulos del adaptador siguen sin crear procesos.

## Cambios relevantes

- `packages/adapters/src/`: `ports/email.ts`, `local/capture-email-sender.ts`, `local/capture-key-lock.ts`, `local/capture-message.ts`, `local/own-files.ts` y `local/byte-copy.ts` (nuevos); `local/file-ops.ts`, `local/private-root.ts`, `local/work-area.ts` y `local/private-folder-storage.ts` (reutilización); `index.ts` con los exports públicos del bloque.
- `packages/adapters/test/`:
  - `capture-support.ts`: construcción de la captura de prueba, reloj manual, mensajes de ejemplo con `example.com`;
  - `capture-send.test.ts` (57), `capture-phases.test.ts` (16), `capture-lock.test.ts` (7), `capture-read-purge.test.ts` (14) y `capture-lifecycle.test.ts` (10): 104 pruebas nuevas. Total del paquete: 307;
  - `fixtures/capture-lock-holder.ts`, con `fixtures/ts-source-hooks.mjs` y `fixtures/register-ts-source.mjs`: el proceso hijo de la prueba entre procesos, que corre las fuentes TypeScript con el type stripping de Node.
- `scripts/evidence/capture-lock-rename-repro.mjs`: reproducción aislada de la adquisición simultánea, con llamadas reales.
- `packages/adapters/README.md`, el plan (§9.10 y §13), `docs/13_TRAZABILIDAD.md` y `PROJECT_STATUS.md`.

## Pruebas

Con archivos reales en directorios de `mkdtemp`, fallos y pausas inyectados en `FileOps`, reloj manual y compuertas. Sin esperas arbitrarias.

- **Envío:** validación de cada motivo sin escribir nada, con y sin adjunto, formato en disco, duplicados, conflictos, corrupción del registro y del contenido, escrituras parciales, fallos de copia, temporales preexistentes, directorio sin registro y umask 0777 restaurada.
- **Fases:** orden de los `fsync`; fallos de adquisición (con y sin bloqueo creado, y sin poder comprobarlo); fallos de publicación (entrada plantada, `staged/` quitado, publicación incierta); `fsync` de `captures/` fallido; liberación fallida y bloqueo reemplazado.
- **Bloqueo:**
  - dos adquisiciones simultáneas en 50 rondas;
  - titular pausado más de 120 s: `KEY_BUSY` a los 5 s, la purga lo omite, nada lo rompe y al reanudarse termina;
  - proceso caído con el bloqueo tomado;
  - diez envíos simultáneos en una instancia, y cinco desde cada una de dos instancias: una sola captura;
  - **un proceso hijo real** toma el bloqueo y excluye al padre; al liberarlo, el padre verifica la captura del hijo.
- **Lectura y purga:** lectura con adjunto, inexistente y mal formado, captura recreada entre lecturas, `EIO`; retención, plazos configurados, purgas concurrentes y `EIO` en la purga; los escenarios A, B y C de la purga pausada frente a una recreación.
- **Ciclo de vida:** cierre concurrente y repetido, `send` admitido durante el cierre, limpieza sin tocar material activo, colisión de id y guardas de entorno.

**Mutaciones temporales,** detectadas y retiradas (`cmp` sin diferencias):
- purga sin comparar el `publicationId`: falla el escenario A;
- sin verificar el SHA-256 del adjunto: falla la prueba de corrupción;
- con ruptura automática del bloqueo: fallan 8;
- liberación sin comprobar el titular: falla la del bloqueo reemplazado.

## Validación

**Local (macOS 27.0.1, APFS, arm64; Node 24.22.1, pnpm 12.12.1), sobre `9839c73`:**
- `pnpm run check`, código 0. Typecheck, lint, formato, límites, build y pruebas: `db` 62, `flow-schema` 132, `contracts` 191, `api` 64 y `adapters` 307.
- Suite de `adapters` cinco veces seguidas: 307/307.
- `scripts/evidence/capture-lock-rename-repro.mjs`: `ENOTEMPTY+OK` en 5000 de 5000 pares con `fs.promises` y en 3000 de 3000 con dos hilos liberados por una barrera, sin anomalías.
- `check:db`: no ejecutado en local. El bloque no toca la base ni la API, y lo cubre el job `db` de la CI.

**CI:** CI #53 sobre `9839c73`, los dos jobs en verde, con `adapters` 307/307 en Linux y las mismas cantidades por archivo (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/40549543132).

**CI del SHA final y checkout limpio:** en `PROJECT_STATUS.md` y en la entrega.

## Limitaciones

- **Mantenimiento (§7.3, no implementado):** un bloqueo abandonado por una caída deja la clave en `KEY_BUSY`, y la purga la omite, hasta ese bloque. También quedan para él los pasos 3 y 4 del escenario C: terminar de borrar lo reclamado y quitar el bloqueo. Lo prueba la suite.
- **Alcance de la idempotencia:** mientras existe el registro (30 días por defecto). Después, la misma clave crea otra captura con otro `publicationId` (§9.8).
- **Mismo usuario:** un proceso del mismo usuario que manipule la raíz fuera del protocolo queda fuera del modelo (§6.6). La liberación no quita un bloqueo ajeno, pero no impide la manipulación.
- **Datos personales:** `message.json` y `attachment.bin` contienen destinatarios, asunto, cuerpo y adjunto. Son para datos ficticios, quedan privados (0600) y se purgan al vencer.
- **Medición en una máquina:** la exclusión del `rename` de adquisición se midió en APFS local. En Linux la cubren las pruebas de la CI, no el script de evidencia.
- **No es una entrega:** `CAPTURED` no prueba SMTP, proveedor, codificación MIME, rebotes ni webhooks (§9.9).

## Próxima tarea concreta

Revisión del PR por el propietario. Los bloques siguientes de P1-T5 (scanner, composición y mantenimiento) esperan autorización, bloque por bloque.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
