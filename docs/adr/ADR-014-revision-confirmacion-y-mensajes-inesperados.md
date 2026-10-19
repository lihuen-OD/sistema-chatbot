# ADR-014 — Revisión y confirmación del documento, reemplazos y mensajes inesperados

- Fecha: 19/10/2026
- Estado: Aceptada. Requisito del propietario del 19/10/2026; los valores marcados como iniciales se revisan en el PR de P0.
- Responsable: propietario del proyecto
- Relación:
  - Precisa ADR-003 (el bloque `file` incorpora revisión obligatoria).
  - Precisa ADR-007: "un archivo por trámite" pasa a ser "un adjunto seleccionado y confirmado por envío, con candidatos limitados".
  - Amplía las mitigaciones de ADR-013, recortes 1 y 2.
  - Se apoya en ADR-002 (serialización e inicio del despacho), ADR-004, ADR-011 y ADR-012.
- Revisión: con datos del piloto sobre reemplazos, entradas inesperadas y correcciones.

## Historial

- 19/10/2026: versión inicial (commit `39830f2`).
- 19/10/2026: precisiones de la revisión del commit `5323bf6`, sin cambiar la dirección:
  - archivo recibido durante la elección y candidatos no seleccionables (§2, §5);
  - cupo por trámite con reserva atómica (§2);
  - identidad de la entrega después de cancelar otra (§6);
  - límite de cambios según el estado (§3);
  - vinculación de eventos, generación y correlación de archivos (§12).

## Contexto

Recibir y validar un archivo no significa que el empleado eligió el documento correcto. El empleado debe poder corregirse antes del correo. El sistema debe tratar mensajes inesperados (otro archivo, texto, botones viejos, eventos tardíos) sin adivinar y sin distribuir documentación incorrecta.

El modelo anterior tenía dos problemas:

- pasaba de `DOCUMENT_APPROVED` directamente al correo;
- limitaba físicamente el trámite a un documento, lo que impide gestionar reemplazos.

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Enviar al aprobarse el análisis, sin confirmación | Rechazada: validar no equivale a autorizar el envío |
| Usar siempre el último archivo recibido | Rechazada: sustitución silenciosa |
| Confirmación por texto libre ("sí", "ok") | Rechazada en V1: no referencia trámite, revisión ni archivo |
| Aprobación de un supervisor antes del envío | Fuera de alcance: la confirmación es del empleado, no una aprobación administrativa (ADR-013, recorte 10) |
| Correcciones como ciclos dibujados en el editor | Rechazada: V1 prohíbe ciclos arbitrarios. Se resuelven como estados internos del paso documental |
| Botón "Usar este archivo" para archivos sin correlación | Rechazada en V1: obliga a retener referencias a medios no pedidos y a crear otro tipo de prompt. La asociación explícita es reenviar el archivo después del pedido (§12) |

## Decisión

### 1. Paso documental con estados internos controlados

El bloque `file` es un paso compuesto. Sus estados internos son estados del trámite y el editor no puede dibujar ciclos entre ellos.

| Estado del trámite | Etiqueta | Prompt vigente | Entradas válidas |
|---|---|---|---|
| `WAITING_FILE` | Esperando archivo | Pedido de archivo | Archivo correlacionado (§12), Cancelar |
| `VALIDATING_FILE` | Validando archivo | Aviso de verificación con [Reemplazar] [Cancelar] | Reemplazar, Cancelar, archivo adicional (§5) |
| `WAITING_FILE_CHOICE` | Esperando elección de archivo | Lista de candidatos seleccionables + [Cancelar] | Elegir un candidato seleccionable, Cancelar, archivo adicional (§5) |
| `WAITING_CONFIRMATION` | Esperando confirmación | Revisión con [Confirmar] [Reemplazar] [Cancelar] | Confirmar, Reemplazar, Cancelar, archivo adicional |
| `DELIVERY_PENDING` | Envío pendiente | Aviso de envío en curso | Cancelar o archivo adicional, solo antes del inicio del despacho (§6) |

