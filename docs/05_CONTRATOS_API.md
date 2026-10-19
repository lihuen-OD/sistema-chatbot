# Contratos API propuestos

Base /api/v1. Sesión administrativa en cookie; CSRF en mutaciones. Error estructurado con code, message, requestId y details filtrados. JSON y tamaño acotados. Fechas ISO UTC, IDs opacos, paginación por cursor. OpenAPI se genera/revisa al implementar.

## Recursos

| Método/ruta | Permiso | Resultado |
|---|---|---|
| POST /auth/login | Público con rate limit | Sesión; desafío MFA si aplica |
| POST /auth/mfa/verify | Sesión de desafío | Sesión completa |
| POST /auth/logout | Autenticado | Revoca sesión |
| GET /auth/me | Autenticado | Identidad y permisos efectivos |
| GET/POST /flows | Leer/editar | Lista paginada o nuevo flujo |
| GET /flows/:id/draft | Editor | Definición + revision |
| PUT /flows/:id/draft | Editor | Guardado con If-Match/revision |
| POST /flows/:id/validate | Editor/publicador | Errores por nodo/arista |
| POST /flows/:id/publish | Publicador | Versión creada + activa |
| GET /flows/:id/versions | Leer | Versiones y autores |
| POST /flows/:id/activate-version | Publicador | Activa versión válida existente |
| POST /simulations | Editor | simulationId + primera salida |
| POST /simulations/:id/events | Dueño autorizado | Evento simulado + trace |
| GET /simulations/:id | Dueño autorizado | Estado/acciones simuladas |
| GET/POST/PATCH /contacts | Administrador de contactos | Cambios validados y auditados |
| GET/POST/PATCH /recipient-groups | Administrador de contactos | Miembros y alcance |
| GET/POST /routing-rule-sets | Editor de reglas | Borrador de reglas |
| POST /routing-rule-sets/:id/publish | Publicador | Versión inmutable |
| GET/POST/PATCH /employees | Administrador de directorio | Alta/alcances/desactivación |
| GET /submissions | Operador por alcance | Lista paginada |
| GET /submissions/:id | Operador por alcance | Detalle permitido |
| POST /documents/:id/download-url | Lectura documental explícita | URL temporal tras autorización |
| POST /deliveries/:id/retry | Operador de envíos | 202 + trabajo o 409 |

## Guardado concurrente

PUT draft lleva revisión esperada. Si otro editor guardó, responder 409 DRAFT_REVISION_CONFLICT con nueva revisión, sin sobrescribir. Publicar revalida exactamente esa revisión y hash, crea versión y cambia puntero en transacción. No publicar una definición diferente a la revisada.

## Ejemplo de error

```json
{"error":{"code":"FLOW_INVALID","message":"Hay pasos incompletos","requestId":"req-demo","details":[{"nodeId":"upload","field":"next","code":"MISSING_TARGET"}]}}
```

Semántica: 400 estructura inválida; 401 no autenticado; 403 acción prohibida; 404 inexistente/no visible cuando corresponda; 409 conflicto/estado; 413 tamaño; 422 validación semántica; 429 límite; 503 indisponibilidad temporal. No revelar IDs/contactos de otros ámbitos en errores.

## Webhooks

GET /webhooks/whatsapp verifica token y challenge según Meta. POST conserva raw body y valida firma antes de parsear/aceptar. Cuentas permitidas se mapean a channelId desde configuración de servidor. Persistir cada evento del batch de forma atómica o gestionar ACK solo cuando todos queden durables. Un duplicado ya guardado puede recibir 200. Un evento irrelevante válido puede descartarse con registro mínimo; no confundirlo con fallo de persistencia.

POST /webhooks/email verifica mecanismo de firma del proveedor, ventana de timestamp si existe y deduplica cada evento. Campos/estado externo se normalizan y no se aceptan como estados internos sin validar.

## Envelope interno

```json
{"eventId":"ev-demo","channelId":"wa-test","senderId":"sender-demo","kind":"OPTION_SELECTED","conversationId":"conv-demo","providerMessageId":"wamid-demo","promptMessageId":"prompt-demo","optionId":"company_a","receivedAt":"2026-10-14T17:00:00Z"}
```

No es el payload literal de Meta. El adaptador hace el mapeo. No aceptar senderId o companyId del navegador como autorización. Simulación agrega namespace y simulationId separados.

## Retries administrativos

Retry requiere idempotency key, motivo y permiso; solo estados recuperables. Resultado incierto exige conciliación o aprobación explícita documentada del operador para arriesgar duplicado. El servidor bloquea doble clic concurrente. No reenvía a direcciones editadas automáticamente: un nuevo conjunto de destinatarios genera otra entrega auditada.
