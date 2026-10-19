# Plan de desarrollo por entregas

Las etapas de este archivo descomponen las de la arquitectura en P0–P7; son el identificador operativo para el seguimiento. No se estiman fechas sin conocer equipo, dedicación e integraciones. No saltar pruebas de invariantes para acelerar pantallas.

## P0 — Definición y decisiones

Leer kit; confirmar flujo inicial y permisos; comprobar compatibilidad de dependencias; revisar hosting y proveedor futuro de correo; decidir identificación, retención y alcance. Crear ADR de stack, cola, autenticación y DSL. Si faltan datos, usar fixtures para prototipo y marcar decisiones temporales.

Salida: plan de carpetas, matriz de permisos, contratos revisados, esquema de flujo V1 acordado y bloqueos separados. No conectar servicios ni generar una aplicación completa todavía.

Estado al 19/10/2026: documentado en `docs/15_PLAN_CONSOLIDADO_P0.md` y `docs/adr/` (ADR-001 a ADR-013). P0 se cierra al aprobar y fusionar su PR. Se cierra con fixtures ficticios: confirmar el recorrido, los contactos y el catálogo reales pasa a ser condición previa del piloto.

## P1 — Base local y contratos

Desglose en tareas P1-T1 a P1-T6 y alcance de P1-T1 en `docs/15_PLAN_CONSOLIDADO_P0.md` §9. Al iniciar, verificar y registrar versiones exactas (ADR-009).

Crear monorepo apps/admin, apps/api, apps/worker y packages/domain, flow-schema, flow-engine, contracts, db, adapters (ADR-001). Configurar TS estricto, lint/format, lockfile, scripts y CI mínima. Entorno local PostgreSQL, almacenamiento privado y capturador de correo. Esquemas de mensajes, variables, flujos, reglas (con cobertura y límites) y errores. Migraciones SQL con Kysely + pg (ADR-010), incluidas las restricciones de identidad activa única y trámite activo único por empleado y número. Seed idempotente ficticio. Autenticación local con sesiones para panel desde que haya endpoints administrativos.

Salida: instalar desde checkout limpio, arrancar local, migrar y ejecutar checks documentados. Ningún secreto ni envío real. Archivo README de comandos reales; no listar scripts inexistentes como verificados.

## P2 — Motor, estado y durabilidad

Implementar selección (estática y dinámica)/captura/archivo/condición/acción/fin, intérprete puro y action sink. Crear Conversation, Submission, Event, Job, Outbox y persistencia. Resolución de identidad al empleado canónico (ADR-011). Serialización por número + empleado, IDs estables, claves únicas, lease con fencing, intentos en dos fases, apagado ordenado sin liberar llamadas externas en curso, recuperación y conciliación (ADR-002). Decidir implementación propia o biblioteca de cola con addendum de ADR-002. Separar transición de ejecución de efectos. Integrar fixture de ejemplo con pruebas.

Salida: recorrido completo por API/test harness, deduplicación, concurrencia, botón viejo, restart, outbox atómica y lease vencido probados; un solo trámite activo con dos identidades (T29) y apagado con llamada externa en curso (T31). Trámites conservan versión. No sustituir cola por setTimeout o memoria.

## P3 — Editor y simulador

Canvas con nodos, inspector, conexiones, variables y validación. Simulador con trace y reinicio. Archivo simulado por metadatos (nombre, MIME declarado, tamaño y resultado de análisis elegido) con action sink; mostrar correo previsto y regla aplicada. El archivo simulado no prueba subida, almacenamiento ni análisis reales (ADR-005). Persistir borradores usando revisión optimista. El frontend no ejecuta una segunda lógica de negocio: manda eventos al motor de simulación aislado.

Salida: usuario edita flujo, corrige validación, lo recorre y ve acciones de ejemplo. Prueba de bloqueo de envío real desde simulación. Demo explícitamente local, no WhatsApp real.

## P4 — Administración y publicación

Roles y permisos completos, directorio con identidades de canal y conflictos, catálogo documental versionado, contactos/grupos, reglas con informe de cobertura, MFA o SSO definido, publicación atómica, historial y revertir. Validaciones semánticas/límites del canal y permisos de destinatarios. Cambios que relajan clasificación con permiso `classification.relax`, vista previa de impacto, motivo y auditoría (ADR-012); decidir antes si se exige segunda aprobación. Auditoría, lista de trámites y descargas autorizadas. ETag/revisión para evitar que dos editores sobrescriban cambios.

Salida: V1/V2 conviven en trámites; roles negativos probados; publicación fallida no modifica activo; reglas con huecos o solapamientos no publican; destinatarios ausentes, ambiguos o no autorizados bloquean; contacto bloqueado detiene entrega pendiente; relajación sin permiso rechazada y sin efecto en trámites en curso (T30, T32, T33). Demo no se convierte en admin público.

## P5 — Documentos y correo

Adaptador de storage, descarga limitada, cuarentena, tipo real, análisis antimalware, política de archivos no analizables. Resolver snapshot de destinos al crear Delivery. Ejecutar entrega durable; reconciliar idempotencia y estados. Primero capturador local, luego proveedor de prueba/allowlist autorizado.

Las pruebas de archivos usan bytes reales en un entorno aislado: extensión o MIME falsos, archivo excedido o truncado, PDF cifrado, archivo de prueba EICAR y scanner caído. El simulador por metadatos de P3 no reemplaza estas pruebas (ADR-005).

Salida: adjunto correcto, rechazos/malware, caídas del escáner, timeout incierto, rebote y reinicio probados con archivos reales aislados. Correo aceptado y entregado diferenciados. Ningún archivo pendiente se distribuye.

## P6 — WhatsApp de prueba

Configurar cuenta/recursos de Meta con propietario, webhook HTTPS, tokens de servidor, firma y eventos normalizados. Verificar en documentación oficial el formato, el ámbito y la presencia del BSUID en webhooks, y los límites de listas/botones (ADR-003, ADR-011). Envío de listas/botones con límites del canal, media, ventana de atención (mensajes retenidos si está cerrada, sin plantillas en V1) y estados. Pruebas reales solo con teléfonos/correos habilitados. No integrar SDK archivado como dependencia.

Salida: desde celular, preguntas → archivo → validación → correo en casilla controlada → confirmación, con IDs correlacionados. Documentar qué limita el entorno de Meta y qué aún requiere producción.

## P7 — Endurecimiento y lanzamiento

Permisos/MFA, escáner operativo, backup/restore, carga, alertas, reglas de retención, runbooks, revisión de secretos y dependencias. Dimensionar API, worker, BD y scanner. Verificar dominio de correo/SPF/DKIM/DMARC, canal y cuenta empresarial. Configurar número propio, acceso y operación solo cuando esté autorizado.

Salida: gate de producción aprobado con evidencia de tests y restore. RPO/RTO acordados, monitoreo activo, responsable de incidentes, rollback probado. Piloto con pocos empleados antes de ampliar.

## Disciplina por etapa

Inicio: alcance, dependencias y criterio de salida. Ejecución: cambios coherentes y pruebas de comportamiento. Cierre: evidencia, limitaciones y estado. Una aprobación de P2 no autoriza construir P3–P7 completos ni contratar proveedores.

## Vertical mínimo antes de integraciones

Al cerrar P4 debe existir editor → versión publicada → simulador → archivo simulado por metadatos → destinos → correo visualizado, con permisos y durabilidad. No afirmar que esta entrega sube, guarda o analiza archivos reales, ni que descarga media de Meta.
