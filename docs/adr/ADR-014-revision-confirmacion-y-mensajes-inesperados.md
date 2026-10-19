# ADR-014 — Revisión y confirmación del documento, reemplazos y mensajes inesperados

- Fecha: 19/10/2026
- Estado: Aceptada. Requisito del propietario del 19/10/2026; los valores marcados como iniciales se revisan en el PR de P0.
- Responsable: propietario del proyecto
- Relación:
  - Precisa ADR-003 (el bloque `file` incorpora revisión obligatoria).
  - Precisa ADR-007: "un archivo por trámite" pasa a ser "un adjunto seleccionado y confirmado por envío, con candidatos limitados".
  - Amplía las mitigaciones de ADR-013, recortes 1 y 2.
  - Se apoya en ADR-002 (inicio del despacho), ADR-004, ADR-011 y ADR-012.
- Revisión: con datos del piloto sobre reemplazos, entradas inesperadas y correcciones.

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

## Decisión

### 1. Paso documental con estados internos controlados

El bloque `file` es un paso compuesto. Sus estados internos son estados del trámite y el editor no puede dibujar ciclos entre ellos.

| Estado del trámite | Etiqueta | Prompt vigente | Entradas válidas |
|---|---|---|---|
| `WAITING_FILE` | Esperando archivo | Pedido de archivo | Archivo, Cancelar |
| `VALIDATING_FILE` | Validando archivo | Aviso de verificación con [Reemplazar] [Cancelar] | Reemplazar, Cancelar, otro archivo (ver punto 5) |
| `WAITING_FILE_CHOICE` | Esperando elección de archivo | Lista de candidatos + Cancelar | Elegir candidato, Cancelar |
| `WAITING_CONFIRMATION` | Esperando confirmación | Revisión con [Confirmar] [Reemplazar] [Cancelar] | Confirmar, Reemplazar, Cancelar, otro archivo |
| `DELIVERY_PENDING` | Envío pendiente | Aviso de envío en curso | Cancelar o archivo nuevo, solo antes del inicio del despacho (punto 6) |

Solo una confirmación válida sale del paso documental hacia su `next`. Si un candidato seleccionado se rechaza o el análisis es inconcluso, el trámite vuelve a `WAITING_FILE` con un aviso genérico. El candidato rechazado cuenta para el límite.

### 2. Candidatos y selección

- Cada archivo recibido en el paso documental crea un `Document` candidato con `candidateSeq`, `nodeId` y `executionInstanceId`. El candidato es inmutable: un archivo nuevo es otro candidato, nunca una modificación del anterior.
- Selección del candidato (`selection`): `PENDING_CHOICE`, `SELECTED`, `SUPERSEDED` (reemplazado) y `DISCARDED` (no elegido o trámite cancelado). Es independiente del estado de validación (`RECEIVED` … `APPROVED`/`REJECTED`).
- Como máximo un candidato `SELECTED` por paso documental. V1 mantiene un único adjunto por envío: la entrega adjunta exactamente el documento confirmado.
- Se reemplaza la restricción física "un documento por trámite" por: hasta 3 candidatos por trámite, a lo sumo uno seleccionado, y una entrega con exactamente un documento igual al confirmado.

### 3. Revisión del contexto

`Submission.contextRevision` aumenta en una unidad con cada cambio que afecta lo que se enviaría:

- respuesta o variable asignada;
- llegada de un candidato nuevo;
- elección de candidato;
- reemplazo;
- cancelación de una entrega pendiente.

Toda confirmación y todo prompt guardan la revisión con la que se emitieron.

### 4. Confirmación del empleado

- El mensaje de revisión muestra el nombre del archivo (escapado y truncado), el tipo, el tamaño, la empresa y el tipo documental. No muestra direcciones de destinatarios. Antes de mostrarlo, el host hace una resolución previa de destinatarios (ADR-012): si ya se sabe que el envío quedaría bloqueado, se informa en lugar de pedir confirmación.
- La confirmación solo se acepta como respuesta interactiva al prompt de revisión vigente. Su referencia incluye `promptId`, `submissionId`, `contextRevision` y `documentId`, y el servidor la verifica contra su propio registro, nunca contra datos del cliente.
- Es válida solo si se cumplen todas estas condiciones:
  - el prompt es el vigente;
  - el trámite está en `WAITING_CONFIRMATION`;
  - la revisión coincide con la actual;
  - el documento es el `SELECTED`, está `APPROVED` y su sha256 coincide con el registrado.
