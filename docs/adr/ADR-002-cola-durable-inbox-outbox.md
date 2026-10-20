# ADR-002 — Inbox/outbox y cola durable en PostgreSQL, con leases, fencing y apagado ordenado

- Fecha: 19/10/2026
- Estado: Aceptada
- Responsable: propietario del proyecto
- Revisión: al iniciar P2 (implementación propia o biblioteca) y si el volumen supera la capacidad medida de la cola en PostgreSQL.

## Contexto

El webhook debe persistir antes de responder 200. Los eventos llegan al menos una vez y los efectos externos (correo, mensajes de WhatsApp) no tienen garantía de entrega única. El kit original pedía "no matar jobs sin liberación/lease", y eso es incorrecto cuando hay una llamada externa en curso: liberar el lease permite que otro worker repita un efecto que quizás ya ocurrió (corrección 2).

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Redis + biblioteca de colas | Agrega un servicio y su configuración de durabilidad; no se justifica con el volumen previsto |
| Biblioteca de colas sobre PostgreSQL | Viable. Se evalúa al iniciar P2: debe permitir encolar en la misma transacción que el cambio de dominio, exponer fencing por reclamo y respetar la serialización definida acá |
| Cola gestionada de un proveedor cloud | Atadura al proveedor y costo; no permite encolar en la transacción de dominio |
| Memoria o `setTimeout` | Rechazada: se pierde con un reinicio |

## Decisión

Este ADR fija la semántica. La elección entre implementación propia o biblioteca se toma en P2 con un addendum, siempre que la cumpla.

**Inbox.** El webhook verifica la firma sobre el cuerpo original y la cuenta. En una transacción inserta cada evento (`MessageEvent`, único por `channelId` + `externalEventKey`) y su `Job`. Responde 200 solo después del commit; un duplicado ya durable también recibe 200.

**Outbox.** La transición del motor y sus `OutboxAction` se guardan en la misma transacción. `actionKey` es única.

**Reclamo y fencing.** Un worker reclama con `FOR UPDATE SKIP LOCKED`, fija `leaseOwner` y `leaseUntil`, incrementa `fencingToken` y pasa el job a `RUNNING`. Toda escritura posterior (resultado, heartbeat, reprogramación) se condiciona a `jobId` + `fencingToken` vigente.

**Serialización.** Las transiciones del motor se serializan por clave: `channelId` + `employeeId` para remitentes identificados, o `channelId` + `channelIdentityId` para no identificados (ADR-011). Se usa un lock transaccional por clave dentro de la transacción corta de transición, más control de revisión de `Submission`. Nunca se mantiene un lock ni una transacción SQL abierta durante una llamada externa.

**Efectos externos en dos fases.**

1. Antes de llamar al proveedor se confirma, en una transacción propia, un `DeliveryAttempt` (o intento de mensaje saliente) en fase `DISPATCHING` con su `idempotencyKey`, derivada de `actionKey`.
2. Se llama al proveedor con un timeout acotado, menor que la duración del lease menos un margen.
3. Se registra el resultado con fencing: `SUCCEEDED`, `FAILED` (reintentable o definitivo) o `UNKNOWN`.

**Apagado ordenado (SIGTERM).**

1. El proceso deja de estar listo (readiness) y deja de reclamar trabajos.
2. Los trabajos reclamados que todavía no iniciaron un efecto externo se liberan: vuelven a `READY`, se limpia el lease y no se cuenta el intento.
3. Las transiciones en curso (solo base de datos) terminan o hacen rollback; después se liberan.
4. **Los trabajos con una llamada externa en curso no liberan su lease.** El worker sigue enviando heartbeats hasta que la llamada termina y el resultado queda registrado, o hasta el plazo de gracia.
5. Si se alcanza el plazo de gracia, el worker deja de enviar heartbeats y termina sin liberar. El lease vence solo.
6. Cierra el pool y sale.

El plazo de gracia del despliegue debe superar el timeout máximo de llamada más el margen de registro. Si la plataforma no lo permite, se reduce el timeout de esos adaptadores o se acepta y documenta que una terminación forzada sigue el camino de recuperación.

