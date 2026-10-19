# ADR-004 — Versiones inmutables fijadas por trámite

- Fecha: 19/10/2026
- Estado: Aceptada
- Responsable: propietario del proyecto
- Revisión: si se habilitan migraciones de trámites en curso entre versiones (fuera de V1).

## Contexto

Publicar una versión nueva no puede cambiar el comportamiento de un trámite ya iniciado. Esto vale para el flujo, las reglas y la clasificación documental, que cambia qué destinatarios están autorizados (corrección 3).

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Ejecutar siempre la versión activa | Rechazada: un trámite cambia de reglas a mitad de camino |
| Fijar solo el flujo | Insuficiente: las reglas y la clasificación también cambian el resultado |
| Fijar flujo, reglas y catálogo documental | Elegida |

## Decisión

- `FlowVersion`, `RoutingRuleSetVersion` y `DocumentCatalogVersion` son inmutables, tienen hash de contenido y se publican de forma atómica.
- Al crear un `Submission` se fijan `flowVersionId`, la versión de cada conjunto de reglas referenciado por esa versión del flujo y `catalogVersionId`.
- Cuando el trámite asigna `documentType`, guarda `appliedClassification`, la clasificación de ese tipo en la versión de catálogo fijada. No cambia durante la vida del trámite (ADR-012).
- El directorio (empleados, contactos, grupos) no se versiona. Los destinatarios se resuelven con el estado vigente al resolver y se guardan como snapshot inmutable en `Delivery`. Bloqueos urgentes, desactivaciones y endurecimientos de autorización se revalidan al ejecutar: prevalece la condición más restrictiva.
- Revertir = activar una versión anterior válida. Es un evento nuevo, no una modificación.
- La base rechaza `UPDATE` y `DELETE` sobre versiones publicadas (trigger o privilegios, a definir en la migración de P1).

## Costos

Más tablas de versión y snapshots. Los trámites largos usan versiones viejas: hay que poder consultarlas y no se pueden borrar mientras haya trámites que las referencien.

## Consecuencias

- La interfaz muestra la versión de flujo, reglas y catálogo de cada trámite.
- Un cambio urgente que debe afectar trámites en curso solo puede ser restrictivo (bloquear contacto, desactivar empleado). Nunca amplía permisos de forma retroactiva.

## Invariantes

- Una versión publicada no cambia.
- Un trámite no cambia de versión de flujo, reglas ni catálogo.
- `appliedClassification` no cambia después de asignarse.

## Pruebas

T03, T25 y T32.

## Documentos afectados

`docs/04_MODELO_DATOS.md`, `docs/06_EDITOR_Y_MOTOR.md` (selección de versiones), `docs/05_CONTRATOS_API.md`.
