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
  - sin red ni procesos en los módulos locales;
  - dos puntos de entrada: uno para los adaptadores y otro, separado, para el mantenimiento.
- **Entornos:** solo `development` y `test`, comprobados en la configuración, en cada fábrica y en cada operación. La API rechaza los modos locales en `staging`.
- **Raíz y antecesores (§6):**
  - se recorren la ruta configurada y la canónica;
  - solo se admiten enlaces de root dentro de directorios confiables;
  - los antecesores deben ser de root o del usuario, sin escritura de grupo ni de otros. La única excepción, por propiedad, son los directorios de root con bit sticky;
  - en cada operación se compara el inodo de la raíz y del subdirectorio que usa;
  - la limitación frente a procesos del mismo usuario y frente a las ACL de macOS queda explícita.
- **Limpieza en ejecución y mantenimiento (§7):**
  - un proceso pausado puede seguir vivo, así que no hay arrendamientos ni plazos de abandono;
  - en ejecución solo se limpia lo propio sin operación activa y `.reclaim/`. Nunca se tocan los temporales ni los bloqueos de otras instancias, ni el material que conservan;
  - los temporales y bloqueos que deja una caída se recuperan solo con un mantenimiento explícito (`recoverStoppedRoot`), con todos los consumidores detenidos;
  - el procedimiento y sus precondiciones están documentados. Se aclara que ni un plazo ni una confirmación demuestran que los procesos estén detenidos;
  - una tabla separa lo que se limpia en cada caso.
- **Almacenamiento (§8):**
  - claves opacas y publicación con `link`, sin sobrescribir;
  - una tabla de resultados por fase, antes y después del punto de publicación;
  - si falla el `fsync` del directorio, retira el objeto e informa la clave;
  - distingue la visibilidad atómica de la durabilidad.
- **Captura (§9):**
  - resultado `CAPTURED` con `delivered: false`;
  - un registro sin datos personales y con `publicationId`, más el contenido;
  - **bloqueo por `captureId` entre instancias (§9.4):**
    - se adquiere con un `rename` atómico, que traslada también la captura preparada, así que el material retenido nunca queda en `tmp/`;
    - la publicación, la verificación y la purga ocurren bajo el bloqueo;
    - sin ruptura automática. Un titular pausado lo conserva;
    - `send` espera hasta 5 s y recibe `KEY_BUSY`, y la purga omite las claves ocupadas;
    - un bloqueo abandonado por una caída se recupera solo con el mantenimiento;
  - la purga relee bajo el bloqueo y omite una captura con otro `publicationId`, es decir, una recreada después de su escaneo;
  - resultados por fase. Un reintento reconoce una captura publicada, verifica su contenido y no la duplica;
  - **entrada sin `record.json`:** es `CaptureIntegrityError`, no se sobrescribe ni se borra. Un directorio ausente se interpreta según ocurra al comenzar, durante o fuera de la sección bajo bloqueo (§9.7);
  - la purga borra el contenido a los 7 días y conserva el registro hasta los 30, que es el alcance de la idempotencia local;
  - lo que deberá garantizar el host en P2, incluida la alerta ante un `KEY_BUSY` persistente.
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
4. **Simplificación del bloqueo de capturas:**
   - sin ruptura automática por vencimiento;
   - sin el traslado del directorio del token como garantía de cercado;
   - la recuperación de bloqueos abandonados es solo un mantenimiento explícito con los consumidores detenidos.

El propietario también fijó dos requisitos, registrados en §18.1:
- una purga no puede eliminar una captura recreada con el mismo `captureId`;
- un directorio sin registro es un error de integridad.

Las demás decisiones del plan (§18.2) tienen un valor por defecto que se acepta al aprobarlo, salvo objeción. Entre ellas está aplicar a los temporales el mismo criterio que A4 (§18.2, n.º 6).

## Validación

`pnpm run format:check` y `pnpm run check` terminaron con código 0. No hay pruebas nuevas, porque no hay código nuevo. CI: en el informe de la entrega.

## Limitaciones

- El plan no está aprobado en su totalidad.
- **Sin prueba de concepto:** los detalles de sistema de archivos se basan en la semántica POSIX documentada:
  - `link` sin sobrescritura;
  - `rename` de directorios: falla sobre uno no vacío y reemplaza uno vacío;
  - `O_NOFOLLOW`;
  - bit sticky.

  Se comprueban en macOS y en Linux (CI) recién al implementar.
- **Única observación local:** la estructura de `/tmp`, `/var` y `os.tmpdir()` en el equipo del propietario (macOS).
- **Precondición del mantenimiento:** el adaptador no puede verificar que no haya consumidores activos. Lo garantiza quien opera.