- Si no es válida, el resultado es `CONFIRMATION_STALE`, sin efecto, y se re-presenta el prompt vigente.
- En una transacción se registra `DocumentConfirmation` (única por `submissionId` + `contextRevision`), se resuelven y fijan los destinatarios (ADR-012) y se crea la entrega `PENDING` (única por confirmación) con su acción de outbox.
- Confirmar dos veces es idempotente (`CONFIRMATION_ALREADY_USED`): no hay segunda entrega.
- Confirmar no es una aprobación administrativa. Este ADR no incorpora un flujo de aprobación por supervisor.

### 5. Reemplazo y archivos adicionales

- **[Reemplazar] en revisión o durante la validación:** el candidato vigente pasa a `SUPERSEDED`, la revisión aumenta y el trámite vuelve a `WAITING_FILE`. El archivo siguiente queda seleccionado directamente, porque el empleado eligió reemplazar. V1 no ofrece "volver al anterior": hay que enviarlo de nuevo como candidato.
- **Otro archivo sin pulsar [Reemplazar]**, en `VALIDATING_FILE`, `WAITING_CONFIRMATION` o `DELIVERY_PENDING` antes del despacho:
  - se registra como candidato `PENDING_CHOICE`, si hay cupo;
  - la revisión aumenta, lo que invalida cualquier revisión o confirmación pendiente;
  - una entrega `PENDING` todavía no despachada pasa a `CANCELLED`;
  - el trámite pasa a `WAITING_FILE_CHOICE`;
  - no hay sustitución silenciosa.
- **Elección:** el candidato elegido pasa a `SELECTED` y los demás a `DISCARDED`. Si el elegido sigue en análisis, el trámite va a `VALIDATING_FILE`; si ya está aprobado, a `WAITING_CONFIRMATION` con un prompt nuevo.
- **Resultado tardío del análisis:** se registra en el documento correspondiente (estado y metadatos), pero el motor solo avanza con resultados del candidato `SELECTED` de la revisión vigente. Un resultado de un candidato `SUPERSEDED` o `DISCARDED`, o de un trámite terminado, no selecciona nada ni habilita un envío. Un resultado de malware igual genera la alerta de seguridad.

### 6. Coordinación atómica con el despacho

Confirmar, reemplazar, elegir, cancelar, recibir un archivo nuevo e iniciar el despacho son transiciones que bloquean la fila de `Submission` y verifican su revisión (ADR-002), así que se serializan.

El **punto de no retorno** es el commit que pasa el intento de entrega a `DISPATCHING` (ADR-002). Esa transacción comprueba que:

- la entrega sigue `PENDING`;
- el trámite sigue `DELIVERY_PENDING`;
- la revisión de la confirmación es la actual;
- el documento coincide (sha256);
- los destinatarios siguen autorizados.

| Compiten | Gana el primero en confirmar su transacción | Resultado |
|---|---|---|
| Confirmar y Reemplazar (o archivo nuevo) | Confirmar | Entrega `PENDING`; el reemplazo posterior la cancela y reabre la elección o el pedido de archivo |
| | Reemplazar | La confirmación llega vieja: `CONFIRMATION_STALE`, sin entrega |
| Confirmar y Cancelar | Confirmar | Cancelar después cancela la entrega `PENDING` y el trámite |
| | Cancelar | La confirmación sobre un trámite terminado no tiene efecto |
| Cancelar o Reemplazar e inicio del despacho | Inicio del despacho | `DISPATCH_ALREADY_STARTED`: no se promete cancelación ni reemplazo; se informa el resultado al terminar y se ofrece corrección |
| | Cancelar o Reemplazar | El despacho encuentra la entrega `CANCELLED` y no llama al proveedor |
| Confirmación duplicada | — | Una confirmación por revisión y una entrega por confirmación |

Después del punto de no retorno, un archivo nuevo no se descarga ni se adjunta. El mensaje al empleado es veraz: el envío ya está en curso con el archivo confirmado y, cuando termine, podrá iniciar una corrección.

### 7. Mensajes inesperados

