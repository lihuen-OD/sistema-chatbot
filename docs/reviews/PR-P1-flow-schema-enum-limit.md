# `flow-schema`: límite de 50 valores por `enum` (`enumValues`)

## Dependencia

Esta rama sale de `p1/node-24.22.1`, que a su vez sale de `p1/t4-plan`. Orden de fusión: plan, Node y este PR. Diff exclusivo: https://github.com/lihuen-OD/sistema-chatbot/compare/p1/node-24.22.1...p1/flow-schema-enum-limit.

## Destino del PR

- **Mientras `p1/node-24.22.1` no esté fusionada,** este PR apunta a `p1/node-24.22.1`, para que el diff muestre solo sus cambios.
- **Después de fusionar `p1/node-24.22.1`** (y antes, `p1/t4-plan`), hay que cambiar el destino de este PR a `main`, actualizada con esas fusiones, antes de revisarlo y fusionarlo.
- **El PR siguiente (`p1/t4-api`)** hace lo mismo cuando se fusiona este.

## Problema resuelto

Las variables `enum` no tenían máximo de valores, y las comprobaciones de dominio comparaban listas completas. Validar un flujo de 1 MiB con 120.000 valores tardaba 6,7 s y bloqueaba el único hilo de JavaScript. El problema aparecería en cuanto un endpoint reciba definiciones (P3 y P4).

## Cambios

- `enumValues = 50` en `FLOW_LIMITS` y `RULE_LIMITS`, igual que `valuesPerList`.
- La comprobación va antes del análisis semántico y solo lee la longitud de cada lista.
- Errores existentes, con detalles y rutas estables:
  - `FLOW_LIMIT_EXCEEDED`, en `variables.<nombre>.values`;
  - `RULE_LIMIT_EXCEEDED`, en `contextVariables.<nombre>.values`;
  - en los dos, `details = {limit: "enumValues", max: 50, actual}`.
- La pertenencia a un `enum` se resuelve con un conjunto, en lugar de búsquedas lineales. El conjunto vive durante una sola ejecución del validador (`EnumValueSets`), sin caché global: una lista modificada entre dos validaciones se lee con sus valores actuales.
- Documentos: addenda de ADR-003 y ADR-012, README de `flow-schema` y docs/13.

## Validación

- **Pruebas nuevas:** frontera (1, 50 y 51, en flujo y reglas), entradas excesivas (120.000 y 250.000 valores, rechazadas sin leer elementos), semántica conservada y compatibilidad con `examples/`.
- **Sin pruebas de tiempo:** el rechazo temprano se prueba contando lecturas de una lista instrumentada.
- **Mutaciones temporales:** con el límite en 51 fallan 6 pruebas; sin la comprobación del flujo, fallan 5.
- **Medición local:** el caso de 120.000 valores pasó de 6.746 ms a menos de 1 ms.
- **Local:** `check` con 62, 128 y 183 pruebas, y `check:db` con 79, ambos con código 0.
- **Corrección de la revisión:**
  - **Defecto:** la primera versión usaba una caché global (`WeakMap` por array). Agregar, quitar o reemplazar valores en el mismo array entre dos validaciones devolvía el resultado viejo. Se reprodujo con el `dist` anterior: `urgent` agregado al mismo array seguía dando `VALUE_OUT_OF_DOMAIN`, y con una copia desaparecía.
  - **Corrección:** ahora la caché es de cada ejecución.
  - **Regresiones:** 4 pruebas nuevas que agregan, quitan y reemplazan valores en flujos, reglas y el contexto del correo, y que comprueban el límite de 50 sobre el mismo array.
  - **Mutación temporal:** con la caché compartida de nuevo, fallan las 3 regresiones de estado viejo.
  - **Local:** `check` con 62, 132 y 183 pruebas, y `check:db` con 79.
- **Checkout limpio y CI:** en el informe de la entrega.

## Compatibilidad

- `examples/` no declara `enum`.
- No hay definiciones publicadas.
- `schemaVersion` no cambia.
- `contracts` acepta el nombre de límite sin cambios de código.
- Una prueba existente que superaba el límite de combinaciones con un `enum` de 300 valores ahora usa dos de 50.
