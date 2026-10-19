# Sistema de chatbot documental — Kit de desarrollo

Versión 1.0 · 14/10/2026

Base de trabajo para Claude Code y revisión humana. Incluye especificación, arquitectura, contratos propuestos, recorrido de ejemplo, plan y pruebas. Desde P1-T1 también incluye la base del monorepo y `packages/flow-schema` (validación de definiciones). **Todavía no hay aplicación (API, worker, motor, panel) ni despliegue.** Los ejemplos son fixtures validados por `flow-schema`, no pruebas de funcionamiento del sistema.

## Inicio rápido

1. Descomprimir la carpeta completa y abrir `sistema-chatbot-kit` en Claude Code.
2. Leer `AGENTS.md`, requisitos y arquitectura.
3. Pegar `prompts/01_PLAN_INICIAL.md` en modo Plan. Ese prompt pide un plan revisable, no implementación inmediata.
4. Resolver los bloqueos de P0 y revisar el plan.
5. Autorizar una etapa específica y usar `prompts/02_IMPLEMENTAR_ETAPA.md`.
6. Al terminar cada etapa, revisar evidencia y actualizar `PROJECT_STATUS.md`.

No contratar servicios para iniciar. El simulador y adaptadores locales permiten trabajar antes de tener cuenta de Meta o número definitivo. La integración real necesita cuentas y acceso del propietario.

## Qué se construirá

Panel autenticado → editor visual → publicación de versión → motor compartido → simulador/WhatsApp → archivo en cuarentena → validación y análisis → reglas autorizadas → correo → seguimiento.

La empresa debe poder modificar textos, preguntas, opciones, rutas, contactos y plantillas sin tocar código. Agregar nuevas capacidades requiere desarrollar nuevos bloques/adaptadores seguros.

## Orden de lectura

| Archivo | Contenido |
|---|---|
| `AGENTS.md` | Reglas de trabajo y límites del agente |
| `docs/01_REQUISITOS.md` | Alcance, roles y requisitos verificables |
| `docs/02_ARQUITECTURA.md` | Arquitectura completa original |
| `docs/03_PLAN_DESARROLLO.md` | Etapas y criterios de salida |
| `docs/04_MODELO_DATOS.md` | Entidades, relaciones, estados e índices |
| `docs/05_CONTRATOS_API.md` | Recursos, errores y semántica HTTP |
| `docs/06_EDITOR_Y_MOTOR.md` | DSL, validación, versión y ejecución |
| `docs/07_SEGURIDAD.md` | Amenazas, permisos y controles |
| `docs/08_CONFIABILIDAD.md` | Inbox/outbox, orden, reintentos y resultados inciertos |
| `docs/09_PRUEBAS_Y_ACEPTACION.md` | Casos, evidencia y condiciones de entrega |
| `docs/10_ENTORNOS_Y_OPERACION.md` | Desarrollo, CI, despliegue y recuperación |
| `docs/11_UX_ADMINISTRADOR.md` | Pantallas y comportamiento del editor |
| `docs/12_DECISIONES_Y_RIESGOS.md` | Decisiones propuestas, pendientes y ADR |
| `docs/13_TRAZABILIDAD.md` | Requisitos → etapas → pruebas |
| `docs/14_FUENTES.md` | Referencias oficiales y límites de la propuesta |
| `docs/15_PLAN_CONSOLIDADO_P0.md` | Plan consolidado de P0 (19/10/2026), contradicciones resueltas, bloqueos y P1-T1 |
| `docs/adr/` | Decisiones de arquitectura ADR-001 a ADR-014 |
| `docs/reviews/` | Títulos y descripciones de PR preparados para revisión |
| `packages/flow-schema/README.md` | API, códigos de validación y límites del paquete de definiciones |
| `packages/contracts/README.md` | Eventos, vinculación, errores y DTO iniciales (contratos internos) |
| `examples/` | Flujo y reglas ficticias para usar en desarrollo |
| `prompts/` | Plan, ejecución, revisión y continuidad |
| `PROJECT_STATUS.md` | Estado inicial y handoff |

## Desarrollo local

Requisitos:

- **Node.js 24.21.0**, fijado en `.node-version`. `package.json` exige `>=24.21.0 <25` y `engineStrict` rechaza otras versiones. La 24.18.0 es anterior a la release de seguridad 24.18.1 y no se admite.
- **corepack**, incluido en Node 24, para usar la versión de pnpm fijada en `packageManager` (12.12.1, con hash).

```sh
corepack enable            # una vez por instalación de Node
pnpm install --frozen-lockfile
pnpm run check             # typecheck, lint, formato, límites entre paquetes, pruebas y build
```

| Comando | Qué hace |
|---|---|
| `pnpm run typecheck` | `tsc` en cada paquete (TypeScript estricto) |
| `pnpm run lint` | ESLint con reglas con tipos y restricciones de importación de ADR-001; falla con cualquier advertencia |
| `pnpm run format:check` / `pnpm run format` | Prettier sobre código y configuración (no sobre `docs/` ni `examples/`) |
| `pnpm run check:boundaries` | Verifica las dependencias entre paquetes internos según ADR-001 |
| `pnpm run test` | Vitest en cada paquete |
| `pnpm run build` | Compila cada paquete a `dist/` |

**Política de dependencias** (`pnpm-workspace.yaml`):

- versiones exactas y lockfile versionado;
- solo versiones publicadas hace al menos 7 días (`minimumReleaseAge: 10080`), también las transitivas;
- `trustPolicy: no-downgrade`;
- sin dependencias transitivas de Git o URL;
- scripts de instalación de dependencias bloqueados salvo aprobación explícita.

Versiones y fuentes en `docs/adr/ADR-009-stack-base-y-convenciones.md`. La CI (`.github/workflows/ci.yml`) ejecuta `pnpm install --frozen-lockfile` y `pnpm run check` en cada push.

## Principios que no se negocian dentro del alcance

- Simulador y WhatsApp utilizan el mismo motor.
- El webhook persiste antes de confirmar; las tareas lentas son asíncronas.
- Ningún correo real sale del simulador.
- No hay destinatarios elegidos libremente por el empleado.
- Las versiones publicadas son inmutables.
- No se distribuye un archivo sin aprobarlo.
- Reintentar no equivale a garantizar una única entrega externa.
- No llamar a una interfaz mock una integración real.

El stack era una propuesta a verificar en P0. Desde el 19/10/2026 rigen los ADR de `docs/adr/`: React/TypeScript, Node LTS/Express, PostgreSQL con Kysely + pg y migraciones SQL (en lugar de Prisma, ADR-010), worker durable y archivos privados. No se fijan versiones de dependencias sin consultar compatibilidad y mantenimiento vigentes; se verifican al iniciar P1. Los servicios opcionales de producción se presupuestan por separado.

`MANIFEST.json` es la referencia histórica del kit tal como se entregó el 14/10/2026; los archivos modificados después ya no coinciden con sus hashes.