| Entrada | Situación | Tratamiento |
|---|---|---|
| Texto libre que no es un comando | Paso que espera botón o archivo | Aviso breve + re-presentación del prompt vigente; no cambia estado ni candidatos |
| "sí", "ok", "confirmo" escritos | `WAITING_CONFIRMATION` | Igual que texto libre: no confirma |
| Botón u opción de un prompt no vigente o de otro trámite | Cualquiera | `PROMPT_STALE`: "Esa opción ya no corresponde" + prompt vigente |
| Archivo | Paso que no es documental | No se descarga ni se vincula; se explica el paso esperado (`FILE_OUT_OF_STEP`) |
| Archivo con tipo o tamaño declarado no admitido | Paso documental | No se descarga; se indican formatos y tamaño |
| Archivo con el cupo de candidatos agotado | Paso documental | No se descarga (`CANDIDATE_LIMIT_REACHED`); se ofrece elegir entre los existentes o cancelar |
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
  - cancela las entregas `PENDING` y los mensajes salientes no despachados;
  - no anula análisis en curso: sus resultados se registran y se ignoran.
- Reiniciar crea un trámite nuevo, recién después de cerrar el anterior en la misma transacción (ADR-011).
- Eventos pendientes del trámite anterior (descargas, análisis, botones, mensajes retenidos) nunca se vinculan al nuevo: cada evento y prompt lleva su `submissionId`.
- Si el despacho ya empezó, reiniciar y cancelar se rechazan con `DISPATCH_ALREADY_STARTED`.

### 9. Mensajes retenidos al reabrirse la ventana

- Cada `OutboundMessage` guarda `submissionId`, `contextRevision`, `promptId` (si es un prompt), `purpose` (`PROMPT` o `NOTICE`) y `expiresAt`.
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
| Candidatos por trámite (incluye rechazados) | 3; hasta 30 MB almacenados |
| Adjuntos seleccionados por envío | 1 |
| Entradas inesperadas por paso antes de dejar de re-presentar | 5 |
| Revisiones de contexto por trámite | 20; al alcanzarlo solo se ofrecen Confirmar o Cancelar |
| Plazo para iniciar una corrección | 7 días desde la aceptación |
| Correcciones por envío original | 3 |
| Vigencia de un mensaje retenido | 7 días |
| Objeto de un candidato rechazado | Se elimina al registrar el resultado; se conservan los metadatos |
| Objeto de un candidato `SUPERSEDED` o `DISCARDED` | Se elimina 24 h después de que el trámite termina, o antes si se agota la retención general |
| Documento confirmado y enviado | Retención general (30 días, propuesta) |

Los metadatos de candidatos (hash, tamaño, tipo, fechas, selección) siguen la retención de auditoría.

## Costos

- Un paso más para el empleado en cada envío.
- Más estados, más entidades (`DocumentConfirmation`) y más pruebas de concurrencia.
- Almacenamiento temporal de candidatos, acotado por los límites.

## Consecuencias

- El nodo `file` declara un bloque `review` obligatorio, y entre el `file` y el `email` que adjunta su documento no puede haber nodos que capturen datos.
- Cambiar empresa o tipo después del paso documental requiere cancelar y reiniciar.
- Las confirmaciones escritas no se aceptan en V1. Si el piloto muestra problemas de accesibilidad, se revisa.
- Una corrección es un envío nuevo y visible para los destinatarios; no reemplaza ni retira el anterior.

## Invariantes

- Ningún correo sin una confirmación válida del documento exacto y de la revisión vigente.
- Ningún archivo reemplaza a otro sin una acción explícita del empleado.
- Ningún resultado de un candidato no seleccionado, o de un trámite terminado, habilita un envío.
- Después del punto de no retorno no se promete cancelación ni reemplazo.
- Ningún prompt retenido se reproduce: el prompt vigente se emite de nuevo con una identidad nueva.
- El historial de un envío aceptado no se modifica por una corrección.

## Pruebas

T35 a T45 (nuevas). T06, T13 y T22 conservan su ID con el resultado precisado.

## Documentos afectados

`docs/01_REQUISITOS.md`, `docs/02_ARQUITECTURA.md`, `docs/03_PLAN_DESARROLLO.md`, `docs/04_MODELO_DATOS.md`, `docs/05_CONTRATOS_API.md`, `docs/06_EDITOR_Y_MOTOR.md`, `docs/08_CONFIABILIDAD.md`, `docs/09_PRUEBAS_Y_ACEPTACION.md`, `docs/11_UX_ADMINISTRADOR.md`, `docs/13_TRAZABILIDAD.md`, `docs/15_PLAN_CONSOLIDADO_P0.md`, `examples/`.

## Decisiones pendientes

- Avisar o no automáticamente a los destinatarios originales cuando una corrección cambia de destinatarios. Antes de P4.
- Confirmar los valores iniciales de la sección 11.
- Mostrar o no al empleado el nombre del área destinataria en la revisión (claridad frente a privacidad). Por defecto, no se muestra.
