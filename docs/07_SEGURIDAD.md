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

## Autenticación administrativa

Sesión opaca con token aleatorio de alta entropía; persistir hash, no token. Login con Argon2id y parámetros revisados según capacidad. Rate limit por usuario/red, errores sin enumeración y revocación. Cookie HttpOnly, Secure y SameSite apropiado; CSRF para cookie auth. CORS no sustituye auth. No guardar tokens de sesión en localStorage.

MFA obligatorio para admin/publicador en producción o SSO empresarial con exigencia equivalente. Recuperación MFA con códigos protegidos y procedimiento auditado. Desactivar usuario revoca sesiones. Cookies/login local no son excusa para dejar endpoints de demo públicos.

## Identidad de empleados

Enrolar teléfonos desde directorio autorizado. El legajo escrito no prueba identidad. Para material sensible, definir verificación adicional con cuenta/canal empresarial. Cambio de número requiere proceso y revoca vínculo anterior. Evitar revelar existencia de legajos a remitentes no autorizados.

## Permisos

Matriz de permisos sobre acciones y empresas. Editor no puede publicar salvo permiso. Operador no ve certificados salvo permiso documental. Contactos tienen clasificaciones habilitadas. Revalidar estado del empleado, contacto y credenciales antes de efectos externos. Denegar por defecto y no confiar en ocultar botones.

## Documentos

V1 PDF/JPG/PNG con límites; firmas/MIME reales y archivo completo limitado. Rechazar contenido no analizables según política, nombres peligrosos y extensiones no permitidas. Para imágenes, evaluar decodificar/re-encode en proceso aislado según uso. Archivos cifrados que el scanner no pueda inspeccionar quedan rechazados o revisión explícita, nunca aprobados automáticamente.

Antimalware en proceso/servicio aislado con actualización y límites de CPU/memoria/tiempo. Si falla, estado pendiente/incierto. La simulación debe etiquetar scanner falso; producción no acepta ese adaptador.

Objetos privados, claves aleatorias sin datos personales. Autorización previa a links temporales; logs de acceso sin URL firmada. Adjuntos MIME codificados aumentan tamaño; limitar total antes de enviar. Para alta sensibilidad considerar portal autenticado en lugar de adjuntos irreversibles.

## Integraciones y red

Tokens Meta con mínimos permisos y rotation; API no devuelve secretos. Credenciales de correo solo worker. HTTPS. Validar webhook del correo según proveedor. Timeouts, límites y salida a hosts autorizados. Configuración de Graph API versionada con actualización controlada. No confiar únicamente en IP allowlists; firma es esencial.

## Privacidad y retención

Clasificar documentos, registrar finalidad, accesos y plazos. Propuesta inicial 30 días debe aprobarse; metadatos/auditoría pueden requerir plazo distinto. Definir eliminación de objetos, backups y payloads. Limitar payloads crudos y redactar logs. Revisar obligaciones aplicables con responsable de datos antes del lanzamiento; este kit no es asesoría legal.

## Auditoría

Registrar actor, acción, ámbito, recurso, revisión previa/nueva, fecha y requestId; no archivo ni secreto. Append-only de aplicación con acceso restringido. Para resistencia contra administradores de BD comprometidos se requiere exportación externa/inmutabilidad adicional; no llamar inviolable a una tabla local.

## Gate de seguridad

Verificar permisos negativos, firma, CSRF, secretos, dependencias, manejo de archivos, antimalware, desactivación y aislamiento de simulación. Cerrar hallazgos críticos/altos o aceptar explícitamente el riesgo con dueño y fecha; no esconderlos en un TODO.