Solo una confirmación válida sale del paso documental hacia su `next`.

Si el candidato seleccionado deja de ser seleccionable (rechazado, análisis inconcluso, descarga fallida u objeto eliminado), la selección se libera y la revisión aumenta. Después:

- si queda cupo, el trámite vuelve a `WAITING_FILE` con un aviso genérico;
- si no queda cupo, se aplica la salida segura de §3.

El candidato sigue contando para el cupo.

### 2. Candidatos, cupo y selección

**Candidato.** Solo se crea un `Document` candidato si se cumplen todas estas condiciones:

- el archivo es admisible (tipo y tamaño declarados aceptados);
- el archivo está correlacionado con el trámite (§12);
- el estado acepta archivos;
- hay cupo.

El candidato es inmutable: un archivo nuevo es otro candidato, nunca una modificación del anterior.

**Cupo por trámite completo.** El máximo de candidatos (3) es por `Submission`, no por nodo ni por `executionInstanceId`.

- **Reserva atómica.** La transición que procesa `FILE_RECEIVED` bloquea la fila del trámite y hace un incremento condicional de `Submission.candidateCount`: solo si es menor que el máximo, y devuelve el valor nuevo. Ese valor es el `candidateSeq` del candidato, único por trámite (1 a 3, con `CHECK`). Si el incremento no aplica, el resultado es `CANDIDATE_LIMIT_REACHED`: no se crea candidato ni se descarga nada.
- **Reprocesamiento.** `(submissionId, receivedEventId)` es único. Procesar de nuevo el mismo evento reutiliza su candidato y no reserva otro lugar.
- **Descarga.** El trabajo de descarga se encola en la misma transacción que la reserva y referencia al candidato.
- **El cupo no se devuelve.** Los candidatos rechazados, inconclusos, con descarga fallida, reemplazados, descartados o purgados siguen contando. Conservar sus metadatos o eliminar su objeto no libera lugar.
- **Recepción concurrente cerca del máximo.** Con `candidateCount = 2`, dos archivos admisibles simultáneos se serializan por la clave del trámite y por el incremento condicional: uno obtiene `candidateSeq = 3` y el otro recibe `CANDIDATE_LIMIT_REACHED` sin descarga. Si la serialización de la aplicación fallara, el incremento condicional, el `CHECK` y la unicidad de `candidateSeq` siguen impidiendo un cuarto candidato.

**Selección.** `selection` toma los valores `PENDING_CHOICE`, `SELECTED`, `SUPERSEDED` (reemplazado) o `DISCARDED` (no elegido o trámite cancelado). Es independiente del estado de validación. Hay como máximo un `SELECTED` por paso documental, y la entrega adjunta exactamente el documento confirmado.

**Seleccionable.** Un candidato es seleccionable si cumple todo lo siguiente:

- `selection` es `PENDING_CHOICE` (o `SELECTED`, para confirmarlo);
- su validación está en `RECEIVED` (descarga pendiente), `QUARANTINED`, `SCANNING` o `APPROVED`;
- su objeto no fue eliminado.

No son seleccionables los `REJECTED`, `SCAN_INCONCLUSIVE`, `DOWNLOAD_FAILED`, `DELETED`, los de objeto purgado, ni los `SUPERSEDED` o `DISCARDED`.

**Disponible para confirmar.** `SELECTED` + `APPROVED` + objeto presente + sha256 registrado.

Esto reemplaza la restricción física "un documento por trámite": hasta 3 candidatos por trámite, a lo sumo uno seleccionado, y una entrega con exactamente el documento confirmado.

### 3. Revisión del contexto y límite de cambios según estado

**Revisión del contexto.** `Submission.contextRevision` aumenta con cada cambio que afecta lo que se enviaría o lo que se ofrece:

- respuesta o variable asignada;
- candidato nuevo;
- elección;
- reemplazo;
- cancelación de una entrega pendiente;
- un candidato `SELECTED` o `PENDING_CHOICE` que deja de ser seleccionable.

Todo prompt y toda confirmación guardan la revisión con la que se emitieron.

**Límite de cambios del empleado (valor inicial 20).**

- Se cuenta en `Submission.employeeChangeCount`, que solo aumenta con acciones del empleado que cambian el contexto: respuesta, `VOLVER`, Reemplazar, archivo adicional y elección.
- Los eventos internos (descarga, análisis, resultados de entrega, vencimientos, revocaciones, acciones de operador) aumentan `contextRevision` pero **nunca se bloquean ni cuentan para el límite**.
- Al alcanzar el límite:

| Estado | Permitido | Bloqueado | Qué se ofrece |
|---|---|---|---|
| `WAITING_ANSWER` (antes del paso documental) | Responder la pregunta vigente (avanzar), Cancelar | `VOLVER` | Pregunta vigente y aviso |
| `WAITING_FILE` | Archivo correlacionado si queda cupo (el cupo ya lo acota), Cancelar | — | Pedido de archivo |
| `VALIDATING_FILE` | Cancelar | Reemplazar, archivo adicional | Aviso de verificación solo con [Cancelar] |
| `WAITING_FILE_CHOICE` | Elegir un seleccionable, Cancelar | Archivo adicional | Lista de seleccionables y [Cancelar] |
| `WAITING_CONFIRMATION` | Confirmar, Cancelar | Reemplazar, archivo adicional | [Confirmar] [Cancelar] |
| `DELIVERY_PENDING` | Cancelar antes del punto de no retorno | Archivo adicional (no se descarga) | Aviso de envío |

Elegir sigue permitido al alcanzar el límite porque, sin archivos adicionales ni Reemplazar, no hay forma de volver a la elección: ocurre como máximo una vez más.

**Reglas que valen siempre, con o sin límite.**

- Nunca se emite un prompt de revisión, ni se acepta Confirmar, sin un candidato seleccionado, aprobado y disponible para confirmar.
- **Salida segura:** si no hay candidato seleccionable y no queda cupo, el paso no puede continuar. Se ofrece solo [Cancelar], con la indicación de que puede escribir `REINICIAR` para empezar un trámite nuevo con cupo propio. Si no responde, el trámite vence por inactividad.
- No se deriva a revisión administrativa en ese caso, porque no hubo efecto externo. Las situaciones con efectos o configuración bloqueada siguen yendo a `NEEDS_REVIEW` (ADR-012, ADR-002).

### 4. Confirmación del empleado

- El mensaje de revisión muestra el nombre del archivo (escapado y truncado), el tipo, el tamaño, la empresa y el tipo documental. No muestra direcciones de destinatarios. Antes de mostrarlo, el host hace una resolución previa de destinatarios (ADR-012): si ya se sabe que el envío quedaría bloqueado, se informa en lugar de pedir confirmación.
- La confirmación solo se acepta como respuesta interactiva al prompt de revisión vigente. Su referencia incluye `promptId`, `submissionId`, `contextRevision` y `documentId`, y el servidor la verifica contra su propio registro, nunca contra datos del cliente.
- Es válida solo si se cumplen todas estas condiciones:
  - el prompt es el vigente;
  - el trámite está en `WAITING_CONFIRMATION`;
  - la revisión coincide con la actual;
  - el documento es el `SELECTED` y está disponible para confirmar (§2), con el mismo sha256.
- Si no es válida, el resultado es `CONFIRMATION_STALE`, sin efecto, y se re-presenta el prompt vigente.
- En una transacción se registra `DocumentConfirmation` (única por `submissionId` + `contextRevision`), se resuelven y fijan los destinatarios (ADR-012) y se crea la entrega `PENDING` con su acción de outbox.
- La entrega toma su identidad de la confirmación: `Delivery.confirmationId` es único, y `actionKey` y la clave de idempotencia del proveedor se derivan de `confirmationId` (§6).
- Confirmar dos veces es idempotente (`CONFIRMATION_ALREADY_USED`): no hay segunda entrega.
- Confirmar no es una aprobación administrativa. Este ADR no incorpora un flujo de aprobación por supervisor.

