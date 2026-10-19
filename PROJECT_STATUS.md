# Estado del proyecto

Actualizado: 19/10/2026

## Situación actual

- Kit de especificación v1.0 versionado en Git y publicado en GitHub.
- P0 documentado en la rama `p0/arquitectura-y-decisiones`: ADR-001 a ADR-013 (`docs/adr/`) y plan consolidado (`docs/15_PLAN_CONSOLIDADO_P0.md`). P0 se cierra al aprobar y fusionar su PR hacia `main`.
- Código de aplicación: no iniciado. P1 no comenzó.
- Integraciones reales: no configuradas.
- Pruebas de aplicación: no ejecutadas; todavía no existe implementación.

## Repositorio

- Carpeta local de trabajo: `Desktop/Proyectos OD/sistema-chatbot-kit`.
- Remoto: `origin` → https://github.com/lihuen-OD/sistema-chatbot (público).
- Ramas:
  - `main`: kit original y estado integrado.
  - `p0/arquitectura-y-decisiones`: cierre documental de P0, pendiente de PR y revisión.
- Pull request de P0: el conector de GitHub no tuvo permiso para crearlo (ver registro del 19/10). Se abre desde https://github.com/lihuen-OD/sistema-chatbot/compare/main...p0/arquitectura-y-decisiones?expand=1 como borrador.
- Las etapas de implementación se desarrollan en ramas propias y llegan a `main` mediante PR revisado por el propietario (AGENTS.md).
- `MANIFEST.json` es la referencia histórica del kit tal como se entregó; el commit `8a28a3a` coincide con sus sha256. Los archivos modificados después dejan de coincidir, y es esperado.

## Etapas

| Etapa | Estado |
|---|---|
| P0 Definición y ADR | Documentado en rama; se cierra al fusionar su PR |
| P1 Base local y contratos | Pendiente; P1-T1 propuesto en `docs/15_PLAN_CONSOLIDADO_P0.md` §9 |
| P2 Motor y persistencia durable | Pendiente |
| P3 Editor y simulador | Pendiente |
| P4 Administración, permisos y publicación | Pendiente |
| P5 Documentos y correo | Pendiente |
| P6 WhatsApp de prueba | Pendiente |
| P7 Endurecimiento y lanzamiento | Pendiente |

## Pendientes del propietario

- Abrir (o habilitar que se abra) el PR de P0 en borrador, revisarlo y fusionarlo si corresponde.
- Autorizar P1-T1.
- Antes de P4: decidir si relajar una clasificación exige una segunda aprobación (ADR-012).
- Antes del piloto: recorrido, contactos y catálogo reales; verificación adicional de identidad para documentos sensibles; retención.
- Antes de P5/P7: proveedor de correo, scanner, almacenamiento, hosting, volumen. Para el prototipo se usan los fixtures ficticios de `examples/`.

Detalle de qué bloquea cada pendiente: `docs/15_PLAN_CONSOLIDADO_P0.md` §8.

## Registro por sesión — completar, no borrar historial

### 19/10/2026 — Conexión con GitHub

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `main` / base `8a28a3a` / ninguna etapa de implementación; tarea autorizada: conectar y publicar el estado actual en GitHub.

Objetivo: versionar la carpeta local y publicarla en el repositorio remoto sin perder trabajo ni exponer datos sensibles.

Cambios:
- Inicializado Git en esta carpeta (no tenía repositorio) y configurado `origin`. El remoto estaba vacío: sin ramas ni commits.
- `.gitignore` nuevo: entorno y credenciales (salvo `.env.example`), dependencias, builds, cachés, logs, documentos recibidos, almacenamiento local, bases, backups, datos personales reales y temporales.
- Commit del kit sin modificaciones (25 archivos verificados contra `MANIFEST.json`).
- Este archivo actualizado.

Pruebas (comando, resultado, limitación):
- Hash sha256 de los 25 archivos contra `MANIFEST.json`: todos coinciden.
- `git ls-remote` y API de GitHub: repositorio público, vacío, con permiso de escritura.
- Búsqueda local de correos, teléfonos, tokens, claves y URLs con credenciales: solo correos `@example.com` y la URL de base local de ejemplo de `.env.example` (usuario y contraseña de desarrollo local, no son credenciales reales).
- `git check-ignore` con rutas de muestra: excluye `.env*`, `node_modules`, `dist`, `storage/`, `uploads/`, dumps, `*.sqlite`, logs y `private/`; conserva `.env.example`, migraciones `*.sql`, fixtures y código fuente.
- Limitación: el escáner de secretos de GitHub no está disponible en este repositorio (requiere GitHub Advanced Security); la revisión de secretos fue local. **[Impreciso; corregido en la entrada "Registro de P0" del 19/10/2026.]**

