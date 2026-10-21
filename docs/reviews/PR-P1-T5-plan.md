# Plan de P1-T5 — adaptadores locales (solo documentación)

## Destino del PR

`main` (`aaf0002`). La rama sale de `main` actualizada y no depende de otra rama abierta.

## Problema resuelto

P1-T5 de `docs/15` §9 (carpeta privada, captura de correo y scanner simulado, que no se puedan usar con `APP_ENV=production`) necesita un plan aprobado antes de implementarse. Además, el estado del proyecto seguía describiendo P1-T4 como pendiente de revisión.

## Alcance

Solo documentación. No incluye código, dependencias, configuración ni migraciones. No inicia P1-T5.

## Cambios relevantes

- **`docs/plans/P1-T5-adaptadores-locales.md`**, el plan propuesto:
  - **paquete nuevo `packages/adapters`:** dependencias internas solo de `contracts` y `flow-schema`, sin dependencias de npm nuevas, sin red ni procesos en los módulos locales. Los puertos quedan en el paquete hasta que exista `domain` (P2);
  - **guardas de entorno:** solo `development` y `test`, comprobadas en la configuración, en cada fábrica y en cada operación;
  - **almacenamiento privado:**
    - claves opacas generadas por el adaptador;
    - temporal con `O_EXCL` y `O_NOFOLLOW`, límite de bytes durante la escritura y publicación con `link`, sin sobrescribir;
    - permisos 0700 y 0600, borrado idempotente;
    - qué controles son del adaptador y cuáles del host;
  - **captura de correo:**
    - resultado `CAPTURED` con `delivered: false`, distinto de `PROVIDER_ACCEPTED` y `DELIVERED`;
    - formato `message.json` más `attachment.bin`, publicación atómica;
    - repetición por clave de idempotencia y conflicto si el contenido cambia;
    - CR y LF rechazados en el asunto final;
  - **scanner simulado:**
    - procedencia `SIMULATED` y etiqueta en cada resultado;
    - escenarios deterministas de aprobación, rechazo, resultado inconcluso, falla y demora;
    - no lee bytes;
    - la composición rechaza combinarlo con un correo que entrega de verdad;
  - pruebas con archivos reales, riesgos, secuencia de implementación y criterios de salida;
  - lo que sigue sin cubrirse hasta P5.
- **`PROJECT_STATUS.md`:**
  - situación, ramas, etapas y pendientes actualizados: P1-T4 cerrada con los PR #7 a #10, `main` en `aaf0002`;
  - una entrada nueva que separa lo comprobado por mí de lo informado por el propietario. Las entradas anteriores no cambian.
- **`docs/15_PLAN_CONSOLIDADO_P0.md` §9:** cierre de P1-T4 y estado del plan de P1-T5.
- **ADR-009:** nota fechada sobre el Node del sistema (24.22.1), debajo del texto anterior, que no se modificó.

## Decisiones que necesitan al propietario

1. **Cambia comportamiento:** rechazar en la API `STORAGE_MODE`, `EMAIL_MODE` y `SCANNER_MODE` locales con `APP_ENV=staging`.
   - Hoy la API arranca así contra el contenedor local, porque las guardas de base no rechazan `staging`.
   - Alternativa: no tocar la API y confiar en las guardas del paquete.
2. **Antes de P2:**
   - cómo se registra una captura en `deliveries`;
   - dónde se guarda la procedencia de un análisis, que hoy no está en `DOCUMENT_SCAN_RESULT` ni en `documents`.

Las demás decisiones del plan (§16) tienen un valor por defecto que se acepta al aprobarlo, salvo objeción.

## Validación

`pnpm run format:check` y `pnpm run check` terminaron con código 0. No hay pruebas nuevas, porque no hay código nuevo. CI: en el informe de la entrega.

## Limitaciones

- El plan no está aprobado.
- **Sin prueba de concepto:** los detalles de sistema de archivos se basan en la semántica POSIX documentada:
  - `link` sin sobrescritura;
  - `rename` de directorios no vacíos;
  - `O_NOFOLLOW`.

  Se comprueban en macOS y en Linux (CI) recién al implementar.