### 5. Reemplazo, archivos adicionales y elección

- **[Reemplazar] en revisión o durante la validación:**
  - el candidato vigente pasa a `SUPERSEDED`, la revisión aumenta y el trámite vuelve a `WAITING_FILE`;
  - el ancla de correlación pasa a ser esa acción (§12);
  - el archivo correlacionado siguiente queda seleccionado directamente, porque el empleado eligió reemplazar;
  - V1 no ofrece "volver al anterior": hay que enviarlo de nuevo, y cuenta para el cupo.
- **Archivo adicional sin pulsar [Reemplazar]**, admisible, correlacionado y con cupo, en `VALIDATING_FILE`, `WAITING_CONFIRMATION` o `DELIVERY_PENDING` antes del despacho:
  - se registra como candidato `PENDING_CHOICE`;
  - el candidato que estaba `SELECTED`, si sigue siendo seleccionable, vuelve a `PENDING_CHOICE` y se limpia `selectedDocumentId`;
  - la revisión aumenta, lo que invalida cualquier revisión o confirmación pendiente;
  - una entrega `PENDING` todavía no despachada pasa a `CANCELLED` (§6);
  - el trámite pasa a `WAITING_FILE_CHOICE` con una lista de todos los seleccionables.
- **Archivo adicional en `WAITING_FILE_CHOICE`** (por ejemplo, el tercero), admisible, correlacionado y con cupo:
  - se agrega como `PENDING_CHOICE`;
  - la revisión aumenta;
  - se emite una lista nueva con todos los candidatos seleccionables;
  - los botones de la lista anterior responden `PROMPT_STALE`.
- **No hay elección automática**, ni siquiera cuando queda un único candidato seleccionable: se le pregunta igual al empleado. La única selección sin elección explícita es la del archivo correlacionado que sigue a un [Reemplazar].
- **Cambios internos de la lista:**
  - Si un candidato `PENDING_CHOICE` deja de ser seleccionable, sale de la lista: la revisión aumenta y se emite una lista nueva con un aviso breve. Si no queda ninguno seleccionable, el trámite pasa a `WAITING_FILE` si hay cupo, o a la salida segura de §3 si no.
  - Que un candidato `PENDING_CHOICE` se apruebe no cambia la lista: ya era seleccionable.
- **Elección:**
  - el candidato elegido pasa a `SELECTED` y los demás `PENDING_CHOICE` a `DISCARDED`;
  - si el elegido sigue en análisis, el trámite va a `VALIDATING_FILE`; si ya está aprobado y disponible, a `WAITING_CONFIRMATION` con un prompt nuevo;
  - elegir un candidato que ya no es seleccionable (botón viejo o estado cambiado) responde `CANDIDATE_NOT_SELECTABLE` y re-presenta la lista vigente.
- **Resultado tardío del análisis:**
  - se registra en el documento correspondiente;
  - solo el resultado del candidato `SELECTED` de la revisión vigente produce el avance hacia la revisión;
  - un resultado de un candidato `SUPERSEDED` o `DISCARDED`, o de un trámite terminado, no selecciona nada ni habilita un envío;
  - un resultado de malware igual genera la alerta de seguridad.

### 6. Coordinación atómica con el despacho e identidad de las entregas

Confirmar, reemplazar, elegir, cancelar, recibir un archivo nuevo e iniciar el despacho son transiciones que bloquean la fila de `Submission` y verifican su revisión (ADR-002), así que se serializan.

El **punto de no retorno** es el commit que pasa el intento de entrega a `DISPATCHING` (ADR-002). Esa transacción comprueba que:

