# Contratos API propuestos

Actualizado: 19/10/2026 (ADR-003, ADR-004, ADR-005, ADR-011, ADR-012, ADR-014). Códigos de error, estados y tipos de evento en inglés (ADR-009).

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
| GET /submissions/:id | Operador por alcance | Detalle permitido: timeline, candidatos (metadatos y selección), confirmaciones, entregas y su motivo de bloqueo, mensajes retenidos y descartados, vínculo "corrige a" / "corregido por" |
| POST /documents/:id/download-url | Lectura documental explícita | URL temporal tras autorización; vale también para candidatos no seleccionados mientras su objeto exista; 410 si ya se purgó |
| POST /deliveries/:id/retry | Operador de envíos | 202 + trabajo o 409 |

## Guardado concurrente

PUT draft lleva revisión esperada. Si otro editor guardó, responder 409 DRAFT_REVISION_CONFLICT con nueva revisión, sin sobrescribir. Publicar revalida exactamente esa revisión y hash, crea versión y cambia puntero en transacción. No publicar una definición diferente a la revisada.

## Ejemplo de error

```json
{"error":{"code":"FLOW_INVALID","message":"Hay pasos incompletos","requestId":"req-demo","details":{"issues":[{"code":"MISSING_TARGET","message":"Falta la salida de este paso.","document":{"type":"FLOW"},"path":["nodes",3,"next"],"nodeId":"upload"}],"totalIssues":1,"truncated":false}}}
```

Semántica: 400 estructura inválida; 401 no autenticado; 403 acción prohibida; 404 inexistente/no visible cuando corresponda; 409 conflicto/estado; 413 tamaño; 422 validación semántica; 429 límite; 503 indisponibilidad temporal. No revelar IDs/contactos de otros ámbitos en errores.

Códigos implementados en `packages/contracts` (P1-T2):

| Código | HTTP | details |
|---|---|---|
| `REQUEST_INVALID` | 400 | `problems`: ruta y motivo, sin repetir valores recibidos |
| `UNAUTHENTICATED` | 401 | — |
| `FORBIDDEN` | 403 | — |
| `NOT_FOUND` | 404 | — |
| `PAYLOAD_TOO_LARGE` | 413 | — |
| `RATE_LIMITED` | 429 | — (la espera va en la cabecera `Retry-After`) |
| `SERVICE_UNAVAILABLE` | 503 | — |
| `FLOW_INVALID` | 422 | Informe acotado de problemas de `flow-schema`: `issues`, `totalIssues`, `truncated` |
| `DRAFT_REVISION_CONFLICT` | 409 | `currentRevision` |
| `IDENTITY_CONFLICT`, `SUBMISSION_ALREADY_ACTIVE`, `CLASSIFICATION_IMPACT_CHANGED` | 409 | — |
| `CLASSIFICATION_RELAX_FORBIDDEN` | 403 | — |

`details` solo existe en los códigos que lo declaran, y sus campos están acotados. Los problemas de validación conservan código, documento, ruta y nodo. Sus `details` pasan por una lista permitida que excluye identificadores de personas o de otros ámbitos (`contactId`, `ownerEmployeeId`, `scopeId`).

## Códigos de dominio agregados en P0

| Código | HTTP | Cuándo |
|---|---|---|
| `IDENTITY_CONFLICT` | 409 | La identidad está activa en otro empleado o el evento mezcla identidades de empleados distintos |
| `SUBMISSION_ALREADY_ACTIVE` | 409 | El empleado ya tiene un trámite activo en ese número (uso interno del host; al empleado se le ofrece continuar o cancelar) |
| `DYNAMIC_OPTIONS_LIMIT_EXCEEDED` | 422 (dentro de `FLOW_INVALID`) | La cota superior de opciones dinámicas supera `maxOptions` o el límite del canal |
| `FLOW_LIMIT_EXCEEDED` | 422 (dentro de `FLOW_INVALID`) | Se supera un límite de ADR-003 |
| `RULE_COVERAGE_GAP` | 422 (dentro de `FLOW_INVALID`) | Combinación sin regla y fuera de `reviewOnly` |
| `RULE_OVERLAP` | 422 (dentro de `FLOW_INVALID`) | Más de una regla coincide para una combinación |
| `RULE_LIMIT_EXCEEDED` | 422 (dentro de `FLOW_INVALID`) | Se supera un límite de complejidad de ADR-012 |
| `RECIPIENT_GROUP_NOT_AUTHORIZED` | 422 (dentro de `FLOW_INVALID`) | El grupo destino no pertenece a la empresa o no admite la clasificación |
| `CLASSIFICATION_RELAX_FORBIDDEN` | 403 | Cambio que relaja restricciones sin `classification.relax` |
| `CLASSIFICATION_IMPACT_CHANGED` | 409 | El `impactHash` confirmado no coincide con el impacto actual |

