# Decisiones, preguntas y riesgos

## Decisiones

Registro vigente: `docs/adr/README.md` (ADR-001 a ADR-013, 19/10/2026). Las propuestas originales del kit conservan su número: ADR-001 Monolito modular con API/worker. ADR-002 Cola durable PostgreSQL inicial. ADR-003 DSL declarativa sin código libre. ADR-004 Versiones inmutables fijadas por trámite. ADR-005 Simulador con motor compartido y efectos aislados. ADR-006 API correo con reconciliación preferida a SMTP. ADR-007 Archivos privados con cuarentena y scanner. ADR-008 Una propietaria, empresas internas; no SaaS inicial. P0 agregó ADR-009 (stack y convenciones), ADR-010 (Kysely + pg), ADR-011 (identidad), ADR-012 (clasificación y distribución), ADR-013 (alcance V1 y recortes) y ADR-014 (revisión y confirmación del documento, reemplazos y mensajes inesperados).

Estado: el propietario aceptó la dirección y las correcciones el 19/10/2026; la redacción se ratifica con la aprobación del PR de P0. Plan consolidado: `docs/15_PLAN_CONSOLIDADO_P0.md`.

## Preguntas pendientes

Actualizado: 19/10/2026. Ninguna de estas preguntas bloquea P1-T1.

| Pregunta | Cuándo bloquea | Supuesto provisional |
|---|---|---|
| Recorrido, campos, contactos y catálogo reales | Antes de configurar piloto | Fixtures ficticios de `examples/` |
| Volumen/picos | Antes de dimensionar P7 | Escenario de carga propuesto |
| Identificación empleado: verificación adicional para documentos sensibles | Antes de datos reales sensibles | Directorio aprobado + identidades de canal (ADR-011); no legajo libre |
| Formato, ámbito y presencia real del BSUID | P6 | Valor opaco con ámbito |
| Proveedor correo y dominio | Antes de envíos reales P5 | Capturador local |
| Formatos/cantidad | Resuelta | PDF/JPG/PNG, un archivo de hasta 10 MB (ADR-007) |
| Retención/sensibilidad | Antes de datos reales | 30 días solo propuesta |
| Número nuevo/existente | Antes de producción | Número de prueba Meta |
| Hosting/región/backups | Antes de P7 | Local/staging aislado |
| Aprobación previa al envío | Resuelta para V1 | Sin aprobación administrativa previa; el empleado confirma su propio documento (ADR-014) y la distribución sigue reglas aprobadas y fail-closed (ADR-013) |
| Aviso a destinatarios originales cuando una corrección cambia de destinatarios | Antes de P4 | Sin aviso automático; el operador decide (ADR-014) |
| Valores iniciales del paso documental | Al implementar P2 | ADR-014 §11 |
| Mostrar el área destinataria en la revisión | P3 | No se muestra |
| Segunda aprobación para relajar clasificación | Antes de P4 | Permiso específico + motivo + auditoría (ADR-012) |
| Implementación propia o biblioteca de cola | Inicio de P2 | Semántica de ADR-002 |
| Ejecutor de migraciones SQL | Tarea de base de P1 | Kysely Migrator o equivalente con SQL plano (ADR-010) |
| Scanner y almacenamiento de producción | P5 real / P7 | Scanner simulado etiquetado y carpeta local |
| Plantillas fuera de ventana | Si se requieren notificaciones proactivas | Mensajes retenidos hasta nueva entrada (ADR-013) |
| Roles/personas | Antes de habilitar administración | Roles del kit con scopes |

## Riesgos prioritarios

| Riesgo | Mitigación / decisión |
|---|---|
| Editor se convierte en programación arbitraria | Bloques limitados y DSL tipada |
| Documentos sensibles al grupo equivocado | Reglas/permiso por clasificación y fail-closed |
| UI independiente del motor | Un motor compartido y tests de paridad |
| Correo duplicado tras timeout | Idempotencia del proveedor, reconciliación y estado incierto |
| Scanner consume recursos o falla | Aislamiento/límites/cuarentena; costear |
| Hosting gratuito se duerme | Desarrollo gratis; producción dimensionada |
| Registros y adjuntos crecen | Retención/purga y métricas |
| Cambios de Meta o proveedor | Adaptadores, versión API y revisión de requisitos |
| Dos agentes pisan trabajo | Solo delegar si autorizado; worktrees separados |
| Backups reintroducen trabajos enviados | Conciliación antes de reactivar workers |
| Mismo empleado con varias identidades abre trámites paralelos | Empleado canónico e índice único por empleado + número (ADR-011) |
| Meta cambia o detalla el BSUID de forma distinta a lo previsto | Valor opaco con ámbito; verificación en P6 |
| Apagado repite un efecto externo en curso | Leases retenidos, fencing y conciliación (ADR-002) |
| Relajación de clasificación expone documentos sensibles | Permiso específico, vista previa, auditoría, sin efecto retroactivo (ADR-012) |
| Validación de cobertura inmanejable | Dominios finitos y límites de complejidad (ADR-012) |
| Recorte de mensajes fuera de ventana deja empleados sin respuesta | Mensajes retenidos visibles para el operador; revisar tras el piloto (ADR-013) |
| Simulador por metadatos se toma como prueba de archivos | Evidencia de archivos solo con bytes reales en P5 (ADR-005) |
| Se envía un archivo que el empleado no quería | Confirmación explícita del archivo exacto, sin sustitución silenciosa (ADR-014) |
| Confirmación o resultado tardío habilita un envío incorrecto | Referencia a revisión de contexto y documento; resultados de candidatos no seleccionados ignorados (ADR-014) |
| Carrera entre cancelar o reemplazar y el despacho | Transiciones serializadas por la fila del trámite y punto de no retorno explícito (ADR-014) |
| Candidatos acumulan documentos sensibles | Límite de 3 y purga de no seleccionados (ADR-014) |
| Paso extra de confirmación aumenta abandonos | Medir en el piloto; textos claros; revisar el ADR |

## Plantilla ADR

Título/ID; fecha; estado propuesta/aceptada/reemplazada; contexto; alternativas; decisión; motivo; costos; consecuencias; invariantes; pruebas; documentos afectados; responsable y condición de revisión. Las decisiones sustituidas se conservan con referencia a la nueva.

## Orden de precedencia documental

Instrucción explícita actual del propietario → ADR aceptado más reciente → requisitos/contratos ratificados → arquitectura → fixtures. Un cambio real debe actualizar todos los documentos afectados; esta precedencia no es permiso para ignorar contradicciones.
