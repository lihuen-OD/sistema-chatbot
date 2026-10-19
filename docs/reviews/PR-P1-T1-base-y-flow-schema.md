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
  - límites de tamaño evaluados antes de cualquier análisis;
  - una confirmación habilita un solo envío por camino;
  - asunto de correo sin CR ni LF;
  - 48 códigos estables con ruta JSON y `nodeId` (`packages/flow-schema/README.md`).
- **Pruebas** (Vitest 5.0.3): los tres JSON de `examples/` como fixtures; 54 casos negativos (cada código tiene al menos uno y una prueba lo exige); comportamiento, plantillas y regresiones de la revisión. 112 pruebas.
- **CI:** `.github/workflows/ci.yml` con acciones fijadas por SHA y permisos de solo lectura; corre `pnpm install --frozen-lockfile` y `pnpm run check`.
- **Documentación:** comandos en `README.md`, addendum de versiones verificadas en ADR-009 (fechas, fuentes, motivos) y referencias en `docs/05`, `docs/10`, `docs/13`, `docs/15` y `PROJECT_STATUS.md`.

### Correcciones de la revisión del commit `f0d056f`

Commits `97397e2` (código y regresiones) y `2557b5b` (documentación). Las versiones de dependencias no cambiaron.

1. **Límites antes del análisis costoso.**
   - Hallazgo: un flujo lineal de 6.000 nodos terminaba en `RangeError`.
   - Corrección en el flujo: los límites de tamaño (nodos, variables, opciones, ramas, predicados, valores) se evalúan primero. Si alguno se supera, solo se devuelve `FLOW_LIMIT_EXCEEDED` con su ruta, sin recorrer el grafo.
   - Corrección en las reglas: lo mismo con `RULE_LIMIT_EXCEEDED`, sin cobertura ni recursión sobre el dominio.
   - Otros patrones corregidos: la cota de opciones dinámicas era un spread que fallaba con un directorio de 200.000 empresas (ahora es lineal), y el recuento de destinatarios ahora se detiene al superar el máximo.
   - No hay `catch` de `RangeError`.
2. **Una confirmación, un envío (ADR-014).** Nuevo `CONFIRMATION_REUSED`: ningún camino del grafo puede llevar a dos correos con el mismo documento sin un paso documental intermedio. Las ramas alternativas con un correo cada una siguen siendo válidas.
3. **Asunto sin CR ni LF.**
   - Nuevo `EMAIL_SUBJECT_LINE_BREAK` con ruta `["nodes", i, "subject"]`, tanto en `parseFlowDefinition` como en `validateFlowDefinition`.
   - Plantillas, tildes y saltos de línea en el cuerpo siguen siendo válidos.
   - Queda documentado (README del paquete, `docs/03` P5, `docs/06`, `docs/07`, T53) que el renderizado y el adaptador de correo deben volver a validar el asunto ya interpolado. No se implementan esas etapas.

### Versiones

Verificadas en fuentes oficiales; todas con al menos 7 días de publicadas, sin excepciones. Detalle en el addendum de ADR-009:

- **TypeScript 6.0.3 y no 7.0.2:** typescript-eslint declara compatibilidad con `typescript <6.1.0`.
- **Node 24.21.0:** la 24.22.0 tenía 5 días; la 24.18.0 local es anterior a una release de seguridad.

### Validaciones ejecutadas

- **Local (Node 24.21.0, pnpm 12.12.1):** `pnpm run check` con código de salida 0 (typecheck, lint, formato, límites, 112/112 pruebas y build).
- **Regresiones de la revisión contra el código sin corregir:** 17 de 112 fallaron.
  - `RangeError: Maximum call stack size exceeded` con el flujo de 6.000 nodos (entrada pública y función semántica), el directorio de 200.000 empresas y 6.000 variables de contexto.
  - Problemas además del límite con 400 ramas, 201 reglas y 6.000 reglas.
  - Falta de `CONFIRMATION_REUSED` y de `EMAIL_SUBJECT_LINE_BREAK`.

  Después de la corrección: 112/112.
- **Mutaciones temporales:**
  - Primera versión: sacar el control de `review` o el de captura entre el archivo y el correo hace fallar las pruebas correspondientes (2/86).
  - Revisión: quitar el retorno temprano por límites o el control de confirmación reutilizada hace fallar 6 pruebas, con `RangeError` en el primer caso. Se restauró el código.
- **Controles de límites entre paquetes:** ESLint rechaza `node:fs` y paquetes internos en `flow-schema`; el script de límites falla con un paquete no declarado o una dependencia interna prohibida.
- **Checkout limpio desde GitHub:** con un store de pnpm vacío, `pnpm install --frozen-lockfile` y `pnpm run check` terminaron con código de salida 0 (antes y después de la revisión).
- **CI de GitHub:** runs #1 y #2 (primera versión) y #3 (`2557b5b`) en success. El run del commit final figura en `PROJECT_STATUS.md`.

### Limitaciones

- **Alcance de las pruebas:** son validaciones de definiciones. No prueban concurrencia, idempotencia, confirmación en ejecución, cupo atómico de candidatos, vinculación de eventos ni seguridad de archivos (P2/P5), ni límites reales del canal (P6).
- **Cobertura de aceptación:** T02 y T33 a nivel de esquema; T34 solo en su parte de publicación.
- **Disjunción de condiciones:** es conservadora; se rechaza lo que no puede demostrarse disjunto.
- **Confirmación reutilizada:** se analizan todos los caminos del grafo como ejecutables, sin evaluar si sus condiciones pueden cumplirse a la vez. La unicidad en ejecución (una entrega por confirmación, T37/T49) sigue siendo de P2.
- **Asunto:** la validación es de la plantilla. El asunto interpolado (T53) se revalida en P5.
- **Límites:** una definición que supera un límite de tamaño recibe solo ese error. Los demás problemas aparecen al reducirla.
- **Node:** sin verificación GPG de `SHASUMS256.txt`.
- **Uso local:** requiere actualizar Node a 24.21.0 y ejecutar `corepack enable`.

### Pendientes

Revisión del propietario. P1-T2 (`packages/contracts`) solo con autorización.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
