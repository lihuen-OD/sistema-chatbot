# Pruebas y evidencia de aceptación

Cada entrega registra comandos reales y resultados; no inventar conteos. Pruebas unitarias del motor, integración con PostgreSQL real aislado, E2E del panel y conectores reales en staging autorizado. Tests con mocks no prueban comportamiento del proveedor. El simulador por metadatos de archivo (P3) no prueba subida, almacenamiento ni análisis: T13–T16 se cumplen solo con bytes reales en entorno aislado (ADR-005).

Estado al 19/10/2026: ninguna prueba de este catálogo se ejecutó, porque todavía no hay implementación. Los IDs existentes se conservan; T35–T45 se agregaron con ADR-014.

## Catálogo mínimo

| ID | Caso | Resultado requerido |
|---|---|---|
| T01 | Flujo A/B + factura/certificado | Ruta, variables y grupo esperado |
| T02 | Definición inválida/ciclo/nodo huérfano | Publicación rechazada con error por nodo |
| T03 | Publicar V2 con trámite V1 | V1 conserva definición y ruleSet |
| T04 | Evento idéntico repetido/concurrente | Una transición y una acción lógica |
| T05 | Dos respuestas distintas simultáneas | Sin pérdida de estado ni mezcla de pasos |
| T06 | Botón antiguo o opción manipulada | No cambia paso actual |
| T07 | Caída después de persistir inbox | Worker recupera trabajo |
| T08 | BD cae antes de commit del webhook | Sin ACK exitoso y sin efecto externo |
| T09 | Dos workers + lease vencido | Un dueño válido; fencing rechaza viejo |
| T10 | Efecto externo aceptado + caída local | Conciliación o incierto, no éxito inventado |
| T11 | Destinatario ausente, ambiguo o no autorizado | Sin correo, entrega `BLOCKED` con código, revisión visible y sin envío parcial |
| T12 | Contacto bloqueado después de planificar | Entrega detenida auditada |
| T13 | Archivo fuera de paso | No se descarga ni se vincula a otro trámite; se explica el paso esperado (`FILE_OUT_OF_STEP`) |
| T14 | MIME/bytes/extensión inconsistentes | Rechazo seguro |
| T15 | Archivo grande/stream infinito | Límite corta descarga y recursos |
| T16 | Malware/scanner caído | Sin distribución; rechazo/pendiente correcto |
| T17 | Usuario B descarga documento A | Denegado, no URL firmada |
| T18 | Simulación intenta correo real | Bloqueado por construcción/configuración |
| T19 | Firma ausente/manipulada + replay | Rechazo de falsificación; replay deduplicado |
| T20 | Sesión revocada/CSRF/rol editor publica | Denegado por backend |
| T21 | Límite 429 y Retry-After | Reintento acotado sin tormenta |
| T22 | Ventana WhatsApp vence en cola | No envía mensaje libre indebido; queda `HELD_WINDOW_CLOSED`; con la próxima entrada se revalida contra el estado vigente antes de enviarse (ver T44) |
| T23 | Rebote posterior a confirmación | Delivery cambia sin falsear entrega |
| T24 | Restore en base aislada | Recuperación verificable de estado/objetos |
| T25 | Dos editores guardan/publican | Conflicto de revisión, no overwrite |
| T26 | Desactivar empleado durante trámite | Política aplicada y efectos protegidos |
| T27 | Retención/purga | Objeto eliminado, permisos y auditoría coherentes |
| T28 | SMTP/proveedor sin idempotencia | Resultado incierto no reintenta a ciegas |
| T29 | Mismo empleado escribe por teléfono y por BSUID, en concurrencia | Un solo trámite activo por empleado y número; la base rechaza el segundo |
| T30 | Identidad activa en otro empleado, o evento con identidades de empleados distintos | Sin trámite ni avance, incidencia de revisión, sin revinculación automática |
| T31 | SIGTERM con llamada externa en curso, y terminación forzada antes de registrar | Lease no liberado; recuperación con fencing; intento `DISPATCHING` conciliado o `UNCERTAIN`; resultado tardío guardado sin cambiar estado |
| T32 | Cambio de clasificación durante un trámite (relajar y endurecer) | El trámite conserva la clasificación aplicada; relajar sin permiso se rechaza; endurecer bloquea la entrega pendiente no autorizada |
| T33 | Reglas con hueco, solapamiento, grupo de otra empresa o límite excedido | Publicación rechazada con el código y la combinación afectada |
| T34 | Opciones dinámicas: sin opciones, exceso sobre el límite, opción manipulada | Ruta `onEmpty`; publicación rechazada o `NEEDS_REVIEW` sin truncar; opción no autorizada rechazada |
| T35 | Archivo A y después archivo B sin pulsar Reemplazar (en validación, en revisión y con entrega `PENDING` antes del despacho) | B queda `PENDING_CHOICE`; se pide elegir; la revisión aumenta; la confirmación o entrega pendiente de A queda inválida o `CANCELLED`; no hay sustitución silenciosa |
| T36 | Texto inesperado entre archivos, incluido "sí" escrito en revisión | Se re-presenta el prompt vigente; no cambian estado, candidatos ni revisión; el texto no confirma; al llegar al límite, un aviso final y sin bucle |
| T37 | Confirmación vieja (otra revisión, otro archivo u otro trámite) o repetida | Vieja: `CONFIRMATION_STALE`, sin entrega. Repetida: `CONFIRMATION_ALREADY_USED`; una confirmación por revisión y una entrega por confirmación |
| T38 | Reemplazar mientras se analiza A | A pasa a `SUPERSEDED`; se pide el nuevo archivo; B se valida y requiere su propia confirmación; nada de A habilita el envío |
| T39 | Resultado tardío del análisis de A (A reemplazado, descartado o de un trámite terminado) | Se registra en A; no selecciona, no cambia el estado del trámite ni habilita envío; malware igual genera alerta |
| T40 | Confirmar compite con Reemplazar o Cancelar, y estos compiten con el inicio del despacho | Un único resultado serializado según la tabla de ADR-014 §6; después del punto de no retorno, `DISPATCH_ALREADY_STARTED` sin promesas retroactivas; nunca dos entregas |
| T41 | Reiniciar con eventos pendientes del trámite anterior (descarga, análisis, botones, retenidos) | El trámite anterior queda `CANCELLED`; ningún evento suyo se vincula al nuevo; sus botones dan `PROMPT_STALE`; reiniciar después del inicio del despacho se rechaza |
| T42 | Archivo recibido después de iniciar el despacho | No se descarga ni se adjunta; mensaje veraz con el archivo confirmado; se ofrece corrección al terminar |
| T43 | Corrección después de un envío aceptado | Trámite `CORRECTION` vinculado al original; correo con marca de corrección no removible; original intacto; plazo y máximo respetados; destinatarios distintos señalados al operador |
| T44 | Mensajes retenidos de trámites cancelados o vencidos, y prompts retenidos de un trámite vigente | Al reabrirse la ventana: retenidos de trámites terminados descartados (a lo sumo un aviso del estado final); ningún prompt obsoleto reproducido; prompt vigente con `promptId` nuevo |
| T45 | Límites del paso documental y purga | Cuarto archivo rechazado sin descarga (`CANDIDATE_LIMIT_REACHED`); límite de revisiones solo ofrece Confirmar/Cancelar; objetos de candidatos no seleccionados purgados en plazo, con metadatos conservados |

