# Editor, DSL y motor de ejecución

Actualizado: 19/10/2026 (ADR-003, ADR-004, ADR-005, ADR-012, ADR-013, ADR-014)

## Contrato

definition = schemaVersion, flowId, name, variables, entryNodeId, nodes. El layout (posiciones y zoom) va separado. Cada nodo tiene id, type y la configuración validada para ese type. Los ejemplos de `examples/` expresan este contrato; P1-T1 formaliza tipos y validación y los usa como fixtures.

Tipos de variable: `enum`, `string`, `date`, `boolean`, `companyRef`, `documentTypeRef` y `documentRefList`. `companyRef` y `documentTypeRef` se validan contra el directorio y el catálogo. Los archivos son referencias controladas, nunca URLs libres. `employeeId` proviene del contexto autenticado, no de una respuesta.

## Bloques V1

| Tipo | Entrada/configuración | Salida/efecto |
|---|---|---|
| start | Sin entrada | Transición al siguiente |
| message | Texto con variables definidas | Acción de mensaje; continuar tras aceptación o política definida |
| selection | Texto, variable y opciones estáticas `{id,label,value,next}` u `optionsSource` dinámico | Muestra la pregunta y espera una respuesta válida |
| capture | Tipo, validación, variable | Espera el dato y guarda el valor tipado |
| file | Formatos, maxBytes, minCount/maxCount, variable, `review` obligatorio | Solicita el adjunto, lo valida y pide confirmación explícita; admite reemplazo y elección entre candidatos como estados internos (ADR-014) |
| condition | Ramas con predicados `ALL` y `else` obligatorio | Resuelve la ruta de forma determinista |
| email | ruleSetId, variables de contexto, asunto, cuerpo, documentVariable | Crea la entrega; espera aceptación antes de continuar en V1 |
| end | Motivo de cierre | Finaliza el recorrido |

V1 admite exactamente un adjunto seleccionado por envío (ADR-007, ADR-014): el validador exige `minCount` = `maxCount` = 1. El trámite puede tener hasta 3 candidatos para gestionar reemplazos, pero solo uno se selecciona y confirma. No existe "Terminé de adjuntar". Si en el futuro se habilitan varios adjuntos, hará falta esa acción explícita, cantidades mínima y máxima, y evitar que la confirmación se interprete como documento; tampoco se debe inferir el final por un timeout breve.

## Paso documental: revisión, reemplazo y confirmación

Detalle normativo en ADR-014. Resumen para el motor:

- Estados internos del paso: `WAITING_FILE` → `VALIDATING_FILE` → `WAITING_CONFIRMATION`, con `WAITING_FILE_CHOICE` cuando llega otro archivo sin pulsar Reemplazar. No son aristas del editor: el editor no puede dibujar ciclos.
- `review` es obligatorio. Define el texto de revisión y las etiquetas de [Confirmar], [Reemplazar] y [Cancelar] (tres botones). Variables reservadas: `{{fileName}}` (escapado y truncado), `{{fileType}}` y `{{fileSize}}`. Las variables `companyRef` y `documentTypeRef` se muestran con su etiqueta del catálogo.
- Solo una confirmación interactiva que referencia el prompt vigente, la revisión de contexto actual y el documento seleccionado, aprobado y disponible permite salir hacia `next`. Recibir o aprobar el archivo no alcanza. El prompt de revisión no se emite sin un candidato en esas condiciones.
- Cada candidato nuevo, reemplazo, elección o candidato que deja de ser seleccionable incrementa `contextRevision` e invalida revisiones, listas y confirmaciones anteriores.
- **Elección:**
  - la lista ofrece solo candidatos seleccionables (ADR-014 §2);
  - un archivo adicional en `WAITING_FILE_CHOICE` actualiza la lista con un prompt nuevo, y los botones anteriores responden `PROMPT_STALE`;
  - nunca se elige automáticamente, ni con un único candidato.
- **Cupo:**
  - 3 candidatos por trámite completo, reservados con incremento condicional;
  - `candidateSeq` único por trámite;
  - el cupo no se devuelve.
