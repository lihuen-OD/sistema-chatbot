# Editor, DSL y motor de ejecución

Actualizado: 19/10/2026 (ADR-003, ADR-004, ADR-005, ADR-012, ADR-013)

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
| file | Formatos, maxBytes, minCount/maxCount, variable | Solicita el adjunto; espera la validación del documento |
| condition | Ramas con predicados `ALL` y `else` obligatorio | Resuelve la ruta de forma determinista |
| email | ruleSetId, variables de contexto, asunto, cuerpo, documentVariable | Crea la entrega; espera aceptación antes de continuar en V1 |
| end | Motivo de cierre | Finaliza el recorrido |

V1 admite exactamente un archivo por trámite (ADR-007, ADR-013): el validador exige `minCount` = `maxCount` = 1. No existe "Terminé de adjuntar". Si en el futuro se habilitan varios archivos, hará falta esa acción explícita, cantidades mínima y máxima, y evitar que la confirmación se interprete como documento; tampoco se debe inferir el final por un timeout breve.

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

- Salir de `selection` requiere una opción vinculada a su pregunta activa.
- Entrar a `file` crea el prompt y deja el trámite en `WAITING_FILE`. Recibir media crea una referencia en cuarentena y lo pasa a `VALIDATING_FILE`.
- Solo `DOCUMENT_APPROVED` permite llegar a `email`. `EMAIL_ACCEPTED` permite mostrar la confirmación de envío; `EMAIL_FAILED` no muestra éxito.
- Si la resolución de destinatarios se bloquea (ADR-012), el trámite pasa a `NEEDS_REVIEW` sin enviar nada.
- El fin del flujo no impide recibir un rebote posterior en `Delivery`.

**Ventana de atención (V1).** Toda acción de mensaje es una respuesta dentro de la ventana. Si al despachar la ventana está cerrada, el mensaje queda en `HELD_WINDOW_CLOSED` y se envía cuando el empleado vuelve a escribir. V1 no usa plantillas (ADR-013).

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

## Comandos y entrada inválida

- Cancelar antes de efectos irreversibles marca el estado y cancela los pendientes que aún no se enviaron, con concurrencia protegida.
- En fase de envío en curso el resultado puede ser incierto: no se promete cancelación.
- Reiniciar crea un `Submission` nuevo tras el cierre explícito del anterior; nunca hay dos activos para el mismo empleado y número (ADR-011).
- Volver solo a pasos reversibles sin correo ejecutado. Ayuda no modifica variables.
- Un documento fuera de paso no se adjunta automáticamente.

## Simulación

El simulador usa el mismo motor con un `ActionSink` local (ADR-005). En P3, los archivos se simulan con metadatos (nombre, MIME declarado, tamaño y resultado de análisis elegido). Esto prueba rutas del motor, no la subida, el almacenamiento ni el análisis de archivos reales, que se prueban en P5 con archivos reales aislados.

## Publicación

- Validar estructura, semántica, referencias, autorización documental, límites del canal y de ADR-003, fuentes dinámicas, cantidad de archivos (V1 = 1) y cobertura de reglas.
- V1 rechaza configuraciones de plantillas fuera de ventana.
- Mostrar errores exactos por bloque.
- Versionar el layout de forma opcional, para reconstruir la vista sin usarlo como lógica.
- Un "flujo válido" garantiza estructura, no entrega de proveedores: también requiere E2E.
