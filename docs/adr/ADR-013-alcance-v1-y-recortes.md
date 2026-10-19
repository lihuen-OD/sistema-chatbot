# ADR-013 — Alcance V1, recortes y consecuencias

- Fecha: 19/10/2026
- Estado: Aceptada. ADR-014 amplía las mitigaciones:
  - recorte 1: el empleado puede reemplazar el archivo antes de confirmar;
  - recorte 2: los mensajes retenidos se revalidan al reabrirse la ventana y los prompts obsoletos no se reproducen.

  El recorte 10 se mantiene: la confirmación del empleado no es una aprobación administrativa.
- Responsable: propietario del proyecto
- Revisión: al terminar el piloto, o antes si un recorrido real exige algo recortado.

## Contexto

El propietario fijó el alcance V1: un archivo PDF/JPG/PNG de hasta 10 MB por trámite, y sin IA, ERP, SaaS ni mensajes proactivos fuera de la ventana de atención. Algunos documentos del kit preveían más (hasta 3 archivos, plantillas fuera de ventana). Los requisitos no se eliminan en silencio: se registra cada recorte con su consecuencia (corrección 7).

## Decisión

Los requisitos se conservan en `docs/01_REQUISITOS.md` con su ajuste V1 indicado. Recortes:

| # | Recorte V1 | Afecta | Consecuencia | Mitigación en V1 | Revisar cuando |
|---|---|---|---|---|---|
| 1 | Un archivo por trámite (antes "hasta 3") | RF07, arquitectura §8, bloque `file` | Varias fotos de un mismo documento no se aceptan como un envío; el empleado las une en un PDF o inicia otro trámite. No existe "Terminé de adjuntar" | Texto del paso explícito; el esquema conserva `minCount`/`maxCount` para el futuro | Haya demanda medida en el piloto |
| 2 | Sin mensajes proactivos fuera de la ventana de atención (sin plantillas) | RF10, excepción "ventana vencida", validación de publicación | Si la ventana se cierra mientras se analiza o envía el documento, la confirmación o el resultado no llegan hasta que el empleado vuelva a escribir. El bot no puede pedir datos faltantes ni enviar recordatorios | El mensaje queda en `HELD_WINDOW_CLOSED` y se entrega en la próxima entrada; el estado es visible en el panel; el operador puede contactar por otro medio | Se aprueben plantillas y su costo |
| 3 | Sin IA, OCR ni lectura automática | Fuera de alcance original | La clasificación depende de lo que elige el empleado; puede haber documentos mal clasificados | Reglas por tipo, revisión ante errores | Requisito explícito |
| 4 | Sin integración con ERP (Finnegans) | Fuera de alcance original | La carga posterior en sistemas internos sigue siendo manual | — | Requisito explícito |
| 5 | Sin SaaS ni multiorganización | ADR-008 | — | — | Requisito explícito |
| 6 | Sin ciclos en flujos | Arquitectura §5 | No hay bucles del tipo "agregar otro documento"; solo reintentos de entrada inválida | Iniciar otro trámite | Necesidad real |
| 7 | Opciones dinámicas solo desde fuentes cerradas y hasta el límite del canal | RF06, ADR-003 | Una organización con más empresas que el límite necesita otro diseño | Publicación rechazada; revisión en ejecución si el catálogo crece | Más empresas que el límite |
| 8 | La confirmación al empleado indica aceptación del proveedor, no entrega ni lectura | RF10, ADR-006 | El empleado no recibe confirmación de entrega | Rebotes visibles para el operador | Haya necesidad de confirmar entrega |
| 9 | Teléfonos compartidos entre empleados no soportados | RF05, ADR-011 | Dos empleados no pueden usar el mismo número | Conflicto y revisión | Caso real |
| 10 | Sin aprobación humana previa al envío | Pregunta pendiente del kit | La distribución es automática por reglas aprobadas; solo los errores pasan a revisión | Reglas fail-closed (ADR-012) | El propietario lo requiera |
| 11 | Otros formatos (Word, Excel, etc.) rechazados | RF07 | El empleado debe convertir a PDF | Mensaje de rechazo claro | Demanda medida |

Se mantienen sin cambios las exclusiones originales: grupos de WhatsApp, Telegram, scripts libres y workflows de aprobación complejos.

## Costos

Peor experiencia en los casos recortados, especialmente el recorte 2: resultados que esperan a que el empleado escriba.

## Consecuencias

- El validador de publicación V1 rechaza `file` con `maxCount` distinto de 1 y cualquier configuración de plantillas.
- `OutboundMessage` incorpora el estado `HELD_WINDOW_CLOSED`.
- La ventana se revalida al despachar, no solo al planificar (`docs/08_CONFIABILIDAD.md`).

## Invariantes

- Fuera de la ventana de atención no sale ningún mensaje libre.
- Ningún requisito se elimina sin quedar registrado en este ADR.

## Pruebas

T22 (retención con ventana cerrada) y validación de publicación con `maxCount` > 1 o plantillas (T02).

## Documentos afectados

`docs/01_REQUISITOS.md`, `docs/02_ARQUITECTURA.md` §8, `docs/06_EDITOR_Y_MOTOR.md`, `docs/08_CONFIABILIDAD.md`, `docs/13_TRAZABILIDAD.md`.
