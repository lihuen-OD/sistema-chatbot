# Durabilidad, orden y efectos externos

## Principio

Se diseña para entrega al menos una vez de eventos, con deduplicación interna. No prometer exactamente una entrega externa. La caída del servidor entre aceptación externa y escritura local es un caso obligatorio.

## Inbox

Verificar firma y cuenta; descomponer lote. En transacción registrar evento único y Job. ACK solo después del commit. Si duplicado durable, ACK. Si DB indisponible, error. No devolver 200 “para evitar reintentos” sin persistencia. El plazo de reintento de Meta no reemplaza backups ni alerta.

## Orden por empleado y número

Una sola transición activa por clave de serialización: número empresarial + empleado si el remitente está identificado, o número + identidad si no lo está (ADR-002, ADR-011). Así, dos identidades del mismo empleado no avanzan en paralelo. Usar lock transaccional por clave y revisión del trámite, o mecanismo equivalente demostrado. SKIP LOCKED asigna trabajos, pero dos workers pueden tomar dos eventos de la misma clave: debe existir exclusión adicional. Nunca sostener lock SQL durante descarga/correo.

Relacionar respuesta con prompt activo y opción. Un timestamp externo no determina toda causalidad. Si llega respuesta antes de registrar aceptación del mensaje saliente, reconciliar por correlación; un prompt conocido no debe perderse por la ventana de escritura. Si no hay correlación segura, detener/reexplicar, no asignar al siguiente paso a ciegas.

## Confirmación, reemplazo y despacho

Detalle en ADR-014. Confirmar, reemplazar, elegir candidato, cancelar, recibir un archivo nuevo e iniciar el despacho bloquean la fila del trámite y verifican su revisión, así que se serializan.

El punto de no retorno es el commit del intento en `DISPATCHING`. Antes de ese commit, la entrega `PENDING` puede pasar a `CANCELLED` y el despacho no llama al proveedor. Después, cancelar o reemplazar responde `DISPATCH_ALREADY_STARTED` y no se promete nada retroactivo.

Una confirmación por revisión y una entrega por confirmación: los duplicados son idempotentes. Los resultados tardíos de análisis de candidatos no seleccionados se registran sin transición.

## Outbox

Transición y acción externa en mismo commit. Executor reclama, ejecuta y registra resultado; acciones dependientes esperan predecesora. No reusar la misma actionKey para efectos diferentes. La acción de correo captura configuración aprobada y referencias de archivo, no descarga libremente al ejecutar.

## Workers

Campos: attempts, runAfter, leaseUntil, owner, fencingToken, heartbeatAt. Heartbeat limitado. Recuperar lease vencido; la escritura del worker antiguo se rechaza con token de fencing, pero su observación del proveedor se guarda como `EffectObservation` y dispara conciliación. Backoff exponencial con jitter y límites. Respetar Retry-After. Separar límites de descarga/scanner/correo/WhatsApp para que un proveedor lento no bloquee todo.

Efectos externos en dos fases: confirmar el intento en `DISPATCHING` con su clave de idempotencia antes de llamar, y registrar el resultado después. Un intento `DISPATCHING` sin resultado se concilia; no se reintenta a ciegas.

**Apagado ordenado (drain).** Al recibir SIGTERM: dejar de estar listo y de reclamar; liberar los trabajos reclamados sin efecto externo iniciado; terminar o revertir transiciones de base; **no liberar el lease de trabajos con llamada externa en curso** y mantener su heartbeat hasta registrar el resultado o hasta el plazo de gracia; si el plazo vence, salir sin liberar y dejar que el lease venza. El plazo de gracia del despliegue debe superar el timeout de llamada más el margen de registro (ADR-002).

## Política de errores

| Caso | Tratamiento |
|---|---|
| 429 / indisponibilidad temporal | Reintento programado dentro de presupuesto |
| Timeout antes de confirmación externa | Conciliar; mismo idempotency key si proveedor lo admite |
| 401/403 por credenciales | Pausar integración y alertar; no loop infinito |
| Regla ausente o conflictiva | Revisión administrativa |
| Archivo malicioso | Rechazo definitivo y aviso seguro |
| Scanner inaccesible | Mantener cuarentena y reintentar |
| Dirección inválida/bounce | Registrar fallo/rebote; no sustituir destino silenciosamente |
| Worker cae después del commit | Otro worker recupera trabajo durable |
| Correo aceptado pero escritura falla | Estado incierto/reconciliación; no retry ciego |
| Apagado con llamada externa en curso | Lease retenido hasta resultado o plazo de gracia; después, recuperación con fencing y conciliación |
| Lease vencido con intento `DISPATCHING` | Reintento con la misma clave si sigue vigente, consulta de estado, o `NEEDS_RECONCILIATION` + `UNCERTAIN` |
| Resultado tardío de worker sin lease | Estado no se modifica; se guarda `EffectObservation` y se concilia |
| Destinatarios ausentes, ambiguos o no autorizados | Entrega `BLOCKED` con código, trámite `NEEDS_REVIEW`, sin envío parcial (ADR-012) |
| Cancelar o reemplazar compite con el inicio del despacho | Gana la primera transacción confirmada; después del punto de no retorno, `DISPATCH_ALREADY_STARTED` (ADR-014) |
| Resultado de análisis de un candidato no seleccionado | Se registra; no hay transición ni envío (ADR-014) |

## Correo

Preferir API con idempotency keys documentadas, consulta de estado y webhooks. Verificar duración de deduplicación: si vence, ya no es seguro suponer que repetir key evitará duplicado. SMTP no ofrece esta garantía. Aceptación de proveedor, entrega a servidor destinatario y lectura son niveles distintos; V1 no promete lectura.

Idempotencia por acción/trámite, no por hash global del documento. Reenvío manual autorizado es una acción nueva con motivo, actor y referencia a original. Si una entrega se resuelve parcialmente por destinatario, conservar esos estados y no reenviar a todos sin decisión.

## WhatsApp

Acciones con ID lógico interno y correlación a ID de proveedor. Timeout incierto requiere reconciliación disponible o política explícita, sin promesa de deduplicación del canal. Revalidar ventana de atención al ejecutar, no solo al planificar. Si vence durante cola, el mensaje queda `HELD_WINDOW_CLOSED` hasta una nueva entrada del empleado. Al reabrirse la ventana, se procesa primero la entrada y después se revalida cada retenido contra el trámite, la revisión y el paso vigentes. Los prompts no se reproducen (se re-presenta el vigente con un `promptId` nuevo); los avisos se envían solo si siguen siendo ciertos; los de trámites cancelados o vencidos se descartan; los que superan 7 días vencen (ADR-014 §9). V1 no usa plantillas fuera de ventana (ADR-013); si en el futuro se aprueban, se configuran para ese caso específico. No cobrar/repetir preguntas por errores de loop.

## Operación

Trabajos agotados pasan a DEAD con razón y quedan visibles. Métricas de edad de cola y tamaño; alerta antes de expiración de conversación/media. Priorizar descarga de media cuya disponibilidad es temporal. Estado de cancelación protegido contra worker concurrente. Detener flujo no revoca correos/WhatsApp ya aceptados.