Corrección de P1-T2: los seis códigos marcados "dentro de `FLOW_INVALID`" son códigos de validación de `flow-schema`. No son códigos HTTP propios: viajan como problemas en los `details` de `FLOW_INVALID` (422), para no duplicar el catálogo.

Los bloqueos de entrega en ejecución (`RULE_NOT_MATCHED`, `RULES_AMBIGUOUS`, `RECIPIENTS_MISSING`, `RECIPIENT_NOT_AUTHORIZED`, `RECIPIENT_BLOCKED`, `RECIPIENTS_LIMIT_EXCEEDED`, `EMPLOYEE_SCOPE_REVOKED`) no son respuestas HTTP: son el `blockReason` de `Delivery` y se exponen en el detalle del trámite.

## Cambios que relajan restricciones

Primero `POST /classification-changes/preview` con el cambio propuesto: devuelve tipos, grupos y contactos afectados más un `impactHash`. La mutación correspondiente (publicar catálogo, publicar reglas, otorgar clasificación o agregar miembros a un grupo sensible) se envía con `reason` y `impactHash`. Si el impacto cambió entre la vista previa y la confirmación, responde 409 `CLASSIFICATION_IMPACT_CHANGED`. Todo queda auditado con valores anteriores y nuevos (ADR-012).

## Webhooks

GET /webhooks/whatsapp verifica token y challenge según Meta. POST conserva raw body y valida firma antes de parsear/aceptar. Cuentas permitidas se mapean a channelId desde configuración de servidor. Persistir cada evento del batch de forma atómica o gestionar ACK solo cuando todos queden durables. Un duplicado ya guardado puede recibir 200. Un evento irrelevante válido puede descartarse con registro mínimo; no confundirlo con fallo de persistencia.

POST /webhooks/email verifica mecanismo de firma del proveedor, ventana de timestamp si existe y deduplica cada evento. Campos/estado externo se normalizan y no se aceptan como estados internos sin validar.

## Envelope interno

```json
{"source":"ADAPTER","eventId":"ev-demo","channelId":"wa-test","senderIdentities":[{"provider":"WHATSAPP","kind":"PHONE_E164","scopeType":"E164","scopeId":"global","value":"+12025550101"},{"provider":"WHATSAPP","kind":"WHATSAPP_BSUID","scopeType":"BUSINESS","scopeId":"demo_business_scope","value":"demo-bsuid-0001"}],"kind":"OPTION_SELECTED","providerMessageId":"wamid-demo","promptId":"prm-demo-1","optionId":"AUTHORIZED_COMPANIES:company_a","repliedProviderMessageId":"wamid-prompt-demo","providerTimestamp":"2026-10-19T16:59:58Z","receivedAt":"2026-10-19T17:00:00Z"}
```

No es el payload literal de Meta. El adaptador hace el mapeo y entrega todas las identidades que trae el evento, con su ámbito. El host resuelve `employeeId` y la conversación (ADR-011); el adaptador no decide identidad ni autorización. No aceptar identidades, `employeeId` ni `companyId` del navegador como autorización. Simulación agrega namespace y `simulationId` separados.

Cada evento declara su origen en `source`:

- `ADAPTER`: eventos normalizados del canal. No incluyen `employeeId`, autorización ni vinculación.
- `JOB`: resultados de trabajos internos, con la referencia fija a su trabajo, trámite, generación y documento o entrega.
- `SIMULATOR`: eventos del simulador, con `simulationId`.

La entrada de producción solo acepta `ADAPTER` y rechaza cualquier evento con `simulationId`. Los datos de vinculación (`binding`) los agrega el host aparte del evento.

`providerTimestamp` es obligatorio en `OPTION_SELECTED`, `TEXT_RECEIVED` y `PROMPT_ACTION`, porque cualquiera puede fijar el ancla del pedido de archivo de ADR-014 §12. Solo `FILE_RECEIVED` admite que falte, para conservar el evento y diagnosticarlo después como `FILE_NOT_CORRELATED`.

Corrección de P1-T2: la respuesta a una selección lleva `promptId` (emitido por el servidor), porque ADR-014 §12 vincula las respuestas por prompt. El ejemplo anterior usaba `promptMessageId`; el id del proveedor del mensaje respondido pasa a ser opcional (`repliedProviderMessageId`).

