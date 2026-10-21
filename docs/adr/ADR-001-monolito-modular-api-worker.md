# ADR-001 — Monolito modular con API y worker

- Fecha: 19/10/2026
- Estado: Aceptada
- Responsable: propietario del proyecto
- Revisión: cuando métricas de carga o requisitos de aislamiento justifiquen separar un módulo en un servicio propio.

## Contexto

Equipo reducido, volumen inicial bajo o medio y tareas lentas (descarga de media, análisis, correo) que no pueden ejecutarse dentro del HTTP del webhook. El motor de flujos tiene que ser independiente de la interfaz, de WhatsApp y del correo.

## Alternativas

| Alternativa | Motivo de descarte |
|---|---|
| Un solo proceso | Mezcla la latencia del webhook con trabajos lentos; no permite aislar ni escalar el worker |
| Microservicios | Costo operativo y contratos distribuidos sin una necesidad que los justifique |
| Funciones serverless | Leases largos, procesos permanentes y timeouts difíciles de garantizar |

## Decisión

Monorepo con un monolito modular y dos procesos desplegables (API y worker) más el panel:

```
apps/
  admin/        React: panel, editor y simulador
  api/          HTTP: autenticación, administración, simulaciones y webhooks
  worker/       ejecución durable: inbox, outbox, archivos, correo y WhatsApp
packages/
  flow-schema/  DSL v1: tipos, esquemas, validación estructural y semántica, cobertura de reglas
  flow-engine/  motor puro, sin E/S
  domain/       entidades, invariantes y políticas (identidad, clasificación, distribución)
  contracts/    DTO HTTP, envelope de eventos y códigos de error
  db/           Kysely, migraciones SQL y repositorios (ADR-010)
  adapters/     WhatsApp, correo, almacenamiento y scanner: reales, simulados y de captura
```

`packages/db` no figuraba en el kit original; se agrega para que API y worker compartan migraciones y tipos de base sin duplicarlos.

Reglas de dependencia:

- `flow-schema` no depende de otros paquetes internos.
- `flow-engine` depende solo de `flow-schema`. No usa reloj, aleatoriedad, red ni base: tiempo e IDs se inyectan.
- `contracts` depende solo de `flow-schema`, para reutilizar sus códigos y esquemas, y no usa APIs de Node. `flow-schema` nunca depende de `contracts`. Precisión registrada en P1-T2 (19/10/2026); el control está en `scripts/check-workspace-boundaries.mjs` y en ESLint.
- `db` no depende de otros paquetes internos y usa APIs de Node: archivos de migración, criptografía y `pg`. `domain` y `flow-engine` no dependen de `db`. Precisión registrada en P1-T3 (20/10/2026); el control está en `scripts/check-workspace-boundaries.mjs` y en ESLint.
- `domain` no conoce HTTP, base ni proveedores.
- `adapters` implementa interfaces declaradas en `domain`/`contracts`.
- Las apps componen paquetes. Los controllers son delgados y la lógica de negocio vive en `domain` y `flow-engine`.
- `admin` puede usar `flow-schema` para validación previa en el navegador; el servidor sigue siendo la autoridad.

## Consecuencias

- API y worker comparten el esquema de base: las migraciones siguen expand/contract.
- Pueden convivir en un mismo host al inicio, pero la separación lógica se mantiene.
- Hay que hacer cumplir los límites de dependencia con lint en CI desde P1.

## Invariantes

- El motor no importa HTTP, base de datos ni SDK de proveedores.
- El webhook no ejecuta descargas, análisis ni envíos dentro de la petición.

## Pruebas

Regla de lint de dependencias en CI (P1). T07/T08 verifican que el webhook solo persiste (P2/P6).

## Documentos afectados

`docs/02_ARQUITECTURA.md` §2 y §11, `docs/03_PLAN_DESARROLLO.md` P1, `docs/15_PLAN_CONSOLIDADO_P0.md`.

## Addendum del 21/10/2026 — dependencias de `apps/api` (P1-T4)

Precisión de las reglas de dependencia; la decisión no cambia.

- `apps/api` depende de `contracts` y de `db`. `flow-schema` se agrega cuando una ruta lo use (P3/P4).
- Dentro de la API, `src/auth` (contraseñas, sesiones, límites, admisión) no importa Express ni otros módulos HTTP, que viven en `src/http`. Así los controllers son delgados.
- La autenticación administrativa es infraestructura del host, no dominio del trámite: queda en la app y no en `domain`.
- La configuración también vive en la API por ahora. Si el worker la necesita (P2), se extrae a un paquete con su addendum.
- Controles: `scripts/check-workspace-boundaries.mjs` y ESLint (`no-restricted-imports`).
