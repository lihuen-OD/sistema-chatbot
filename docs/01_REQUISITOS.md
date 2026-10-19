# Requisitos del producto

## Alcance V1

Una organización propietaria con varias empresas internas, un número de WhatsApp, atención individual y un trámite activo por empleado y número. Editor visual con bloques tipados. No hay IA, grupos de WhatsApp ni autoservicio de cuentas de clientes SaaS.

## Personas y permisos

Empleado: iniciar trámite, seleccionar ámbitos permitidos, adjuntar y consultar su resultado resumido. Editor: editar borradores y simular. Publicador: validar y activar versiones/reglas. Operador: consultar incidencias y reintentar según permiso. Administrador: gestionar usuarios, accesos y configuración. Ver documentos requiere permiso explícito y alcance de empresa; no se deduce de poder editar flujos.

## Requisitos funcionales

| ID | Requisito | Criterio observable |
|---|---|---|
| RF01 | Crear/editar un flujo visual | Agregar bloques, conexiones, texto y opciones sin código |
| RF02 | Validar y publicar | No publica un flujo incompleto; genera versión inmutable |
| RF03 | Fijar versión por trámite | Publicar V2 no cambia un trámite iniciado en V1 |
| RF04 | Simular el recorrido | Mismo motor; muestra acciones sin envío externo |
| RF05 | Identificar al empleado | Rechaza teléfono no habilitado o ámbito no autorizado |
| RF06 | Capturar opciones/datos | Valida contra paso activo y conserva respuestas tipadas |
| RF07 | Recibir documentos | Vincula archivo al trámite correcto y lo pone en cuarentena |
| RF08 | Resolver destinatarios | Aplica regla autorizada y guarda snapshot de resolución |
| RF09 | Enviar correo | Adjunta solo documentos aprobados y conserva ID de proveedor |
| RF10 | Informar resultado | Distingue recibido, pendiente, aceptado y fallo |
| RF11 | Administrar contactos/grupos | Valida direcciones, alcance y bloqueo urgente |
| RF12 | Consultar trámites/incidencias | Filtros, paginación y seguimiento de entregas |
| RF13 | Cancelar/reiniciar | No cancela silenciosamente un efecto ya ejecutado |
| RF14 | Registrar auditoría | Quién cambió/publicó/descargó/reintentó y cuándo |
| RF15 | Retención y purga | Cumple política y no borra evidencia mínima necesaria |

## Requisitos de calidad

| ID | Requisito | Verificación |
|---|---|---|
| RNF01 | Aislamiento de permisos | Tests cruzados entre empresas y tipos sensibles |
| RNF02 | Persistencia antes del ACK | Fallo de BD no produce un ACK de recepción exitosa |
| RNF03 | Recuperación y deduplicación | Replay/reinicio no duplica una acción lógica |
| RNF04 | Orden por conversación | Dos respuestas concurrentes no pisan estado |
| RNF05 | Seguridad documental | Tipo real, tamaño, análisis, bucket privado y permisos |
| RNF06 | Disponibilidad operativa | Health checks, alertas, worker permanente y restore probado |
| RNF07 | Rendimiento | Medir objetivos, colas y backpressure bajo carga |
| RNF08 | Observabilidad sin filtraciones | IDs de correlación; no secretos/documentos en logs |
| RNF09 | Mantenibilidad | Motor independiente, contratos, ADR y lockfile |
| RNF10 | Ambientes aislados | Simulador sin envío y staging con allowlist |

## Caso inicial ficticio

El empleado autorizado elige empresa A/B y documento Factura/Certificado. Sube PDF/JPG/PNG. Empresa+tipo resuelve un grupo de demo. El bot informa recepción y, después de aceptación por correo, confirma procesamiento. Un certificado solo lo recibe RRHH autorizado. Los contactos de demo terminan en example.com y no deben usarse en integración real.

## Excepciones previstas

Archivo fuera de paso: explicar el paso esperado, no adjuntarlo a otro trámite. Opción vieja: informar que ya no corresponde. Trámite activo: ofrecer continuar o cancelar, sin crear otro por error. Regla ausente/conflictiva: revisión. Escáner caído: pendiente. Correo incierto: conciliación. Empleado desactivado: impedir nuevos pasos/efectos sensibles y derivar según política. Ventana WhatsApp vencida: esperar nueva entrada o usar plantilla permitida; no forzar mensaje libre.

## Fuera de alcance

Leer automáticamente facturas, OCR, IA, Finnegans, workflows de aprobación complejos, grupos WhatsApp, canal Telegram, scripts libres y multiempresa SaaS. Guardar correos no es una agenda abierta: destinos tienen permisos y administración controlados.
