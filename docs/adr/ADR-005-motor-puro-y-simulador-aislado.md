# ADR-005 — Motor puro compartido y simulador aislado

- Fecha: 19/10/2026
- Estado: Aceptada
- Responsable: propietario del proyecto
- Revisión: si el simulador necesita capacidades que el motor no expone.

## Contexto

El simulador y WhatsApp deben ejecutar la misma lógica. La simulación no puede producir efectos reales. Un simulador que solo maneja metadatos de archivo no prueba la subida, el almacenamiento ni el análisis de archivos reales (corrección 5).

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Lógica de simulación propia en el frontend | Rechazada: dos implementaciones que divergen |
| Simular contra adaptadores reales con una bandera | Rechazada: un error de configuración produce envíos reales |
| Motor puro con hosts distintos | Elegida |

## Decisión

- `flow-engine` expone una función pura: (definición, estado, contexto permitido, evento) → (estado nuevo, acciones, diagnóstico). No hace E/S; tiempo e IDs se inyectan.
- El host de producción (worker) y el host de simulación (API) componen el mismo motor. El host de simulación solo puede construirse con un `ActionSink` local y adaptadores simulados: los adaptadores reales no son inyectables en esa composición. Además, una verificación de configuración lo impide.
- La simulación usa su propio espacio de datos (`simulationId`) y nunca crea `Delivery`, `OutboundMessage` ni documentos reales.
- **Archivos en P3:** el simulador recibe un evento de archivo con metadatos (nombre, MIME declarado y tamaño), sin bytes. El evaluador elige el resultado del análisis simulado (aprobado, rechazado o incierto) y el documento queda marcado como simulado.
- **Lo que el simulador por metadatos no prueba:** subida o descarga real, límites de streaming, tipo real por firma de bytes, almacenamiento privado, análisis antimalware ni la API de media de Meta. Eso se prueba en P5 con archivos reales en un entorno aislado (archivos con extensión o MIME falsos, archivos excedidos o truncados, PDF cifrado, archivo de prueba EICAR) y en P6 con media de Meta. La evidencia de P3 no cierra RF07, RNF05 ni T13–T16.
- Pruebas de paridad: el mismo fixture recorrido por el host de simulación y por el host de producción con adaptadores simulados produce las mismas transiciones.

## Costos

Dos composiciones del host para mantener. Las pruebas de paridad agregan trabajo en P2/P3.

## Consecuencias

- La interfaz del simulador indica "Simulación: no envía mensajes ni correos" y "Archivo simulado por metadatos".
- El vertical mínimo de P4 no permite afirmar que el sistema procesa archivos reales.

## Invariantes

- No hay ruta de código desde una simulación hasta un adaptador real.
- El motor no contiene lógica específica de simulación.

## Pruebas

T18, prueba de paridad del motor, T34. T13–T16 solo con archivos reales en P5.

## Documentos afectados

`docs/03_PLAN_DESARROLLO.md` (P3, P5), `docs/06_EDITOR_Y_MOTOR.md`, `docs/09_PRUEBAS_Y_ACEPTACION.md`, `docs/11_UX_ADMINISTRADOR.md`.
