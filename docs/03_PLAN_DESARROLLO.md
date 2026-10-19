# Plan de desarrollo por entregas

Las etapas de este archivo descomponen las de la arquitectura en P0–P7; son el identificador operativo para el seguimiento. No se estiman fechas sin conocer equipo, dedicación e integraciones. No saltar pruebas de invariantes para acelerar pantallas.

## P0 — Definición y decisiones

Leer kit; confirmar flujo inicial y permisos; comprobar compatibilidad de dependencias; revisar hosting y proveedor futuro de correo; decidir identificación, retención y alcance. Crear ADR de stack, cola, autenticación y DSL. Si faltan datos, usar fixtures para prototipo y marcar decisiones temporales.

Salida: plan de carpetas, matriz de permisos, contratos revisados, esquema de flujo V1 acordado y bloqueos separados. No conectar servicios ni generar una aplicación completa todavía.

## P1 — Base local y contratos

Crear monorepo apps/admin, apps/api, apps/worker y packages/domain, flow-schema, flow-engine, contracts, adapters. Configurar TS estricto, lint/format, lockfile, scripts y CI mínima. Entorno local PostgreSQL, almacenamiento privado y capturador de correo. Esquemas de mensajes, variables, flujos y errores. Migración mínima y seed idempotente ficticio. Autenticación local con sesiones para panel desde que haya endpoints administrativos.

Salida: instalar desde checkout limpio, arrancar local, migrar y ejecutar checks documentados. Ningún secreto ni envío real. Archivo README de comandos reales; no listar scripts inexistentes como verificados.

## P2 — Motor, estado y durabilidad

Implementar selección/captura/archivo/condición/acción/fin, intérprete puro y action sink. Crear Conversation, Submission, Event, Job, Outbox y persistencia. Serialización por conversación, IDs estables, claves únicas, lease, intentos y recuperación. Separar transición de ejecución de efectos. Integrar fixture de ejemplo con pruebas.

Salida: recorrido completo por API/test harness, deduplicación, concurrencia, botón viejo, restart, outbox atómica y lease vencido probados. Trámites conservan versión. No sustituir cola por setTimeout o memoria.

## P3 — Editor y simulador

Canvas con nodos, inspector, conexiones, variables y validación. Simulador con trace y reinicio. Carga de archivo simulado con action sink; mostrar correo previsto y regla aplicada. Persistir borradores usando revisión optimista. El frontend no ejecuta una segunda lógica de negocio: manda eventos al motor de simulación aislado.

Salida: usuario edita flujo, corrige validación, lo recorre y ve acciones de ejemplo. Prueba de bloqueo de envío real desde simulación. Demo explícitamente local, no WhatsApp real.

## P4 — Administración y publicación

Roles y permisos completos, directorio, contactos/grupos, reglas, MFA o SSO definido, publicación atómica, historial y revertir. Validaciones semánticas/límites del canal y permisos de destinatarios. Auditoría, lista de trámites y descargas autorizadas. ETag/revisión para evitar que dos editores sobrescriban cambios.

Salida: V1/V2 conviven en trámites; roles negativos probados; publicación fallida no modifica activo; reglas conflictivas bloquean; contacto bloqueado detiene entrega pendiente. Demo no se convierte en admin público.

## P5 — Documentos y correo

Adaptador de storage, descarga limitada, cuarentena, tipo real, análisis antimalware, política de archivos no analizables. Resolver snapshot de destinos al crear Delivery. Ejecutar entrega durable; reconciliar idempotencia y estados. Primero capturador local, luego proveedor de prueba/allowlist autorizado.

Salida: adjunto correcto, rechazos/malware, caídas del escáner, timeout incierto, rebote y reinicio probados. Correo aceptado y entregado diferenciados. Ningún archivo pendiente se distribuye.

## P6 — WhatsApp de prueba

Configurar cuenta/recursos de Meta con propietario, webhook HTTPS, tokens de servidor, firma y eventos normalizados. Envío de listas/botones con límites del canal, media, ventana de atención y estados. Pruebas reales solo con teléfonos/correos habilitados. No integrar SDK archivado como dependencia.

Salida: desde celular, preguntas → archivo → validación → correo en casilla controlada → confirmación, con IDs correlacionados. Documentar qué limita el entorno de Meta y qué aún requiere producción.

## P7 — Endurecimiento y lanzamiento

Permisos/MFA, escáner operativo, backup/restore, carga, alertas, reglas de retención, runbooks, revisión de secretos y dependencias. Dimensionar API, worker, BD y scanner. Verificar dominio de correo/SPF/DKIM/DMARC, canal y cuenta empresarial. Configurar número propio, acceso y operación solo cuando esté autorizado.

Salida: gate de producción aprobado con evidencia de tests y restore. RPO/RTO acordados, monitoreo activo, responsable de incidentes, rollback probado. Piloto con pocos empleados antes de ampliar.

## Disciplina por etapa

Inicio: alcance, dependencias y criterio de salida. Ejecución: cambios coherentes y pruebas de comportamiento. Cierre: evidencia, limitaciones y estado. Una aprobación de P2 no autoriza construir P3–P7 completos ni contratar proveedores.

## Vertical mínimo antes de integraciones

Al cerrar P4 debe existir editor → versión publicada → simulador → archivo simulado → destinos → correo visualizado, con permisos y durabilidad. No afirmar que esta entrega descarga media de Meta ni analiza malware real.
