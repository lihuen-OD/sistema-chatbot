# Decisiones, preguntas y riesgos

## Decisiones propuestas

ADR-001 Monolito modular con API/worker. ADR-002 Cola durable PostgreSQL inicial. ADR-003 DSL declarativa sin código libre. ADR-004 Versiones inmutables fijadas por trámite. ADR-005 Simulador con motor compartido y efectos aislados. ADR-006 API correo con reconciliación preferida a SMTP. ADR-007 Archivos privados con cuarentena y scanner. ADR-008 Una propietaria, empresas internas; no SaaS inicial.

Estado: propuestas para ratificar en P0. El archivo de arquitectura expresa esta dirección, pero los detalles de implementación todavía deben revisar compatibilidad/costo.

## Preguntas pendientes

| Pregunta | Cuándo bloquea | Supuesto provisional |
|---|---|---|
| Recorrido y campos reales | Antes de configurar piloto | Ejemplo ficticio del kit |
| Volumen/picos | Antes de dimensionar P7 | Escenario de carga propuesto |
| Identificación empleado | Antes de integración sensible | Directorio aprobado; no legajo libre |
| Proveedor correo y dominio | Antes de envíos reales P5 | Capturador local |
| Formatos/cantidad | Antes de media real | PDF/JPG/PNG; demo 1 archivo |
| Retención/sensibilidad | Antes de datos reales | 30 días solo propuesta |
| Número nuevo/existente | Antes de producción | Número de prueba Meta |
| Hosting/región/backups | Antes de P7 | Local/staging aislado |
| Aprobación previa al envío | Antes de recorrido real | Distribución automática a reglas aprobadas |
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

## Plantilla ADR

Título/ID; fecha; estado propuesta/aceptada/reemplazada; contexto; alternativas; decisión; motivo; costos; consecuencias; invariantes; pruebas; documentos afectados; responsable y condición de revisión. Las decisiones sustituidas se conservan con referencia a la nueva.

## Orden de precedencia documental

Instrucción explícita actual del propietario → ADR aceptado más reciente → requisitos/contratos ratificados → arquitectura → fixtures. Un cambio real debe actualizar todos los documentos afectados; esta precedencia no es permiso para ignorar contradicciones.
