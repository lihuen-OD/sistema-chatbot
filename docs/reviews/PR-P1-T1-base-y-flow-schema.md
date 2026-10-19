# PR de P1-T1 — título y descripción

Rama: `p1/t1-base-y-flow-schema` → `main`. Abrir como **borrador**. No fusionar sin revisión del propietario.

Para abrirlo: en GitHub, comparar `main...p1/t1-base-y-flow-schema`, pegar el título y la descripción siguientes y elegir "Create draft pull request".

---

## Título

P1-T1: base del monorepo y flow-schema

## Descripción

### Alcance

Solo P1-T1. No incluye base de datos, API, worker, motor, panel ni adaptadores, y no conecta servicios. **P1-T1 completa no significa P1 terminada**: faltan P1-T2 a P1-T6.

- **Workspace:**
  - pnpm 12.12.1 vía corepack (con hash), lockfile y Node 24.21.0 LTS en `.node-version` con `engineStrict`;
  - política de dependencias en `pnpm-workspace.yaml`: versiones exactas, antigüedad mínima de 7 días también para transitivas, `trustPolicy: no-downgrade`, sin subdependencias de Git/URL y scripts de instalación bloqueados;
  - TypeScript 6.0.3 estricto, ESLint 10 + typescript-eslint 8.71.1 con reglas con tipos, y Prettier 3.9.10;
  - control de dependencias entre paquetes internos (ADR-001) y restricción de importaciones en `flow-schema` (sin APIs de Node ni paquetes internos).
- **`packages/flow-schema`** (Zod 4.6.6), esquemas y validación de flujo, reglas y directorio/catálogo:
  - ids únicos, inicio único, salidas completas, alcanzabilidad y ausencia de ciclos;
  - variables declaradas, tipos compatibles y definidas en todos los caminos;
  - opciones dinámicas con límite del canal y cota del catálogo; límites de complejidad;
  - condiciones con operadores por tipo y ramas disjuntas;
  - `review` obligatorio en `file`;
  - un adjunto seleccionado por envío, distinto del cupo de candidatos del trámite, que no es configurable en la definición;
  - sin nodos de captura entre el paso documental y su correo;
  - plantillas y variables reservadas;
  - cobertura de reglas: huecos, solapamientos, `reviewOnly`, límites y destinatarios incompatibles con empresa o clasificación;
  - integridad del directorio e identidades activas únicas;
  - 46 códigos estables con ruta JSON y `nodeId` (`packages/flow-schema/README.md`).
- **Pruebas** (Vitest 5.0.3): los tres JSON de `examples/` como fixtures; 52 casos negativos (cada código tiene al menos uno y una prueba lo exige); comportamiento y plantillas. 86 pruebas.
- **CI:** `.github/workflows/ci.yml` con acciones fijadas por SHA y permisos de solo lectura; corre `pnpm install --frozen-lockfile` y `pnpm run check`.
- **Documentación:** comandos en `README.md`, addendum de versiones verificadas en ADR-009 (fechas, fuentes, motivos) y referencias en `docs/05`, `docs/10`, `docs/13`, `docs/15` y `PROJECT_STATUS.md`.

### Versiones

Verificadas en fuentes oficiales; todas con al menos 7 días de publicadas, sin excepciones. Detalle en el addendum de ADR-009:

- **TypeScript 6.0.3 y no 7.0.2:** typescript-eslint declara compatibilidad con `typescript <6.1.0`.
- **Node 24.21.0:** la 24.22.0 tenía 5 días; la 24.18.0 local es anterior a una release de seguridad.

### Validaciones ejecutadas

- **Local (Node 24.21.0, pnpm 12.12.1):** `pnpm run check` con código de salida 0 (typecheck, lint, formato, límites, 86/86 pruebas y build).
- **Mutaciones temporales:** sacar el control de `review` o el de captura entre el archivo y el correo hace fallar las pruebas correspondientes (2/86).
- **Controles de límites:** ESLint rechaza `node:fs` y paquetes internos en `flow-schema`; el script de límites falla con un paquete no declarado o una dependencia interna prohibida.
- **Checkout limpio desde GitHub:** con un store de pnpm vacío, `pnpm install --frozen-lockfile` y `pnpm run check` terminaron con código de salida 0.
- **CI de GitHub:** run #1 en success.

### Limitaciones

- **Alcance de las pruebas:** son validaciones de definiciones. No prueban concurrencia, idempotencia, confirmación en ejecución, cupo atómico de candidatos, vinculación de eventos ni seguridad de archivos (P2/P5), ni límites reales del canal (P6).
- **Cobertura de aceptación:** T02 y T33 a nivel de esquema; T34 solo en su parte de publicación.
- **Disjunción de condiciones:** es conservadora; se rechaza lo que no puede demostrarse disjunto.
- **Node:** sin verificación GPG de `SHASUMS256.txt`.
- **Uso local:** requiere actualizar Node a 24.21.0 y ejecutar `corepack enable`.

### Pendientes

Revisión del propietario. P1-T2 (`packages/contracts`) solo con autorización.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