## Flujo E2E inicial

Login editor → crear flujo → simular ambas ramas → corregir error → publicar → iniciar trámite V1 → enviar archivo A, enviar B, elegir B, confirmar → publicar V2 → terminar V1 → comprobar grupo, adjunto B y correo capturado → corregir el envío y comprobar el vínculo → consultar auditoría. P6 repite ruta desde celular con Meta y correo controlado.

## Carga

Escenario provisional: 100 conversaciones activas, 10 eventos/segundo durante 5 minutos, mezcla de opciones y documentos. Medir percentiles, memoria, conexiones, tamaño/edad de cola y throughput de scanner/correo. Repetir solo si cambian cuellos de botella o fallan objetivos. Objetivos iniciales: webhook p95 <1s, consultas simples p95 <500ms, respuesta bot sin archivos p95 <3s cuando proveedores están sanos. Son metas a validar, no garantías.

## Gate por etapa

| Etapa | Pruebas del gate |
|---|---|
| P1 | Instalación limpia, checks y seed seguro. Validación de esquema de T02/T33/T34 y de `review` obligatorio y sin nodos de captura entre `file` y `email` (sin base ni motor). Restricciones de base de T29 y de candidatos, confirmación y entrega única de T37/T45 |
| P2 | T01–T10, T29, T31, T34 y T35–T41 (motor y host con ejecutores simulados) |
| P3 | T02, T06, T18, T25, T34 y T35–T37 (simulador) |
| P4 | T03, T11, T12, T17, T20, T26, T30, T32, T33 y T43 (vista y vínculo de correcciones) |
| P5 | T10, T13–T16, T23, T28, T31, T38–T40, T42 y T45 con archivos reales y adaptadores |
| P6 | T19, T21, T22, T44 + E2E real |
| P7 | T24, T27, T45 (purga en operación), carga y revisión de seguridad completa |

Revisar el catálogo según cambios.

## Formato de evidencia

Fecha, commit, entorno, comando, resultado, IDs de pruebas, limitaciones, enlace/ruta del reporte sanitizado. Capturas sin documentos sensibles. Un gate fallido bloquea la declaración de etapa completa; explicar qué funciona y qué falta.
