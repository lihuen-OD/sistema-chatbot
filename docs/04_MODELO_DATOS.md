# Modelo de datos conceptual y físico propuesto

Actualizado: 19/10/2026 (ADR-002, ADR-004, ADR-009, ADR-010, ADR-011, ADR-012)

Este documento orienta las migraciones SQL (ADR-010); no es una migración lista.

- IDs UUID/ULID, timestamps en UTC y fechas de negocio con zona explícita.
- Tablas, columnas y códigos de estado en inglés; la interfaz muestra etiquetas en español (ADR-009).
- No usar nombres visibles como identificadores.
- Todo ID externo guarda su namespace de cuenta o canal y su ámbito.

## Entidades

| Entidad | Campos esenciales y relación |
|---|---|
| Organization | id, nombre; propietaria de la instalación |
| Company | id, organizationId, código, nombre, activo |
| Employee | id, organizationId, estado, legajo; empleado canónico (ADR-011) |
| EmployeeCompanyScope | employeeId, companyId, vigencia; ámbitos autorizados |
| ChannelIdentity | id, employeeId, provider, kind (`PHONE_E164`, `WHATSAPP_BSUID`), scopeType, scopeId, normalizedValue, status, linkMethod, verifiedAt, revokedAt, createdBy. Reemplaza a `EmployeePhone` del kit original |
| AdminUser | id, email normalizado, hash/SSO, estado, MFA |
| Session | hash de token, userId, expiresAt, revokedAt |
| RoleAssignment | userId, permiso/rol, alcance de empresas; incluye permisos sensibles como `classification.relax` |
| Classification | code, sensitive; conjunto definido por ADR-012 |
| DocumentCatalogVersion | catalogId, version, contentHash, publishedBy, publishedAt |
| DocumentTypeVersion | catalogVersionId, documentTypeId, label, classification, companyIds opcional, activo |
| Contact | id, email normalizado, nombre, companyId, allowedClassifications, activo, blockedAt |
| RecipientGroup | id, companyId, allowedClassifications; miembros por ContactGroupMember |
| Flow | id, nombre, activo, activeVersionId |
| FlowDraft | flowId, definition JSONB, layout JSONB, revision, updatedBy |
| FlowVersion | flowId, version, definition JSONB, contentHash, publishedBy, publishedAt |
| RoutingRuleSetVersion | ruleSetId, version, contextVariables, reglas declarativas, targetGroupIds, reviewOnly, coverageReport, coverageHash, estado |
| Conversation | channelId, channelIdentityId, employeeId (si está identificado), lastInboundAt; hilo del canal y ventana de atención |
| Submission | employeeId, channelId, conversationId de inicio, flowVersionId, ruleSetVersionIds, catalogVersionId, companyId, documentTypeId, appliedClassification, currentNodeId, status, revision, expiresAt |
| Prompt | submissionId, nodeId, executionInstanceId, outboundMessageId, optionsSnapshot (acotado), estado |
| Answer | submissionId, nodeId, executionInstanceId, variable, valor tipado, channelIdentityId de origen |
| MessageEvent | cuenta/canal, externalEventKey, tipo, receivedAt, providerTimestamp, payload mínimo, estado |
| OutboundMessage | submissionId, conversationId, channelIdentityId, actionKey, status, providerMessageId |
| Document | submissionId, storageKey, sha256, tamaño, MIME declarado/real, status, expiresAt |
| Delivery | submissionId, actionKey, status, blockReason, appliedClassification, recipientsSnapshot, contentSnapshot, ruleSnapshot, providerId |
| DeliveryAttempt | deliveryId, intento, phase (`PREPARED`, `DISPATCHING`, `SUCCEEDED`, `FAILED`, `UNKNOWN`), idempotencyKey, fencingToken, inicio/fin, resultado/error sanitizado |
| EffectObservation | intento o acción, worker y fencingToken observador, resultado del proveedor, observedAt; solo inserción. Guarda resultados tardíos de workers sin lease (ADR-002) |
| Job | type, reference, serializationKey, status, attempt, runAfter, leaseUntil, leaseOwner, fencingToken, heartbeatAt |
| OutboxAction | logicalKey, tipo, payload mínimo, estado, dependencyActionId |
| AuditEvent | actor, acción, recurso, timestamp, correlación, valores anterior/nuevo sin documentos, motivo cuando se exige |

Las simulaciones usan su propio espacio de datos (`simulationId`): nunca crean `Delivery`, `OutboundMessage` ni documentos reales (ADR-005).

El trámite fija al iniciar la versión de flujo, la de cada conjunto de reglas referenciado y la del catálogo (ADR-004). Resolución de destinatarios: versión de reglas fijada + contactos y grupos vigentes al resolver, con snapshot inmutable en `Delivery`. Al ejecutar se revalidan bloqueos, desactivaciones y autorización por clasificación; prevalece lo más restrictivo (ADR-012). No confundir revertir una regla con editar una entrega pendiente.

## Invariantes y restricciones