- la entrega sigue `PENDING` y su acción de outbox no está cancelada;
- el trámite sigue `DELIVERY_PENDING`;
- la revisión de la confirmación es la actual;
- el documento coincide (sha256);
- los destinatarios siguen autorizados.

| Compiten | Gana el primero en confirmar su transacción | Resultado |
|---|---|---|
| Confirmar y Reemplazar (o archivo adicional) | Confirmar | Entrega `PENDING`; el reemplazo posterior la cancela y reabre la elección o el pedido de archivo |
| | Reemplazar | La confirmación llega vieja: `CONFIRMATION_STALE`, sin entrega |
| Confirmar y Cancelar | Confirmar | Cancelar después cancela la entrega `PENDING` y el trámite |
| | Cancelar | La confirmación sobre un trámite terminado no tiene efecto |
| Cancelar o Reemplazar e inicio del despacho | Inicio del despacho | `DISPATCH_ALREADY_STARTED`: no se promete cancelación ni reemplazo; se informa el resultado al terminar y se ofrece corrección |
| | Cancelar o Reemplazar | El despacho encuentra la entrega `CANCELLED` y no llama al proveedor |
| Confirmación duplicada | — | Una confirmación por revisión y una entrega por confirmación |

**Entrega cancelada y nueva confirmación.**

- Cancelar una entrega `PENDING` (D1) pasa, en la misma transacción, la entrega a `CANCELLED` y su `OutboxAction` y su job a `CANCELLED`.
- Un ejecutor nunca reclama acciones canceladas. Si ya había reclamado el job, el control del punto de no retorno lo detiene. D1 nunca se despacha ni se reactiva.
- Una confirmación posterior (C2, de otra revisión), aunque sea del mismo documento, crea una entrega nueva (D2) con su propia `actionKey` y su propia clave de idempotencia, derivadas de C2. No reutiliza la identidad de D1, que nunca llegó al proveedor.
- Repetir C2 responde `CONFIRMATION_ALREADY_USED` y no crea una D3.

Después del punto de no retorno, un archivo nuevo no se descarga ni se adjunta. El mensaje al empleado es veraz: el envío ya está en curso con el archivo confirmado y, cuando termine, podrá iniciar una corrección.

### 7. Mensajes inesperados

| Entrada | Situación | Tratamiento |
|---|---|---|
| Texto libre que no es un comando | Paso que espera botón o archivo | Aviso breve + re-presentación del prompt vigente; no cambia estado ni candidatos |
| "sí", "ok", "confirmo" escritos | `WAITING_CONFIRMATION` | Igual que texto libre: no confirma |
| Botón u opción de un prompt no vigente o de otro trámite | Cualquiera | `PROMPT_STALE`: "Esa opción ya no corresponde" + prompt vigente |
| Elección de un candidato no seleccionable | `WAITING_FILE_CHOICE` | `CANDIDATE_NOT_SELECTABLE` + lista vigente |
| Archivo | Paso que no es documental | No se descarga ni se vincula; se explica el paso esperado (`FILE_OUT_OF_STEP`) |
| Archivo sin correlación suficiente (§12) | Paso documental | No se descarga ni cuenta para el cupo (`FILE_NOT_CORRELATED`); se pide reenviarlo si se quiere usar |
| Archivo con tipo o tamaño declarado no admitido | Paso documental | No se descarga; se indican formatos y tamaño |
| Archivo con el cupo de candidatos agotado | Paso documental | No se descarga (`CANDIDATE_LIMIT_REACHED`); se ofrece elegir entre los seleccionables, si los hay, o la salida segura |
| Archivo adicional con el límite de cambios alcanzado | Paso documental | No se descarga (`CHANGE_LIMIT_REACHED`); se re-presenta el prompt vigente |
| Archivo | Después del inicio del despacho, o sin trámite activo | No se descarga; mensaje veraz; se ofrece corrección o iniciar un trámite |
| Audio, video, sticker, ubicación, contacto | Cualquiera | No se descarga; se indican los formatos aceptados |
| Reacciones; ediciones o eliminaciones de mensajes, si el canal las informa | Cualquiera | Registro mínimo; no cambian el trámite. Para cambiar el archivo se usa Reemplazar |
| Comandos `CANCELAR`, `REINICIAR`, `AYUDA`, `CORREGIR` | Según estado | Coincidencia exacta normalizada (mayúsculas, tildes, espacios); sin interpretación de lenguaje natural |

