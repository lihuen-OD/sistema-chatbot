# Editor, DSL y motor de ejecución

## Contrato

definition = schemaVersion, flowId, variables, entryNodeId, nodes. Layout separado: posiciones/zoom. Cada nodo tiene id, type y configuración validada para ese type. Los ejemplos del kit expresan este contrato conceptual; durante P0/P1 se formaliza JSON Schema y validación TypeScript y se actualizan fixtures si cambia.

Variables tipadas: enum, string, date, boolean y lista documentRef. company y documentType son enums internos. Los archivos son referencias controladas, nunca URLs libres. La variable employeeId proviene del contexto autenticado, no de una respuesta libre.

## Bloques V1

| Tipo | Entrada/configuración | Salida/efecto |
|---|---|---|
| start | Sin entrada | Transición al siguiente |
| message | Texto con variables definidas | Acción de mensaje; continuar tras aceptación o política definida |
| selection | Texto, opciones {id,label,value,next}, variable | Muestra pregunta y espera respuesta válida |
| capture | Tipo, validación, variable | Espera dato y guarda valor tipado |
| file | Formatos, maxBytes, minCount/maxCount, variable | Solicita adjunto; espera validación de todos los documentos requeridos |
| condition | Predicados permitidos y salidas | Resuelve ruta de forma determinista |
| email | ruleSet/contexto, asunto, cuerpo, documentVariable | Crea entrega; espera aceptación antes de continuar V1 |
| end | Motivo de cierre | Finaliza recorrido |

V1 del file puede limitarse a un archivo para simplificar interacción. Si se habilitan varios, definir acción explícita “Terminé de adjuntar”, cantidad mínima/máxima y evitar que la confirmación se interprete como documento. No inferir que dejó de enviar por un timeout breve.

## Ejecución

Motor puro recibe definition inmutable, estado, contexto permitido y evento. Devuelve nuevo estado, acciones y diagnóstico. El host valida permisos vigentes y persiste la transición+acciones de forma atómica. El ejecutor envía efectos y emite eventos de resultado al motor.

Salir de selection requiere opción vinculada a su pregunta activa. Entrar a file crea prompt y queda WAITING_FILE. Recibir media crea referencia en cuarentena y queda VALIDATING_FILE. Solo DOCUMENT_APPROVED permite llegar a email. EMAIL_ACCEPTED permite mostrar confirmación de envío; EMAIL_FAILED no muestra éxito. El fin del flujo no impide recibir un rebote posterior en Delivery.

Las acciones automáticas no corren en bucle ilimitado: límite de transiciones por evento y presupuesto de pasos. Rechazar ciclos en publicación V1. Reintentar dato inválido no crea una nueva entrega ni transición semántica; limitar abuso por remitente.

## Selección de versiones

flowVersionId y ruleSetVersionId fijados al iniciar. Definición y reglas inmutables con hash. Borrador no se ejecuta en producción. Simulación usa snapshot de borrador y su hash; si el editor cambia, ofrecer reiniciar simulación y no mutar el snapshot actual.

## Condiciones

Predicados con variables declaradas y operadores tipados. No usar eval ni expresiones de plantilla como lógica. Para rules, especificar ALL de condiciones. No resolver ambigüedad por orden visual: múltiples matches incompatibles son error. Fallback explícito solo si tiene permiso y propósito configurado; V1 propone detener sin match.

## Idempotencia de pasos

Cada entrada lógica a nodo tiene executionInstanceId. La actionKey incluye submissionId, nodeId, executionInstanceId y acción. Distingue una repetición accidental del mismo evento de una nueva ejecución autorizada. V1 sin ciclos reduce repetición, pero comandos y retries deben conservar esta semántica.

## Comandos y entrada inválida

Cancelar antes de efectos irreversibles: marca estado y cancela pendientes que aún no se enviaron, con concurrencia protegida. En fase de envío en curso, resultado puede ser incierto: no prometer cancelación. Reiniciar crea Submission nueva tras cierre explícito de la anterior. Volver solo a pasos reversibles sin correo ejecutado. Ayuda no modifica variables. Documento fuera de paso no se adjunta automáticamente.

## Publicación

Validar estructura, semántica, referencias, autorización documental, límites de canal, plantillas fuera de ventana y máximos de adjuntos. Mostrar errores exactos por bloque. Versionar layout opcionalmente para poder reconstruir la vista sin usarlo como lógica. Un “flujo válido” garantiza estructura, no entrega de proveedores: requiere también E2E.
