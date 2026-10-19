# Durabilidad, orden y efectos externos

## Principio

Se diseña para entrega al menos una vez de eventos, con deduplicación interna. No prometer exactamente una entrega externa. La caída del servidor entre aceptación externa y escritura local es un caso obligatorio.

## Inbox

Verificar firma y cuenta; descomponer lote. En transacción registrar evento único y Job. ACK solo después del commit. Si duplicado durable, ACK. Si DB indisponible, error. No devolver 200 “para evitar reintentos” sin persistencia. El plazo de reintento de Meta no reemplaza backups ni alerta.

## Orden por conversación

Una sola transición activa por conversación. Usar estado/revisión y lease lógico, o mecanismo equivalente demostrado. SKIP LOCKED asigna trabajos, pero dos workers pueden tomar dos eventos de la misma conversación: debe existir exclusión adicional. Nunca sostener lock SQL durante descarga/correo.

Relacionar respuesta con prompt activo y opción. Un timestamp externo no determina toda causalidad. Si llega respuesta antes de registrar aceptación del mensaje saliente, reconciliar por correlación; un prompt conocido no debe perderse por la ventana de escritura. Si no hay correlación segura, detener/reexplicar, no asignar al siguiente paso a ciegas.

## Outbox

Transición y acción externa en mismo commit. Executor reclama, ejecuta y registra resultado; acciones dependientes esperan predecesora. No reusar la misma actionKey para efectos diferentes. La acción de correo captura configuración aprobada y referencias de archivo, no descarga libremente al ejecutar.

## Workers

Campos: attempts, runAfter, leaseUntil, owner, fencingToken. Heartbeat limitado. Recuperar lease vencido; resultado del worker antiguo se rechaza con token de fencing. Backoff exponencial con jitter y límites. Respetar Retry-After. Separar límites de descarga/scanner/correo/WhatsApp para que un proveedor lento no bloquee todo.

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

## Correo

Preferir API con idempotency keys documentadas, consulta de estado y webhooks. Verificar duración de deduplicación: si vence, ya no es seguro suponer que repetir key evitará duplicado. SMTP no ofrece esta garantía. Aceptación de proveedor, entrega a servidor destinatario y lectura son niveles distintos; V1 no promete lectura.

Idempotencia por acción/trámite, no por hash global del documento. Reenvío manual autorizado es una acción nueva con motivo, actor y referencia a original. Si una entrega se resuelve parcialmente por destinatario, conservar esos estados y no reenviar a todos sin decisión.

## WhatsApp

Acciones con ID lógico interno y correlación a ID de proveedor. Timeout incierto requiere reconciliación disponible o política explícita, sin promesa de deduplicación del canal. Revalidar ventana de atención al ejecutar, no solo al planificar. Si vence durante cola, esperar nueva entrada o plantilla aprobada configurada para ese caso. No cobrar/repetir preguntas por errores de loop.

## Operación

Trabajos agotados pasan a DEAD con razón y quedan visibles. Métricas de edad de cola y tamaño; alerta antes de expiración de conversación/media. Priorizar descarga de media cuya disponibilidad es temporal. Estado de cancelación protegido contra worker concurrente. Detener flujo no revoca correos/WhatsApp ya aceptados.
