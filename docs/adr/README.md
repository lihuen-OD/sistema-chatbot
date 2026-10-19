# Registro de decisiones de arquitectura (ADR)

Actualizado: 19/10/2026

El propietario aprobó la dirección técnica y las correcciones de P0 el 19/10/2026. La redacción de estos ADR se revisa en el PR de P0: si el PR recibe observaciones, prevalecen sobre este texto hasta corregirlo. Precedencia documental: ver `docs/12_DECISIONES_Y_RIESGOS.md`.

| ADR | Título | Estado | Origen |
|---|---|---|---|
| [ADR-001](ADR-001-monolito-modular-api-worker.md) | Monolito modular con API y worker | Aceptada | Propuesta ADR-001 del kit |
| [ADR-002](ADR-002-cola-durable-inbox-outbox.md) | Inbox/outbox y cola durable en PostgreSQL, con leases, fencing y apagado ordenado | Aceptada | Propuesta ADR-002 + corrección 2 |
| [ADR-003](ADR-003-dsl-declarativa-de-flujos.md) | DSL declarativa de flujos, opciones dinámicas y límites | Aceptada; precisada por ADR-014 | Propuesta ADR-003 + corrección 4 |
| [ADR-004](ADR-004-versiones-inmutables-por-tramite.md) | Versiones inmutables fijadas por trámite | Aceptada | Propuesta ADR-004 + corrección 3 |
| [ADR-005](ADR-005-motor-puro-y-simulador-aislado.md) | Motor puro compartido y simulador aislado | Aceptada | Propuesta ADR-005 + corrección 5 |
| [ADR-006](ADR-006-correo-con-reconciliacion.md) | Correo transaccional con reconciliación | Aceptada en principios; proveedor pendiente (P5) | Propuesta ADR-006 |
| [ADR-007](ADR-007-archivos-privados-cuarentena.md) | Archivos privados con cuarentena y análisis; un archivo por trámite en V1 | Aceptada; precisada por ADR-014 (un adjunto seleccionado por envío, candidatos limitados) | Propuesta ADR-007 + dirección V1 |
| [ADR-008](ADR-008-organizacion-unica-sin-saas.md) | Una organización propietaria, sin SaaS | Aceptada | Propuesta ADR-008 |
| [ADR-009](ADR-009-stack-base-y-convenciones.md) | Stack base y convenciones de idioma | Aceptada; versiones exactas en P1 | Dirección técnica 19/10 |
| [ADR-010](ADR-010-acceso-a-datos-kysely.md) | Acceso a datos con Kysely + pg y migraciones SQL revisadas | Aceptada | Dirección técnica 19/10 + corrección 6 |
| [ADR-011](ADR-011-identidad-de-empleados.md) | Empleado canónico e identidades de canal con ámbito | Aceptada | Corrección 1 |
| [ADR-012](ADR-012-clasificacion-y-distribucion.md) | Clasificación documental y distribución fail-closed | Aceptada | Correcciones 3 y 4 |
| [ADR-013](ADR-013-alcance-v1-y-recortes.md) | Alcance V1, recortes y consecuencias | Aceptada; mitigaciones ampliadas por ADR-014 | Dirección técnica 19/10 + corrección 7 |
| [ADR-014](ADR-014-revision-confirmacion-y-mensajes-inesperados.md) | Revisión y confirmación del documento, reemplazos y mensajes inesperados | Aceptada | Requisito adicional del propietario, 19/10/2026 |

## Reglas del registro

- Formato: plantilla de `docs/12_DECISIONES_Y_RIESGOS.md`.
- Una decisión aceptada no se edita para cambiar su sentido: se crea un ADR nuevo y el anterior pasa a "Reemplazada por ADR-NNN". Si el cambio es parcial, el anterior conserva su texto y lleva una nota "Precisada por ADR-NNN" que indica qué punto cambia. Se permiten correcciones de redacción que no cambien la decisión.
- Los límites numéricos marcados como "valor inicial" son constantes revisables. Cambiarlos requiere actualizar el ADR, las pruebas y la trazabilidad.
- Las afirmaciones sobre proveedores (Meta, correo, almacenamiento) se verifican en documentación oficial en la etapa que las usa. Un ADR no reemplaza esa verificación.
