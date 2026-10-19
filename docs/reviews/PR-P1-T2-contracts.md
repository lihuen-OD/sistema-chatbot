# P1-T2 — Contratos de eventos, errores y DTO iniciales

## Problema resuelto

El host, el simulador, los futuros adaptadores y la API necesitaban contratos compartidos que distinguieran el origen de cada entrada, acotaran los datos públicos y conservaran las referencias necesarias para aplicar ADR-011 y ADR-014 sin tratarlas como autorización.

## Alcance

- `packages/contracts`, con tipos TypeScript y validación en tiempo de ejecución.
- Eventos normalizados `ADAPTER`, `JOB` y `SIMULATOR` y vinculación agregada por el host.
- Errores de API, diagnósticos del motor, motivos de bloqueo y conversión acotada de problemas de `flow-schema`.
- DTO iniciales de borrador, validación, publicación y solicitud de eventos de simulación.
- Pruebas, documentación e integración del paquete en los checks del workspace.

Quedan fuera la base de datos, el host/motor, HTTP, autenticación y autorización, persistencia, concurrencia, idempotencia, payloads reales de proveedores y efectos externos.

## Cambios relevantes

- Las acciones `CONFIRM`, `REPLACE`, `CANCEL` y `CHOOSE` exigen y prohíben referencias según su variante.
- Los resultados internos conservan trabajo, trámite, generación y documento o entrega.
- `FILE_RECEIVED` puede omitir `providerTimestamp` para que el host produzca `FILE_NOT_CORRELATED`; las demás entradas del adaptador lo exigen para poder fijar el ancla de correlación.
- El simulador usa eventos propios y archivos por metadatos; producción rechaza esa fuente.
- Las identidades del canal son datos a resolver, no prueba de identidad laboral ni autorización.
- Los detalles públicos tienen listas permitidas y límites; los códigos de `flow-schema` no se duplican.
- `contracts` depende solo de `flow-schema` y no usa APIs de Node en su código distribuido.

## Validación

Resultados locales con Node 24.21.0 y pnpm 12.12.1:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Ambos comandos terminaron con código 0. El check aprobó typecheck, lint, formato, límites entre paquetes, build, 112 pruebas de `flow-schema` y 170 de `contracts`.

En un checkout limpio y aislado del commit de código, la instalación usó un store temporal vacío (132 paquetes descargados) y ambos comandos volvieron a terminar con código 0. La comprobación del SHA final y la URL de su CI se informan al entregar; el detalle queda en `PROJECT_STATUS.md`.

## Limitaciones

Validar estos esquemas no demuestra autenticidad, autorización, persistencia, orden, concurrencia ni idempotencia. Las pruebas del simulador tampoco validan Meta, archivos reales, antimalware ni entrega de correo.
