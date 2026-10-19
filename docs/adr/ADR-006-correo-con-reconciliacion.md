# ADR-006 — Correo transaccional con reconciliación

- Fecha: 19/10/2026
- Estado: Aceptada en principios. La elección de proveedor queda pendiente para P5 y requiere decisión del propietario con costo; no se contrata nada en esta etapa.
- Responsable: propietario del proyecto
- Revisión: al elegir proveedor en P5.

## Contexto

El correo es el efecto principal del sistema. Un timeout después de que el proveedor aceptó el mensaje puede producir duplicados si se reintenta a ciegas. AGENTS.md prohíbe marcar ENTREGADO por recibir HTTP 200 y exige registrar estado incierto cuando no se puede conciliar.

## Alternativas

| Alternativa | Evaluación |
|---|---|
| API transaccional con claves de idempotencia, consulta de estado y webhooks | Preferida |
| SMTP | Alternativa aceptable con consecuencias: sin deduplicación ni consulta, los timeouts terminan en `UNCERTAIN` |

## Decisión

- Interfaz del adaptador: `send(idempotencyKey, message)` → aceptado (`providerMessageId`) | rechazado | desconocido; `queryStatus` opcional; normalización de webhooks firmados.
- Desarrollo: adaptador de captura local que no entrega. Staging: allowlist de destinatarios. Producción: proveedor elegido en P5.
- Estados de `Delivery` (código / etiqueta): `PENDING` Pendiente, `PROCESSING` Procesando, `PROVIDER_ACCEPTED` Aceptado por el proveedor, `DELIVERED` Entregado, `BOUNCED` Rebotado, `FAILED` Fallido, `UNCERTAIN` Resultado incierto, `BLOCKED` Bloqueado.
- `PROVIDER_ACCEPTED` no es `DELIVERED`. Solo un evento del proveedor que lo indique produce `DELIVERED`; un HTTP 200 nunca.
- En V1 el trámite se completa con `PROVIDER_ACCEPTED`. Un rebote posterior actualiza la entrega sin reabrir el trámite.
- La clave de idempotencia se deriva de la acción lógica, no del hash del documento. Si la vigencia de la deduplicación del proveedor vence, ya no se asume protección contra duplicados.
- Reenvío manual = acción nueva, con motivo, actor y referencia a la original. Destinatarios nuevos generan otra entrega auditada.

## Costos

Dependencia de un proveedor con costo recurrente (a presupuestar en P5). Configuración de dominio (SPF/DKIM/DMARC) antes de producción.

## Consecuencias

- Los mensajes al empleado no prometen entrega ni lectura.
- La conciliación de `UNCERTAIN` es una tarea operativa con permisos y auditoría.

## Invariantes

- Ningún correo sale desde simulación ni desarrollo.
- Ningún estado `DELIVERED` sin evidencia del proveedor.

## Pruebas

T10, T23, T28 y T31.

## Documentos afectados

`docs/08_CONFIABILIDAD.md`, `docs/04_MODELO_DATOS.md`, `docs/02_ARQUITECTURA.md` §12.