- **Límite de cambios:** se cuenta solo sobre acciones del empleado y su efecto depende del estado (ADR-014 §3). Los resultados internos nunca se bloquean.
- **Salida segura:** si no hay candidato seleccionable ni cupo, solo se ofrece Cancelar (o `REINICIAR`).
- Los resultados de análisis de candidatos no seleccionados se registran y no producen transición.
- Un archivo solo se asocia al trámite con correlación suficiente: identidad del empleado, estado que acepta archivos y timestamp del proveedor posterior al ancla de pedido de archivo. Si no, `FILE_NOT_CORRELATED` y se pide reenviarlo (ADR-014 §12).
- Entre el `file` y el `email` que adjunta su documento solo pueden ir nodos `condition` o `message`: ningún nodo que capture datos.
- Los mensajes del sistema del paso (archivo adicional, opción vieja, envío en curso, límite alcanzado) tienen textos por defecto editables desde Configuración; no cambian la lógica.

## Opciones dinámicas

Una selección puede declarar `optionsSource` en lugar de `options` (ADR-003):

- Fuentes V1: `AUTHORIZED_COMPANIES` (empresas activas dentro de los ámbitos del empleado) y `DOCUMENT_TYPES` (tipos activos del catálogo fijado, filtrables por la empresa ya elegida).
- Obligatorios: `maxOptions` (no mayor que el límite del canal), `next` y `onEmpty`. `autoSelectSingle` vale `false` por defecto.
- El id de cada opción es `<fuente>:<id de la entidad>` y se guarda con el prompt.
- La respuesta se valida contra las opciones presentadas y se revalida: el empleado sigue autorizado y la entidad sigue activa.
- Si al ejecutar hay más opciones que `maxOptions`, no se trunca: el trámite pasa a `NEEDS_REVIEW`.
- La publicación se rechaza si la cota superior de opciones supera `maxOptions`.

## Ejecución

El motor puro recibe la definición inmutable, el estado, el contexto permitido y el evento, y devuelve estado nuevo, acciones y diagnóstico. El host valida permisos vigentes y persiste la transición y sus acciones de forma atómica. El ejecutor envía los efectos y emite eventos de resultado al motor.

El host vincula cada evento a un trámite (por `promptId`, al activo o a la referencia de su trabajo) en la transacción de transición y en orden de llegada por clave. Registra el trámite, la generación y la revisión, y nunca reasigna después ni el evento ni sus trabajos derivados (ADR-014 §12). El motor no decide vinculaciones: recibe el evento ya vinculado al estado sobre el que se aplica.

- Salir de `selection` requiere una opción vinculada a su pregunta activa.
- Entrar a `file` crea el prompt y deja el trámite en `WAITING_FILE`. Recibir media crea un candidato en cuarentena y lo pasa a `VALIDATING_FILE`.
- `DOCUMENT_APPROVED` del candidato seleccionado lleva a `WAITING_CONFIRMATION`. Solo `DOCUMENT_CONFIRMED` válido permite llegar a `email` (ADR-014). `EMAIL_ACCEPTED` permite mostrar la confirmación de envío; `EMAIL_FAILED` no muestra éxito.
- Si la resolución de destinatarios se bloquea (ADR-012), el trámite pasa a `NEEDS_REVIEW` sin enviar nada.
- El fin del flujo no impide recibir un rebote posterior en `Delivery`.

**Ventana de atención (V1).** Toda acción de mensaje es una respuesta dentro de la ventana. Si al despachar la ventana está cerrada, el mensaje queda en `HELD_WINDOW_CLOSED`. V1 no usa plantillas (ADR-013). Cuando el empleado vuelve a escribir, primero se procesa su entrada y después se revalidan los retenidos contra el trámite, la revisión y el paso vigentes:

- los prompts retenidos nunca se reproducen: se re-presenta el prompt vigente con un `promptId` nuevo;
- los avisos se envían solo si siguen siendo ciertos;
- los retenidos de trámites cancelados o vencidos se descartan (ADR-014 §9).

Las acciones automáticas no corren en bucle ilimitado: hay un límite de transiciones por evento y un presupuesto de pasos. La publicación V1 rechaza ciclos. Reintentar un dato inválido no crea una nueva entrega ni una transición semántica; se limita el abuso por remitente.

## Selección de versiones

`flowVersionId`, las versiones de los conjuntos de reglas referenciados y `catalogVersionId` se fijan al iniciar. Al asignar el tipo documental se fija `appliedClassification` (ADR-004). Definición, reglas y catálogo son inmutables y tienen hash. Un borrador no se ejecuta en producción. La simulación usa un snapshot del borrador y su hash; si el editor cambia, se ofrece reiniciar la simulación sin mutar el snapshot actual.

## Condiciones y reglas

