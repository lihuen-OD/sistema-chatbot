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
- Los borradores (`definition` y `layout`) admiten contenido incompleto. Antes de la validación recursiva, un recorrido iterativo acota cada campo a 32 niveles y 250.000 valores. Si se superan, el resultado es un problema controlado, sin `RangeError`. El límite de valores admite una definición en los límites de tamaño de `FLOW_LIMITS`.
- El índice de `RULE_SET` en el informe de validación es un entero seguro no negativo sin máximo propio: conserva la posición real del conjunto y el informe convertido pasa su propio esquema.

## Correcciones de la revisión de `07b8767`

| Hallazgo | Antes (reproducido con Node 24.21.0 y Zod 4.6.6) | Después |
|---|---|---|
| Borrador de 6.000 niveles en `definition`, `layout` o respuesta de lectura | `RangeError: Maximum call stack size exceeded` | `success: false`, problema `custom` con `reason: "MAX_DEPTH"` y `limit: 32` |
| Problema en `ruleSets[1000]` | El informe conserva `index: 1000`, pero `validationReportSchema` lo rechaza (`too_big`, máximo 999) | El informe conserva `index: 1000` y pasa el esquema |

Las regresiones están en `packages/contracts/test/review-regressions.test.ts`. Sobre el código anterior fallaban 9 de 11. Las 2 que pasaban comprueban comportamiento que debía conservarse. La prueba 12, sobre `FLOW_LIMITS`, se agregó después y falla si el límite de valores vuelve a 50.000.

## Validación

Resultados locales con Node 24.21.0 y pnpm 12.12.1:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Ambos comandos terminaron con código 0. El check aprobó typecheck, lint, formato, límites entre paquetes, build, 112 pruebas de `flow-schema` y 182 de `contracts`.

Se verificó un checkout limpio y aislado del commit de código de las correcciones (`a97d585`):
- la instalación usó un store temporal vacío (132 paquetes descargados);
- ambos comandos volvieron a terminar con código 0.

## Resultado

- **Fusión:** con el PR #3 en `main` (merge `6c3804f`).
- **CI del último commit de la rama** (`fdfee82`): run #8 en `success` (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/39278871678).
- **CI del merge en `main`** (`6c3804f`): run #9 en `success` (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/39283148279). El árbol de `6c3804f` es idéntico al de `fdfee82`.

El detalle queda en `PROJECT_STATUS.md`.

## Limitaciones

- Validar estos esquemas no demuestra autenticidad, autorización, persistencia, orden, concurrencia ni idempotencia. Las pruebas del simulador tampoco validan Meta, archivos reales, antimalware ni entrega de correo.
- Los límites del borrador acotan la estructura, no los bytes. El límite del cuerpo HTTP (413) sigue pendiente para la API.
- Observación fuera de alcance: `flow-schema` no limita la cantidad de valores de una variable `enum`. Una definición con una lista enorme puede no recibir error de tamaño y aun así superar el límite del borrador. Queda registrada en `PROJECT_STATUS.md` para que decida el propietario.
