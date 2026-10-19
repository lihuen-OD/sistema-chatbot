# Contratos API propuestos

Actualizado: 19/10/2026 (ADR-003, ADR-004, ADR-005, ADR-011, ADR-012). Códigos de error, estados y tipos de evento en inglés (ADR-009).

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
| POST /routing-rule-sets/:id/validate | Editor de reglas | Informe de cobertura: huecos, solapamientos, grupos no autorizados y límites (ADR-012) |
| POST /routing-rule-sets/:id/publish | Publicador | Versión inmutable con informe de cobertura; si amplía destinatarios de un tipo sensible, exige `classification.relax` |
| GET/POST /document-catalog/draft | Editor de catálogo | Borrador de tipos documentales y clasificación |
| POST /document-catalog/publish | Publicador | Versión inmutable del catálogo; si baja una clasificación, exige `classification.relax` |
| GET/POST/PATCH /employees | Administrador de directorio | Alta/alcances/desactivación |
| GET/POST /employees/:id/identities | Administrador de directorio | Vincula una identidad de canal con su ámbito; 409 `IDENTITY_CONFLICT` si está activa en otro empleado |
| POST /employees/:id/identities/:identityId/revoke | Administrador de directorio | Revoca el vínculo, con motivo y auditoría |
| POST /classification-changes/preview | `classification.relax` | Impacto de un cambio que relaja restricciones + `impactHash` |
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

## Códigos de dominio agregados en P0

| Código | HTTP | Cuándo |
|---|---|---|
| `IDENTITY_CONFLICT` | 409 | La identidad está activa en otro empleado o el evento mezcla identidades de empleados distintos |
| `SUBMISSION_ALREADY_ACTIVE` | 409 | El empleado ya tiene un trámite activo en ese número (uso interno del host; al empleado se le ofrece continuar o cancelar) |
| `DYNAMIC_OPTIONS_LIMIT_EXCEEDED` | 422 | La cota superior de opciones dinámicas supera `maxOptions` o el límite del canal |
| `FLOW_LIMIT_EXCEEDED` | 422 | Se supera un límite de ADR-003 |
| `RULE_COVERAGE_GAP` | 422 | Combinación sin regla y fuera de `reviewOnly` |
| `RULE_OVERLAP` | 422 | Más de una regla coincide para una combinación |
| `RULE_LIMIT_EXCEEDED` | 422 | Se supera un límite de complejidad de ADR-012 |
| `RECIPIENT_GROUP_NOT_AUTHORIZED` | 422 | El grupo destino no pertenece a la empresa o no admite la clasificación |
| `CLASSIFICATION_RELAX_FORBIDDEN` | 403 | Cambio que relaja restricciones sin `classification.relax` |
| `CLASSIFICATION_IMPACT_CHANGED` | 409 | El `impactHash` confirmado no coincide con el impacto actual |

Los bloqueos de entrega en ejecución (`RULE_NOT_MATCHED`, `RULES_AMBIGUOUS`, `RECIPIENTS_MISSING`, `RECIPIENT_NOT_AUTHORIZED`, `RECIPIENT_BLOCKED`, `RECIPIENTS_LIMIT_EXCEEDED`, `EMPLOYEE_SCOPE_REVOKED`) no son respuestas HTTP: son el `blockReason` de `Delivery` y se exponen en el detalle del trámite.

## Cambios que relajan restricciones

Primero `POST /classification-changes/preview` con el cambio propuesto: devuelve tipos, grupos y contactos afectados más un `impactHash`. La mutación correspondiente (publicar catálogo, publicar reglas, otorgar clasificación o agregar miembros a un grupo sensible) se envía con `reason` y `impactHash`. Si el impacto cambió entre la vista previa y la confirmación, responde 409 `CLASSIFICATION_IMPACT_CHANGED`. Todo queda auditado con valores anteriores y nuevos (ADR-012).

## Webhooks

GET /webhooks/whatsapp verifica token y challenge según Meta. POST conserva raw body y valida firma antes de parsear/aceptar. Cuentas permitidas se mapean a channelId desde configuración de servidor. Persistir cada evento del batch de forma atómica o gestionar ACK solo cuando todos queden durables. Un duplicado ya guardado puede recibir 200. Un evento irrelevante válido puede descartarse con registro mínimo; no confundirlo con fallo de persistencia.

POST /webhooks/email verifica mecanismo de firma del proveedor, ventana de timestamp si existe y deduplica cada evento. Campos/estado externo se normalizan y no se aceptan como estados internos sin validar.

## Envelope interno

```json
{"eventId":"ev-demo","channelId":"wa-test","senderIdentities":[{"provider":"WHATSAPP","kind":"PHONE_E164","scopeType":"E164","scopeId":"global","value":"+12025550101"},{"provider":"WHATSAPP","kind":"WHATSAPP_BSUID","scopeType":"BUSINESS","scopeId":"demo_business_scope","value":"demo-bsuid-0001"}],"kind":"OPTION_SELECTED","providerMessageId":"wamid-demo","promptMessageId":"prompt-demo","optionId":"AUTHORIZED_COMPANIES:company_a","receivedAt":"2026-10-19T17:00:00Z"}
```

No es el payload literal de Meta. El adaptador hace el mapeo y entrega todas las identidades que trae el evento, con su ámbito. El host resuelve `employeeId` y la conversación (ADR-011); el adaptador no decide identidad ni autorización. No aceptar identidades, `employeeId` ni `companyId` del navegador como autorización. Simulación agrega namespace y `simulationId` separados.

En simulación, un archivo se representa con metadatos, sin bytes (ADR-005):

```json
{"kind":"FILE_METADATA_SIMULATED","simulationId":"sim-demo","fileName":"factura.pdf","declaredMime":"application/pdf","sizeBytes":120000,"simulatedScanResult":"APPROVED"}
```

Ese evento solo existe en el host de simulación; el host de producción lo rechaza.

## Retries administrativos

Retry requiere idempotency key, motivo y permiso; solo estados recuperables. Resultado incierto exige conciliación o aprobación explícita documentada del operador para arriesgar duplicado. El servidor bloquea doble clic concurrente. No reenvía a direcciones editadas automáticamente: un nuevo conjunto de destinatarios genera otra entrega auditada.
