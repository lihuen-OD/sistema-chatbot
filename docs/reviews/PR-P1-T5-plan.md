# Plan de P1-T5 — adaptadores locales (solo documentación)

## Destino del PR

`main` (`aaf0002`). La rama sale de `main` actualizada y no depende de otra rama abierta.

## Problema resuelto

P1-T5 de `docs/15` §9 necesita un plan aprobado antes de implementarse: carpeta privada, captura de correo y scanner simulado, sin uso posible con `APP_ENV=production`. Además, el estado del proyecto seguía describiendo P1-T4 como pendiente de revisión.

## Alcance

Solo documentación. No incluye código, dependencias, configuración ni migraciones, y no inicia P1-T5. Ningún control descrito en el plan está implementado.

## Cambios relevantes

### `docs/plans/P1-T5-adaptadores-locales.md`

- **Paquete nuevo `packages/adapters`:**
  - depende solo de `contracts` y `flow-schema`;
  - sin dependencias de npm nuevas;
  - sin red ni procesos en los módulos locales.
- **Entornos:** solo `development` y `test`, comprobados en la configuración, en cada fábrica y en cada operación. La API rechaza los modos locales en `staging`.
- **Raíz y antecesores (§6):**
  - se recorren la ruta configurada y la canónica;
  - solo se admiten enlaces de root dentro de directorios confiables;
  - los antecesores deben ser de root o del usuario, sin escritura de grupo ni de otros. La única excepción, por propiedad, son los directorios de root con bit sticky;
  - en cada operación se compara el inodo de la raíz y del subdirectorio que usa;
  - la limitación frente a procesos del mismo usuario y frente a las ACL de macOS queda explícita.
- **Área de trabajo (§7):**
  - un directorio por instancia, con arrendamiento;
  - la recuperación nunca borra temporales de instancias vivas;
  - los abandonados se reclaman con un `rename` atómico, de modo que una carrera con la publicación termina en un fallo seguro.
- **Almacenamiento (§8):**
  - claves opacas y publicación con `link`, sin sobrescribir;
  - una tabla de resultados por fase, antes y después del punto de publicación;
  - si falla el `fsync` del directorio, retira el objeto e informa la clave;
  - distingue la visibilidad atómica de la durabilidad.
- **Captura (§9):**
  - resultado `CAPTURED` con `delivered: false`;
  - un registro sin datos personales, más el contenido;
  - resultados por fase. Un reintento reconoce una captura publicada, verifica su contenido y no la duplica;
  - la purga borra el contenido a los 7 días y conserva el registro hasta los 30, que es el alcance de la idempotencia local;
  - lo que deberá garantizar el host en P2.
- **Scanner simulado (§10):**
  - procedencia `SIMULATED` y etiqueta en cada resultado;
  - escenarios deterministas, con `INCONCLUSIVE` por defecto;
  - no lee bytes.
- **Además:** pruebas previstas, riesgos, secuencia y criterios de salida.

### Otros archivos

- **`PROJECT_STATUS.md`:**
  - situación, ramas, etapas y pendientes actualizados: P1-T4 cerrada con los PR #7 a #10, `main` en `aaf0002`;
  - entradas nuevas que separan lo comprobado por mí de lo informado o decidido por el propietario. Las entradas anteriores no cambian.
- **`docs/15_PLAN_CONSOLIDADO_P0.md` §9:** cierre de P1-T4 y estado del plan de P1-T5.
- **ADR-009:** nota fechada sobre el Node del sistema (24.22.1), debajo del texto anterior, que no se modificó.

## Decisiones aprobadas por el propietario (21/10/2026)

Están registradas como decisiones de diseño, no como controles implementados:
1. La configuración de la API rechaza con `staging` los modos locales de almacenamiento, captura de correo y scanner simulado.
2. El escenario predeterminado del scanner es `INCONCLUSIVE`. `APPROVED` se elige explícitamente.
3. El registro de `CAPTURED` y la procedencia del análisis en contratos y base quedan para P2, antes de integrar estos adaptadores al host.

Las demás decisiones del plan (§18.2) tienen un valor por defecto que se acepta al aprobarlo, salvo objeción.

## Validación

`pnpm run format:check` y `pnpm run check` terminaron con código 0. No hay pruebas nuevas, porque no hay código nuevo. CI: en el informe de la entrega.

## Limitaciones

- El plan no está aprobado en su totalidad.
- **Sin prueba de concepto:** los detalles de sistema de archivos se basan en la semántica POSIX documentada:
  - `link` sin sobrescritura;
  - `rename` de directorios no vacíos;
  - `O_NOFOLLOW`;
  - bit sticky.

  Se comprueban en macOS y en Linux (CI) recién al implementar.
- **Única observación local:** la estructura de `/tmp`, `/var` y `os.tmpdir()` en el equipo del propietario (macOS).