- Cada entrada inesperada suma al contador del paso. Al llegar al límite se envía un último mensaje con las opciones vigentes y se dejan de re-presentar prompts en ese paso hasta una entrada válida o el vencimiento por inactividad. Esto evita bucles y costo.
- `VOLVER` no está disponible desde el paso documental en adelante. Para cambiar empresa o tipo, el empleado cancela y reinicia; el texto de revisión lo indica.

### 8. Reinicio y cancelación con eventos pendientes

- Cancelar o reiniciar antes del punto de no retorno:
  - pasa el trámite a `CANCELLED`;
  - pasa sus candidatos a `DISCARDED`;
  - cancela las entregas `PENDING` (con su outbox) y los mensajes salientes no despachados;
  - no anula análisis en curso: sus resultados se registran y se ignoran.
- Reiniciar crea un trámite nuevo, con generación siguiente y cupo propio, recién después de cerrar el anterior en la misma transacción (ADR-011).
- Los eventos pendientes del trámite anterior (descargas, análisis, botones, mensajes retenidos) nunca se vinculan al nuevo (§12).
- Si el despacho ya empezó, reiniciar y cancelar se rechazan con `DISPATCH_ALREADY_STARTED`.

### 9. Mensajes retenidos al reabrirse la ventana

- Cada `OutboundMessage` guarda `submissionId`, `generation`, `contextRevision`, `promptId` (si es un prompt), `purpose` (`PROMPT` o `NOTICE`) y `expiresAt`.
- Al llegar una entrada nueva, primero se procesa esa entrada y después se revalidan los mensajes retenidos contra el trámite, la revisión y el paso vigentes:
  - **Prompts:** nunca se reproducen. Se cancelan (`STALE_PROMPT`) y el motor re-presenta el prompt vigente con un `promptId` nuevo si hace falta.
  - **Avisos:** se envían solo si lo que describen sigue siendo cierto; como máximo el último aviso por trámite.
  - **Trámites `CANCELLED` o `EXPIRED`:** se descartan todos. A lo sumo se envía un aviso del estado final si el empleado no fue informado ("no se envió ningún documento").
  - **Retenidos vencidos o dirigidos a una identidad revocada:** se descartan.

### 10. Corrección después de un envío aceptado

- Con el trámite original `COMPLETED` (entrega `PROVIDER_ACCEPTED`, `DELIVERED` o `BOUNCED`) y sin trámite activo, el comando `CORREGIR` lista hasta 5 envíos elegibles del mismo empleado y número. Son elegibles los que están dentro del plazo y del máximo de correcciones.
- Elegir uno crea un trámite nuevo con `kind = CORRECTION` y `correctsSubmissionId`. Recorre el flujo normal con las versiones activas (ADR-004), incluida la revisión y confirmación.
- El sistema marca el correo de corrección con un prefijo de asunto y un bloque de cuerpo que referencian el envío original (código y fecha). Las plantillas del panel no pueden quitarlos.
- El trámite, la entrega y el documento originales no se modifican. "Corregido por" se deriva del vínculo. Nada aparenta que el correo anterior no existió.
- Si la corrección resuelve destinatarios distintos de los originales, el panel lo señala. Avisar automáticamente a los destinatarios originales es una decisión pendiente; por defecto en V1, no se avisa y el operador decide.

### 11. Límites (valores iniciales)

