# ADR-011 — Empleado canónico e identidades de canal con ámbito

- Fecha: 19/10/2026
- Estado: Aceptada
- Responsable: propietario del proyecto
- Revisión: en P6, al verificar en documentación oficial de Meta el formato, el ámbito y la presencia del identificador de usuario en los webhooks; y antes de habilitar documentos sensibles con datos reales.

## Contexto

- El kit modelaba `EmployeePhone`, una conversación activa por remitente y número, y un trámite activo por conversación.
- Según la revisión del 14/10/2026, los webhooks de WhatsApp pueden traer un identificador de usuario con ámbito de negocio (BSUID, campo `user_id`) además del teléfono, o en lugar de él.
- Un mismo empleado puede llegar por más de una identidad: teléfono y BSUID, o un número nuevo.
- El requisito es un solo trámite activo por empleado y número empresarial, aunque use varias identidades (corrección 1).
- Un teléfono no prueba por sí solo la identidad laboral.

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Teléfono como identidad (`EmployeePhone`) | Rechazada: falla si el evento trae solo BSUID |
| Unicidad por conversación o remitente | Rechazada: dos identidades del mismo empleado podrían abrir dos trámites en paralelo |
| Empleado canónico con identidades de canal que conservan su ámbito | Elegida |

## Decisión

**Modelo.**

- `Employee` es la entidad canónica: estado, legajo y ámbitos de empresa.
- `ChannelIdentity` vincula una identidad externa a un empleado:

| Campo | Valores |
|---|---|
| `provider` | `WHATSAPP` |
| `kind` | `PHONE_E164`, `WHATSAPP_BSUID` |
| `scopeType` / `scopeId` | Ámbito del identificador: `E164` global para teléfonos; para BSUID, el ámbito de negocio que defina Meta (a verificar en P6) |
| `normalizedValue` | Valor opaco normalizado |
| `status` | `PENDING_VERIFICATION`, `ACTIVE`, `REVOKED` |
| `linkMethod` | `DIRECTORY_ENROLLMENT`, `PROVIDER_ASSERTED`, `ADMIN_APPROVED` |
| Otros | `verifiedAt`, `revokedAt`, `createdBy` |

**Unicidad.** Una identidad `ACTIVE` (`provider`, `kind`, `scopeType`, `scopeId`, `normalizedValue`) pertenece a un solo empleado, garantizado por un índice único parcial. Los valores nunca se comparan entre ámbitos distintos.

**Vinculación.**

- Los teléfonos se enrolan desde el directorio autorizado.
- Un BSUID se vincula automáticamente (`PROVIDER_ASSERTED`) solo si se cumplen tres condiciones: llega en un evento firmado del canal configurado, viene junto a un teléfono `ACTIVE` de un empleado y no está activo en otro empleado. Queda auditado.
- Un BSUID sin teléfono vinculado se trata como remitente no identificado: mensaje genérico de enrolamiento, sin trámite y sin revelar si existe el legajo. Un administrador puede vincularlo (`ADMIN_APPROVED`).
- Conflicto (identidad activa en otro empleado, o teléfono y BSUID del mismo evento que apuntan a empleados distintos): no se crea ni avanza ningún trámite, se registra una incidencia de revisión y nunca se revincula automáticamente.

**Resolución de un evento entrante.** Todas las identidades del evento deben resolver al mismo empleado, o a ninguno. La clave de serialización es `channelId` + `employeeId` (ADR-002).

**Un trámite activo por empleado y número empresarial.** Índice único parcial sobre `Submission(employee_id, channel_id)` para los estados no terminales; la creación ocurre en transacción. Ante un conflicto se ofrece continuar o cancelar el trámite existente. Un remitente no identificado no puede crear trámites.

**Conversaciones.** `Conversation` es el hilo del canal por `channelId` + `channelIdentityId` y guarda la ventana de atención (`lastInboundAt`). Para escribirle a un empleado se usa la identidad con la entrada más reciente dentro de una ventana abierta. Si ninguna ventana está abierta, el mensaje queda retenido (ADR-013).

**Respuestas.** Una respuesta es válida solo si llega desde una identidad `ACTIVE` del empleado del trámite y corresponde al prompt activo.

**Revocación y cambio de número.** Revocar una identidad no cancela el trámite. Una entrada posterior desde esa identidad se trata como no identificada. Los mensajes salientes a esa identidad que todavía no se despacharon se cancelan.

**Empleado desactivado.** No avanza pasos ni ejecuta efectos sensibles (excepción ya prevista en requisitos).

## Costos

Más complejidad en la resolución de identidad y en el directorio. Hay que administrar conflictos y vinculaciones manuales.

## Consecuencias

- Un teléfono compartido por dos empleados no está soportado en V1 (ADR-013).
- La verificación adicional para documentos sensibles sigue pendiente. No bloquea P1, pero sí el uso con datos reales sensibles.
- El formato real del BSUID no afecta al modelo: se guarda como valor opaco con su ámbito.

## Invariantes

- Una identidad activa pertenece a un solo empleado.
- Un empleado tiene como máximo un trámite activo por número empresarial.
- Ningún trámite pertenece a un remitente no identificado.

## Pruebas

T05, T26, T29 y T30.

## Documentos afectados

`docs/01_REQUISITOS.md` (RF05), `docs/02_ARQUITECTURA.md` §6 y §10, `docs/04_MODELO_DATOS.md`, `docs/05_CONTRATOS_API.md`, `docs/07_SEGURIDAD.md`, `docs/08_CONFIABILIDAD.md`, `examples/directorio_demo.json`.
