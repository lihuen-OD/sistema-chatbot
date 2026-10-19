# Seguridad y privacidad

Objetivo: impedir distribución indebida, falsificación de eventos, acceso cruzado, ejecución de código y filtración de documentos. Las medidas requieren implementación y verificación; no son una certificación.

## Modelo de amenazas

| Amenaza | Control | Prueba |
|---|---|---|
| Evento WhatsApp falsificado | HMAC sobre raw body, comparación segura, cuenta permitida | Firma ausente/incorrecta no genera trabajo |
| Replay de evento firmado | Clave única e idempotencia | Replay concurrente crea una acción |
| Empleado elige empresa ajena | Directorio y scopes en backend | Opción manipulada devuelve rechazo |
| Robo de sesión admin | Cookies seguras, MFA, revocación y expiración | Sesión revocada deja de operar |
| CSRF/XSS | CSRF, CSP, escaping, plantillas limitadas | Mutación sin token y HTML malicioso bloqueados |
| IDOR de documento | Permiso documental por recurso | Usuario de empresa B no descarga A |
| Malware/disfraz de archivo | Bytes reales, scanner, cuarentena | Archivo detectado nunca se distribuye |
| SSRF al descargar | URL desde adaptador, allowlist/redirecciones/red interna | URL privada/redirección hostil bloqueada |
| Destinatario arbitrario | Contactos autorizados, no correo libre de empleado | Correo en texto no cambia destino |
| Secretos filtrados | Gestor de secretos y logs redactados | Escaneo de repositorio/logs |
| Abuso del bot | Límites de tasa, tamaño y cola | Usuario abusivo no agota recursos |
| Flujo malicioso | DSL sin ejecución de código y permiso de publicar | Script/URL arbitrario no se acepta |
| Vinculación indebida de identidad | Identidades con ámbito; BSUID solo con teléfono activo en evento firmado o aprobación admin; conflicto a revisión (ADR-011) | T30: identidad de otro empleado no abre ni avanza trámites |
| Relajación indebida de clasificación | Permiso `classification.relax`, vista previa con hash, motivo, auditoría, sin efecto retroactivo (ADR-012) | T32: relajación sin permiso rechazada; trámites en curso conservan restricción |
| Envío a destinatario no autorizado por configuración | Cobertura de reglas al publicar y resolución fail-closed al ejecutar (ADR-012) | T11/T33: sin envío parcial ni grupo de respaldo |

## Autenticación administrativa

Sesión opaca con token aleatorio de alta entropía; persistir hash, no token. Login con Argon2id y parámetros revisados según capacidad. Rate limit por usuario/red, errores sin enumeración y revocación. Cookie HttpOnly, Secure y SameSite apropiado; CSRF para cookie auth. CORS no sustituye auth. No guardar tokens de sesión en localStorage.

MFA obligatorio para admin/publicador en producción o SSO empresarial con exigencia equivalente. Recuperación MFA con códigos protegidos y procedimiento auditado. Desactivar usuario revoca sesiones. Cookies/login local no son excusa para dejar endpoints de demo públicos.

## Identidad de empleados

Empleado canónico con identidades de canal (ADR-011). Enrolar teléfonos desde directorio autorizado. Un BSUID se vincula automáticamente solo si llega en un evento firmado junto a un teléfono activo del mismo empleado y no está activo en otro; si no, requiere aprobación administrativa. Las identidades se comparan dentro de su ámbito. Un conflicto entre identidades bloquea el avance y va a revisión; nunca se revincula de forma automática. El legajo escrito no prueba identidad. Para material sensible, definir verificación adicional con cuenta/canal empresarial (pendiente antes de usar datos reales sensibles). Cambio de número requiere proceso y revoca vínculo anterior. Evitar revelar existencia de legajos a remitentes no autorizados.

## Permisos

Matriz de permisos sobre acciones y empresas. Editor no puede publicar salvo permiso. Operador no ve certificados salvo permiso documental. Contactos y grupos tienen clasificaciones habilitadas; la clasificación de cada tipo la define el catálogo y el trámite conserva la aplicada. Cambios que relajan restricciones exigen `classification.relax`, motivo, vista previa de impacto y auditoría; endurecer se aplica de inmediato (ADR-012). Decisión pendiente antes de P4: exigir una segunda aprobación para relajar. Revalidar estado del empleado, contacto y credenciales antes de efectos externos. Denegar por defecto y no confiar en ocultar botones.

## Documentos

V1 PDF/JPG/PNG con límites; firmas/MIME reales y archivo completo limitado. Rechazar contenido no analizables según política, nombres peligrosos y extensiones no permitidas. Para imágenes, evaluar decodificar/re-encode en proceso aislado según uso. Archivos cifrados que el scanner no pueda inspeccionar quedan rechazados o revisión explícita, nunca aprobados automáticamente.

Antimalware en proceso/servicio aislado con actualización y límites de CPU/memoria/tiempo. Si falla, estado pendiente/incierto. La simulación debe etiquetar scanner falso; producción no acepta ese adaptador. Los controles de archivos se verifican con bytes reales en P5; el simulador por metadatos no cuenta como evidencia (ADR-005).

Los candidatos no seleccionados se purgan según ADR-014 (los rechazados, al registrarse el resultado; los reemplazados o descartados, 24 h después del cierre del trámite), y se conservan solo metadatos. El nombre de archivo del empleado es dato no confiable: se escapa y se trunca al mostrarlo en la revisión y en el panel, y nunca se usa como clave de almacenamiento. Un archivo fuera de paso o posterior al inicio del despacho no se descarga.

Objetos privados, claves aleatorias sin datos personales. Autorización previa a links temporales; logs de acceso sin URL firmada. Adjuntos MIME codificados aumentan tamaño; limitar total antes de enviar. Para alta sensibilidad considerar portal autenticado en lugar de adjuntos irreversibles.

## Integraciones y red

Tokens Meta con mínimos permisos y rotation; API no devuelve secretos. Credenciales de correo solo worker. Inyección de cabeceras: el asunto de la plantilla no admite CR ni LF (P1-T1). El renderizado y el adaptador de correo vuelven a validar el asunto interpolado y codifican las cabeceras (P5, T53). HTTPS. Validar webhook del correo según proveedor. Timeouts, límites y salida a hosts autorizados. Configuración de Graph API versionada con actualización controlada. No confiar únicamente en IP allowlists; firma es esencial.

## Privacidad y retención

Clasificar documentos, registrar finalidad, accesos y plazos. Propuesta inicial 30 días debe aprobarse; metadatos/auditoría pueden requerir plazo distinto. Definir eliminación de objetos, backups y payloads. Limitar payloads crudos y redactar logs. Revisar obligaciones aplicables con responsable de datos antes del lanzamiento; este kit no es asesoría legal.

## Auditoría

Registrar actor, acción, ámbito, recurso, revisión previa/nueva, fecha y requestId; no archivo ni secreto. Append-only de aplicación con acceso restringido. Para resistencia contra administradores de BD comprometidos se requiere exportación externa/inmutabilidad adicional; no llamar inviolable a una tabla local.

## Gate de seguridad

Verificar permisos negativos, firma, CSRF, secretos, dependencias, manejo de archivos, antimalware, desactivación y aislamiento de simulación. Cerrar hallazgos críticos/altos o aceptar explícitamente el riesgo con dueño y fecha; no esconderlos en un TODO.