En simulación, un archivo se representa con metadatos, sin bytes (ADR-005):

```json
{"source":"SIMULATOR","simulationId":"sim-demo","eventId":"ev-sim-1","occurredAt":"2026-10-19T17:02:00Z","kind":"FILE_METADATA_SIMULATED","fileName":"factura.pdf","declaredMimeType":"application/pdf","sizeBytes":120000,"simulatedScanResult":"APPROVED"}
```

Ese evento solo existe en el host de simulación; el host de producción lo rechaza. El cliente envía a `POST /simulations/:id/events` solo el contenido (`kind` y sus campos). `source`, `simulationId`, `eventId` y `occurredAt` los asigna el servidor. Si falta `simulatedScanResult`, el resultado se entrega después con `SCAN_RESULT_SIMULATED`, que permite probar resultados tardíos (ADR-014).

## Eventos del paso documental (ADR-014)

| `kind` | Origen | Campos relevantes |
|---|---|---|
| `FILE_RECEIVED` | Adaptador | Metadatos declarados, id de media del proveedor y `providerTimestamp` (obligatorio para la correlación; si falta, el archivo no se correlaciona). El host decide si se vincula y se descarga (ADR-014 §12) |
| `PROMPT_ACTION` | Adaptador (respuesta interactiva) | `promptId`, `action` (`CONFIRM`, `REPLACE`, `CANCEL`, `CHOOSE`), `submissionId`, `contextRevision`, `documentId` o `candidateId`, `providerTimestamp` |
| `TEXT_RECEIVED` | Adaptador | Texto; el host solo reconoce comandos por coincidencia exacta normalizada |
| `DOCUMENT_SCAN_RESULT` | Worker | `documentId`, resultado (`APPROVED`, `REJECTED` con `rejectionReason` `MALWARE`, `TYPE_MISMATCH` o `ENCRYPTED`, o `SCAN_INCONCLUSIVE`); el motor lo ignora si el documento no es el `SELECTED` de la revisión vigente |
| `DISPATCH_STARTED` | Worker | Registro del punto de no retorno de la entrega: `deliveryId`, `attempt`, `fencingToken` |
| `DOCUMENT_DOWNLOAD_RESULT` | Worker | `documentId`, resultado (`QUARANTINED` o `DOWNLOAD_FAILED`) |
| `FILE_METADATA_SIMULATED` | Simulador | Archivo representado por metadatos (ADR-005) |
| `SCAN_RESULT_SIMULATED` | Simulador | Resultado de análisis elegido por quien prueba, en cualquier orden |

Los eventos del worker llevan `jobId`, `submissionId` y `generation` fijados al crear el trabajo. `FILE_RECEIVED` sin `providerTimestamp` es representable, para que el host lo diagnostique como `FILE_NOT_CORRELATED` en lugar de descartarlo.

**Vinculación.** El adaptador no vincula eventos a trámites. El host lo hace en la transacción de transición, con el lock de la clave tomado y en orden de llegada al inbox, y registra `boundSubmissionId`, `boundGeneration`, `boundContextRevision` y `bindingOutcome` en `MessageEvent` (ADR-014 §12):

- las respuestas a prompts se vinculan al trámite de su `promptId`;
- el texto, al trámite activo;
- los archivos, solo con correlación suficiente;
- los resultados internos, a la referencia fijada en su trabajo.

Ningún evento ni trabajo se reasigna después.

Ejemplo de confirmación. Los identificadores van codificados en el id del botón que emite el servidor y se verifican contra su propio registro del prompt. Son referencias a verificar, no una prueba. Campos según la acción:

- `CONFIRM` y `REPLACE`: `documentId`;
- `CHOOSE`: `candidateId`;
- `CANCEL`: ninguna referencia a documento.

Un texto como "sí" es `TEXT_RECEIVED`, nunca una confirmación.

```json
{"source":"ADAPTER","eventId":"ev-demo-2","channelId":"wa-test","senderIdentities":[{"provider":"WHATSAPP","kind":"PHONE_E164","scopeType":"E164","scopeId":"global","value":"+12025550101"}],"kind":"PROMPT_ACTION","promptId":"prm-demo-7","action":"CONFIRM","submissionId":"sub-demo-1","contextRevision":4,"documentId":"doc-demo-2","providerMessageId":"wamid-demo-2","providerTimestamp":"2026-10-19T17:04:59Z","receivedAt":"2026-10-19T17:05:00Z"}
```

