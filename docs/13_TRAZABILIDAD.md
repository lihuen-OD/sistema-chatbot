# Matriz de trazabilidad

Actualizado: 19/10/2026 (ADR de P0, incluido ADR-014).

| Requisito | Módulo | Etapa | Prueba | ADR |
|---|---|---|---|---|
| RF01 editor | Admin/editor | P3 | T01/T02/T25/T34 | ADR-003 |
| RF02 publicación | Flow service, flow-schema | P1 (validación) / P4 | T02/T25/T33/T34 | ADR-003, ADR-004 |
| RF03 versiones | Engine/Submission | P2/P4 | T03/T32 | ADR-004 |
| RF04 simulación | Simulator/sink | P3 | T18 + paridad + E2E | ADR-005 |
| RF05 identidad | Directory/identity, engine host | P2/P4/P6 | T20/T26/T29/T30 | ADR-011 |
| RF06 datos y opciones | Engine, flow-schema | P1 (validación) / P2 | T01/T05/T06/T34 | ADR-003 |
| RF07 documentos | Document service | P5 (bytes reales) | T13–T16/T45/T48 | ADR-005, ADR-007, ADR-014 |
| RF08 destinos | Routing, flow-schema | P1 (cobertura) / P4/P5 | T11/T12/T33 | ADR-012 |
| RF09 correo | Delivery worker, flow-schema | P1 (plantilla) / P5 | T10/T23/T28/T31/T53 | ADR-002, ADR-006, ADR-014 |
| RF10 resultado | Engine/adapters | P5/P6 | T10/T22/T23/T44 | ADR-006, ADR-013, ADR-014 |
| RF11 contactos | Directory/routing | P4 | T11/T12/T20/T32 | ADR-012 |
| RF12 incidencias | Operations UI | P4/P5 | E2E + estados | — |
| RF13 comandos | Engine, delivery worker | P2/P5 | Casos cancelar/reiniciar + T05/T40/T41 | ADR-014 |
| RF14 auditoría | Audit | P4 | E2E + permiso + T32 | ADR-012 |
| RF15 retención | Purge worker | P7 | T27 | ADR-007 |
| RF16 clasificación | Catalog/routing | P4 | T32/T33 | ADR-004, ADR-012 |
| RF17 revisión y confirmación | flow-schema, engine, engine host, delivery worker | P1 (esquema) / P2/P3/P5 | T35/T37/T38/T40/T46/T47/T49/T50 | ADR-014 |
| RF18 mensajes inesperados | Engine host, adapters | P2/P3/P5/P6 | T06/T13/T36/T39/T41/T42/T44/T51/T52 | ADR-014 |
| RF19 corrección | Engine host, operations UI | P2/P4 | T43 | ADR-014 |
| RNF01 permisos | Todos | P4/P7 | T17/T20/T26/T30/T32 | ADR-008, ADR-012 |
| RNF02 ACK durable | Inbox | P2/P6 | T07/T08 | ADR-002 |
| RNF03 deduplicación | Inbox/outbox | P2/P5 | T04/T09/T10/T31/T37/T48/T49 | ADR-002, ADR-014 |
| RNF04 orden | Engine host | P2 | T05/T06/T09/T29/T40/T51 | ADR-002, ADR-011, ADR-014 |
| RNF05 archivos | Documents | P5 (bytes reales) | T14/T15/T16/T17 | ADR-005, ADR-007 |
| RNF06 recuperación | Operations | P2/P7 | T24/T31 | ADR-002 |
| RNF07 performance | API/worker | P7 | Carga | — |
| RNF08 observabilidad | Telemetry | P5/P7 | Revisión de logs/alertas | — |
| RNF09 mantenimiento | Contracts/domain/db | P1–P7 | CI/ADR/revisión/divergencia de tipos | ADR-001, ADR-009, ADR-010 |
| RNF10 ambientes | Adapters/config | P1/P3/P6 | T18 + allowlist | ADR-005 |

Recortes de V1 y sus consecuencias: ADR-013. Mantener esta matriz al cambiar requisitos. Una pantalla visible no satisface un requisito si el backend no implementa su comportamiento y permisos. Una prueba del simulador por metadatos no satisface RF07 ni RNF05.

Estado de implementación al 19/10/2026: P1-T1 implementó la validación de definiciones de RF01, RF02, RF06, RF08, RF16 y RF17 a nivel de esquema (`packages/flow-schema`), con las partes de esquema de T02, T33 y T34. Eso no cierra esos requisitos: publicación, ejecución, permisos y efectos se prueban en las etapas indicadas en la matriz.
