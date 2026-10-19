# Pruebas y evidencia de aceptación

Cada entrega registra comandos reales y resultados; no inventar conteos. Pruebas unitarias del motor, integración con PostgreSQL real aislado, E2E del panel y conectores reales en staging autorizado. Tests con mocks no prueban comportamiento del proveedor. El simulador por metadatos de archivo (P3) no prueba subida, almacenamiento ni análisis: T13–T16 se cumplen solo con bytes reales en entorno aislado (ADR-005).

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
| T13 | Archivo fuera de paso | No se vincula a otro trámite |
| T14 | MIME/bytes/extensión inconsistentes | Rechazo seguro |
| T15 | Archivo grande/stream infinito | Límite corta descarga y recursos |
| T16 | Malware/scanner caído | Sin distribución; rechazo/pendiente correcto |
| T17 | Usuario B descarga documento A | Denegado, no URL firmada |
| T18 | Simulación intenta correo real | Bloqueado por construcción/configuración |
| T19 | Firma ausente/manipulada + replay | Rechazo de falsificación; replay deduplicado |
| T20 | Sesión revocada/CSRF/rol editor publica | Denegado por backend |
| T21 | Límite 429 y Retry-After | Reintento acotado sin tormenta |
| T22 | Ventana WhatsApp vence en cola | No envía mensaje libre indebido; queda `HELD_WINDOW_CLOSED` y sale con la próxima entrada |
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

## Flujo E2E inicial

Login editor → crear flujo → simular ambas ramas → corregir error → publicar → iniciar trámite V1 → publicar V2 → terminar V1 → comprobar grupo y correo capturado → consultar auditoría. P6 repite ruta desde celular con Meta y correo controlado.

## Carga

Escenario provisional: 100 conversaciones activas, 10 eventos/segundo durante 5 minutos, mezcla de opciones y documentos. Medir percentiles, memoria, conexiones, tamaño/edad de cola y throughput de scanner/correo. Repetir solo si cambian cuellos de botella o fallan objetivos. Objetivos iniciales: webhook p95 <1s, consultas simples p95 <500ms, respuesta bot sin archivos p95 <3s cuando proveedores están sanos. Son metas a validar, no garantías.

## Gate por etapa

P1 instalación limpia/checks/seed seguro + validación de esquema de T02/T33/T34 (sin base ni motor) y restricciones de base de T29; P2 T01–T10/T29/T31/T34 (motor); P3 T02/T06/T18/T25/T34 (simulador); P4 T03/T11/T12/T17/T20/T26/T30/T32/T33; P5 T10/T13–T16/T23/T28/T31 con archivos reales y adaptadores; P6 T19/T21/T22 + E2E real; P7 T24/T27, carga y revisión de seguridad completa. Revisar catálogo según cambios.

## Formato de evidencia

Fecha, commit, entorno, comando, resultado, IDs de pruebas, limitaciones, enlace/ruta del reporte sanitizado. Capturas sin documentos sensibles. Un gate fallido bloquea la declaración de etapa completa; explicar qué funciona y qué falta.
