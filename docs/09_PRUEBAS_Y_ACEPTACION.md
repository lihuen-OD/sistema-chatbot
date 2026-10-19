# Pruebas y evidencia de aceptación

Cada entrega registra comandos reales y resultados; no inventar conteos. Pruebas unitarias del motor, integración con PostgreSQL real aislado, E2E del panel y conectores reales en staging autorizado. Tests con mocks no prueban comportamiento del proveedor.

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
| T11 | Destinatario ausente/conflictivo | Sin correo y revisión visible |
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
| T22 | Ventana WhatsApp vence en cola | No envía mensaje libre indebido |
| T23 | Rebote posterior a confirmación | Delivery cambia sin falsear entrega |
| T24 | Restore en base aislada | Recuperación verificable de estado/objetos |
| T25 | Dos editores guardan/publican | Conflicto de revisión, no overwrite |
| T26 | Desactivar empleado durante trámite | Política aplicada y efectos protegidos |
| T27 | Retención/purga | Objeto eliminado, permisos y auditoría coherentes |
| T28 | SMTP/proveedor sin idempotencia | Resultado incierto no reintenta a ciegas |

## Flujo E2E inicial

Login editor → crear flujo → simular ambas ramas → corregir error → publicar → iniciar trámite V1 → publicar V2 → terminar V1 → comprobar grupo y correo capturado → consultar auditoría. P6 repite ruta desde celular con Meta y correo controlado.

## Carga

Escenario provisional: 100 conversaciones activas, 10 eventos/segundo durante 5 minutos, mezcla de opciones y documentos. Medir percentiles, memoria, conexiones, tamaño/edad de cola y throughput de scanner/correo. Repetir solo si cambian cuellos de botella o fallan objetivos. Objetivos iniciales: webhook p95 <1s, consultas simples p95 <500ms, respuesta bot sin archivos p95 <3s cuando proveedores están sanos. Son metas a validar, no garantías.

## Gate por etapa

P1 instalación limpia/checks/seed seguro; P2 T01–T10; P3 T02/T06/T18/T25; P4 T03/T11/T12/T17/T20/T26; P5 T10/T13–T16/T23/T28; P6 T19/T21/T22 + E2E real; P7 T24/T27, carga y revisión de seguridad completa. Revisar catálogo según cambios.

## Formato de evidencia

Fecha, commit, entorno, comando, resultado, IDs de pruebas, limitaciones, enlace/ruta del reporte sanitizado. Capturas sin documentos sensibles. Un gate fallido bloquea la declaración de etapa completa; explicar qué funciona y qué falta.