- Predicados con variables declaradas y operadores tipados: `eq`, `neq`, `in`, `notIn`, `exists` y comparaciones de orden solo para `date`.
- No se usa eval ni expresiones de plantilla como lógica.
- Las ramas de `condition` deben ser disjuntas; lo que el validador no puede demostrar disjunto se rechaza.
- Las reglas de distribución usan condiciones `ALL`. Para cada combinación del dominio declarado debe coincidir exactamente una regla, o la combinación debe estar en `reviewOnly`.
- No se resuelve ambigüedad por orden visual.
- No hay grupo genérico de respaldo: sin coincidencia, el trámite va a revisión.

Cobertura, límites y bloqueos en ADR-012.

## Idempotencia de pasos

Cada entrada lógica a un nodo tiene `executionInstanceId`. La `actionKey` incluye submissionId, nodeId, executionInstanceId y acción. Así se distingue una repetición accidental del mismo evento de una nueva ejecución autorizada. V1 sin ciclos reduce la repetición, pero comandos y reintentos deben conservar esta semántica.

Para el correo, la identidad de la acción es la confirmación: `actionKey` y la clave de idempotencia del proveedor se derivan de `confirmationId`. Así, después de cancelar una entrega `PENDING` y confirmar otro archivo (o el mismo, en otra revisión) dentro del mismo nodo y ejecución, la entrega nueva tiene identidad propia. Repetir la misma confirmación no crea otra, y la acción cancelada nunca se despacha (ADR-014 §6).

## Comandos y entrada inválida

- Comandos: `CANCELAR`, `REINICIAR`, `AYUDA`, `VOLVER` y `CORREGIR`, por coincidencia exacta normalizada, sin interpretación de lenguaje natural.
- Cancelar antes del punto de no retorno (commit del intento en `DISPATCHING`) marca el estado, descarta candidatos, cancela la entrega `PENDING` y los mensajes no despachados, con concurrencia protegida.
- Después del punto de no retorno no se promete cancelación ni reemplazo (`DISPATCH_ALREADY_STARTED`); el resultado puede ser incierto.
- Reiniciar crea un `Submission` nuevo tras el cierre explícito del anterior; nunca hay dos activos para el mismo empleado y número (ADR-011). Los eventos pendientes del trámite anterior no se vinculan al nuevo.
- Volver solo a pasos reversibles anteriores al paso documental. Desde el paso documental en adelante, para cambiar empresa o tipo se cancela y reinicia. Ayuda no modifica variables.
- Corregir solo está disponible sin trámite activo y sobre un envío aceptado elegible: crea un trámite `CORRECTION` vinculado al original (ADR-014 §10).
- Un documento fuera de paso no se descarga ni se adjunta. Un archivo después del inicio del despacho tampoco.
- Entradas inesperadas: se re-presenta el prompt vigente sin cambiar estado, hasta 5 por paso (valor inicial). Tabla completa en ADR-014 §7.

## Simulación

El simulador usa el mismo motor con un `ActionSink` local (ADR-005). En P3, los archivos se simulan con metadatos (nombre, MIME declarado, tamaño y resultado de análisis elegido). Esto prueba rutas del motor, no la subida, el almacenamiento ni el análisis de archivos reales, que se prueban en P5 con archivos reales aislados.

El simulador permite enviar varios archivos simulados, pulsar Confirmar, Reemplazar y Cancelar, reutilizar botones viejos y entregar resultados de análisis en cualquier orden (incluidos los tardíos) para recorrer los casos de ADR-014.

## Publicación

- Validar estructura, semántica, referencias, autorización documental, límites del canal y de ADR-003, fuentes dinámicas, adjuntos por envío (V1 = 1), `review` obligatorio en cada `file`, ausencia de nodos que capturen datos entre `file` y su `email`, y cobertura de reglas.
- V1 rechaza configuraciones de plantillas fuera de ventana.
- Los límites de tamaño se evalúan primero. Una definición que los supera recibe solo el error de límite y no se analiza su grafo (`packages/flow-schema`).
- Una confirmación habilita un solo envío: ningún camino puede llevar a dos correos con el mismo documento sin un paso documental nuevo (`CONFIRMATION_REUSED`). Ramas alternativas pueden tener un correo cada una (ADR-014).
- El asunto del correo no admite CR ni LF (`EMAIL_SUBJECT_LINE_BREAK`). Esta validación es de la plantilla: el renderizado y el adaptador de correo deben volver a validar el asunto ya interpolado (P5, T53).
- Mostrar errores exactos por bloque.
- Versionar el layout de forma opcional, para reconstruir la vista sin usarlo como lógica.
- Un "flujo válido" garantiza estructura, no entrega de proveedores: también requiere E2E.