ADR creados o modificados: ninguno.

Pendientes / bloqueos: aprobación del plan de P0 por el propietario.

Próxima tarea concreta: el propietario revisa el plan de P0 (`prompts/01_PLAN_INICIAL.md`). Una vez aprobado, registrar las decisiones como ADR en una rama de P0 y abrir PR hacia `main`. P1 no empieza hasta entonces.

### 19/10/2026 — Registro de P0

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `p0/arquitectura-y-decisiones` / base `5824772` / P0 documental: rama, documentación, ejemplos, commits, push y PR en borrador. Sin fusionar ni iniciar P1.

Objetivo: registrar y cerrar documentalmente P0 con la dirección técnica aceptada por el propietario y sus ocho correcciones.

Cambios:
- `docs/adr/`: ADR-001 a ADR-013 e índice.
- `docs/15_PLAN_CONSOLIDADO_P0.md`: plan consolidado con fecha 19/10/2026. El plan del 14/10 no se conservó; no se reconstruye y solo se citan sus notas como antecedente.
- Actualizados según los ADR: `README.md` y `docs/01` a `docs/14`.
- `examples/`:
  - flujo con selección dinámica, `onEmpty` y `ruleSetId` estable;
  - reglas con dominio declarado y sin clasificación;
  - nuevo `directorio_demo.json` con catálogo, identidades y grupos.
- `MANIFEST.json` sin cambios.

Pruebas (comando, resultado, limitación):
- `python3 -I` con `json.load` sobre `examples/*.json` y `MANIFEST.json`: los cuatro son válidos.
- Script ad hoc de coherencia de fixtures (fuera del repo), sin errores: referencias, alcanzabilidad, sin ciclos, un archivo, cobertura 2×2, empresa y clasificación de grupos, miembros autorizados, correos ficticios e identidades únicas.
- `grep` de términos obsoletos (Prisma, EmployeePhone, 3 archivos, estados en español, `routing_demo_v1`): solo quedan menciones intencionales del tipo "reemplaza…".
- Verificación de que existen todos los archivos ADR enlazados desde `docs/`.
- Herramientas locales consultadas sin instalar nada: Node v24.18.0, npm 11.16.0, corepack 0.35.0 y Docker 29.7.2 instalados; pnpm y psql no instalados.
- Limitación: no hay pruebas automatizadas porque no hay código. Las afirmaciones sobre BSUID, límites interactivos, MinIO y tooling provienen de la revisión del 14/10 y se verifican en P1/P6.

Corrección sobre secret scanning (corrección 8):
- La entrada anterior decía que el escáner de secretos "no está disponible en este repositorio (requiere GitHub Advanced Security)". Era impreciso.
- GitHub ofrece secret scanning gratuitamente para repositorios públicos.
- Lo que falló fueron dos cosas distintas:
  1. La función de escaneo bajo demanda del conector MCP respondió "Repository does not have GitHub Advanced Security enabled". Ese mensaje describe esa función del conector, no la disponibilidad de secret scanning en el repositorio.
  2. Al consultar alertas (`GET /repos/lihuen-OD/sistema-chatbot/secret-scanning/alerts`), la API respondió `403 Resource not accessible by personal access token`. Es una falta de permiso del token del conector para leer alertas, no una prueba de que el producto esté desactivado.
- Desde esta sesión no se pudo verificar el estado de la configuración ni si existen alertas. El propietario puede verlo en la configuración de seguridad del repositorio en GitHub, o dar al token del conector permiso de lectura de alertas de secret scanning.

Pull request:
- La creación del PR en borrador con el conector respondió `403 Resource not accessible by personal access token`: el token no tiene permiso de escritura sobre pull requests.
- No se usaron otras credenciales para sortearlo.
- La rama está publicada. El PR se abre como borrador desde https://github.com/lihuen-OD/sistema-chatbot/compare/main...p0/arquitectura-y-decisiones?expand=1, o se otorga al token el permiso de pull requests (lectura y escritura) para que lo abra Claude Code.

ADR creados o modificados: ADR-001 a ADR-013 (nuevos).

Pendientes / bloqueos:
- El inicio de P1 lo bloquean solo la apertura, revisión y fusión del PR de P0, y la autorización de P1-T1.
- El resto de los pendientes no bloquea P1-T1 (`docs/15_PLAN_CONSOLIDADO_P0.md` §8).

Próxima tarea concreta: P1-T1, una vez fusionado el PR y autorizado. Incluye monorepo mínimo y `packages/flow-schema` (esquemas de flujo y reglas, validación semántica, cobertura con límites, fixtures de `examples/` y pruebas negativas). Primero verificar y registrar versiones exactas de runtime y tooling.
