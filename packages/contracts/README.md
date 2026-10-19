# @sistema-chatbot/contracts

Contratos internos con tipos TypeScript y validación en tiempo de ejecución (Zod): eventos normalizados, vinculación del host, errores y DTO iniciales.

- **Dependencias:** solo `@sistema-chatbot/flow-schema` (ADR-001). Reutiliza sus códigos de validación, identificadores y formatos de identidad; `flow-schema` nunca depende de este paquete.
- **Entorno:** no usa APIs de Node, así que sirve también al panel.

**Validar un contrato no prueba autenticidad, autorización, idempotencia, concurrencia ni persistencia.** Esas garantías son de etapas posteriores (P1-T3 en adelante, P2, P4, P5 y P6).

## Eventos

Cada evento declara su origen en `source`. Son contratos internos normalizados: no son payloads de Meta. El mapeo real y la verificación del BSUID son de P6.

| Origen | Esquema | `kind` |
|---|---|---|
| `ADAPTER` (canal) | `adapterEventSchema` | `OPTION_SELECTED`, `TEXT_RECEIVED`, `FILE_RECEIVED`, `PROMPT_ACTION` |
| `JOB` (trabajos internos) | `jobEventSchema` | `DOCUMENT_DOWNLOAD_RESULT`, `DOCUMENT_SCAN_RESULT`, `DISPATCH_STARTED` |
| `SIMULATOR` | `simulatorEventSchema` | `OPTION_SELECTED`, `TEXT_RECEIVED`, `PROMPT_ACTION`, `FILE_METADATA_SIMULATED`, `SCAN_RESULT_SIMULATED` |

**Adaptador:**
- Lleva las identidades del remitente con su ámbito (ADR-011), los ids del proveedor y `receivedAt`.
- No admite `employeeId`, `companyId`, autorización ni datos de vinculación: los objetos son estrictos.
- `providerTimestamp` es obligatorio en opciones, texto y acciones de prompt, porque esas entradas pueden fijar el ancla de un pedido de archivo. Es opcional únicamente en `FILE_RECEIVED`: así, un archivo sin timestamp queda representado para que el host lo diagnostique como `FILE_NOT_CORRELATED`; no se descarta ni se inventa una fecha.

**`PROMPT_ACTION`** se valida según la acción. Las referencias vienen codificadas en el botón que emitió el servidor: el host las verifica contra su registro del prompt.

| Acción | Referencias |
|---|---|
| `CONFIRM`, `REPLACE` | `documentId` obligatorio |
| `CHOOSE` | `candidateId` obligatorio |
| `CANCEL` | sin referencias a documentos |

Un "sí" escrito es `TEXT_RECEIVED`, nunca una confirmación.

**Trabajos:** conservan la referencia fijada al crear el trabajo: `jobId`, `submissionId`, `generation`, y `documentId` o `deliveryId`. Un `DOCUMENT_SCAN_RESULT` con `REJECTED` exige `rejectionReason` (`MALWARE`, `TYPE_MISMATCH` o `ENCRYPTED`, ADR-007).

**Simulador:**
- Cada evento lleva `simulationId`.
- El cliente envía `simulationEventRequestSchema` (solo el contenido). `toSimulatorEvent` agrega `source`, `simulationId`, `eventId` y `occurredAt` del servidor.

**Entradas por origen:**
- `parseProductionInboundEvent` acepta solo `ADAPTER` y rechaza cualquier evento con `simulationId` (`SOURCE_NOT_ALLOWED`).
- `parseSimulatorEvent` acepta solo `SIMULATOR`.
- `parseJobEvent` acepta solo `JOB`.

Es una separación de contratos: la protección efectiva del host y del despliegue todavía no existe.

**Vinculación** (`boundEventSchema`):
- El host agrega `binding` aparte del evento: `outcome`, `submissionId`, `generation`, `contextRevision`, `boundAt`, `employeeId` resuelto y diagnóstico (ADR-014 §12).
- `NOT_BOUND` no lleva trámite.
- Un resultado interno solo puede vincularse al trámite y a la generación de su trabajo.

La inmutabilidad y la persistencia de la vinculación son de P2.

## Errores

Cuatro catálogos distintos:

- **Errores de la API** (`apiErrorResponseSchema`): `code`, `message` (hasta 500 caracteres), `requestId` y `details` tipados. Solo `REQUEST_INVALID`, `FLOW_INVALID` y `DRAFT_REVISION_CONFLICT` llevan `details`; el resto los rechaza. `apiErrorStatus` da el estado HTTP. Códigos y estados en `docs/05_CONTRATOS_API.md`.
- **Diagnósticos del motor** (`engineDiagnosticSchema`): los 12 códigos de docs/05. `FILE_NOT_CORRELATED` exige su motivo (`MISSING_PROVIDER_TIMESTAMP` o `NOT_AFTER_FILE_REQUEST_ANCHOR`).
- **Motivos de bloqueo de entrega** (`deliveryBlockReasonSchema`): los 7 de ADR-012.
- **Problemas de validación de definiciones:** los códigos de `flow-schema` (`ISSUE_CODES`), sin duplicarlos.
  - `toValidationIssueDto` y `toValidationReport` conservan código, documento (`FLOW`, `RULE_SET` con índice e id, `DIRECTORY`), ruta y nodo.
  - El informe tiene hasta 500 problemas, con `totalIssues` y `truncated`.
  - `details` pasa por una lista permitida con tipos y tamaños acotados. Quedan fuera `contactId`, `ownerEmployeeId` y `scopeId`, que identifican personas o ámbitos.

## DTO

**Implementados:**

| Recurso | Request | Response |
|---|---|---|
| GET /flows/:id/draft | — | `flowDraftResponseSchema` |
| PUT /flows/:id/draft | `flowDraftUpdateRequestSchema` | `flowDraftUpdateResponseSchema`; conflicto: `DRAFT_REVISION_CONFLICT` |
| POST /flows/:id/validate | `flowValidationRequestSchema` | `flowValidationResponseSchema` |
| POST /flows/:id/publish | `flowPublishRequestSchema` (revisión + `contentHash`) | `flowPublishResponseSchema`; problemas: `FLOW_INVALID` |
| POST /simulations/:id/events | `simulationEventRequestSchema` | pendiente |

El borrador es un objeto JSON sin validar: un borrador incompleto se puede guardar, y se valida con `flow-schema` al validar o publicar. El tamaño del cuerpo lo limita la API (413).

**Pendientes:**
- respuesta de eventos de simulación (trace del motor);
- creación y estado de simulaciones;
- autenticación;
- listados, versiones y activación de flujos;
- contactos, grupos, reglas, catálogo, empleados e identidades;
- vista previa de clasificación;
- trámites, descargas y reintentos;
- payloads reales de Meta y del correo;
- mensajes no admitidos, reacciones y estados de mensajes salientes.

## Comandos

Desde la raíz del repositorio:

```sh
pnpm --filter @sistema-chatbot/contracts run typecheck
pnpm --filter @sistema-chatbot/contracts run test
pnpm --filter @sistema-chatbot/contracts run build
```

Typecheck y pruebas usan las fuentes de `flow-schema` (condición `@sistema-chatbot/source` en `exports`), sin build previo. El build usa `dist`: `pnpm run build` compila en orden de dependencias.