Resultados del motor ante entradas rechazadas. No son respuestas HTTP: se devuelven en el diagnóstico, se exponen en el trace del simulador y en el timeline del trámite, y determinan el mensaje al empleado.

| Código | Cuándo |
|---|---|
| `PROMPT_STALE` | Botón u opción de un prompt que no es el vigente, o de otro trámite |
| `CONFIRMATION_STALE` | La revisión, el documento o el trámite de la confirmación no coinciden con los vigentes |
| `CONFIRMATION_ALREADY_USED` | Confirmación repetida de una revisión ya confirmada |
| `DISPATCH_ALREADY_STARTED` | Cancelar, reemplazar, reiniciar o archivo nuevo después del punto de no retorno |
| `CANDIDATE_LIMIT_REACHED` | Archivo con el cupo de candidatos del trámite agotado (cupo por trámite completo, no se devuelve) |
| `CANDIDATE_NOT_SELECTABLE` | Elección de un candidato rechazado, inconcluso, con descarga fallida, purgado, reemplazado o descartado |
| `FILE_NOT_CORRELATED` | Archivo con timestamp del proveedor ausente o no posterior al ancla de pedido de archivo; no se descarga ni consume cupo |
| `FILE_OUT_OF_STEP` | Archivo fuera del paso documental o sin trámite activo |
| `UNSUPPORTED_MESSAGE_TYPE` | Audio, video, sticker, ubicación, contacto o tipo declarado no admitido |
| `UNEXPECTED_INPUT_LIMIT_REACHED` | Se alcanzó el límite de entradas inesperadas del paso |
| `CHANGE_LIMIT_REACHED` | Se alcanzó el límite de cambios del empleado; la acción bloqueada depende del estado (ADR-014 §3). Los eventos internos nunca reciben este código |
| `CORRECTION_NOT_ALLOWED` | Corrección fuera de plazo, sobre un envío no aceptado o por encima del máximo |

## Validación de definiciones (P1-T1)

`packages/flow-schema` implementa la validación estructural y semántica de flujos, conjuntos de reglas y directorio/catálogo. Los códigos estables, la ruta JSON de cada problema y su significado están en `packages/flow-schema/README.md`. Cuando exista el endpoint de validación (`POST /flows/:id/validate`, P4), devolverá esos problemas en `details` del error `FLOW_INVALID` sin cambiar los códigos.

## Contratos implementados (P1-T2)

`packages/contracts` implementa, con tipos TypeScript y validación en tiempo de ejecución:

- eventos `ADAPTER`, `JOB` y `SIMULATOR`, la unión del host y los datos de vinculación;
- errores de la API, diagnósticos del motor y motivos de bloqueo de entrega;
- el informe acotado de problemas de `flow-schema`.

DTO implementados:

| Recurso | Request | Response |
|---|---|---|
| GET /flows/:id/draft | — | `flowDraftResponseSchema` (borrador como objeto JSON, revisión) |
| PUT /flows/:id/draft | `flowDraftUpdateRequestSchema` (`expectedRevision`) | `flowDraftUpdateResponseSchema`; conflicto: `DRAFT_REVISION_CONFLICT` |
| POST /flows/:id/validate | `flowValidationRequestSchema` (`revision`) | `flowValidationResponseSchema` (`valid` + informe) |
| POST /flows/:id/publish | `flowPublishRequestSchema` (`revision`, `contentHash`) | `flowPublishResponseSchema`; problemas: `FLOW_INVALID` |
| POST /simulations/:id/events | `simulationEventRequestSchema` | Pendiente (depende del trace del motor, P2/P3) |

Pendientes:

- el resto de los recursos de la tabla de arriba (autenticación, listados y versiones de flujos, creación y estado de simulaciones, contactos, grupos, reglas, catálogo, empleados e identidades, vista previa de clasificación, trámites, descargas y reintentos);
- payloads reales de Meta y del proveedor de correo (P5/P6);
- eventos de mensajes no admitidos, reacciones, ediciones y estados de mensajes salientes.

Validar un contrato no prueba autenticidad, autorización, idempotencia, concurrencia ni persistencia.

## Retries administrativos

Retry requiere idempotency key, motivo y permiso; solo estados recuperables. Resultado incierto exige conciliación o aprobación explícita documentada del operador para arriesgar duplicado. El servidor bloquea doble clic concurrente. No reenvía a direcciones editadas automáticamente: un nuevo conjunto de destinatarios genera otra entrega auditada.
