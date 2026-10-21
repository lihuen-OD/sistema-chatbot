# `flow-schema`: límite de 50 valores por `enum` (`enumValues`)

## Dependencia

Esta rama sale de `p1/node-24.22.1`, que a su vez sale de `p1/t4-plan`. Orden de fusión: plan, Node y este PR. Diff exclusivo: https://github.com/lihuen-OD/sistema-chatbot/compare/p1/node-24.22.1...p1/flow-schema-enum-limit.

## Problema resuelto

Las variables `enum` no tenían máximo de valores, y las comprobaciones de dominio comparaban listas completas. Validar un flujo de 1 MiB con 120.000 valores tardaba 6,7 s y bloqueaba el único hilo de JavaScript. El problema aparecería en cuanto un endpoint reciba definiciones (P3 y P4).

## Cambios

- `enumValues = 50` en `FLOW_LIMITS` y `RULE_LIMITS`, igual que `valuesPerList`.
- La comprobación va antes del análisis semántico y solo lee la longitud de cada lista.
- Errores existentes, con detalles y rutas estables:
  - `FLOW_LIMIT_EXCEEDED`, en `variables.<nombre>.values`;
  - `RULE_LIMIT_EXCEEDED`, en `contextVariables.<nombre>.values`;
  - en los dos, `details = {limit: "enumValues", max: 50, actual}`.
- La pertenencia a un `enum` se resuelve con un conjunto, en lugar de búsquedas lineales.
- Documentos: addenda de ADR-003 y ADR-012, README de `flow-schema` y docs/13.

## Validación

- **Pruebas nuevas:** frontera (1, 50 y 51, en flujo y reglas), entradas excesivas (120.000 y 250.000 valores, rechazadas sin leer elementos), semántica conservada y compatibilidad con `examples/`.
- **Sin pruebas de tiempo:** el rechazo temprano se prueba contando lecturas de una lista instrumentada.
- **Mutaciones temporales:** con el límite en 51 fallan 6 pruebas; sin la comprobación del flujo, fallan 5.
- **Medición local:** el caso de 120.000 valores pasó de 6.746 ms a menos de 1 ms.
- **Local:** `check` con 62, 128 y 183 pruebas, y `check:db` con 79, ambos con código 0.
- **Checkout limpio y CI:** en el informe de la entrega.

## Compatibilidad

- `examples/` no declara `enum`.
- No hay definiciones publicadas.
- `schemaVersion` no cambia.
- `contracts` acepta el nombre de límite sin cambios de código.
- Una prueba existente que superaba el límite de combinaciones con un `enum` de 300 valores ahora usa dos de 50.