**Recuperación.** Cuando vence el lease, otro worker reclama el job con un `fencingToken` nuevo. Si el último intento quedó en `DISPATCHING` sin resultado, no se reintenta a ciegas:

| Capacidad del proveedor | Tratamiento |
|---|---|
| Clave de idempotencia documentada y todavía vigente | Reintentar con la misma clave y registrar el resultado |
| Consulta de estado por clave o correlación | Consultar y registrar el resultado |
| Ninguna de las anteriores (por ejemplo, SMTP) | Intento `UNKNOWN`; entrega o mensaje en `UNCERTAIN`; job en `NEEDS_RECONCILIATION`; trámite en `NEEDS_REVIEW` si queda bloqueado; alerta al operador |

Reintentar un resultado incierto sin conciliación exige una decisión explícita y auditada del operador que acepte el riesgo de duplicado.

**Resultados tardíos.** Si el worker que perdió el lease recibe después la respuesta del proveedor, su escritura de estado se rechaza por fencing, pero la observación no se descarta: se agrega como `EffectObservation` (solo inserción) y dispara la conciliación, porque prueba que el efecto externo ocurrió.

**Reintentos y límites.** Backoff exponencial con jitter, respeto de `Retry-After`, máximo de intentos por tipo de trabajo y estado `DEAD` visible. Límites de concurrencia separados para descarga, scanner, correo y WhatsApp.

## Costos

Más código y más estados que una cola simple. El sondeo genera carga en PostgreSQL (LISTEN/NOTIFY es una optimización opcional). Los operadores tienen que atender `NEEDS_RECONCILIATION`.

## Consecuencias

- La duración del lease, los timeouts por adaptador y el plazo de gracia del despliegue pasan a ser configuración documentada y probada.
- Un apagado nunca convierte un efecto en curso en un reintento ciego.
- Las métricas incluyen jobs en `NEEDS_RECONCILIATION` y observaciones tardías.

## Invariantes

- No hay 200 antes del commit del inbox.
- No hay una transacción SQL abierta durante una llamada externa.
- No se libera el lease de un job con una llamada externa en curso.
- Toda escritura de estado de un job lleva el `fencingToken` vigente.
- Un intento `DISPATCHING` sin resultado no vuelve a ejecutarse sin conciliación o decisión auditada del operador.

## Pruebas

T07, T08, T09, T10, T28 y T31 (`docs/09_PRUEBAS_Y_ACEPTACION.md`).

## Documentos afectados

`docs/02_ARQUITECTURA.md` §7, `docs/04_MODELO_DATOS.md` (Job, DeliveryAttempt, EffectObservation), `docs/08_CONFIABILIDAD.md`, `docs/10_ENTORNOS_Y_OPERACION.md` (despliegue).

## Addendum P1-T3 — outbox mínima y `jobs` en P2 (20/10/2026)

No cambia la decisión. Precisa qué parte del modelo existe antes de elegir la cola.

- **`outbox_actions` en P1-T3, solo con lo que no depende de la cola:**
  - `logical_key` única;
  - tipo de acción;
  - trámite y generación fijados al crear, con clave foránea compuesta y sin reasignación;
  - referencia opcional a la entrega;
  - estados `PENDING`, `CLAIMED`, `DONE` y `CANCELLED`, con `CANCELLED` terminal.
- **Pendientes para P2:** el payload, los datos del reclamo y los índices de la cola.
- **`jobs` no se crea en P1-T3.** Estados, lease, `fencing_token`, intentos, `run_after`, prioridad, clave de serialización e índices de reclamo dependen de la elección entre cola propia y biblioteca, que se hace al iniciar P2. Es una desviación del alcance de P1-T3 en `docs/15_PLAN_CONSOLIDADO_P0.md` §9, aprobada por el propietario.
- **Obligaciones de P2 con cualquier cola:**
  - escrituras condicionadas por `fencingToken` (T09);
  - trabajos que conservan trámite y generación (T51);
  - acciones canceladas que nunca se reclaman (T49).
