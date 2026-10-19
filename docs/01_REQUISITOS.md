# Requisitos del producto

Actualizado: 19/10/2026. Los ajustes de P0 se marcan "V1:" y remiten a su ADR; ningún requisito se eliminó.

## Alcance V1

Una organización propietaria con varias empresas internas, un número de WhatsApp, atención individual y un trámite activo por empleado y número, aunque el empleado use varias identidades de canal (ADR-011). Editor visual con bloques tipados. Un archivo PDF/JPG/PNG de hasta 10 MB por trámite. Sin mensajes proactivos fuera de la ventana de atención. No hay IA, ERP, grupos de WhatsApp ni autoservicio de cuentas de clientes SaaS. Recortes y consecuencias en ADR-013.

## Personas y permisos

Empleado: iniciar trámite, seleccionar ámbitos permitidos (opciones generadas desde sus ámbitos autorizados), adjuntar y consultar su resultado resumido. Editor: editar borradores y simular. Publicador: validar y activar versiones/reglas. Operador: consultar incidencias y reintentar según permiso. Administrador: gestionar usuarios, accesos y configuración. Ver documentos requiere permiso explícito y alcance de empresa; no se deduce de poder editar flujos. Relajar restricciones de clasificación requiere el permiso específico `classification.relax` (ADR-012).

## Requisitos funcionales

| ID | Requisito | Criterio observable |
|---|---|---|
| RF01 | Crear/editar un flujo visual | Agregar bloques, conexiones, texto y opciones sin código |
| RF02 | Validar y publicar | No publica un flujo incompleto; genera versión inmutable |
| RF03 | Fijar versión por trámite | Publicar V2 no cambia un trámite iniciado en V1 |
| RF04 | Simular el recorrido | Mismo motor; muestra acciones sin envío externo |
| RF05 | Identificar al empleado | Resuelve teléfono o BSUID, con su ámbito, al empleado canónico; rechaza identidad no habilitada, en conflicto o ámbito no autorizado; un trámite activo por empleado y número (ADR-011) |
| RF06 | Capturar opciones/datos | Valida contra paso activo y conserva respuestas tipadas; las opciones dinámicas solo muestran ámbitos autorizados y se revalidan (ADR-003) |
| RF07 | Recibir documentos | Vincula archivo al trámite correcto y lo pone en cuarentena. V1: un archivo PDF/JPG/PNG de hasta 10 MB (ADR-007, ADR-013) |
| RF08 | Resolver destinatarios | Aplica regla autorizada y guarda snapshot de resolución; destinatarios ausentes, ambiguos o no autorizados bloquean el envío (ADR-012) |
| RF09 | Enviar correo | Adjunta solo documentos aprobados y conserva ID de proveedor |
| RF10 | Informar resultado | Distingue recibido, pendiente, aceptado y fallo. V1: dentro de la ventana de atención; si está cerrada, al siguiente mensaje del empleado (ADR-013) |
| RF11 | Administrar contactos/grupos | Valida direcciones, alcance y bloqueo urgente |
| RF12 | Consultar trámites/incidencias | Filtros, paginación y seguimiento de entregas |
| RF13 | Cancelar/reiniciar | No cancela silenciosamente un efecto ya ejecutado |
| RF14 | Registrar auditoría | Quién cambió/publicó/descargó/reintentó y cuándo |
| RF15 | Retención y purga | Cumple política y no borra evidencia mínima necesaria |
| RF16 | Clasificación documental | El catálogo define la clasificación de cada tipo; el trámite conserva la aplicada; los cambios que relajan restricciones exigen permiso específico, motivo y auditoría, y no afectan trámites en curso (ADR-012). Agregado en P0 |

## Requisitos de calidad

| ID | Requisito | Verificación |
|---|---|---|
| RNF01 | Aislamiento de permisos | Tests cruzados entre empresas y tipos sensibles |
| RNF02 | Persistencia antes del ACK | Fallo de BD no produce un ACK de recepción exitosa |
| RNF03 | Recuperación y deduplicación | Replay/reinicio no duplica una acción lógica |
| RNF04 | Orden por empleado y número | Dos respuestas concurrentes no pisan estado, aunque lleguen por identidades distintas del mismo empleado (ADR-011) |
| RNF05 | Seguridad documental | Tipo real, tamaño, análisis, bucket privado y permisos |
| RNF06 | Disponibilidad operativa | Health checks, alertas, worker permanente y restore probado |
| RNF07 | Rendimiento | Medir objetivos, colas y backpressure bajo carga |
| RNF08 | Observabilidad sin filtraciones | IDs de correlación; no secretos/documentos en logs |
| RNF09 | Mantenibilidad | Motor independiente, contratos, ADR y lockfile |
| RNF10 | Ambientes aislados | Simulador sin envío y staging con allowlist |

## Caso inicial ficticio

El empleado autorizado elige empresa A/B y documento Factura/Certificado. Sube PDF/JPG/PNG. Empresa+tipo resuelve un grupo de demo. El bot informa recepción y, después de aceptación por correo, confirma procesamiento. Un certificado solo lo recibe RRHH autorizado. Los contactos de demo terminan en example.com y no deben usarse en integración real.

## Excepciones previstas

Archivo fuera de paso: explicar el paso esperado, no adjuntarlo a otro trámite. Opción vieja: informar que ya no corresponde. Trámite activo: ofrecer continuar o cancelar, sin crear otro por error. Regla ausente/conflictiva: revisión. Escáner caído: pendiente. Correo incierto: conciliación. Empleado desactivado: impedir nuevos pasos/efectos sensibles y derivar según política. Ventana WhatsApp vencida: esperar nueva entrada o usar plantilla permitida; no forzar mensaje libre. V1: solo esperar nueva entrada; las plantillas quedan fuera (ADR-013). Identidad no vinculada o en conflicto: mensaje genérico, sin trámite y sin revelar datos del directorio (ADR-011).

## Ajustes de alcance V1

Registrados en ADR-013 con su consecuencia y cuándo revisarlos: un archivo por trámite; sin mensajes proactivos fuera de ventana; sin IA, OCR ni ERP; sin SaaS; sin ciclos en flujos; opciones dinámicas limitadas; confirmación por aceptación del proveedor; sin teléfonos compartidos; sin aprobación humana previa al envío; solo PDF/JPG/PNG.

## Fuera de alcance

Leer automáticamente facturas, OCR, IA, Finnegans, workflows de aprobación complejos, grupos WhatsApp, canal Telegram, scripts libres y multiempresa SaaS. Guardar correos no es una agenda abierta: destinos tienen permisos y administración controlados.