- FlowVersion, RoutingRuleSetVersion y DocumentCatalogVersion únicas por (id, version), solo inserción. La base rechaza `UPDATE`/`DELETE` mediante trigger o privilegios. El hash detecta modificaciones accidentales; no sustituye permisos.
- FlowDraft con revisión optimista y un borrador por flujo en V1.
- MessageEvent única por (channelId, externalEventKey), con clave distinta para el mensaje y para cada estado externo.
- OutboxAction.logicalKey y Delivery.actionKey únicas en su namespace.
- **Identidad:** índice único parcial sobre ChannelIdentity(provider, kind, scopeType, scopeId, normalizedValue) WHERE status = `ACTIVE`. Una identidad activa pertenece a un solo empleado; los valores no se comparan entre ámbitos.
- **Trámite activo:** índice único parcial sobre Submission(employeeId, channelId) WHERE status en estados no terminales, con creación en transacción. Un empleado tiene como máximo un trámite activo por número empresarial, aunque use varias identidades.
- Submission.employeeId es obligatorio: no hay trámites de remitentes no identificados.
- Submission.appliedClassification no cambia una vez asignada.
- Document pertenece a Submission; DeliveryDocument no puede referenciar documentos de otro trámite. En V1, un documento por trámite.
- Contactos y grupos pertenecen a la empresa autorizada. Se comprueba en transacción, con restricciones cuando sea posible; nunca se confía en IDs enviados por el cliente.
- Job: toda actualización incluye `fencingToken` en la condición.
- Se bloquea el borrado físico de versiones usadas, empleados, identidades y contactos referenciados, y entregas; se desactiva y se purga según política.

## Estados

Códigos internos en inglés; etiqueta visible en español.

**Submission (trámite).** Los seis primeros son activos (no terminales).

| Código | Etiqueta |
|---|---|
| `IN_PROGRESS` | En curso |
| `WAITING_ANSWER` | Esperando respuesta |
| `WAITING_FILE` | Esperando archivo |
| `VALIDATING_FILE` | Validando archivo |
| `DELIVERY_PENDING` | Envío pendiente |
| `NEEDS_REVIEW` | Requiere revisión |
| `COMPLETED` | Completado |
| `CANCELLED` | Cancelado |
| `EXPIRED` | Vencido |

**Document:** `RECEIVED` Recibido, `QUARANTINED` En cuarentena, `SCANNING` Analizando, `APPROVED` Aprobado, `REJECTED` Rechazado, `SCAN_INCONCLUSIVE` Análisis incierto, `DELETED` Eliminado.

**Delivery:** `PENDING` Pendiente, `PROCESSING` Procesando, `PROVIDER_ACCEPTED` Aceptado por el proveedor, `DELIVERED` Entregado, `BOUNCED` Rebotado, `FAILED` Fallido, `UNCERTAIN` Resultado incierto, `BLOCKED` Bloqueado. `blockReason` usa los códigos de ADR-012.

**OutboundMessage:** `PENDING` Pendiente, `HELD_WINDOW_CLOSED` Retenido por ventana cerrada, `DISPATCHING` Enviando, `PROVIDER_ACCEPTED` Aceptado por el proveedor, `DELIVERED` Entregado, `READ` Leído, `FAILED` Fallido, `UNCERTAIN` Resultado incierto, `CANCELLED` Cancelado.

**ChannelIdentity:** `PENDING_VERIFICATION` Pendiente de verificación, `ACTIVE` Activa, `REVOKED` Revocada.

**Job:** `READY`, `RUNNING`, `RETRY_SCHEDULED`, `NEEDS_RECONCILIATION`, `SUCCEEDED`, `DEAD`, `CANCELLED`. Un worker con lease vencido no puede completar ni reescribir el job con un `fencingToken` antiguo; su resultado tardío se guarda como `EffectObservation`.

Conversation registra el canal; Submission registra el trámite. `COMPLETED` significa que se completó el recorrido al nivel configurado (en V1: correo aceptado por el proveedor), no que el destinatario lo leyó. Los eventos tardíos no hacen retroceder `DELIVERED` a `PENDING`.

## Índices y límites

- Jobs por status + runAfter + priority; leaseUntil para recuperar; serializationKey para la exclusión por clave.
- Trámites por companyId + status + createdAt + id, y por employeeId + channelId.
- Conversaciones por channelId + channelIdentityId.
- Identidades por (kind, scopeType, scopeId, normalizedValue).
- Entregas por submissionId + status. Eventos por cuenta + clave externa.
- Paginación por cursor con orden total timestamp + ID.

Pool con límite por proceso y total de conexiones calculado con todas las réplicas. No guardar binarios en la base ni payloads ilimitados en JSONB (`optionsSnapshot`, `coverageReport` con tamaño máximo). Conservar timestamps del proveedor y de recepción para diagnóstico; las reglas de orden son del motor, no un ORDER BY timestamp ciego.

## Migraciones

- Migraciones SQL versionadas y revisadas (ADR-010); nunca `db push`.
- Probar en base vacía y en copia aislada.
- Expand/contract para campos usados por API y worker de versiones diferentes.
- Seed de demo solo local, idempotente y prohibido por guard de entorno en producción.
