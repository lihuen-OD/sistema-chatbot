# Modelo de datos conceptual y físico propuesto

Este documento orienta el schema Prisma; no es una migración lista. IDs UUID/ULID, timestamps UTC, fechas de negocio con zona explícita. No usar nombres visibles como identificadores. Todos los IDs externos tienen namespace de cuenta/canal.

## Entidades

| Entidad | Campos esenciales y relación |
|---|---|
| Organization | id, nombre; propietaria de la instalación |
| Company | id, organizationId, código, nombre, activo |
| Employee | id, estado, legajo, alcances autorizados |
| EmployeePhone | employeeId, waUserId/E164 normalizado, verifiedAt, activo |
| AdminUser | id, email normalizado, hash/SSO, estado, MFA |
| Session | hash de token, userId, expiresAt, revokedAt |
| RoleAssignment | userId, permiso/rol, alcance de empresas |
| Contact | id, email normalizado, nombre, companyId, clasificaciones permitidas, activo, blockedAt |
| RecipientGroup | id, companyId, miembros; relación explícita ContactGroupMember |
| Flow | id, nombre, activo, activeVersionId |
| FlowDraft | flowId, definition JSONB, layout JSONB, revision, updatedBy |
| FlowVersion | flowId, version, definition JSONB, contentHash, publishedBy, publishedAt |
| RoutingRuleVersion | ruleSetId, versión, condiciones declarativas, targetGroupIds, estado |
| Conversation | channelId, senderId, employeeId, estado, lockVersion, lastInboundAt |
| Submission | conversationId, flowVersionId, ruleSetVersionId, companyId, currentNodeId, status, expiresAt |
| Answer | submissionId, nodeId, executionInstanceId, variable, valor tipado, fuente |
| MessageEvent | cuenta/canal, externalEventKey, tipo, receivedAt, providerTimestamp, payload mínimo, estado |
| Document | submissionId, storageKey, sha256, tamaño, MIME declarado/real, scanStatus, expiresAt |
| Delivery | submissionId, actionKey, estado, recipientsSnapshot, contentSnapshot, ruleSnapshot, providerId |
| DeliveryAttempt | deliveryId, intento, inicio/fin, resultado/error sanitizado |
| Job | tipo, referencia, estado, attempt, runAfter, leaseUntil, leaseOwner, fencingToken |
| OutboxAction | logicalKey, tipo, payload mínimo, estado, dependencyActionId |
| AuditEvent | actor, acción, recurso, timestamp, correlación, metadatos sin documentos |

El conjunto de reglas se versiona y se fija en Submission al iniciar. Resolución de destinatarios: versión de reglas fijada + miembros de contactos/grupos actuales al resolver, luego snapshot inmutable en Delivery. Bloqueos urgentes se revalidan al ejecutar. No confundir revertir regla con editar una entrega pendiente.

## Invariantes y restricciones

- FlowVersion única (flowId, version), solo inserción. Hash garantiza detectar modificación accidental; no sustituye permisos.
- FlowDraft revisión optimista y un borrador por flujo V1.
- MessageEvent única (channelId, externalEventKey); separar key para mensaje y key para cada estado externo.
- OutboxAction.logicalKey y Delivery.actionKey únicas en su namespace.
- Una Submission activa por Conversation V1: índice parcial sobre estados activos y transacción de creación.
- Un teléfono activo no se vincula simultáneamente a dos empleados del mismo ámbito.
- Document pertenece a Submission; DeliveryDocument no puede referenciar documentos de otro trámite.
- Contactos y grupos deben pertenecer a la empresa/organización autorizada. Comprobar en transacción y constraints posibles; no confiar en IDs del cliente.
- Bloquear borrado duro de versiones usadas, empleados/contactos referenciados y entregas; desactivar y purgar según política.

## Estados

Document: RECIBIDO, CUARENTENA, ANALIZANDO, APROBADO, RECHAZADO, ANALISIS_INCIERTO, ELIMINADO.

Delivery: PENDIENTE, PROCESANDO, ACEPTADO_POR_PROVEEDOR, ENTREGADO, REBOTADO, FALLIDO, RESULTADO_INCIERTO, BLOQUEADO.

Job: READY, RUNNING, RETRY_SCHEDULED, SUCCEEDED, DEAD, CANCELLED. El worker vencido no puede completar/reescribir usando un fencingToken antiguo.

Conversation registra el canal; Submission registra el trámite. COMPLETADA significa que se completó el recorrido al nivel configurado (en V1: correo aceptado), no que el destinatario leyó el correo. Eventos tardíos no hacen retroceder ENTREGADO a PENDIENTE.

## Índices y límites

Jobs por estado+runAfter+priority; leaseUntil para recuperar. Trámites por companyId+status+createdAt+id. Conversaciones por channelId+senderId. Entregas por submissionId+status. Eventos por cuenta+clave externa. Paginación por cursor con orden total timestamp+ID.

Pool con límite por proceso y total de conexiones calculado con todas las réplicas. No guardar binarios en BD ni payloads ilimitados en JSONB. Conservar timestamps de proveedor y recepción para diagnóstico; las reglas de orden son del motor, no un ORDER BY timestamp ciego.

## Migraciones

En producción aplicar migraciones versionadas revisadas, nunca db push. Probar en base vacía y copia aislada. Estrategia expand/contract para campos usados por API/worker de versiones diferentes. Seed de demo solo local, idempotente y prohibido por guard de entorno en producción.
