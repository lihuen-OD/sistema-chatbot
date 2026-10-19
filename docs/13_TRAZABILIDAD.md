# Matriz de trazabilidad

| Requisito | Módulo | Etapa | Prueba |
|---|---|---|---|
| RF01 editor | Admin/editor | P3 | T01/T02/T25 |
| RF02 publicación | Flow service | P4 | T02/T25 |
| RF03 versiones | Engine/Submission | P2/P4 | T03 |
| RF04 simulación | Simulator/sink | P3 | T18 + E2E |
| RF05 identidad | Directory/auth | P4/P6 | T20/T26 |
| RF06 datos | Engine | P2 | T01/T05/T06 |
| RF07 documentos | Document service | P5 | T13–T16 |
| RF08 destinos | Routing | P4/P5 | T11/T12 |
| RF09 correo | Delivery worker | P5 | T10/T23/T28 |
| RF10 resultado | Engine/adapters | P5/P6 | T10/T22/T23 |
| RF11 contactos | Directory/routing | P4 | T11/T12/T20 |
| RF12 incidencias | Operations UI | P4/P5 | E2E + estados |
| RF13 comandos | Engine | P2 | Casos cancelar/reiniciar + T05 |
| RF14 auditoría | Audit | P4 | E2E + permiso |
| RF15 retención | Purge worker | P7 | T27 |
| RNF01 permisos | Todos | P4/P7 | T17/T20/T26 |
| RNF02 ACK durable | Inbox | P2/P6 | T07/T08 |
| RNF03 deduplicación | Inbox/outbox | P2/P5 | T04/T09/T10 |
| RNF04 orden | Engine host | P2 | T05/T06/T09 |
| RNF05 archivos | Documents | P5 | T14/T15/T16/T17 |
| RNF06 recuperación | Operations | P7 | T24 |
| RNF07 performance | API/worker | P7 | Carga |
| RNF08 observabilidad | Telemetry | P5/P7 | Revisión de logs/alertas |
| RNF09 mantenimiento | Contracts/domain | P1–P7 | CI/ADR/revisión |
| RNF10 ambientes | Adapters/config | P1/P3/P6 | T18 + allowlist |

Mantener esta matriz al cambiar requisitos. Una pantalla visible no satisface un requisito si el backend no implementa su comportamiento y permisos.