| Límite | Valor inicial |
|---|---|
| Candidatos por trámite completo (incluye rechazados, inconclusos, con descarga fallida y purgados; el cupo no se devuelve) | 3; hasta 30 MB almacenados |
| Adjuntos seleccionados por envío | 1 |
| Entradas inesperadas por paso antes de dejar de re-presentar | 5 |
| Cambios del empleado por trámite (`employeeChangeCount`) | 20; efecto según estado en §3 |
| Plazo para iniciar una corrección | 7 días desde la aceptación |
| Correcciones por envío original | 3 |
| Vigencia de un mensaje retenido | 7 días |
| Objeto de un candidato rechazado | Se elimina al registrar el resultado; se conservan los metadatos |
| Objeto de un candidato `SUPERSEDED` o `DISCARDED` | Se elimina 24 h después de que el trámite termina, o antes si se agota la retención general |
| Documento confirmado y enviado | Retención general (30 días, propuesta) |

Los metadatos de candidatos (hash, tamaño, tipo, fechas, selección) siguen la retención de auditoría.

### 12. Vinculación de eventos, generación y correlación de archivos

**Generación.** `Submission.generation` es un consecutivo por (`employeeId`, `channelId`), único y asignado al crear el trámite, en la transacción que cierra el anterior. Identifica qué trámite de ese empleado y número era el vigente cuando se vinculó cada evento.

**Orden.** Para cada clave de serialización (ADR-002), los eventos se procesan en el orden de llegada al inbox (`inboxSeq`). Un evento posterior no adelanta a uno anterior de la misma clave.

**Momento de la vinculación.**

- El webhook solo persiste el evento con sus identidades; no lo vincula a un trámite.
- La vinculación ocurre en la transacción de transición, con el lock de la clave tomado.
- Se registra una única vez en `MessageEvent`: `boundSubmissionId`, `boundGeneration`, `boundContextRevision` y `bindingOutcome` (`APPLIED`, `STALE`, `REJECTED`, `IGNORED`, `NOT_BOUND`).
- Esa vinculación no se modifica después.

| Evento | Se vincula a |
|---|---|
| Respuesta a un prompt (opción, Confirmar, Reemplazar, Cancelar, Elegir) | El trámite del prompt, por `promptId`, aunque no sea el activo. Si no es el prompt vigente: `PROMPT_STALE`. Nunca se redirige al trámite activo |
| Texto o comando | El trámite activo al procesarlo, o ninguno |
| Archivo | El trámite activo solo si hay correlación suficiente (abajo); si no, `NOT_BOUND` |
| Resultados internos (descarga, análisis, entrega) y estados del proveedor | La referencia fijada al crear el trabajo o el mensaje saliente; nunca se recalcula |

**Trabajos derivados.**

- Los trabajos de descarga, análisis, entrega y mensajes salientes guardan al crearse `submissionId`, `generation` y el `documentId` o `deliveryId`. Esa referencia es inmutable.
- Reiniciar o cancelar nunca reasigna un trabajo al trámite nuevo. El resultado de un trabajo cuyo trámite ya terminó se registra sin transición, y su candidato sigue las reglas de purga.

**Correlación suficiente de un archivo nuevo.** Recibir un archivo no revela su intención. Se asocia automáticamente al trámite solo si se cumple todo lo siguiente:

1. Viene de una identidad `ACTIVE` del empleado del trámite (ADR-011).
2. El trámite está en un estado que acepta archivos (§1) y antes del punto de no retorno.
3. Su timestamp del proveedor es estrictamente posterior al **ancla de pedido de archivo**: el timestamp del proveedor del evento del empleado que provocó el pedido vigente. Ese evento es la respuesta que hizo entrar al paso documental, la acción [Reemplazar] o, si el paso documental es el primero, el mensaje que creó el trámite.
4. Se comparan timestamps del mismo proveedor; nunca con el reloj del servidor.

Si falla la condición 3, o el timestamp falta, el resultado es `FILE_NOT_CORRELATED`:

- el archivo no se descarga, no se adjunta y no consume cupo;
- el empleado recibe: "Recibimos un archivo enviado antes de que lo pidiéramos y no lo usamos. Si querés usarlo, envialo de nuevo ahora."

**La asociación explícita es reenviar el archivo después del pedido.** Ejemplos:

- Un archivo enviado antes de un reinicio o de un [Reemplazar], que llega después, no se asocia al trámite nuevo ni sirve como reemplazo.
- Un archivo correlacionado que llega fuera de `WAITING_FILE` (archivo adicional) se registra como candidato `PENDING_CHOICE`. No se presume que reemplaza a otro: se pide elegir (§5).

## Costos

- Un paso más para el empleado en cada envío.
- Más estados, más entidades (`DocumentConfirmation`) y más pruebas de concurrencia.
- Almacenamiento temporal de candidatos, acotado por los límites.
- Algunos archivos legítimos enviados "demasiado pronto" requieren reenvío.

## Consecuencias

- El nodo `file` declara un bloque `review` obligatorio, y entre el `file` y el `email` que adjunta su documento no puede haber nodos que capturen datos.
- Cambiar empresa o tipo después del paso documental requiere cancelar y reiniciar.
- Las confirmaciones escritas no se aceptan en V1. Si el piloto muestra problemas de accesibilidad, se revisa.
- Una corrección es un envío nuevo y visible para los destinatarios; no reemplaza ni retira el anterior.
- La correlación depende del timestamp del proveedor en los webhooks. Su semántica y granularidad se verifican en P6; mientras tanto, la comparación estricta es conservadora.

## Invariantes

- Ningún correo sin una confirmación válida del documento exacto y de la revisión vigente.
- Nunca se ofrece ni se acepta Confirmar sin un candidato seleccionado, aprobado y disponible.
- Ningún archivo reemplaza a otro sin una acción explícita del empleado, y ninguno se elige automáticamente.
- Ningún candidato no seleccionable se ofrece ni se acepta en una elección.
- El cupo de candidatos es por trámite, se reserva de forma atómica y no se devuelve.
- Ningún resultado de un candidato no seleccionado, o de un trámite terminado, habilita un envío.
- Una entrega cancelada nunca se despacha; cada confirmación tiene su propia entrega y su propia identidad de acción.
- Ningún evento ni trabajo se reasigna a otro trámite después de vincularse.
- Después del punto de no retorno no se promete cancelación ni reemplazo.
- Ningún prompt retenido se reproduce: el prompt vigente se emite de nuevo con una identidad nueva.
- El historial de un envío aceptado no se modifica por una corrección.

## Pruebas

T35 a T45 (versión inicial) y T46 a T52 (precisiones). T06, T13 y T22 conservan su ID con el resultado precisado. Ninguna se ejecutó todavía.

## Documentos afectados

`docs/01_REQUISITOS.md`, `docs/02_ARQUITECTURA.md`, `docs/03_PLAN_DESARROLLO.md`, `docs/04_MODELO_DATOS.md`, `docs/05_CONTRATOS_API.md`, `docs/06_EDITOR_Y_MOTOR.md`, `docs/08_CONFIABILIDAD.md`, `docs/09_PRUEBAS_Y_ACEPTACION.md`, `docs/11_UX_ADMINISTRADOR.md`, `docs/13_TRAZABILIDAD.md`, `docs/15_PLAN_CONSOLIDADO_P0.md`, `examples/`.

## Decisiones pendientes

- Avisar o no automáticamente a los destinatarios originales cuando una corrección cambia de destinatarios. Antes de P4.
- Confirmar los valores iniciales de la sección 11. Al implementar P2.
- Mostrar o no al empleado el nombre del área destinataria en la revisión (claridad frente a privacidad). Por defecto, no se muestra. P3.
