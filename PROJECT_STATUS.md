# Estado del proyecto

Actualizado: 27/10/2026

## Situación actual

- P0 cerrado: fusionado en `main` con el PR #1 (merge `7914dcb`). ADR-001 a ADR-014 en `docs/adr/`.
- P1 en curso:
  - **P1-T1 cerrada:** fusionada en `main` con el PR #2 (merge `5e67f54`).
  - **P1-T2 cerrada:** fusionada en `main` con el PR #3 (merge `6c3804f`).
  - **P1-T3 cerrada:** fusionada en `main` con el PR #4 (`p1/t2-cierre`, merge `c27285a`) y el PR #5 (`p1/t3-db`, merge `d441571`). Verificada además en local contra el contenedor del proyecto el 21/10/2026. La verificación local se fusionó con el PR #6 (merge `78ea2c6`).
  - **P1-T4 cerrada:** fusionada en `main` con los PR #7 (plan, merge `a134a33`), #8 (Node 24.22.1, merge `92b56e2`), #9 (límite de `enum`, merge `f01d8d5`) y #10 (API, ADR-015, merge `aaf0002`). CI #34 en verde en los dos jobs. Verificada en local sobre `main` el 21/10/2026.
  - **P1-T5: plan aprobado y fusionado** con el PR #11 (merge `d993830`, la rama `p1/t5-plan` con las decisiones A1 a A4 del plan §18.1). **Primer bloque fusionado** con el PR #12 (merge `fed2931`, rama `p1/t5-base-y-config`: base del paquete, configuración y guardas de entorno, más la regla de staging A1 en la API). Correctivo de las pruebas de sesiones fusionado con el PR #13 (merge `274b2d5`). **Segundo bloque (almacenamiento privado) cerrado:** fusionado con el PR #14 (merge `88880a2`, CI #52 en verde), con las decisiones B1 y B2 del plan §18.1. **Tercer bloque (captura local de correo) en revisión** en `p1/t5-local-mail-capture`, sin fusionar. Faltan el scanner (§10), la composición (§11) y el mantenimiento con consumidores detenidos (§7.3): P1-T5 no está completa.
  - Falta P1-T6.
- Código existente:
  - validación de definiciones (`flow-schema`);
  - contratos con validación en tiempo de ejecución (`contracts`);
  - base de datos con migraciones, checksums, guardas y tipos generados (`db`);
  - API mínima local (`apps/api`): configuración validada, health y sesiones administrativas, sin uso en producción;
  - `packages/adapters` (P1-T5, parcial): en `main`, guardas de entorno, configuración validada y el almacenamiento privado local (`ObjectStorage`); la captura local de correo (`EmailSender`) está en la rama `p1/t5-local-mail-capture`, sin fusionar.
- No hay worker, motor ni panel. Los adaptadores locales no están conectados a la API ni a ningún host.
- Integraciones reales: no configuradas.
- Pruebas en `main`:
  - sin base, comprobadas el 27/10/2026 sobre el árbol de `88880a2`: 132 de `flow-schema`, 191 de `contracts`, 62 de `db`, 64 de la API y 203 de `adapters`;
  - las pruebas contra PostgreSQL corren en el job `db` de la CI (en verde en la CI #52 de `88880a2`) y en local con `pnpm run check:db`, contra el contenedor del proyecto. Las cantidades registradas antes (93 de `db` y 44 de la API) no se volvieron a contar en esta sesión.
- Las pruebas de la API cubren sesión, CSRF, admisión y revocación; no hay todavía motor, permisos por rol, archivos reales ni integraciones.

## Repositorio

- Carpeta local de trabajo: `Desktop/Proyectos OD/sistema-chatbot-kit`.
- Remoto: `origin` → https://github.com/lihuen-OD/sistema-chatbot (público).
- Ramas:
  - `main`: P0 y P1-T1 a P1-T4 integrados; del plan de P1-T5 y sus bloques 1 y 2, PR #11, #12 y #14 (último merge `88880a2`).
  - `p0/arquitectura-y-decisiones`: fusionada (PR #1).
  - `p1/t1-base-y-flow-schema`: fusionada (PR #2).
  - `p1/t2-contracts`: fusionada (PR #3).
  - `p1/t2-cierre`: fusionada (PR #4).
  - `p1/t3-db`: fusionada (PR #5). Descripción del PR en `docs/reviews/PR-P1-T3-db.md`.
  - `p1/t3-verificacion-local`: fusionada (PR #6). Descripción del PR en `docs/reviews/PR-P1-T3-verificacion-local.md`.
  - `p1/t4-plan`: fusionada (PR #7).
  - `p1/node-24.22.1`: fusionada (PR #8). Descripción en `docs/reviews/PR-P1-node-24.22.1.md`.
  - `p1/flow-schema-enum-limit`: fusionada (PR #9). Descripción en `docs/reviews/PR-P1-flow-schema-enum-limit.md`.
  - `p1/t4-api`: fusionada (PR #10). Descripción en `docs/reviews/PR-P1-T4-api.md`.
  - `p1/t5-plan`: plan de P1-T5, sobre `main` (`aaf0002`). Solo documentación. Fusionada (PR #11, merge `d993830`). Descripción en `docs/reviews/PR-P1-T5-plan.md`.
  - `p1/t5-base-y-config`: primer bloque de P1-T5 (base del paquete, configuración y guardas de entorno). Fusionada (PR #12, merge `fed2931`). Descripción en `docs/reviews/PR-P1-T5-base-y-config.md`.
  - `p1/fix-session-token-tests`: correctivo del fallo intermitente de las pruebas de sesiones (alteraciones de CSRF y de cookie garantizadamente distintas del original), sobre `main` (`fed2931`). Fusionada (PR #13, merge `274b2d5`). Descripción en `docs/reviews/PR-P1-fix-session-token-tests.md`.
  - `p1/t5-private-storage`: segundo bloque de P1-T5 (raíz privada, área de trabajo y `ObjectStorage`), sobre `main` (`274b2d5`). Fusionada (PR #14, merge `88880a2`). Descripción en `docs/reviews/PR-P1-T5-almacenamiento-privado.md`.
  - `p1/t5-local-mail-capture`: tercer bloque de P1-T5 (captura local de correo), sobre `main` (`88880a2`). En revisión, sin fusionar. Descripción en `docs/reviews/PR-P1-T5-captura-correo.md`.
- CI: `.github/workflows/ci.yml` en cada push; resultados en https://github.com/lihuen-OD/sistema-chatbot/actions.
- Las etapas de implementación se desarrollan en ramas propias y llegan a `main` mediante PR revisado por el propietario (AGENTS.md).
- `MANIFEST.json` es la referencia histórica del kit tal como se entregó; el commit `8a28a3a` coincide con sus sha256. Los archivos modificados después dejan de coincidir, y es esperado.

## Etapas

| Etapa | Estado |
|---|---|
| P0 Definición y ADR | Cerrado (PR #1 fusionado) |
| P1 Base local y contratos | En curso: P1-T1 a P1-T4 cerradas (PR #2 a #10); plan de P1-T5 aprobado y fusionado (PR #11); primer bloque de P1-T5 fusionado (PR #12, merge `fed2931`); correctivo de pruebas fusionado (PR #13, merge `274b2d5`); segundo bloque de P1-T5 fusionado (PR #14, merge `88880a2`); tercer bloque (captura de correo) en revisión (`p1/t5-local-mail-capture`); P1-T6 pendiente (`docs/15_PLAN_CONSOLIDADO_P0.md` §9) |
| P2 Motor y persistencia durable | Pendiente |
| P3 Editor y simulador | Pendiente |
| P4 Administración, permisos y publicación | Pendiente |
| P5 Documentos y correo | Pendiente |
| P6 WhatsApp de prueba | Pendiente |
| P7 Endurecimiento y lanzamiento | Pendiente |

## Pendientes del propietario

- Tercer bloque de P1-T5 (`p1/t5-local-mail-capture`): revisar el PR y las precisiones del plan §9.10 (publicación incierta, adquisición incierta, liberación verificada, errores de la raíz, validación).
- Para P2: la conciliación de huérfanos tiene que excluir las claves con una publicación incierta pendiente (plan §8.4.1 y §16).
- Los bloques siguientes de P1-T5 (scanner, composición y mantenimiento) esperan autorización, bloque por bloque. La captura depende del mantenimiento (§7.3) para recuperar bloqueos abandonados por una caída.
- Revisar la severidad de cada CVE cuando se actualice el aviso de seguridad de Node de octubre (plan de P1-T4 §6).
- En P2, antes de integrar los adaptadores locales al host: diseñar el estado `CAPTURED` en `deliveries` y la procedencia del análisis en contratos y base. Que vaya en P2 es una decisión aprobada (plan de P1-T5 §18.1).
- Antes de P4: decidir si relajar una clasificación exige una segunda aprobación (ADR-012) y si una corrección con destinatarios distintos avisa automáticamente a los originales (ADR-014).
- Al implementar P2/P3: confirmar los valores iniciales del paso documental (ADR-014 §11) y si la revisión muestra el área destinataria.
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

### 19/10/2026 — Requisito de revisión y confirmación del documento (ADR-014)

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `p0/arquitectura-y-decisiones` / base `e366bea` / P0 documental: incorporar el requisito adicional, commits y push en la misma rama. Sin fusionar ni iniciar P1.

Objetivo: que el empleado pueda corregirse antes del correo y que el sistema maneje mensajes inesperados sin adivinar ni distribuir documentación incorrecta.

Cambios:
- `docs/adr/ADR-014-revision-confirmacion-y-mensajes-inesperados.md` (nuevo):
  - confirmación explícita ligada a trámite, revisión de contexto y documento;
  - reemplazo, cancelación y elección entre candidatos;
  - hasta 3 candidatos con un adjunto seleccionado, límites y purga;
  - resultados tardíos sin efecto;
  - coordinación atómica con el inicio del despacho;
  - tabla de mensajes inesperados;
  - reinicio con eventos pendientes;
  - revalidación de retenidos;
  - corrección como trámite vinculado;
  - confirmación distinta de aprobación administrativa.
- ADR-003, ADR-007 y ADR-013: nota "precisada por ADR-014", sin reescribir su decisión. Índice de ADR actualizado con la regla de precisiones parciales.
- Se corrigió la restricción física "un documento por trámite" en `docs/04_MODELO_DATOS.md`: candidatos, selección única, `DocumentConfirmation`, entrega única por confirmación, estados `WAITING_FILE_CHOICE`, `WAITING_CONFIRMATION` y `CANCELLED` de entrega.
- Actualizados según ADR-014:
  - `docs/01` (RF17–RF19, RF07, RF13, excepciones), `02`, `03`, `05` (eventos y resultados del motor), `06`, `07`, `08`, `09` (T35–T45; T13 y T22 precisadas), `11`, `12`, `13`, `15`;
  - `README.md` y `examples/` (bloque `review` y escenarios).
- `docs/reviews/PR-P0-arquitectura-y-decisiones.md` (nuevo): título y descripción del futuro PR, versionados.

Pruebas (comando, resultado, limitación):
- `python3 -I` con `json.load` sobre `examples/*.json`: los tres son válidos.
- Script ad hoc de coherencia de fixtures (fuera del repo), ampliado con `review` obligatorio y sin nodos de captura entre `file` y `email`: sin errores. Dos variantes alteradas (sin `review`; con un nodo `capture` intermedio) fueron detectadas con código de salida 1.
- Catálogo de pruebas: T01–T45, cada ID una sola vez.
- Enlaces a ADR verificados. `MANIFEST.json` sin diferencias con `main`.
- Limitación: no se ejecutaron pruebas de aplicación; no hay código. T35–T45 son casos de aceptación documentados, a implementar desde P1 (esquema) y P2 (motor).

ADR creados o modificados: ADR-014 (nuevo); ADR-003, ADR-007 y ADR-013 (nota de precisión).

Pendientes / bloqueos:
- Siguen bloqueando P1 solo la apertura, revisión y fusión del PR de P0 y la autorización de P1-T1.
- Decisiones nuevas que no bloquean P1:
  - aviso a destinatarios originales en correcciones (antes de P4);
  - valores iniciales de ADR-014 §11 (P2);
  - mostrar el área destinataria en la revisión (P3).

Próxima tarea concreta: abrir el PR en borrador con `docs/reviews/PR-P0-arquitectura-y-decisiones.md`, revisarlo y fusionarlo. Después, con autorización, P1-T1, que ahora incluye validar el bloque `review` obligatorio y la ausencia de nodos de captura entre `file` y `email`.

### 19/10/2026 — Precisiones de ADR-014 (revisión del commit `5323bf6`)

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `p0/arquitectura-y-decisiones` / base `5323bf6` / P0 documental: precisar casos de ADR-014 sin funciones nuevas, commits y push en la misma rama. Sin fusionar ni iniciar P1.

Objetivo: cerrar los casos borde que la revisión señaló antes de cerrar P0.

Cambios:
- ADR-014, con historial de la revisión:
  - §1/§5: archivo admisible durante `WAITING_FILE_CHOICE` (lista nueva, revisión nueva, botones viejos inválidos, sin elección automática); definición de candidato seleccionable y disponible para confirmar; nuevo estado de validación `DOWNLOAD_FAILED`.
  - §2: cupo por trámite completo, con reserva por incremento condicional de `candidateCount`, `candidateSeq` único por trámite, `(submissionId, receivedEventId)` único, cupo no devuelto y recepción concurrente cerca del máximo.
  - §3: límite de cambios contado solo sobre acciones del empleado (`employeeChangeCount`), con tabla por estado; eventos internos nunca bloqueados; Confirmar solo con candidato seleccionado, aprobado y disponible; salida segura con Cancelar o `REINICIAR`.
  - §6: identidad de cada entrega derivada de su confirmación; outbox y job de la entrega cancelada en `CANCELLED`, nunca despachados.
  - §12 (nuevo): generación por empleado y número; orden por clave; vinculación inmutable en `MessageEvent`; trabajos derivados no reasignables; correlación de archivos por timestamp del proveedor posterior al ancla de pedido; `FILE_NOT_CORRELATED`, con el reenvío como asociación explícita.
- `docs/04`: campos `generation`, `candidateCount`, `employeeChangeCount`, `fileRequestAnchorProviderTs`, vinculación en `MessageEvent`, referencia fija en `Job`, estados de `OutboxAction`; invariantes corregidas (la secuencia pasa de "por nodo/ejecución" a "por trámite").
- `docs/05`: `providerTimestamp` en eventos; `DOCUMENT_DOWNLOAD_RESULT`; reglas de vinculación; códigos `CANDIDATE_NOT_SELECTABLE` y `FILE_NOT_CORRELATED`; `CONTEXT_REVISION_LIMIT_REACHED` reemplazado por `CHANGE_LIMIT_REACHED`.
- `docs/06` y `docs/08`: elección, cupo, límite por estado, vinculación y `actionKey` del correo derivada de la confirmación.
- `docs/09`: T46–T52 nuevas y T45 precisada (mismo ID); gates actualizados.
- `docs/13`, `docs/03`, `docs/12`, `docs/15` y `docs/reviews/PR-P0-arquitectura-y-decisiones.md` actualizados.

Pruebas (comando, resultado, limitación):
- Catálogo de pruebas: T01–T52, cada ID una sola vez (script `python3 -I` sobre `docs/09`).
- `grep` de restos (secuencia por nodo, código de límite anterior, "solo Confirmar o Cancelar"): solo aparece la frase descriptiva del PR.
- Los códigos en mayúsculas de ADR-014 están definidos en `docs/04`/`docs/05`, salvo comandos y eventos del motor, que están en `docs/06`.
- Enlaces a ADR verificados; JSON de `examples/` válidos; script de coherencia de fixtures sin errores; sin rutas temporales ni correos reales; `MANIFEST.json` intacto.
- Limitación: no se ejecutaron pruebas de aplicación; no hay código. T46–T52 son casos de aceptación documentados.

ADR creados o modificados: ADR-014 (precisiones con historial; sin cambio de dirección).

Pendientes / bloqueos:
- Siguen bloqueando P1 solo la apertura, revisión y fusión del PR de P0 y la autorización de P1-T1.
- Nueva verificación (no decisión): semántica y granularidad del timestamp del proveedor en webhooks, en P6.

Próxima tarea concreta: abrir el PR en borrador, revisarlo y fusionarlo; después, con autorización, P1-T1.

### 19/10/2026 — P1-T1: base del monorepo y flow-schema

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `p1/t1-base-y-flow-schema` / base `7914dcb` (main con P0) / P1-T1 únicamente: workspace, `packages/flow-schema`, pruebas y CI. Sin base de datos, API, worker, motor, panel ni adaptadores.

Preparación:
- `main` se actualizó con `git merge --ff-only origin/main`. Contiene P0 (PR #1, merge `7914dcb`), sin diferencias con `161dd8f`.
- No había rama de P1 ni cambios locales pendientes.

Objetivo: base técnica mínima y validación comprobable de definiciones (flujo, reglas, directorio/catálogo).

Cambios:
- **Workspace:**
  - pnpm 12.12.1 vía corepack (`packageManager` con hash);
  - `pnpm-lock.yaml`;
  - Node 24.21.0 en `.node-version` con `engines` y `engineStrict`;
  - política de dependencias en `pnpm-workspace.yaml`: `minimumReleaseAge` de 7 días, `trustPolicy: no-downgrade`, `blockExoticSubdeps`, `strictDepBuilds`, versiones exactas;
  - TypeScript 6.0.3 estricto (`tsconfig.base.json`);
  - ESLint 10 con typescript-eslint 8.71.1 (strict y stylistic con tipos);
  - Prettier 3.9.10;
  - `scripts/check-workspace-boundaries.mjs` (ADR-001) y restricciones de importación en `flow-schema` (sin APIs de Node ni paquetes internos).
- **`packages/flow-schema`** (Zod 4.6.6):
  - esquemas del flujo v1, reglas v1 y directorio/catálogo;
  - validación semántica del flujo, cobertura de reglas, validación del directorio y `validatePublication`;
  - 46 códigos estables con ruta JSON y `nodeId`;
  - README con API, códigos y alcance.
- **Pruebas** (Vitest 5.0.3 + Vite 8.3.4):
  - los tres JSON de `examples/` como fixtures;
  - 52 casos negativos (al menos uno por código, con una prueba que lo exige);
  - pruebas de comportamiento y de plantillas.
- **CI:** `.github/workflows/ci.yml`, con acciones fijadas por SHA.
- **Documentación:** `README.md` (comandos y política), addendum de versiones en ADR-009, `docs/05`, `docs/10`, `docs/13`, `docs/15` y `docs/reviews/PR-P1-T1-base-y-flow-schema.md`.

Versiones verificadas (fuentes oficiales: `nodejs.org/dist/index.json`, registro de npm, API de GitHub, documentación de pnpm). Detalle, fechas y motivos en el addendum de ADR-009. Todas con al menos 7 días; sin excepciones a la política.

Comandos ejecutados y resultados:
- **Node 24.21.0:** descargado al directorio temporal de la sesión, con SHA-256 verificado contra `SHASUMS256.txt` (`shasum -a 256 -c`: OK). No se modificó el Node del sistema (24.18.0).
- **Instalación:** `corepack use pnpm@12.12.1` instaló 132 paquetes sin scripts de build bloqueados. `pnpm install --frozen-lockfile` informó: "Lockfile passes supply-chain policies".
- **Check local:** `pnpm run check` (typecheck, lint, format:check, check:boundaries, test, build) con código de salida 0 y Vitest con 4 archivos y 86 pruebas aprobadas.
- **Mutaciones temporales:** sacar el control de `review` y desactivar el control de captura entre el archivo y el correo hizo fallar 2 de 86 pruebas. El archivo se restauró desde una copia (`cmp` sin diferencias) y las 86 volvieron a pasar.
- **Controles de límites:**
  - ESLint rechazó un archivo temporal de `flow-schema` que importaba `node:fs` y `@sistema-chatbot/other` (`no-restricted-imports`); el archivo se eliminó;
  - el script de límites, sobre un workspace de prueba en el directorio temporal, salió con código 1 y señaló el paquete no declarado y la dependencia interna prohibida.
- **Checkout limpio:** `git clone --branch p1/t1-base-y-flow-schema` desde GitHub, `pnpm install --frozen-lockfile --store-dir <store vacío>` y `pnpm run check`: código de salida 0, 86 pruebas aprobadas.
- **CI en GitHub:** run #1 sobre `a7a4dc8` en success. Todos los pasos pasaron: checkout, Node de `.node-version`, corepack, instalación con lockfile y checks (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/39251541103).

Limitaciones:
- **Alcance de las validaciones:** son de definiciones. No prueban concurrencia, idempotencia, confirmación en ejecución, cupo atómico de candidatos, vinculación de eventos ni seguridad de archivos (P2 y P5), ni límites reales del canal (P6).
- **Cobertura de aceptación:** T02 y T33 cubiertas a nivel de esquema; T34 solo en su parte de publicación. La integración con el servicio de publicación es de P4.
- **Longitud de textos:** las cotas son genéricas (4096/200/100) hasta verificar los límites del canal en P6.
- **Disjunción de ramas:** las ramas que solo difieren por variables no finitas (string, date, exists) se rechazan por no poder demostrarse disjuntas. Es conservador y está documentado en ADR-003.
- **Verificación de Node:** no se verificó la firma GPG de `SHASUMS256.txt` (`gpg` no instalado).
- **Node local:** con 24.18.0, `engineStrict` impide instalar. Hay que actualizar Node o usar un gestor que lea `.node-version`.
- **Ejecución local de checks:** `pnpm run check` invoca `pnpm`, así que localmente requiere `corepack enable`. La CI lo hace.
- **PR:** la creación respondió 403 (el token del conector no tiene permiso sobre pull requests).

ADR creados o modificados: ADR-009 (addendum de versiones; sin cambio de decisión).

Pendientes / bloqueos:
- Abrir y revisar el PR de P1-T1.
- Actualizar el Node local.
- P1-T2 requiere autorización.

Próxima tarea concreta: revisión del PR de P1-T1. Después, con autorización, P1-T2: `packages/contracts` con el envelope de eventos, los códigos de error y los DTO iniciales.

### 19/10/2026 — Correcciones de la revisión de P1-T1 (commit `f0d056f`)

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `p1/t1-base-y-flow-schema` / base `f0d056f` / corregir tres hallazgos de P1-T1 en la misma rama. Sin fusionar, sin force push y sin iniciar P1-T2.

Objetivo: corregir el rechazo de definiciones que superan límites, la reutilización de una confirmación en dos envíos y los asuntos con CR/LF.

Cambios (commits `97397e2` y `2557b5b`):
1. **Límites antes del análisis costoso.**
   - **Flujo:** `checkSizeLimits` evalúa primero nodos y variables y, sin recorrer colecciones ya excedidas, después opciones, ramas, predicados y valores por lista. Si alguno se supera, devuelve solo `FLOW_LIMIT_EXCEEDED`, antes de los recorridos recursivos del grafo y de la disjunción de ramas.
   - **Reglas:** lo mismo con `RULE_LIMIT_EXCEEDED` (variables de contexto, reglas, condiciones, valores, grupos), sin validar reglas ni recursión sobre el dominio.
   - **Otros patrones revisados:**
     - la cota de opciones dinámicas usaba spread sobre todas las empresas (`RangeError` con 200.000) y pasó a un cálculo lineal;
     - el cálculo de transiciones automáticas ya no usa spread;
     - el recuento de destinatarios se detiene al superar el máximo.
   - No se agregó ningún `catch` de `RangeError`.
2. **Una confirmación, un envío.** Nuevo código `CONFIRMATION_REUSED`: un recorrido iterativo desde cada correo informa otro correo con el mismo documento alcanzable sin un paso documental intermedio sobre esa variable. Las ramas alternativas siguen siendo válidas. ADR-014 registra la regla en su historial y consecuencias.
3. **Asunto sin CR ni LF.**
   - Nuevo código `EMAIL_SUBJECT_LINE_BREAK` con ruta `["nodes", i, "subject"]` y `details.position`. Lo informan el esquema (refinamiento con código estable, mapeado en `parseFlowDefinition`) y `validateFlowDefinition`.
   - `lineBreakPosition` queda exportada para la revalidación posterior.
   - Documentado en el README del paquete, `docs/03` P5, `docs/06`, `docs/07`, `docs/09` (T53, gates P1 y P5) y `docs/13`: el renderizado y el adaptador de correo deben volver a validar el asunto interpolado. No implementado.
- **Pruebas:**
  - `test/review-regressions.test.ts` con 24 pruebas: entrada pública y funciones semánticas, entradas muy por encima del límite y fronteras exactas (100 nodos, 30 variables, 10 opciones, 10 ramas, 200 reglas);
  - 2 casos negativos nuevos para los códigos nuevos (54 casos, 48 códigos);
  - descripción del PR actualizada en `docs/reviews/PR-P1-T1-base-y-flow-schema.md`.

Pruebas (comando, resultado, limitación):
- **Reproducción antes de corregir** (`pnpm exec vitest run` con las pruebas nuevas sobre `f0d056f`): 17 fallidas y 95 aprobadas, de 112.
  - `RangeError: Maximum call stack size exceeded` con el flujo de 6.000 nodos (entrada pública y `validateFlowDefinition`), el directorio de 200.000 empresas y 6.000 variables de contexto.
  - Problemas además del límite con 400 ramas, 201 reglas y 6.000 reglas.
  - Ningún `CONFIRMATION_REUSED` con dos correos consecutivos o con nodos intermedios.
  - Ningún `EMAIL_SUBJECT_LINE_BREAK` con CR, LF o CRLF.
- **Después de corregir:** `pnpm exec vitest run` aprobó 112 de 112. `pnpm run check` (typecheck, lint, formato, límites, pruebas, build) terminó con código 0.
- **Mutaciones temporales:** quitar el retorno temprano por límites y desactivar el control de confirmación hizo fallar 6 pruebas (con `RangeError`). El archivo se restauró (`cmp` sin diferencias) y volvieron a pasar las 112.
- **Fixtures:** los tres JSON de `examples/` siguen siendo válidos (`fixtures.test.ts`).
- **Checkout limpio:** `git clone` de la rama en `2557b5b`, `pnpm install --frozen-lockfile` con store vacío (Node 24.21.0, pnpm 12.12.1, "Lockfile passes supply-chain policies") y `pnpm run check` con código 0 y 112 de 112.
- **CI:** run #3 sobre `2557b5b` en success (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/39255656446). El run del commit de este registro se informa al entregar.

Limitaciones:
- **Alcance:** son validaciones de definiciones. No resuelven ni prueban casos de ejecución: una entrega por confirmación en el host y la base (T37, T49, P2), el asunto interpolado (T53, P5), concurrencia, idempotencia ni archivos reales.
- **`CONFIRMATION_REUSED`:** considera ejecutables todos los caminos del grafo, sin evaluar si sus condiciones pueden cumplirse a la vez. Es conservador.
- **Límites:** una definición que supera un límite de tamaño recibe solo ese error; el resto aparece al reducirla. El `actual` de `recipientsPerDelivery` es el recuento al detenerse (al menos el máximo más uno).
- **PR:** la creación respondió otra vez 403. No hay PR abierto para esta rama.

ADR creados o modificados: ADR-014 (historial y consecuencia; sin cambio de dirección).

Pendientes / bloqueos:
- Abrir el PR en borrador y revisarlo.
- Actualizar el Node local.
- P1-T2 sigue requiriendo autorización.

Próxima tarea concreta: revisión y fusión del PR de P1-T1 por el propietario.

### 19/10/2026 — Revisión y cierre de P1-T2

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `p1/t2-contracts` / base `762cfb5` / continuar P1-T2, corregir defectos verificables, documentar, comprobar, publicar y preparar PR en borrador. Sin fusionar ni iniciar P1-T3.

Objetivo: revisar la implementación publicada de P1-T2 contra los documentos y ADR, completar las verificaciones desde un entorno limpio y dejar evidencia para revisión.

Hallazgo y corrección:
- `providerTimestamp` era opcional para todas las variantes `ADAPTER`. ADR-014 §12 necesita conservar el timestamp de la entrada que provoca el pedido de archivo para fijar su ancla; la ausencia representable corresponde específicamente a `FILE_RECEIVED`, que el host debe diagnosticar como `FILE_NOT_CORRELATED`.
- `OPTION_SELECTED`, `TEXT_RECEIVED` y las cuatro variantes de `PROMPT_ACTION` ahora exigen el timestamp. `FILE_RECEIVED` sigue admitiendo que falte. Se agregó una regresión que cubre las seis variantes no archivo.
- Se revisaron también las referencias obligatorias y prohibidas de `CONFIRM`, `REPLACE`, `CANCEL` y `CHOOSE`; referencias de trabajos; separación de orígenes; datos de identidad y vinculación; detalles públicos; tipos inferidos; y límites de dependencia. No se encontraron otros defectos verificables dentro de P1-T2.

Cambios documentales:
- `docs/05_CONTRATOS_API.md` y `packages/contracts/README.md` precisan la obligación del timestamp por variante.
- `docs/reviews/PR-P1-T2-contracts.md` creado con problema, alcance, cambios, validación y limitaciones.
- ADR-001 ya describía correctamente `contracts` → `flow-schema`, sin dependencia inversa ni APIs de Node; no requirió cambios.
- `MANIFEST.json` no se modificó.

Pruebas (comando, resultado, limitación):
- Runtime temporal aislado: Node 24.21.0 descargado desde `nodejs.org`, checksum SHA-256 verificado; corepack 0.36.0 y pnpm 12.12.1. No se modificó el Node 24.18.0 del usuario.
- `pnpm install --frozen-lockfile`: código 0, 132 paquetes reutilizados del store local del proyecto, 0 descargados; el lockfile pasó las políticas de cadena de suministro.
- `pnpm run check`: código 0; typecheck, lint, formato, límites, 112 pruebas de `flow-schema`, 170 de `contracts` y build aprobados.
- Checkout limpio aislado del commit de código `d9cdc006c788db109beca7540ca44d18e765c645`: `pnpm install --frozen-lockfile --store-dir <store temporal vacío>` descargó 132 paquetes y terminó con código 0; `pnpm run check` terminó con código 0 y los mismos 112 + 170 tests.
- La CI del SHA final publicado se consulta después del push y se informa en la entrega; no se atribuye como evidencia propia la CI reportada por la sesión anterior.

Limitaciones:
- Los esquemas no prueban autenticidad, autorización, persistencia, orden, concurrencia ni idempotencia.
- Las pruebas del simulador no validan Meta, archivos reales, antimalware ni entrega de correo.
- El checkout limpio documentado arriba corresponde al commit de código; el commit posterior de estado solo agrega esta evidencia documental. El SHA final también se comprueba en un checkout limpio antes de la entrega.

ADR creados o modificados: ninguno. ADR-001 y ADR-014 fueron revisados; la corrección precisa el contrato ya aprobado sin cambiar la arquitectura ni el alcance.

Pendientes / bloqueos:
- Publicar los commits adicionales y comprobar la CI del SHA final exacto.
- Abrir el PR en borrador si el permiso del conector lo permite; ante 403, entregar la comparación y la descripción versionada.
- Revisión y eventual fusión por el propietario. P1-T3 no está autorizada.

Próxima tarea concreta: revisión del PR de P1-T2 por el propietario; P1-T3 requiere autorización separada.

### 19/10/2026 — Hallazgos de la revisión de P1-T2 (commit `07b8767`)

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `p1/t2-contracts` / base `07b8767` / corregir únicamente dos hallazgos de revisión de P1-T2. Sin fusionar ni iniciar P1-T3.

Objetivo: que un borrador muy anidado se rechace con un resultado controlado y que el informe de validación convertido cumpla su propio esquema.

Reproducción con las versiones exactas del repositorio (Node 24.21.0, Zod 4.6.6, `dist` de `07b8767`, objetos construidos iterativamente):
- `flowDraftUpdateRequestSchema.safeParse` con `definition` o `layout` de 6.000 niveles y `flowDraftResponseSchema.safeParse` con `definition` de 6.000 niveles: `RangeError: Maximum call stack size exceeded` en los tres casos. Con 20 niveles: aceptado.
- `toValidationReport` con un problema en `ruleSets[1000]` conserva `index: 1000`, y `validationReportSchema` lo rechaza (`too_big`, `maximum: 999`, ruta `["issues", 0, "document", "index"]`).
- Ambos casos se reprodujeron en este entorno. No hizo falta atribuir resultados a la distribución de Zod que usó el revisor.

Cambios (commit `a97d585`):
1. **Borradores** (`dto.ts`):
   - `jsonObjectSchema` ejecuta un recorrido iterativo antes de `z.json`. El recorrido se detiene al superar la profundidad (`MAX_DRAFT_JSON_DEPTH` = 32, raíz = nivel 1) o la cantidad de valores (`MAX_DRAFT_JSON_VALUES` = 250.000). Cada campo, `definition` y `layout`, tiene su propio límite.
   - Al superar un límite devuelve un problema `custom` con `params.reason` (`MAX_DEPTH` o `MAX_VALUES`) y `params.limit`. No se agregó ningún `catch` de `RangeError`.
   - Los borradores incompletos se siguen aceptando.
   - Criterio de los valores:
     - Una definición de la DSL v1 llega como máximo a 8 niveles.
     - Una definición en los límites de tamaño de `FLOW_LIMITS` (98 condiciones × 10 ramas × 4 predicados × 50 valores, 30 variables) tiene 217.695 valores y 2,3 MB.
     - 250.000 la admite, para que todo flujo publicable pueda guardarse como borrador.
     - Recorrerla tarda unos 2 ms y validarla con `z.json`, unos 8 ms.
     - Un primer valor de 50.000 la rechazaba; se corrigió antes del commit.
2. **Índice de `RULE_SET`** (`validation-issues.ts`):
   - El máximo 999 se reemplazó por `z.int().min(0)` (entero seguro no negativo).
   - Motivo: `validatePublication` no limita la cantidad de conjuntos y el índice es la ubicación real del problema. No se recorta ni se modifica.
   - El informe ya está acotado por `MAX_ISSUES_PER_RESPONSE` (500 problemas).
3. **Pruebas:** `test/review-regressions.test.ts`, con 12 pruebas:
   - 6.000 niveles en `definition`, `layout` y respuesta de lectura;
   - frontera exacta de profundidad, con objetos y con arreglos;
   - frontera exacta de valores;
   - definición en los límites de `FLOW_LIMITS`;
   - objeto cíclico;
   - borradores incompletos y flujo de ejemplo con layout;
   - valores que no son JSON;
   - `ruleSets[1000]` convertido;
   - punta a punta con 1.001 conjuntos;
   - índice entero seguro no negativo.
4. **Documentación:** `packages/contracts/README.md` y `docs/05_CONTRATOS_API.md` registran los límites, su motivo, el error `REQUEST_INVALID` (400) y el criterio del índice.

Pruebas (comando, resultado, limitación):
- **Antes de corregir** (`pnpm exec vitest run test/review-regressions.test.ts` sobre el código de `07b8767`): 9 fallidas y 2 aprobadas, de 11.
  - `RangeError` en los tres casos de 6.000 niveles.
  - Frontera, cantidad de valores y objeto cíclico aceptados.
  - `too_big` con `maximum: 999` en los tres casos del índice.
  - Las 2 aprobadas comprueban comportamiento que debía conservarse: borradores incompletos aceptados y valores no JSON rechazados.
- **Reproducción después** (mismo script, `dist` recompilado): los tres casos de 6.000 niveles devuelven `success=false` con `params {reason: "MAX_DEPTH", limit: 32}`. El índice 1000 se conserva y el informe pasa `validationReportSchema`.
- **Mutación temporal:** con el límite de valores en 50.000 falla solo la prueba de `FLOW_LIMITS` (1 de 12). Se restauró el archivo (`cmp` sin diferencias).
- `pnpm install --frozen-lockfile`: código 0, con el lockfile aprobado por las políticas de cadena de suministro.
- `pnpm run check`: código 0. Typecheck, lint, formato, límites, 112 pruebas de `flow-schema`, 182 de `contracts` (170 previas + 12 nuevas) y build.
- **Checkout limpio** del commit de código `a97d58538afa0bccc5f73808bee0203104838812`: clon de la rama, `pnpm install --frozen-lockfile` con store temporal vacío (132 paquetes descargados) y `pnpm run check`, ambos con código 0 y 112 + 182 pruebas.
- **CI:** la del SHA final se consulta después del push y se informa en la entrega.

Limitaciones:
- El límite de bytes del cuerpo HTTP (413) sigue pendiente para la API (P4). Estos límites no lo reemplazan: acotan la estructura y el trabajo de la validación, no el tamaño en bytes ni la memoria usada al decodificar el JSON.
- **Observación fuera de alcance (`flow-schema`, P1-T1):** `checkSizeLimits` aplica `valuesPerList` a los valores de los predicados, pero no limita la cantidad de valores de una variable `enum`.
  - Una definición con un `enum` de 300.000 valores no recibe un error de tamaño.
  - Esa definición supera `MAX_DRAFT_JSON_VALUES` y no se puede guardar como borrador.
  - No se modificó `flow-schema`. Queda para que el propietario decida si se acota en una tarea propia.
- Las pruebas son de esquemas: no prueban la API, la persistencia ni el comportamiento con un cuerpo HTTP real.
- **PR:** no se repitió el intento de creación por el conector (403 en intentos anteriores).

ADR creados o modificados: ninguno. Los límites del borrador precisan un contrato existente de docs/05 sin cambiar la arquitectura.

Pendientes / bloqueos:
- Revisión y eventual fusión del PR de P1-T2 por el propietario.
- Decidir si se acota la lista `values` de las variables `enum` en `flow-schema`.
- P1-T3 no está autorizada.

Próxima tarea concreta: revisión del PR de P1-T2 por el propietario.

### 19/10/2026 — Cierre de P1-T2 y plan de P1-T3

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `p1/t2-cierre`, creada desde `main` (`6c3804f`) / cerrar el informe de P1-T2 con el resultado real de la CI y preparar el plan de P1-T3. Sin implementar P1-T3 ni tocar bases externas.

Cierre de P1-T2:
- El propietario fusionó P1-T2 con el PR #3 (merge `6c3804f`).
- **CI #8** sobre `fdfee82`, último commit de la rama: `success` (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/39278871678).
  - Tardó unos 35 minutos, de 15:33 a 16:08 UTC. Durante ese tiempo el job no registró pasos y githubstatus.com informaba un incidente de Actions con rendimiento degradado.
  - El seguimiento automático consultaba la API pública sin autenticar, agotó el límite de 60 consultas por hora y no vio el final. El resultado se obtuvo con el conector de GitHub.
- **CI #9** sobre el merge `6c3804f` en `main`: `success`, terminada a las 16:27:08 UTC (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/39283148279).
  - En la primera consulta estaba en cola y, por pedido del propietario, no se esperó ni se relanzó.
  - El propietario informó después el resultado, y una consulta con el conector lo confirmó.
- El árbol de `6c3804f` es idéntico al de `fdfee82` (`git diff` vacío).
- `docs/reviews/PR-P1-T2-contracts.md` y `docs/15_PLAN_CONSOLIDADO_P0.md` §9 registran la fusión y estos resultados.

Herramientas instaladas, relevadas sin modificar nada:
- Docker Desktop 29.7.2 con Compose v5.5.0, con el daemon detenido.
- Postgres.app 2.9.5 con PostgreSQL 18.4 en ejecución en `localhost:5432`. Es un cluster del usuario: no se usa. La versión vigente es 18.6.
- Homebrew 7.0.9, sin PostgreSQL ni libpq, y sin `psql` en el PATH.
- Node global 24.18.0, sin pnpm global y sin `gh`.

Plan de P1-T3 (`docs/plans/P1-T3-base-de-datos.md`, propuesto y pendiente de aprobación). Revisado con los criterios iniciales del propietario:
- PostgreSQL 18.6 en contenedor, en `127.0.0.1:55432`. `compose.yaml` es compatible con Docker y con Colima; el propietario elige el motor, lo instala y acepta sus términos.
- **Identidades, contrastado con ADR-011:**
  - un empleado puede tener varias identidades;
  - una identidad canónica (proveedor, tipo, ámbito y valor normalizado) no puede estar activa en empleados distintos;
  - sus columnas son `NOT NULL`, porque un índice único trata los `NULL` como distintos;
  - se conserva el trámite activo único por empleado y número.
- **Ejecutor de migraciones**: se compararon una solución propia y herramientas mantenidas con una verificación de checksums agregada. La evidencia sale del código publicado de Kysely 0.29.6 y de node-pg-migrate 9.0.0, y del registro de npm.
  - Recomendación: Migrator de Kysely + verificación de checksums.
  - Correcciones del primer borrador:
    - `postgres-migrations` sí verifica hashes, aunque su última versión es de 07/2021;
    - `graphile-migrate` publica release candidates de la 2.0, la última el 14/10/2026.
- **Protecciones descritas** (no implementadas):
  - contra dos ejecutores simultáneos;
  - contra migraciones aplicadas a medias;
  - contra conexiones a Postgres.app u otras bases;
  - contra el borrado de bases ajenas.
- **`outbox_actions` y `jobs`:** en P1-T3 solo se fija lo decidido para `outbox_actions`. `jobs` pasa a P2 junto con la decisión de la cola. Es una desviación de §9 que espera aprobación.
- **Tipos:** kysely-codegen 0.20.0, con su compatibilidad declarada comprobada en los metadatos.
- Cuatro migraciones iniciales con 15 invariantes, cada una con su mecanismo y su prueba, y pruebas de concurrencia.
- `check` sin base y `check:db` separado, ambos en CI.
- Versiones candidatas según la política de 7 días: kysely 0.29.6, pg 8.23.1, @types/pg 8.23.1 y kysely-codegen 0.20.0.

Pruebas (comando, resultado, limitación):
- Esta sesión solo cambió documentación: no se escribió ni ejecutó código de aplicación.
- `pnpm install --frozen-lockfile` y `pnpm run check` sobre esta rama terminaron con código 0: formato y 112 + 182 pruebas.
- Los paquetes de Kysely y node-pg-migrate se descargaron a un directorio temporal fuera del repositorio solo para leer su código; no se ejecutaron.
- Las versiones del plan se vuelven a verificar al iniciar P1-T3.

Limitaciones:
- La compatibilidad de kysely-codegen está comprobada en los metadatos, no con una instalación. La instalación con las políticas de pnpm se hace al iniciar P1-T3.
- No se verificaron los términos de licencia de Docker Desktop: los evalúa el propietario.

ADR creados o modificados: ninguno. El plan propone addenda de ADR-001, ADR-002, ADR-009 y ADR-010 al implementar.

Pendientes / bloqueos:
- Confirmar las decisiones 4 (ejecutor) y 5 (`jobs` en P2) del plan.
- Elegir el motor de contenedores.
- Autorizar P1-T3.

Próxima tarea concreta: aprobación del plan de P1-T3 por el propietario.

### 20/10/2026 — P1-T3: base de datos (`packages/db`)

Fecha / rama / commit / etapa autorizada: 20/10/2026 / `p1/t3-db`, creada desde `p1/t2-cierre` (`41c0234`, sin fusionar) / implementar P1-T3 según el plan publicado en `41c0234`, con las precisiones del propietario. Sin fusionar, sin P1-T4 ni el motor de P2, sin Postgres.app ni bases externas, sin borrar volúmenes. Docker Desktop se usará cuando el propietario lo confirme.

Dependencia: los dos primeros commits de la rama (`8d61205`, `41c0234`) son la documentación de `p1/t2-cierre`. Conviene fusionar esa rama antes de revisar esta contra `main`; mientras tanto, el diff exclusivo es `p1/t2-cierre...p1/t3-db`.

Precisiones del propietario aplicadas:
- **Ejecutor:** Migrator de Kysely más checksums. La verificación definitiva corre dentro del mismo bloqueo de migración. Hay pruebas de dos ejecutores concurrentes y de la inicialización desde una base vacía.
- **`jobs`:** diferida a P2, con la desviación documentada en ADR-002 (addendum), en `docs/15` §9 y en el plan §11. Solo se creó la estructura mínima acordada de la outbox.
- **Validador de SQL:** léxico, sin búsqueda de palabras. Acepta funciones, triggers y `DO` con BEGIN/END y cuerpos `BEGIN ATOMIC`. Rechaza el control de transacciones de nivel superior. Hay pruebas de ambos casos.
- **Guardas:** alineadas con `sc_test_<runId>_<n>` y `sc_test_<runId>_template`. El rol de pruebas no es superusuario y cada instancia borra solo los nombres exactos que creó.
- **Versiones** verificadas al comenzar (ver más abajo).

Versiones verificadas (20/10/2026; política de 7 días, sin excepciones):
- kysely 0.29.6 (0.29.7 tenía 2 días), pg 8.23.1, @types/pg 8.23.1 y kysely-codegen 0.20.0;
- imagen `postgres:18.6-trixie@sha256:74935e72…dcfc4336` (PostgreSQL 18.6; imagen del 06/10/2026), con `PGDATA` y volumen confirmados en el registro sin usar el daemon.
- `pnpm install` aplicó las políticas de cadena de suministro.
- Compatibilidad real de kysely-codegen: peers `kysely@0.29.6` y `pg@8.23.1` satisfechos, `zod@4.6.6` compartido y sin scripts de instalación. Registrado en ADR-009.

Cambios:
- **`packages/db`:**
  - ejecutor de migraciones y validador de SQL;
  - guardas de conexión y bases temporales;
  - `createPool`, con manejador de errores de clientes inactivos;
  - cuatro migraciones con las 15 invariantes del plan;
  - tipos generados (`src/generated/database.ts`);
  - CLI de migración, tipos y limpieza manual;
  - README con invariantes, mecanismos y pruebas.
- **Raíz:**
  - `compose.yaml` (Docker o Colima; `127.0.0.1:55432`; marca `cluster_name`; healthcheck por TCP) y `docker/postgres/initdb/10-roles.sh`;
  - `.env.example`, scripts `db:*`, `test:db` y `check:db`;
  - `.gitattributes`, porque los checksums se calculan sobre los bytes con LF;
  - límites de `db` en el script de límites y en ESLint, y archivo generado excluido de ESLint y Prettier;
  - job `db` en la CI.
- **Documentos:**
  - ADR-001 (dependencias de `db`), ADR-002 (outbox y `jobs`), ADR-009 (versiones) y ADR-010 (ejecutor, tipos y control de divergencia);
  - docs/04 (implementación física), docs/09, docs/10 y docs/15 §9;
  - el plan (aprobación y §11) y `docs/reviews/PR-P1-T3-db.md`.

Pruebas (comando, resultado, limitación):
- **Local** (Node 24.21.0 aislado con checksum verificado; pnpm 12.12.1):
  - `pnpm install --frozen-lockfile` y `pnpm run check`: código 0. Typecheck, lint, formato, límites, 62 pruebas de `db` sin base, 112 de `flow-schema`, 182 de `contracts` y build.
  - Las CLI compiladas sin URL, con el puerto 5432 de Postgres.app o con un host remoto fallan con `DatabaseGuardError` sin conectarse.
  - `test:db` sin `TEST_DATABASE_URL` falla con `URL_MISSING`; no omite pruebas.
- **Checkout limpio** del commit de código `88687eecfdc18777f6122ee4b23e00a587cc8393`: clon desde GitHub, store vacío (183 paquetes descargados), `pnpm install --frozen-lockfile` y `pnpm run check`, ambos con código 0.
- **CI:**
  - **Run #11** sobre `5b5b104`: failure.
    - 75 de 76 pruebas de base aprobadas. La fallida esperaba `23503` al borrar un número con trámites; con `ON DELETE RESTRICT` PostgreSQL responde `23001`, así que se corrigió la expectativa.
    - `db:types:verify` terminó con `57P01`. `DROP DATABASE … WITH (FORCE)` cortó un cliente que pg-pool estaba cerrando, y sin manejador de `error` el proceso terminó. Se corrigió con `createPool`.
  - **Run #12** sobre `6a7272d`: failure. 76/76 pruebas de base aprobadas. La verificación de tipos detectó una diferencia de formato: Prettier, ejecutado desde `packages/db`, no aplicó el `.prettierignore` de la raíz.
  - **Run #13** sobre `88687ee`: success en ambos jobs (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/39409962393). En el job `db`:
    - Docker Compose v2.38.2;
    - contenedor sano;
    - 8 archivos y 76 pruebas aprobadas contra PostgreSQL 18.6, incluidas la migración desde una base vacía, los ejecutores concurrentes, la verificación de checksums dentro del bloqueo y las pruebas concurrentes T29 y T48;
    - "Tipos de la base al día".
  - La CI del SHA final, con estos documentos, se informa en la entrega.

Limitaciones:
- **Verificaciones locales pendientes:** `pnpm db:up`, `pnpm db:migrate` y `pnpm run check:db` contra el contenedor esperan la confirmación de Docker Desktop. No se declaran aprobadas localmente; las mismas pruebas pasaron en la CI.
- **Alcance de las pruebas de base:** prueban restricciones y concurrencia de la base, no el host (serialización por clave, reclamos, fencing, comprobaciones de creación de entregas). Esos casos siguen en P2 y P5.
- La marca `cluster_name` distingue el contenedor del proyecto de Postgres.app. Su ausencia en otro servidor se probó con un servidor simulado, no contra Postgres.app, que no se usó.
- **PR:** el conector devolvió 403 en tareas anteriores; se intenta una vez al publicar.

ADR creados o modificados: addenda en ADR-001, ADR-002, ADR-009 y ADR-010. Sin cambios de dirección.

Pendientes / bloqueos:
- Fusionar `p1/t2-cierre` y revisar el PR de P1-T3.
- Confirmar Docker Desktop para las verificaciones locales.
- Actualizar el Node local.
- Decidir sobre las listas `enum` de `flow-schema`.
- P1-T4 no está autorizada.

Próxima tarea concreta: revisión del PR de P1-T3 por el propietario y, con Docker Desktop confirmado, `pnpm db:up` y `pnpm run check:db` en local.

### 21/10/2026 — P1-T3: cupo histórico de candidatos

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t3-db` / base `0d746eb` / aplicar la corrección pedida sobre el cupo histórico de candidatos, verificar y publicar. Sin fusionar ni iniciar P1-T4.

Estado previo: no había cambios locales, stash ni otros worktrees, y `origin/p1/t3-db` seguía en `0d746eb`. La corrección no estaba implementada.

Problema: `documents` no rechazaba `DELETE`. Borrar un candidato sin referencias liberaba su `candidate_seq` (`UNIQUE (submission_id, candidate_seq)`), y otro archivo del mismo trámite podía ocuparlo, porque el lugar seguía reservado en `candidate_count`. Así se superaban los 3 candidatos históricos de ADR-014 §2. `TRUNCATE` ya fallaba por efectos laterales: las claves foráneas sin `CASCADE` y el trigger de `document_confirmations` con `CASCADE`. No había una protección propia.

Cambios:
- `packages/db/migrations/0005_candidates_no_delete.sql`: `documents_no_delete` (`BEFORE DELETE`, por fila) y `documents_no_truncate` (`BEFORE TRUNCATE`). Ambos rechazan con `23000` y la restricción `documents_no_delete`. La purga sigue siendo `UPDATE` de `status` y `object_deleted_at`.
- `candidates.test.ts`, tres regresiones. Al final de cada una, el trámite no admite otra reserva, ni un `candidate_seq` 1–3 repetido (`23505`), ni un cuarto (`documents_candidate_seq_reserved`), y conserva las secuencias `[1, 2, 3]`:
  - borrar un candidato, y luego todos los del trámite: rechazado, y la siguiente reserva es la 2, no la 1;
  - purgar el objeto: se actualiza la fila (`DELETED`, `object_deleted_at`), y su `DELETE` posterior se rechaza;
  - `TRUNCATE documents CASCADE`: lo rechaza el trigger de `documents`.
- `migration-files.test.ts`: lista con `0005_candidates_no_delete`.
- Documentos: README de `db` (invariante 5 y diferencias), docs/04 (regla del candidato, borrado físico e implementación física), plan §11 y `docs/reviews/PR-P1-T3-db.md`.
- Tipos generados sin cambios: los triggers no alteran el esquema que lee kysely-codegen.

Pruebas (comando, resultado, limitación):
- **Local** (Node 24.21.0 descargado de nodejs.org con SHASUMS256 verificado; pnpm 12.12.1 por corepack):
  - `pnpm install --frozen-lockfile`: lockfile sin cambios;
  - `pnpm run check`: código 0. Typecheck, lint, formato, límites, 62 pruebas de `db` sin base (incluida la validación de `0005`), 112 de `flow-schema`, 182 de `contracts` y build.
- **CI #15** sobre `09879ee`: success en ambos jobs (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/39584497093).
  - Checks: aprobado.
  - Job `db`: contenedor sano; 8 archivos y 79 pruebas aprobadas (antes 76; `candidates.test.ts` pasa de 12 a 15), con la migración desde una base vacía que ya incluye `0005`; "Tipos de la base al día".

Limitaciones:
- Que las regresiones fallen sin `0005` se dedujo del esquema (sin el trigger, el `DELETE` del candidato sin referencias se ejecuta y la secuencia se libera). No se ejecutaron contra una base sin `0005`.
- Las verificaciones locales contra el contenedor siguen esperando la confirmación de Docker Desktop.

ADR: sin cambios. La regla ya estaba en ADR-014 §2 ("purgados siguen contando") y en docs/04; la migración la hace cumplir en la base.

Pendientes / bloqueos: los mismos de la entrada anterior. P1-T4 no está autorizada.

Próxima tarea concreta: revisión del PR de P1-T3 por el propietario.

### 21/10/2026 — P1-T3: verificación local contra el contenedor

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t3-verificacion-local`, creada desde `main` (`d441571`) / completar la verificación local de P1-T3 con Docker Desktop, solo con el contenedor del proyecto; registrar los resultados y preparar un PR sin fusionarlo. Sin P1-T4.

Estado previo:
- **Repositorio:**
  - árbol limpio, sin stash ni otros worktrees;
  - `main` local actualizado por fast-forward de `5e67f54` a `d441571`, con los PR #4 y #5 ya fusionados;
  - CI #18 de `main` sobre `d441571`: success.
- **Entorno:** sin `.env`, sin volumen ni contenedor del proyecto, puerto 55432 libre y sin variables `PG*`, `DATABASE_URL` ni `TEST_DATABASE_URL` en el entorno.

Entorno usado:
- Docker Desktop: cliente y servidor 29.7.2 (linux/arm64), Docker Compose v5.5.0, contexto `desktop-linux`.
- Node 24.21.0 (copia aislada descargada de nodejs.org, con SHASUMS256 verificado) y pnpm 12.12.1 (corepack, con el hash de `packageManager`).
- `.env` creado desde `.env.example`, con tres contraseñas aleatorias nuevas (`openssl rand -hex 24`) repetidas en `DATABASE_URL` y `TEST_DATABASE_URL`. Tiene permisos 600, Git lo ignora y sus valores no se mostraron.
- Imagen `postgres:18.6-trixie@sha256:74935e72…dcfc4336` (PostgreSQL 18.6), descargada por digest.

Ejecución local sobre `d441571` (comando, resultado):
- `pnpm install --frozen-lockfile`: código 0. Lockfile sin cambios y políticas de cadena de suministro aprobadas.
- `pnpm run check`: código 0. Typecheck, lint, formato, límites, 62 pruebas de `db` sin base, 112 de `flow-schema`, 182 de `contracts` y build.
- `pnpm db:up`: código 0.
  - Creó el volumen `sistema-chatbot_postgres-data` y la red.
  - `10-roles.sh` creó los roles y las bases de desarrollo y de pruebas.
  - Contenedor `healthy` en `127.0.0.1:55432`.
- `pnpm run check:db`: código 0. Build, "Tipos de la base al día", y 8 archivos y 79 pruebas aprobadas contra PostgreSQL 18.6.
- Comandos adicionales, que el registro anterior tenía pendientes:
  - `pnpm db:migrate` sobre la base de desarrollo: aplicó `0001` a `0005`. Una segunda ejecución respondió "Sin migraciones pendientes".
  - `test:cleanup`, solo listado: "No hay bases temporales del rol de pruebas". Las pruebas borraron todas las bases que crearon.

CI previa, que no forma parte de esta ejecución:
- CI #15 (`09879ee`) y #16 (`37833b1`) en `p1/t3-db`: success en ambos jobs, con 79 pruebas de base en el job `db`;
- CI #18 en `main` (`d441571`): success.

Resultado: la ejecución local coincide con la CI. No hubo fallos ni correcciones de código.

Estado final del contenedor: `sistema-chatbot-postgres-1` queda en ejecución y `healthy`, con la base de desarrollo migrada. `pnpm db:down` lo detiene sin borrar el volumen.

Cambios:
- este registro y las secciones de estado de este archivo;
- `docs/15_PLAN_CONSOLIDADO_P0.md` §9 (estado de P1-T3);
- `docs/plans/P1-T3-base-de-datos.md` (contenedores y verificaciones);
- descripción del PR en `docs/reviews/PR-P1-T3-verificacion-local.md`.

Sin cambios de código ni de migraciones.

Limitaciones:
- Solo se usó el contenedor del proyecto. No se usó Postgres.app, el puerto 5432 ni ninguna base externa.
- Se verificó la base, no el host: serialización, reclamos y fencing siguen en P2.
- El Node del sistema sigue en 24.18.0.

Pendientes / bloqueos: revisión del PR de esta rama. El resto, en "Pendientes del propietario". P1-T4 no está autorizada.

Próxima tarea concreta: revisión del PR de documentación por el propietario. P1-T4 requiere autorización.

### 21/10/2026 — Plan de P1-T4

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t4-plan`, creada desde `main` (`78ea2c6`) / preparar y guardar el plan de P1-T4 (API mínima, configuración validada, health y sesiones administrativas locales) y proponer cómo resolver el pendiente de las listas `enum`. Solo planificación: sin implementar ni cambiar código.

Estado previo: árbol limpio, sin stash ni otros worktrees. `main` local actualizado por fast-forward de `d441571` a `78ea2c6` (PR #6). El `.env` local se conservó.

Resultado: `docs/plans/P1-T4-api-minima.md`, con:
- alcance y salida verificable;
- estado de partida;
- dependencias de tareas y de paquetes, con versiones verificadas en el registro de npm;
- diseño de configuración, health, sesiones, CSRF, límites de intentos, HTTP, migración `0006`, contratos, CLI, logs y apagado;
- matriz de seguridad;
- pruebas de salida;
- propuesta para las listas `enum`;
- archivos previstos, decisiones y riesgos.

Hallazgos del relevamiento:
- **Sin ADR de autenticación,** aunque docs/03 la pedía en P0. El plan propone ADR-015.
- **Sin código para el error interno:** `contracts` no tiene un código para el 500. El plan agrega `INTERNAL_ERROR`.
- **Argon2id nativo:** Node 24 trae `crypto.argon2` (desde 24.7.0), así que no hace falta un módulo nativo con scripts de instalación. Medición local (Apple M5) con RFC 9106 (64 MiB, t=3, p=1): 63 ms.
- **Node 24.22.1,** versión de seguridad. Primero la registré como publicada el 20/10/2026, que es la fecha de compilación de `index.json`; la publicación oficial en GitHub es del 21/10/2026. Por la política de 7 días, recién se puede adoptar desde el 28/10/2026 salvo excepción.
- **Variables `enum`:** las comprobaciones de dominio de `flow-schema` son lineales por valor, y la del contexto del correo es O(n·m).
  - Medición con `validateFlowDefinition` sobre los fixtures, más una variable `enum` de N valores en el flujo y en las reglas: 769 ms con 40.000 valores (343 KiB) y 6.746 ms con 120.000 (1.065 KiB).
  - Se midió con un script temporal fuera del repositorio, sobre el `dist` de `main`.
  - No hay exposición hoy, porque ningún endpoint recibe definiciones.
- **`.env.example`** declara `MAX_FILES_PER_SUBMISSION=1`, que no coincide con el cupo de 3 candidatos de ADR-014. Se registra para P2 y no se cambia en silencio.

Pruebas: no corresponden. No se modificó código; solo se agregó el plan y se actualizaron este archivo y docs/15 §9.

Pendientes / bloqueos: aprobación del plan y sus decisiones (hoy en su §13). P1-T4 no está autorizada.

Próxima tarea concreta: revisión del plan de P1-T4 por el propietario.

### 21/10/2026 — Precisiones del plan de P1-T4 y publicación

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t4-plan` / base `5127e3d` / precisar el plan según los pedidos del propietario y publicar la rama. Solo documentación: sin implementar P1-T4, sin cambiar código, dependencias ni migraciones, sin fusionar.

Precisiones incorporadas (`docs/plans/P1-T4-api-minima.md`):
- **§5.7, cookie en local:** HTTP con el panel en `http://localhost:5173` y proxy a `http://127.0.0.1:4000`; cookie `sc_dev_session` sin `Secure`, y `__Host-sc_session` con `Secure` en HTTPS. No se usa `Secure` en local porque Safari no envía cookies `Secure` a `http://localhost` (WebKit bug 281149, según los datos de compatibilidad de MDN) y `__Host-` exige origen seguro.
- **§5.9, login:**
  - enumeración: respuesta idéntica y una sola verificación por intento;
  - bloqueo provocado: límites por red, por par email y red, y por email, con un umbral global por encima de lo que logra una sola red;
  - agotamiento: controles baratos primero, como mucho 2 cálculos de Argon2 a la vez, cola de 8 y 503 con `Retry-After`.
- **§5.6, sesiones:** rotación en cada login y al cambiar la contraseña; vencimientos comprobados en el servidor (30 min y 8 h, propuestas iniciales del propietario); tabla de causas de revocación.
- **§5.5, Argon2id:** se agregó en 24.7.0, se marcó estable en 24.19.0 y se corrigió en 24.20.0, sobre OpenSSL 3.5.8 y 3.5.9. Comprobaciones en 24.21.0:
  - el vector de RFC 9106 coincide y no hay `ExperimentalWarning`;
  - 21 ms por cálculo con 64 MiB, t=3 y p=4.
  La 24.22.1 se verificó solo por documentación y changelog, sin ejecutarla.
- **§6, aviso de seguridad de Node:**
  - severidad máxima HIGH en las líneas 26, 24 y 22;
  - versiones corregidas: v26.12.1, v24.22.1 y v22.23.4;
  - impacto por CVE según el changelog, porque el aviso no publicó todavía la severidad de cada uno;
  - recomendación: no exceptuar la espera y adoptar 24.22.1 el 28/10/2026.
- **§9, tarea separada de `enumValues = 50`:** pruebas de frontera, de entradas excesivas y de compatibilidad con los ejemplos, que no declaran `enum`. `contracts` no cambia.
- **§10, candidatos frente a adjuntos:** cupo histórico de 3 por trámite frente a 1 adjunto por envío. Nombres propuestos: `MAX_CANDIDATE_FILES_PER_SUBMISSION` y `MAX_CANDIDATE_BYTES_PER_SUBMISSION`, sin variable para adjuntos. También se detectó la fila ambigua "Archivos por trámite: 1" en ADR-003.
- **§13, decisiones:** separadas en abiertas, con propuesta por defecto y resueltas por el propietario.

Correcciones de la entrada anterior: la fecha de Node 24.22.1 (21/10/2026, no 20/10) y su fecha de elegibilidad (28/10/2026).

Pruebas: no corresponden. No se modificó código.

Pendientes / bloqueos: decisiones abiertas de §13 del plan. P1-T4 no está autorizada.

Próxima tarea concreta: revisión del plan de P1-T4 por el propietario.

### 21/10/2026 — Node 24.22.1 (seguridad)

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/node-24.22.1`, creada desde `p1/t4-plan` (`2567f10`) / adoptar Node 24.22.1 con excepción a la espera de 7 días, autorizada por el propietario por ser una actualización de seguridad. Primer paso del orden autorizado: Node, límite de `enum` y API mínima, en ramas y PR separados. Sin fusionar y sin cambiar el Node del sistema.

Dependencia: la rama sale del plan de P1-T4 (`p1/t4-plan`, sin fusionar). Conviene fusionar primero esa rama. El diff exclusivo es `p1/t4-plan...p1/node-24.22.1`.

Cambios:
- `.node-version`: 24.22.1.
- `package.json`: `engines` `>=24.22.1 <25`.
- README: requisito de Node.
- ADR-009: addendum con la excepción, el motivo y la verificación.

Verificación (comando, resultado, limitación):
- **Fuentes oficiales:**
  - aviso `october-2026-security-releases` de nodejs.org: severidad máxima HIGH en 26.x, 24.x y 22.x;
  - release v24.22.1 en GitHub, publicada el 21/10/2026;
  - `nodejs.org/dist/index.json`: OpenSSL 3.5.9.
- **Checksums:**
  - `node-v24.22.1-darwin-arm64.tar.gz` (`89c68259…dfbc0a7`) y `node-v24.22.1-linux-x64.tar.gz` (`eb6728e7…c6002d7c`), el que descarga la CI. Primero se registró el `.tar.xz`, pero el log de la CI muestra que `setup-node` usa el `.tar.gz`, y se corrigió;
  - los dos coinciden en `SHASUMS256.txt` de nodejs.org/dist y en el post de la release del repositorio `nodejs/nodejs.org`;
  - firma GPG no verificada: `gpg` no está instalado.
- **Argon2id** (script temporal fuera del repositorio):
  - el vector de RFC 9106 §5.3 coincide;
  - sin `ExperimentalWarning`;
  - con 64 MiB, t=3 y p=4, mediana de 21 ms y máximo de 43 ms en 9 ejecuciones (Apple M5).
- **Local**, con Node 24.22.1 aislado y pnpm 12.12.1 por corepack 0.36.0:
  - `pnpm install --frozen-lockfile`: código 0, políticas aprobadas;
  - `pnpm run check`: código 0, con 62 pruebas de `db`, 112 de `flow-schema` y 182 de `contracts`;
  - `pnpm run check:db`, contra el contenedor del proyecto: código 0, "Tipos de la base al día" y 79 pruebas.
- **Checkout limpio y CI:** se informan en la entrega.

Limitaciones:
- La severidad de cada CVE todavía no está publicada.
- El Node del sistema sigue en 24.18.0.

ADR: addendum de ADR-009.

Próxima tarea concreta: límite de `enum` en `flow-schema` (`p1/flow-schema-enum-limit`, sobre esta rama).

### 21/10/2026 — Límite de valores de `enum` en `flow-schema`

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/flow-schema-enum-limit`, creada desde `p1/node-24.22.1` (`c004557`) / implementar `enumValues = 50` en flujos y reglas, con errores y rutas estables y pruebas de frontera, entradas excesivas y compatibilidad (plan de P1-T4 §9). Segundo paso del orden autorizado. Sin fusionar.

Dependencias: `p1/t4-plan` → `p1/node-24.22.1` → esta rama. El diff exclusivo es `p1/node-24.22.1...p1/flow-schema-enum-limit`.

Cambios:
- **`flow-schema`:**
  - `FLOW_LIMITS.enumValues` y `RULE_LIMITS.enumValues` = 50;
  - comprobación en `checkSizeLimits` de flujos y reglas, antes del análisis semántico y leyendo solo la longitud;
  - error `FLOW_LIMIT_EXCEEDED` o `RULE_LIMIT_EXCEEDED` con `details.limit = "enumValues"`, en `variables.<nombre>.values` o `contextVariables.<nombre>.values`;
  - `enum-values.ts`: pertenencia con un conjunto calculado una vez por lista, en lugar de `includes`. Elimina el costo O(n·m) de comparar el `enum` del flujo con el de las reglas.
- **Pruebas:**
  - `test/enum-limits.test.ts`: 16 pruebas de frontera (1, 50 y 51; varias variables; vacía y repetidos), entradas excesivas (120.000 y 250.000 valores), semántica conservada y compatibilidad con `examples/`;
  - una prueba de `contracts`: el informe conserva el límite y sus detalles;
  - una prueba existente de `behavior.test.ts` usaba un `enum` de 300 valores para superar el límite de combinaciones. Ahora usa dos de 50 (10.000 combinaciones) y sigue probando lo mismo.
- **Documentos:** addenda de ADR-003 y ADR-012, README de `flow-schema` y docs/13.

Criterio de corrección: el rechazo ocurre antes del análisis costoso.
- Las pruebas lo comprueban con una lista instrumentada que cuenta las lecturas de elementos: deben ser 0.
- No se mide tiempo, para que la CI no dependa de la velocidad del runner.
- Como contraste, con 50 valores el mismo flujo sí llega al análisis semántico (`VARIABLE_POSSIBLY_UNDEFINED`).

Pruebas (comando, resultado, limitación):
- **Mutaciones temporales:**
  - con `enumValues` en 51, fallan 6 de las 16 pruebas nuevas;
  - sin la comprobación del flujo, fallan 5, incluida la de lecturas: la de 120.000 valores detecta el recorrido aunque, gracias al conjunto, ya no tarde.
  - Archivos restaurados y comprobados con `cmp`.
- **Medición local** con el script del plan sobre el `dist` nuevo (Apple M5, Node 24.22.1): 120.000 valores, que antes tardaban 6.746 ms, ahora tardan menos de 1 ms. Lo mismo con 10.000, 40.000 y 250.000.
- **Local** (Node 24.22.1):
  - `pnpm run check`: código 0, con 62 pruebas de `db`, 128 de `flow-schema` (112 + 16) y 183 de `contracts` (182 + 1);
  - `pnpm run check:db`: código 0, con 79 pruebas y tipos al día.
- **Checkout limpio y CI:** se informan en la entrega.

Limitaciones: es un límite de validación de definiciones. No hay todavía endpoints que las reciban (P3 y P4).

Próxima tarea concreta: API mínima de P1-T4 (`p1/t4-api`, sobre esta rama).

### 21/10/2026 — P1-T4: API mínima (`apps/api`)

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t4-api`, creada desde `p1/flow-schema-enum-limit` (`f636926`) / implementar P1-T4 según el plan de `2567f10` y ADR-015, con las precisiones del propietario. Tercer paso del orden autorizado. Sin fusionar, sin P1-T5 ni etapas posteriores, solo con el contenedor del proyecto.

Dependencias: `p1/t4-plan` → `p1/node-24.22.1` → `p1/flow-schema-enum-limit` → esta rama. El diff exclusivo es `p1/flow-schema-enum-limit...p1/t4-api`.

Cambios:
- **`apps/api`** (nuevo):
  - **Configuración** validada por clave y sin valores en los errores. Rechaza `APP_ENV=production` y cada modo simulado en producción. `API_HOST` solo loopback.
  - **Health:** `live` y `ready` (base, migraciones y apagado).
  - **Login, `me` y logout,** con cookie según el modo: `sc_dev_session` en local HTTP y `__Host-sc_session` con `Secure`.
  - **CSRF** derivado de la sesión. `Origin` obligatorio en las mutaciones y sin CORS.
  - **Argon2id** de `node:crypto`, con una compuerta de 2 cálculos y cola de 8.
  - **Admisión del login** con límites por red, par y email, que reservan antes del trabajo costoso: 429 si un límite rechaza y 503 si la compuerta está saturada.
  - **Errores** del catálogo de `contracts`, `helmet`, `no-store` y cuerpos JSON de hasta 16 KiB sin compresión.
  - **Apagado ordenado** y CLI de usuarios locales.
- **`packages/db`:**
  - `0006_admin_auth`: usuarios, sesiones y límite por email, con `credential_version` y triggers de revocación e inserción;
  - tipos regenerados;
  - 14 pruebas.
- **`packages/contracts`:** `INTERNAL_ERROR` (500); DTO de login y de sesión; ejemplos de docs/05 validados.
- **Raíz:**
  - `apps/*` en el workspace;
  - límites de ADR-001 en el script y en ESLint (`src/auth` sin HTTP);
  - scripts `api:dev`, `api:admin`, `test:db:api`, y `check:db` con la API;
  - paso de la API en el job `db` de la CI;
  - `.env.example` con las claves de la API, y `MAX_FILES_PER_SUBMISSION` reemplazada por `MAX_CANDIDATE_FILES_PER_SUBMISSION=3` y `MAX_CANDIDATE_BYTES_PER_SUBMISSION=31457280`.
- **Documentos:**
  - ADR-015 (nuevo);
  - addenda de ADR-001, ADR-003, ADR-009 y ADR-014;
  - docs/04, 05, 07, 09, 10, 13 y 15;
  - README raíz, README de `api`, `db` y `contracts`;
  - plan (§5.9, §7, §13, §14 y §15);
  - descripción del PR.
- **Dependencias** (política de 7 días, sin excepciones): express 5.3.0, cookie 2.0.1, helmet 8.3.0 y @types/express 5.0.6.

Precisiones del propietario y cómo se probaron:
- **Token CSRF después de recargar:** `/auth/me` devuelve el mismo token, sin otro login. Probado con recarga, dos pestañas y otro dispositivo.
- **Admisión concurrente:**
  - 12 intentos a la misma clave dan 5 verificaciones y 7 respuestas 429, sin ningún 503;
  - 15 emails distintos dan 10 que entran a la compuerta y 5 respuestas 503 con `Retry-After: 1`, sin ningún 429;
  - los intentos saturados no cuentan como fallos.
- **Bloqueo provocado:** se corrigió la afirmación del plan. Los umbrales son una mitigación con limitaciones (ADR-015). Una prueba muestra que una red no bloquea la cuenta para otra, y que 30 fallos desde 6 redes sí la bloquean.
- **Login concurrente:** con desactivación, con cambio de contraseña, con la sesión creada antes y con varios logins a la vez. Nunca queda una sesión válida.

Pruebas (comando, resultado, limitación):
- **Local** (Node 24.22.1 aislado, pnpm 12.12.1):
  - `pnpm install`: código 0, con las dependencias nuevas aprobadas por las políticas;
  - `pnpm run check`: código 0, con 62 pruebas de `db`, 128 de `flow-schema`, 191 de `contracts` y 58 de la API sin base;
  - `pnpm run check:db`: código 0, con "Tipos de la base al día", 93 pruebas de `db` (79 + 14) y 39 de la API contra PostgreSQL. Las pruebas de la API contra la base pasaron 3 veces seguidas.
- **Prueba de humo** con el proceso real contra la base de desarrollo del contenedor:
  - `pnpm db:migrate` aplicó `0006`;
  - `pnpm api:admin create`;
  - live y ready: 200;
  - login sin `Origin`: 403; con `Origin`: 200, con `Set-Cookie: sc_dev_session=…; Path=/; HttpOnly; SameSite=Strict`;
  - `me` 200, con el mismo token CSRF;
  - logout sin CSRF: 403; con CSRF: 204; `me` después: 401;
  - login incorrecto: 401;
  - `SIGTERM`: `shutdown_completed`, y `pnpm api:dev` libera el puerto;
  - el log no contiene el email;
  - `smoke@example.com` quedó desactivado.
- **Hallazgo de la prueba de humo:** con `pnpm --filter`, la CLI no recibía la entrada estándar ni la terminal. Se corrigieron los scripts (`pnpm -C apps/api`), y la CLI ahora ignora un `--` inicial.
- **Checkout limpio y CI:** se informan en la entrega.

Limitaciones:
- La API es solo local: no arranca en producción, no tiene MFA, roles ni auditoría (P4), y no hay TLS, cookies de dispositivo ni límites compartidos (P7).
- Los límites en memoria no se comparten entre procesos.
- El modo de cookie `secure` se probó en las respuestas HTTP. No se probó con un navegador real por HTTPS.
- No se probaron navegadores reales: el comportamiento de Safari con `Secure` en `http://localhost` se tomó de los datos de compatibilidad de MDN.

ADR: ADR-015 (nuevo) y addenda de ADR-001, ADR-003, ADR-009 y ADR-014.

Próxima tarea concreta: revisión de los cuatro PR por el propietario. P1-T5 no está autorizada.

### 21/10/2026 — Revisión: caché de `enum` por ejecución (`p1/flow-schema-enum-limit`)

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/flow-schema-enum-limit` (base `abf8ceb`, más el merge de `p1/node-24.22.1` con la nota de destino de los PR) / corregir el hallazgo 1 de la revisión, sin force push ni fusiones a `main`.

Hallazgo: `enum-values.ts` usaba un `WeakMap` global con el array de valores como clave. Si quien llama modifica el mismo array entre dos validaciones, el resultado sigue siendo el viejo.
- **Reproducción** con el `dist` anterior y un script temporal fuera del repositorio:
  1. una opción `urgent` fuera del `enum` da `VALUE_OUT_OF_DOMAIN`;
  2. con `urgent` agregado al mismo array, sigue dando `VALUE_OUT_OF_DOMAIN`;
  3. con una copia de los mismos valores, desaparece.

Corrección:
- **Caché por ejecución:** `EnumValueSets` es una caché de cada ejecución del validador. Cada `FlowValidator` crea la suya, y `validateRuleSet` también. No hay estado entre validaciones y no se impone inmutabilidad a quien llama.
- **Sin cambios:** el límite de 50 y el corte temprano siguen igual.
- **Reproducción después de corregir:** el paso 2 ya no informa problemas.

Pruebas (comando, resultado, limitación):
- **4 regresiones nuevas** en `enum-limits.test.ts`:
  - agregar, eliminar y reemplazar valores sobre el mismo array en flujos (`VALUE_OUT_OF_DOMAIN`);
  - lo mismo en reglas (`RULE_CONDITION_INVALID`);
  - el contexto del correo contra el `enum` de las reglas;
  - el límite de 50 sobre el mismo array.
- **Mutación temporal:** con la caché compartida entre instancias, fallan las 3 regresiones de estado viejo. Archivo restaurado y comprobado con `cmp`.
- **`pnpm run check`:** código 0, con 62 pruebas de `db`, 132 de `flow-schema` (128 + 4) y 183 de `contracts`.
- **`pnpm run check:db`:** código 0, con tipos al día y 79 pruebas.
- **CI:** se informa en la entrega.

Próxima tarea concreta: propagar a `p1/t4-api` con un merge normal y corregir allí los hallazgos 2 y 3.

### 21/10/2026 — Revisión: bloqueos de autenticación y readiness (`p1/t4-api`)

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t4-api` (base `d946417`, más el merge de `p1/flow-schema-enum-limit` con la caché de `enum`) / corregir los hallazgos 2 y 3 de la revisión, sin force push ni fusiones a `main`.

Hallazgo 2, orden de bloqueos:
- **Defecto:**
  - `createSession` revocaba la sesión de la cookie previa (fila de `admin_sessions`) y después insertaba, y el trigger de inserción tomaba `admin_users` con `FOR SHARE`;
  - la desactivación y el cambio de contraseña toman `admin_users` y después revocan `admin_sessions`;
  - el orden quedaba invertido.
- **Prueba determinista** (`apps/api/test/db/lock-order.test.ts`): una transacción retiene la fila del usuario con `FOR UPDATE`, la desactivación (o el cambio de contraseña) queda primera en la cola, y el login con la cookie previa llega después. Las esperas se comprueban en `pg_stat_activity`, sin pausas fijas.
- **Antes de corregir:** las 2 pruebas de cruce fallaron (`expected 500 to be 401`) a los 1,1 s, por el deadlock que detecta PostgreSQL.
- **Corrección:**
  - el login toma primero con `FOR SHARE`, en orden de id, al usuario que inicia sesión y al dueño de la cookie previa si es otro;
  - comprueba las credenciales antes de tocar sesiones;
  - después revoca la sesión previa e inserta la nueva;
  - `revokeAdminSessions` bloquea al usuario (`FOR NO KEY UPDATE`) antes de revocar;
  - `lock_timeout` de 5 s en la transacción de la sesión: si vence, el login responde 503 con `Retry-After: 1`, sin sesión y sin contar el intento. No hay reintentos.
  - Las migraciones aplicadas no cambiaron.
- **Después:**
  - desactivación y cambio de contraseña: `{ok: true}`, login 401 y ninguna sesión activa;
  - cookie previa de otro usuario que se desactiva: login 200, el otro usuario sin sesiones activas;
  - plazo vencido: 503 y sin sesión.

Hallazgo 3, readiness:
- **Defecto:** `expected.every(applied.has)` declaraba lista a una API vieja frente a una base con migraciones adicionales.
- **Corrección:** conjunto exacto. Una migración faltante da `MIGRATIONS_PENDING` y una adicional `MIGRATIONS_UNEXPECTED`, las dos con 503 y el motivo solo en el log.
- **Pruebas:**
  - esquema exacto: 200;
  - migración faltante: 503;
  - migración adicional (expectativa de una API más vieja): 503;
  - base caída: 503;
  - `live` en 200 en todos los casos.
- **Mutación temporal:** con la regla anterior falla solo la prueba de la migración adicional. Archivo restaurado y comprobado con `cmp`.

Pruebas (comando, resultado, limitación):
- **`pnpm run check`:** código 0, con 62 pruebas de `db`, 132 de `flow-schema`, 191 de `contracts` y 58 de la API.
- **`pnpm run check:db`:** código 0, con tipos al día, 93 pruebas de `db` y 44 de la API (39 + 4 de bloqueos + 1 de readiness). Las de la API pasaron 3 veces seguidas.
- **CI:** se informa en la entrega.

Documentos: ADR-015 (orden de bloqueos y plazo), docs/05, el README de la API, el plan §15 y la descripción del PR, con la nota de destino. Las descripciones de los PR de Node y de `enum` también indican que el destino pasa a `main` actualizada después de fusionar la dependencia.

Próxima tarea concreta: revisión de los cuatro PR. P1-T5 no está autorizada.

### 21/10/2026 — Cierre local de P1-T4 y plan de P1-T5

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t5-plan` (desde `main` en `aaf0002`) / cierre local de P1-T4 y planificación de P1-T5, solo documentación.

Cierre de P1-T4. **Comprobado por mí:**
- `main` y `origin/main` en `aaf0002`, con los merges de los PR #7 a #10. El árbol de `aaf0002` es idéntico al de `38fab2d`, la última versión revisada de `p1/t4-api`.
- CI #34 sobre `aaf0002`: success en los dos jobs.
- `.env` local:
  - `MAX_FILES_PER_SUBMISSION` se reemplazó por `MAX_CANDIDATE_FILES_PER_SUBMISSION=3` y `MAX_CANDIDATE_BYTES_PER_SUBMISSION=31457280`, como autorizó el propietario;
  - las demás líneas quedaron iguales, comprobado por hash, sin mostrar valores;
  - modo 600 e ignorado por Git.
- Verificación local sobre `main`, contra el contenedor del proyecto en `127.0.0.1:55432`:
  - `pnpm install --frozen-lockfile`, `pnpm run check` (62 de `db`, 132 de `flow-schema`, 191 de `contracts` y 58 de la API), `pnpm run db:up`, `pnpm run db:migrate` (sin migraciones pendientes) y `pnpm run check:db` (93 de `db` y 44 de la API): todos con código 0;
  - sin bases temporales sobrantes.
- Node del sistema, en un shell de login nuevo: v24.22.1 en `/usr/local/bin/node` (paquete `org.nodejs.node.pkg` v24.22.1) y pnpm 12.12.1 en `/usr/local/bin/pnpm`.

**Informado por el propietario:** instaló Node 24.22.1 con el paquete oficial, e informa que la verificación local completa pasó. Lo que verifiqué yo es lo de la lista anterior.

Plan de P1-T5 (`docs/plans/P1-T5-adaptadores-locales.md`):
- **Paquete:** nuevo `packages/adapters`, con dependencias internas solo de `contracts` y `flow-schema`, sin dependencias de npm nuevas y sin red ni procesos en los módulos locales. Los puertos viven en el paquete hasta que exista `domain` (addendum de ADR-001).
- **Entornos:** solo `development` y `test`. Se comprueba en la configuración, en cada fábrica (valor recibido igual a `process.env.APP_ENV`) y en cada operación.
- **Almacenamiento:** claves opacas de 128 bits, temporal con `O_EXCL` y `O_NOFOLLOW`, límite de bytes durante la escritura, publicación con `link` (sin sobrescribir), permisos 0700 y 0600, y borrado idempotente.
- **Captura de correo:** resultado `CAPTURED` con `delivered: false`; formato `message.json` más `attachment.bin`; publicación atómica; repetición por clave de idempotencia; CR y LF rechazados.
- **Scanner simulado:** procedencia `SIMULATED` y etiqueta en cada resultado, escenarios deterministas, no lee bytes, y la composición rechaza combinarlo con un correo que entrega de verdad.
- **Pruebas** con archivos reales para almacenamiento y captura. Lo que queda sin cubrir hasta P5 está listado en el plan (§11).

Decisiones pendientes:
- **Cambia comportamiento:** rechazar en la API los modos locales con `APP_ENV=staging`. Hoy se aceptan, porque las guardas de base no rechazan `staging`.
- **Antes de P2:** el estado de una captura en `deliveries` y la procedencia del análisis en contratos y base. Las dos necesitan migraciones nuevas en P2.

Sin cambios de código, dependencias, configuración ni migraciones. Documentos:
- docs/15 §9: cierre de P1-T4 y plan de P1-T5;
- ADR-009: nota fechada sobre el Node del sistema, debajo del texto anterior, que no se modificó;
- descripción del PR en `docs/reviews/PR-P1-T5-plan.md`.

Pruebas (comando, resultado, limitación): solo documentación. Se corrieron `pnpm run format:check` y `pnpm run check`. Los resultados de CI se informan en la entrega.

Próxima tarea concreta: revisión del plan de P1-T5 por el propietario. La implementación no está autorizada.

### 21/10/2026 — Plan de P1-T5: decisiones aprobadas y precisiones

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t5-plan` (base `0683af0`) / registrar tres decisiones aprobadas y precisar el plan en tres puntos. Solo documentación: sin implementar adaptadores ni empezar P1-T6, sin force push y sin fusionar.

**Comprobado por mí:**
- La versión anterior del plan (`0683af0`) pasó la CI #35 en los dos jobs.
- Crear el PR con el conector devolvió 403 y no se reintentó.
- **Rutas temporales de este equipo (macOS), para la regla de antecesores:**
  - `os.tmpdir()` es `/var/folders/<..>/<..>/T`;
  - `/var` y `/tmp` son enlaces de root dentro de `/`;
  - `/private/tmp` es de root con `1777`;
  - `~/Desktop` tiene una ACL que solo niega borrar.

**Decisiones aprobadas por el propietario.** Están registradas en el plan, §18.1, como decisiones de diseño, no como controles implementados:
1. La configuración de la API rechaza con `APP_ENV=staging` los modos locales de almacenamiento, captura de correo y scanner simulado.
2. El escenario predeterminado del scanner simulado es `INCONCLUSIVE`. `APPROVED` se elige explícitamente.
3. El registro de `CAPTURED` y la procedencia del análisis en contratos y base quedan para P2, antes de integrar los adaptadores al host.

**Precisiones del plan, pedidas por el propietario:**
- **Fallos después de publicar (§8.4, §9.4 y §9.5):**
  - tablas por paso, con el resultado, el estado del destino y la recuperación;
  - el punto de publicación es `link` para el almacenamiento y `rename` para la captura;
  - si falla el `fsync` del directorio, el almacenamiento retira el objeto e informa la clave, y la captura queda publicada para que el reintento la confirme;
  - el reintento de correo verifica el registro y el contenido antes de responder `duplicate: true`;
  - se distingue visibilidad atómica de durabilidad.
- **Raíz y antecesores (§6):**
  - se recorren la ruta configurada y la canónica;
  - solo se admiten enlaces de root dentro de directorios confiables;
  - antecesores de root o del usuario, sin escritura de grupo ni de otros, salvo directorios de root con bit sticky;
  - en cada operación se compara el inodo;
  - la limitación frente a procesos del mismo usuario y las ACL de macOS queda explícita;
  - hay pruebas reales y sintéticas previstas.
- **Limpieza concurrente y retención (§7 y §9.6):**
  - directorio por instancia con arrendamiento: no se borra por antigüedad;
  - reclamo con un `rename` atómico;
  - recuperación después de reiniciar;
  - la purga borra el contenido a los 7 días y conserva un registro sin datos personales hasta los 30, que es el alcance de la idempotencia local;
  - se define qué garantiza el host en P2.

Archivos: el plan, la descripción del PR (`docs/reviews/PR-P1-T5-plan.md`), este archivo y docs/15 §9. Sin cambios de código, dependencias, configuración ni migraciones.

Pruebas (comando, resultado, limitación): solo documentación. Se corrieron `pnpm run format:check` y `pnpm run check`. Los resultados de CI se informan en la entrega.

Próxima tarea concreta: revisión del plan por el propietario. La implementación de P1-T5 y P1-T6 no está autorizada.

### 21/10/2026 — Plan de P1-T5: coordinación por clave y entrada sin registro

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t5-plan` (base `baad744`) / precisar dos casos finales del plan. Solo documentación: sin implementar, sin otra rama ni otro documento, sin force push y sin fusionar.

**Comprobado por mí:**
- La versión anterior del plan (`baad744`) pasó la CI #36 en los dos jobs.
- No existe un PR para `p1/t5-plan`: lo consulté en la API pública de GitHub. No se reintentó crearlo.

**Requisitos del propietario y cómo los resuelve el plan:**
1. **Coordinación de purga y publicación** (§9.4 y §9.8):
   - **bloqueo por `captureId` en `locks/<captureId>/`:** se adquiere con un `rename` atómico de un directorio preparado. Falla si ya hay uno no vacío;
   - **cercado:** toda modificación de `captures/<captureId>` (publicar, purgar el contenido o la entrada) es un `rename` cuyo origen o destino está dentro del directorio `f-<token>` del titular. Si el bloqueo se rompió, falla con `ENOENT` y no modifica nada;
   - **ruptura:** solo si el arrendamiento del titular venció, y también cercada;
   - **purga:** escanea sin bloqueo y relee bajo el bloqueo. Si el `publicationId` cambió, la captura es nueva y la omite;
   - **prueba determinista** en tres variantes: A se pausa después de leer sin bloqueo, A se pausa con el bloqueo tomado, y A pierde el bloqueo. En todas, la captura nueva se conserva o su creación espera.
2. **Registro ausente** (§9.7):
   - `captures/<captureId>` presente sin `record.json`, comprobado bajo el bloqueo: `CaptureIntegrityError`, sin sobrescribir ni borrar, aunque el directorio esté vacío;
   - un directorio desaparecido se reintenta una vez solo si el bloqueo propio se perdió, porque solo así lo pudo quitar una purga legítima. Con el bloqueo vigente, es un error de integridad;
   - `readCapture` no concluye sin bloqueo: ante una anomalía, repite la lectura bajo el bloqueo;
   - pruebas previstas para los dos casos.

**Sin cambios:** las decisiones aprobadas A1 a A3, el código, las dependencias, la configuración y las migraciones.

Archivos: el plan, la descripción del PR y este archivo.

Pruebas (comando, resultado, limitación): solo documentación. Se corrieron `pnpm run format:check` y `pnpm run check`. Los resultados de CI se informan en la entrega.

Próxima tarea concreta: revisión del plan por el propietario. La implementación de P1-T5 y P1-T6 no está autorizada.

### 21/10/2026 — Plan de P1-T5: simplificación del bloqueo de capturas (A4)

Fecha / rama / commit / etapa autorizada: 21/10/2026 / `p1/t5-plan` (base `ceb46d3`) / simplificar el bloqueo de capturas según la decisión del propietario. Solo documentación: sin implementar P1-T5 ni P1-T6, sin otra rama, sin force push y sin fusionar.

**Comprobado por mí:** la versión anterior del plan (`ceb46d3`) pasó la CI #37 en los dos jobs, y no existe un PR para `p1/t5-plan`.

**Decisión aprobada por el propietario (A4).** Está registrada en el plan, §18.1, como decisión de diseño, no como control implementado:
- **Se elimina:**
  - la ruptura automática de bloqueos por el vencimiento de 120 s, porque un proceso pausado puede seguir vivo;
  - el uso del traslado del directorio del token como garantía de cercado, junto con las afirmaciones de que un `rename` de un titular anterior falla necesariamente con `ENOENT`.
- **Se conservan:**
  - la exclusión por `captureId`;
  - la publicación, la verificación y la purga bajo el bloqueo;
  - `publicationId` y la relectura antes de purgar;
  - `CaptureIntegrityError` si falta `record.json`;
  - la espera acotada y `KEY_BUSY` en `send`;
  - la purga que omite claves ocupadas.
- **Recuperación de bloqueos abandonados:**
  - es un mantenimiento explícito (`recoverStoppedRoot`), con un punto de entrada y un comando separados;
  - requiere detener antes todos los consumidores de la raíz;
  - nunca se ejecuta al construir ni desde `recoverWorkArea`;
  - el procedimiento y sus precondiciones están documentados, sin afirmar que un plazo o una confirmación prueben que los procesos estén detenidos;
  - mientras no se ejecute, las claves afectadas dan `KEY_BUSY`.

**Cambios del plan derivados de A4:**
- **Temporales (§7):** se aplica el mismo criterio.
  - Se eliminan los arrendamientos.
  - En ejecución solo se limpia lo propio sin operación activa y `.reclaim/`.
  - Los temporales de otras instancias, los bloqueos ajenos y su material se recuperan solo en el mantenimiento.
  - Una tabla separa los dos casos.
- **Material retenido por un bloqueo:** la adquisición lo traslada con el mismo `rename` que toma el bloqueo, así que nunca queda en `tmp/` y ninguna limpieza de temporales lo toca.
- **Sin `LOCK_LOST`:** sin ruptura automática, ese caso desaparece. Un directorio que desaparece durante la sección bajo bloqueo es `CaptureIntegrityError`. Uno ausente al comenzar la sección, o en una lectura sin bloqueo, es una purga legítima o una captura que nunca existió.
- **Pruebas previstas:**
  - un titular pausado más de 120 s conserva el bloqueo: otra instancia recibe `KEY_BUSY` y la purga omite la clave;
  - la liberación normal permite continuar;
  - un proceso caído deja un bloqueo que no se rompe solo;
  - el mantenimiento con los consumidores detenidos lo recupera;
  - se conservan los casos de captura recreada y de registro ausente.
- Se actualizaron los riesgos, los criterios de salida, §18.2 (n.º 6 y 9) y la descripción del PR.

**Sin cambios:** las decisiones A1 a A3, el código, las dependencias, la configuración y las migraciones.

Archivos: el plan, la descripción del PR y este archivo.

Pruebas (comando, resultado, limitación): solo documentación. Se corrieron `pnpm run format:check` y `pnpm run check`. Los resultados de CI se informan en la entrega.

Próxima tarea concreta: revisión del plan por el propietario. La implementación de P1-T5 y P1-T6 no está autorizada.

### 22/10/2026 — P1-T5, primer bloque: base de `packages/adapters`, configuración y guardas de entorno

Fecha / rama / commit / etapa autorizada: 22/10/2026 / `p1/t5-base-y-config`, creada desde `main` (`d993830`, con el plan de P1-T5 fusionado en el PR #11) / P1-T5 únicamente, primer bloque: esqueleto del paquete, límites de dependencias, reglas de los módulos locales, guardas de entorno, configuración validada y la regla de `staging` aprobada (A1) en la API. Sin puertos, raíz privada, almacenamiento, capturas, bloqueos, scanner, composición, mantenimiento, motor ni P1-T6. Sin cambios en contratos, migraciones, `.env` local ni credenciales.

Comprobado antes de empezar:
- `origin/main` en `d993830` (PR #11 fusionado). `main` local actualizado por fast-forward a `d993830`; durante la operación la rama `p1/t5-plan` local y luego se restauró a su posición (`9fcdd63`), igual a `origin/p1/t5-plan`. En un punto de la preparación se creó la rama nueva desde `main` sin actualizar; se corrigió reubicándola con `git branch -f` sobre el `main` actualizado, sin pérdida de trabajo.
- Árbol en `d993830` sin cambios locales, sin stash ni otros worktrees.
- Node v24.22.1 y pnpm 12.12.1 en el sistema, verificados en un shell nuevo.
- Lectura previa: AGENTS.md, PROJECT_STATUS.md, docs/15 §9, el plan de P1-T5 (§14 pasos 1 y 2 y §5, §12) y los ADR-001, ADR-005, ADR-006, ADR-007, ADR-009; convenciones de `packages/contracts`, `packages/db` y `apps/api`.

Cambios:
- **`packages/adapters` (nuevo):**
  - `package.json` con dependencias internas solo de `contracts` y `flow-schema`, sin dependencias de npm nuevas, y los scripts `build`, `typecheck` y `test` integrados al workspace y a la CI recursiva;
  - `src/environment.ts`: guarda reutilizable `assertLocalAdapterEnvironment`, con `LocalAdapterEnvironment` (`development`/`test`), `AdapterEnvironmentError` (`LOCAL_ADAPTER_FORBIDDEN_ENVIRONMENT`, con `reason` `EXPLICIT_ENVIRONMENT_FORBIDDEN`, `PROCESS_APP_ENV_MISSING` o `PROCESS_APP_ENV_MISMATCH`) y `isLocalAdapterEnvironment`. Exige el valor explícito en la lista y `process.env.APP_ENV` definido, recortado e igual; un cambio posterior del entorno lo detecta la llamada siguiente;
  - `src/config.ts`: `loadLocalAdaptersConfig` con validación por clave y sin valores: `APP_ENV` solo local (`APP_ENV_FORBIDDEN`/`MISSING`), rutas (`LOCAL_STORAGE_DIR`, `LOCAL_MAIL_CAPTURE_DIR`) con `UNSAFE_PATH` (byte nulo y caracteres de control, incluidos CR y LF), `NOT_ABSOLUTE`, `NOT_NORMALIZED`, `ROOT_DIR_NOT_ALLOWED` y `OUTSIDE_REPOSITORY_STORAGE` (solo si el host pasa `repoRoot`), plazos (`LOCAL_MAIL_CAPTURE_RETENTION_DAYS` 1–30, `LOCAL_MAIL_CAPTURE_RECORD_DAYS` 1–365 y no menor que el primero), `MAX_FILE_BYTES` (1 a 2147483647, por defecto 10485760) y `SCANNER_SIMULATED_SCENARIO` (§10.2 salvo `DELAYED`; por defecto `INCONCLUSIVE`, decisión A2);
  - `src/types.ts` y `src/index.ts` (único punto de entrada público; no hay exportaciones sin implementación);
  - README con el alcance parcial y el límite entre validación de forma y comprobación real del sistema de archivos;
  - 61 pruebas (vitest).
- **Límites:** `scripts/check-workspace-boundaries.mjs` con `adapters` en la matriz de ADR-001, y `eslint.config.js` con dos bloques: dependencias internas permitidas (solo `contracts` y `flow-schema`) y prohibición de red y procesos en `src/local/**` y `src/maintenance/**`, con y sin prefijo `node:` y con submódulos (el caso `dns/promises` se corrigió durante la verificación: un detalle que la forma con `paths` exactos no cubría).
- **API (A1):** `apps/api/src/config.ts` rechaza en `staging` los modos locales (`EMAIL_MODE`, `STORAGE_MODE`, `SCANNER_MODE`) con `SIMULATED_MODE_OUTSIDE_LOCAL`; `CHANNEL_MODE` no cambia. Consecuencia: la API no arranca con `staging` en P1 (no hay valores válidos para los tres modos locales). Tres pruebas nuevas: rechazo por clave, imposible arranque con valores válidos o ausentes, y los simulados siguen aceptados en `development` y `test`.
- **`.env.example`:** claves de §12 con valores por defecto y textos, sin secretos.
- **Documentación:** ADR-001 (addendum del paquete y sus límites), `apps/api/README.md`, docs/15 §9, `docs/reviews/PR-P1-T5-base-y-config.md` y este archivo.

Pruebas (comando, resultado, limitación):
- `pnpm install --frozen-lockfile`: código 0, con el lockfile actualizado por la única razón esperada (el importador de `packages/adapters`, sin dependencias externas nuevas) y "Lockfile passes supply-chain policies".
- `pnpm run check`: código 0. Typecheck, lint, formato, límites, 62 pruebas de `db`, 132 de `flow-schema`, 191 de `contracts`, 61 de `adapters`, 60 de la API y build.
- **Mutaciones temporales** (todas retiradas después, con `cmp` sin diferencias):
  - archivo temporal en `packages/adapters/src/local/` con `node:net`, `node:child_process` y `@sistema-chatbot/db`: ESLint lo rechaza con las tres reglas y también por tipado;
  - formas sin prefijo (`net`, `child_process`) y `dns/promises`: rechazadas; `node:fs/promises` y `node:crypto` (permitidas en los módulos locales) pasan sin error;
  - `@sistema-chatbot/db` declarado en el manifiesto de `adapters`: `node scripts/check-workspace-boundaries.mjs` sale con código 1 y señala el límite (ADR-001).
- **Verificación contra PostgreSQL no ejecutada en local para este cambio:** la modificación de la API es de configuración y la cubren las pruebas sin base; el daemon de Docker no está en marcha en esta sesión (se comprobó con `docker info`, código 1). El mismo conjunto de pruebas corre en la CI del SHA publicado.
- **Checkout limpio:** del SHA publicado, con `pnpm install --frozen-lockfile` desde store propio y `pnpm run check`; en la entrega.
- **CI:** del SHA final publicado, en la entrega.

Limitaciones:
- La configuración valida solo la forma declarada: el recorrido de antecesores, enlaces, dueños, modos e inodos del plan (§6) es el bloque siguiente. No hay contactos con datos personales reales ni efectos externos.
- La cota de `MAX_FILE_BYTES` (1 a 2147483647) es una desviación menor respecto al silencio del plan, adoptada para que un valor absurdo por error humano se rechace al configurar; el límite real por objeto lo fija `maxBytes` de `put` (P2/P5). Registrada en el README y en la descripción del PR.
- La guarda no recorta el valor explícito que recibe (la configuración sí recorta los valores del entorno, igual que la API): decisión deliberada, documentada en el README.
- `MAX_FILE_BYTES` se valida en la configuración de usuarios humanos, pero su consumo lo hará `put` (P2/P5); hoy nadie lo lee en ejecución.

ADR creados o modificados: addendum de ADR-001. Sin cambios de dirección.

Pendientes / bloqueos: revisión del PR de esta entrega parcial por el propietario; el resto de P1-T5 (controles de raíz, puertos, adaptadores, composición y mantenimiento) continúa después, bloque por bloque y con autorización.

Próxima tarea concreta: revisión del PR `p1/t5-base-y-config` por el propietario.


### 22/10/2026 — P1-T5, primer bloque: corrección de dos hallazgos de revisión

Fecha / rama / commit / etapa autorizada: 22/10/2026 / `p1/t5-base-y-config` (la misma rama publicada, con commits nuevos sobre `77f847a`; sin amend ni force push) / corrección acotada a dos hallazgos del primer bloque de P1-T5. No avanza al bloque siguiente ni fusiona. Sin cambios en contratos, migraciones, `.env` local, guardas de entorno ni API.

Comprobado antes de empezar: `main` en `d993830`, rama publicada en `77f847a` con la CI de ambos jobs aprobada; árbol limpio, sin stash; lectura de AGENTS.md y del plan de P1-T5 (§6.1, §8.3 y §12).

Cambios (`packages/adapters`):
- **Ruta igual a la raíz del repositorio:** `readPath` no consideraba que `relative(repoRoot, raw)` devuelve cadena vacía cuando la ruta es el repositorio mismo, y la aceptaba. La raíz exacta de `LOCAL_STORAGE_DIR` y `LOCAL_MAIL_CAPTURE_DIR` se rechaza ahora con `OUTSIDE_REPOSITORY_STORAGE`. Se conservan la aceptación de `storage/` y sus descendientes y de las rutas externas válidas (plan §6.1).
- **`MAX_FILE_BYTES`:** el máximo del rango de configuración pasa de 2147483647 a 10485760, el límite acordado del plan (§8.3). Se retira la "cota de la configuración" ampliada del bloque anterior; se conservan las entradas históricas y la corrección se registra aquí.
- `packages/adapters/README.md` y `docs/reviews/PR-P1-T5-base-y-config.md` actualizados (rango del límite, regla de la raíz incluida y sección de correcciones); pruebas de `config.test.ts` (49) y total del paquete en 68.

Pruebas (comando, resultado, limitación):
- Regresiones primero, con las correcciones todavía sin aplicar: 4 fallas en `test/config.test.ts` (raíz exacta rechazada para las dos claves y `MAX_FILE_BYTES` 10485761 y 2147483647 rechazados); es decir, detectan los dos fallos. Las demás pass.
- Después de corregir: `vitest run` del paquete, 68 pass; `pnpm run check` del repositorio, código 0 (lint, formato, límites, build, 62 db, 132 flow-schema, 191 contracts, 68 adapters, 60 api). Local, sin base de datos y sin Docker: no aplica para este cambio.
- CI del SHA final publicado: pendiente/acotada; se informa en la entrega.

Limitaciones: la validación sigue siendo sobre la forma declarada (§6 se implementa en el bloque siguiente); sin efectos externos.

ADR creados o modificados: ninguno (precisión del bloque, sin cambio de dirección).

Próxima tarea concreta: revisión del propietario de la rama con la corrección; el poceso de P1-T5 continúa por bloques con autorización.

### 22/10/2026 — Correctivo: fallo intermitente de las pruebas de sesiones (`p1/fix-session-token-tests`)

Fecha / rama / commit / etapa autorizada: 22/10/2026 / `p1/fix-session-token-tests`, creada desde `main` actualizada al `fed2931` (PR #12 ya fusionado) / únicamente este correctivo, autorizado por el propietario; P1-T5 continúa por bloques con autorización. Sin cambios en la implementación de autenticación ni en la comparación CSRF, sin reintentos automáticos, sin omitir pruebas y sin fusionar.

Causa reproducida: las alteraciones de prueba de `apps/api/test/db/sessions.test.ts` operaban por sufijo. El CSRF alterado era `${csrf.slice(0, -1)}A` y la cookie alterada `${value.slice(0, -2)}AA`: si el azar producía un original que ya terminaba en `A` (CSRF) o en `AA` (cookie), el reemplazo era una operación nula, se enviaba el token válido y el rechazo esperado (403 o 401) devolvía 204 o 200. Con el alfabeto base64url de 64 símbolos, la probabilidad de cada final era 1/64 por token, y una sola ocurrencia en la suite hacía fallar la ejecución.

Cambios:
- `apps/api/test/support/tampering.ts` (nuevo):
  - `withOneCharacterChanged(token)`: cambia el último símbolo por el siguiente del alfabeto base64url (con retorno al primero). El reemplazo difiere garantizadamente del original, conserva longitud y alfabeto, y las pruebas afirman antes de enviarlo que difiere:
  - `withOneBitChanged(cookie)`: decodifica los bytes, cambia un bit del primer byte y recodifica en base64url. Un cambio a nivel de bytes no puede tocar solo los bits de relleno del último símbolo: `A` y `B` decodifican los mismos 32 bytes, y un reemplazo de texto por sufijo podía dejar la cookie intacta.
- `apps/api/test/unit/tampering.test.ts` (nuevo): conservación de longitud y alfabeto y diferencia garantizada, con casos que cubren finales en `A` y en `AA`; y el control del relleno, con `'A'`→`'B'` del último símbolo que mantiene los bytes a diferencia del cambio de bit del helper.
- `apps/api/test/db/sessions.test.ts`: usa los helpers en los dos puntos con alteración (CSRF alterado dentro de los cinco rechazos de logout; cookie alterada en el caso de cookie inválida), afirma antes de enviar la diferencia y la longitud, y conserva los controles: cada logout inválido devuelve 403, la sesión sigue activa y el logout válido devuelve 204; la cookie alterada produce 401 con la cookie borrada.
- `apps/api/test/db/sessions.test.ts` agrega dos casos deterministas con `random` inyectado (`deps.random` de `AppDependencies`): una sesión fija cuyo CSRF derivado (HMAC-SHA256 base64url) termina en `A` (alterado: 403; sesión activa; válido: 204) y otra cuya cookie termina en `AA` (cambio de bit: 401 con cookie borrada; sesión original en pie). Así el rechazo ya no depende del azar.
- Documentación: `docs/reviews/PR-P1-fix-session-token-tests.md` y este archivo.

Pruebas (comando, resultado, limitación):
- Antes del arreglo, comprobación fuera de línea con las constantes deterministas: el sufijo por `${csrf.slice(0,-1)}A` sobre un CSRF terminado en `A` devolvía el token intacto, igual que `${value.slice(0,-2)}AA` sobre una cookie terminada en `AA`.
- `pnpm run check` del repositorio: código 0 (lint, formato, límites, typecheck, pruebas unitarias sin base y build; la API con 64 pruebas incluye las 4 del helper nuevo).
- Suite completa contra PostgreSQL real del contenedor del proyecto (127.0.0.1:55432): `pnpm run test:db`, 46/46 en 7 archivos, con 15 de sesiones y los 2 casos deterministas nuevos.
- Estabilidad del archivo afectado: `sessions.test.ts` repetido 10 veces consecutivas con el código final, 15/15 en las 10 (sin fallos).
- Arranque local: al inicio no había daemon de Docker (`docker info` código 1) y nadie escuchaba en 55432 (socket de `node`); se arrancó Docker Desktop y el contenedor del proyecto (`sistema-chatbot-postgres-1`) para poder ejecutar la parte contra base real. No se cambió ninguna configuración del contenedor.

Limitaciones: el fallo intermitente era un defecto de las pruebas, no del producto: los endpoints rechazan correctamente los tokens alterados, y esta entrega no cambia código de producción. La repetición mide la estabilidad del archivo, no de la suite completa; la versión completa con PostgreSQL corre en la CI del PR.

ADR creados o modificados: ninguno.

Próxima tarea concreta: revisión del propietario del PR `p1/fix-session-token-tests` (estado de CI en la entrega).

### 22/10/2026 — P1-T5 bloque 2: almacenamiento local (raíz privada, área de trabajo y `ObjectStorage`) (`p1/t5-private-storage`)

Fecha / rama / commit / etapa autorizada: 22/10/2026 / `p1/t5-private-storage`, creada desde `main` en `274b2d5` (PRs #12 y #13 ya fusionados) / bloque 2 de P1-T5 autorizado por el propietario (plan §14 paso 3, subpasos de §6, §7.1–7.2 y §8). P1-T5 sigue en curso: faltan captura de correo (§9), scanner (§10), composición (§11) y mantenimiento (§7.3).

Cambios:
- Puerto `ObjectStorage` (`packages/adapters/src/ports/storage.ts`): `put`/`open`/`delete`/`listObjects` con errores tipados (`StorageIntegrityError` con `reason`, `StorageWriteError` con `phase`, `key` y `objectState`, `ObjectTooLargeError`, `EmptyObjectError`, `ObjectNotFoundError`, `InvalidObjectKeyError`); claves de 32 hex minúscula generadas por el adaptador; errores con códigos y clave, nunca contenido ni rutas completas.
- Raíz privada (`src/local/private-root.ts`): forma de la ruta, recorrido de la ruta configurada y del canónico (antecesores del usuario sin enlaces ni escritura de otros), raíz y subdirectorios en modo exacto `0700` del usuario del proceso (nunca corregidos en silencio) y verificación por `dev`/`ino`/tipo/dueño/modo en cada operación (`ROOT_REPLACED`, `SUBDIRECTORY_REPLACED`, `UNEXPECTED_ENTRY_TYPE`).
- Área de trabajo (`src/local/work-area.ts`): `tmp/<instancia>/` con `instance.json` 0600 (instanceId, pid, fecha; sin datos personales), registro en memoria de operaciones activas, `cleanLeftovers()` con retiro a `.reclaim/` y drenaje (un ENOENT de una carrera cuenta como borrado); nunca toca lo de otras instancias, por viejos que sea (A4). `close()` borra el directorio de la instancia si no quedan operaciones activas.
- Almacenamiento (`src/local/private-folder-storage.ts`): temporal con `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` y `0600`, copia con conteo de bytes y SHA-256 incremental, límite aplicado sobre los bytes recibidos (deja de leer al superarlo), publicación solo con `link` (nunca `rename`) con resolución por `dev`/`ino` de errores espurios, `fsync` de archivo y de `objects/`, resultados por fase de §8.4, cancelación por `AbortSignal` hasta justo antes del `link` (después se ignora), lectura con `O_NOFOLLOW` y `fstat` sobre el descriptor con stream por trozos y cierre determinista al interrumpir, `delete` repetible, `listObjects` exclusivo de objetos propios, prueba de enlace duro en la construcción (`HARD_LINK_UNSUPPORTED`) y evento `PUBLISHED_TEMPORARY_RESIDUE` si el temporal publicado queda sin borrar.
- `FileOps` inyectable (`src/local/file-ops.ts`) para las pruebas; los módulos de `src/local/**` no se exportan fuera del paquete y siguen bajo las reglas de dependencias (sin red ni child_process).
- README del paquete actualizado (alcance, uso y limitaciones de §6.6) y `docs/reviews/PR-P1-T5-almacenamiento-privado.md`.

Pruebas (comando, resultado, limitación):
- `pnpm run check` del repositorio: código 0; el paquete `adapters` suma 139 pruebas (8 archivos) con archivos reales bajo `mkdtemp`, sin regresiones en los demás paquetes ni en la API. **[Solo local, en macOS. La CI #45 de `f6dd311` falló en Linux (prueba de reemplazo de `objects/`, inodo reutilizado); ver la entrada del 27/10/2026.]**
- Cobertura de los casos del plan §13 del bloque: reemplazo de subdirectorios, enlaces plantados (put/open/delete), modos y umask, límites exactos/exceso con conteo de trozos entregados, fueros del flujo, cancelación (ya abortada, durante la copia, tras el link), fases por inyección de `FileOps` (apertura del temporal, `link` con EEXIST/otro error con y sin efecto, `fsync` del archivo y de objects, `unlink` del temporal y del objeto), limpieza en ejecución con operación viva (compuerta de escritura, envejecido con `utimes`, otra instancia, carrera de `.reclaim` con ENOENT), guardas de entorno tras cambiar `APP_ENV` y configuración inválida que no construye.
- Prueba de mutaciones conwright: hallazgos durante el desarrollo corregidos como parte del trabajo, entre otras: el error del flujo de `put` se envuelve como `StorageWriteError` `BEFORE_PUBLISH` (antes salía la causa cruda); la prueba del enlace duro de §6.4 existía en el plan pero faltaba en la implementación. **[Texto corrupto en el original ("conwright") y sin evidencia registrada de las mutaciones; ver la entrada del 27/10/2026.]**
- **Desviación observada (macOS/APFS, registrada en el README y la descripción del PR):** dos `unlink` concurrentes del mismo nombre devuelven éxito en APFS, así que dos `delete` concurrentes pueden informar `DELETED` dos veces; el plan §8.5 pide `DELETED` + `ALREADY_ABSENT`. La prueba afirma lo exigible: resultados del contrato, al menos un `DELETED`, objeto ausente y reintento que confirma `ALREADY_ABSENT`. En Linux el par exacto se mantiene. Acción propuesta: si el propietario quiere el par exacto como exigencia, la única vía es un bloqueo por clave (costo adicional); si no, queda como límite documentado. **[El comportamiento de APFS se confirmó el 27/10/2026 con una reproducción corregida (la de esa sesión imprimía cada éxito como "RECHAZADO"). La prueba debilitada se reemplazó por la del contrato, que falla en macOS. "La única vía es un bloqueo por clave" no tenía evidencia: `rename` resultó exclusivo en la medición. Decisión pendiente; ver la entrada del 27/10/2026.]**
- Sin PostgreSQL ni Docker: el bloque no toca la base ni la API; las pruebas de db/flow-schema/contracts/api del workspace pasan igualmente en `pnpm run check`.
- CI del SHA final publicado: pendiente; se informa en la entrega. **[CI #45 de `f6dd311`: falló en el job de checks (Linux); el job `db` pasó.]**

Limitaciones de alcance: la conciliación de huérfanos es P2 (`listObjects` solo enumera); el mantenimiento completo con consumidores detenidos (§7.3) es de un bloque posterior; un mismo usuario sigue pudiendo reemplazar entradas dentro de la raíz (§6.6) y las ACL de macOS no son examinadas por `lstat`; la autorización de lectura por documento es del host (P4).

ADR creados o modificados: ninguno (no cambia dirección; las decisiones de diseño del bloque quedaron en el plan y en el README).

Próxima tarea concreta: revisión del propietario del PR; si autoriza, bloque 3 de P1-T5 (captura de correo §9), que reutiliza la misma raíz.

### 27/10/2026 — P1-T5 bloque 2: correcciones de revisión del almacenamiento privado (`p1/t5-private-storage`)

Fecha / rama / commit / etapa autorizada: 27/10/2026 / `p1/t5-private-storage` (base `f6dd311`, commits nuevos sin amend ni force push) / solo las correcciones pendientes del bloque 2 de P1-T5 (escrituras parciales, cancelación, guardas en lo diferido, raíz privada, prueba de reemplazo y verificación de APFS). Sin captura de correo, scanner ni otras etapas; sin fusionar; sin dependencias ni migraciones nuevas. Se retomó después de una sesión de trabajo con OpenCode.

Estado real reconstruido antes de empezar:
- Rama `p1/t5-private-storage` en `f6dd311`, igual a `origin/p1/t5-private-storage` (comprobado con `git fetch`). Sin stash ni otros worktrees.
- Cambios locales sin commit en 7 archivos de `packages/adapters` (los del antecedente) y `scripts/evidence/` sin seguimiento. Se guardó una copia del diff y del script fuera del repositorio antes de modificarlos, y se conservaron y revisaron como base.
- **La CI #45 de `f6dd311` había fallado** en el job de checks (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/39779280916). En Linux, `objects/` borrado con `rm` y recreado con `mkdir` reutilizó el inodo, así que la operación siguiente no detectó el reemplazo y dio `EmptyObjectError` en vez de `SUBDIRECTORY_REPLACED`. La entrada anterior registraba `pnpm run check` con código 0 solo en local.
- No existía PR para la rama.
- El script `scripts/evidence/apfs-dup-unlink-repro.mjs` tenía un error: con `unlink(...).catch((e) => e.code)`, un éxito resuelve `undefined`, y el script lo imprimía como `"RECHAZADO"`. Su salida no distinguía éxito de rechazo.
- Los cambios locales ya resolvían en parte A, C y D, y tenían una prueba que daba por correcto un doble `DELETED` y otra debilitada del par de §8.5.

Defectos encontrados y corrección (código en `b450156`):
- **A. Escrituras parciales:** la copia y `instance.json` usan `writeFully`, que avanza con los bytes realmente escritos y falla si no hay progreso o el resultado está fuera de rango. El SHA-256 y el tamaño se actualizan solo con el trozo ya escrito entero. Si `instance.json` falla, la construcción cierra el descriptor y borra el directorio de esa instancia. Se quitó una rama `EEXIST` muerta: el `mkdir` de la instancia falla antes si el directorio existe.
- **B. Cancelación:**
  - al agotarse la fuente se esperaba su `return()`, así que una fuente cuyo `return()` no responde bloqueaba un `put` terminado. Ahora no se llama a `return()` después de `done`, como en el protocolo de iteración;
  - al cancelar o fallar, la fuente se abandona sin esperarla y sin rechazos sin manejar, aunque su `return()` quede pendiente, lance, rechace o no devuelva una promesa (antes, los dos últimos casos convertían la cancelación en un error crudo);
  - un `next()` sin promesa ya no da `TypeError` con señal;
  - la comprobación de cancelación (y la de entorno) ocurre sin ninguna espera entre ella y el `link`.
- **C. Guardas de entorno en lo diferido:** `listObjects` ya comprobaba al consumirse y al reanudarse (cambio local, conservado y con pruebas). El stream de `open` ahora comprueba antes de cada lectura y cierra el descriptor si rechaza. `put` comprueba otra vez antes del `link`.
- **D. Raíz privada:**
  - antes de crear, se valida la ruta canónica del último antecesor existente. Antes, un enlace de root hacia un directorio con escritura de otros permitía crear la raíz debajo y recién después se rechazaba;
  - 0700 desde `mkdir` (cambio local, conservado);
  - se restituyó el control de dueño de los componentes creados, que los cambios locales habían quitado;
  - un `EEXIST` de otra instancia se vuelve a comprobar (§6.4); antes, dos construcciones simultáneas sobre una raíz nueva podían fallar;
  - las limpiezas recorren los antecesores sin crear: antes recreaban la raíz si había desaparecido;
  - solo `ENOENT` es ausencia. `verify` propaga los demás errores (antes, cualquier error era `*_REPLACED`); `open` propaga `EACCES`, `EIO` y `EMFILE` (antes eran `TARGET_TYPE`); `delete` informa `BEFORE_REMOVE` con la clave;
  - en la reconciliación del `link`, un `lstat` fallido ya no se toma como destino ausente: `AFTER_PUBLISH` con la clave y `LEFT_IN_PLACE`, o `KEY_COLLISION` si el `link` dio `EEXIST`. **[Defecto: la revisión mostró que seguir esa recuperación (borrar la clave) borraba un objeto anterior. Lo reemplazó la publicación incierta de §8.4.1 (decisión B2); ver la segunda entrada del 27/10/2026.]**
- **E. Prueba de reemplazo:** el original se conserva con `rename` (cambio local, conservado), con contenido real en lugar de un flujo vacío y con una variante para la raíz.
- **F. APFS:** se reemplazó el script de evidencia por una reproducción correcta. Se quitó la prueba que daba por correcto el doble `DELETED` y se restituyó la prueba estricta del contrato, ahora con 100 rondas. Ver la evidencia debajo.
- **Pruebas y documentación:**
  - los `mkdtemp` de las pruebas se borran al terminar cada prueba (había 20 directorios `adapters-p1t5-*` sin borrar en el temporal del sistema);
  - se corrigieron el texto corrupto y las afirmaciones sin evidencia del README del paquete y de la descripción del PR.

Evidencia de APFS (medida en esta sesión, sin el adaptador):
- **Plataforma:** macOS 27.0.1 (26A434), Darwin 27.0.0, xnu-13432.1.9, arm64. Volumen `/System/Volumes/Data`, APFS. Node v24.22.1.
- **`scripts/evidence/apfs-dup-unlink-repro.mjs` (5000 pares, temporal del sistema):**
  - `unlink` concurrente: `OK+OK` 4933 y `ENOENT+OK` 67; el nombre ausente después de cada par;
  - `unlink` secuencial: `OK->ENOENT` 1000/1000;
  - sobre un enlace duro: `OK+OK` 4996 y `ENOENT+OK` 4, con `nlink` del original siempre en 1 (no baja dos veces);
  - `rename` del mismo origen a dos destinos: `ENOENT+OK` 5000/5000, siempre con un solo nombre;
  - `link` al mismo destino: `EEXIST+OK` 5000/5000.
  - Con 3000 pares en otra carpeta del mismo volumen: `OK+OK` 2958 y `ENOENT+OK` 42.
- **Controles fuera del repositorio:**
  - `fs.promises.unlink`, 20000 pares: `OK+OK` 19933;
  - dos `worker_threads` liberados por una barrera, 5000 pares: `OK+OK` 4990;
  - Python 3.9.6 (`python3 -I`), dos hilos con barrera, 3000 pares: `unlink` con `OK+OK` 2858; `rename` y `link` exclusivos en 3000/3000.
- **Adaptador:** la prueba del contrato en macOS dio `{"DELETED+DELETED": 98, "ALREADY_ABSENT+DELETED": 2}` en 100 rondas. En Linux (CI #46) pasó las 100.
- **Conclusión:** la afirmación es cierta en APFS (las dos llamadas devuelven éxito). La prueba no se debilitó y el contrato no se cambió. Exige una decisión de diseño: queda pendiente.

Pruebas (comando, resultado, limitación):
- **Regresiones antes de corregir,** contra `f6dd311` más los cambios locales:
  - 22 fallas en la primera corrida. Dos se debían a un error de la propia prueba (contaba también el cierre de la prueba de enlace duro), que se corrigió; con eso, esas dos variantes pasan con el código anterior.
  - Quedaron 19 regresiones que fallan antes y pasan después, más la del contrato de §8.5, que falla en macOS en los dos casos.
- **Mutaciones temporales sobre el código corregido,** todas detectadas y retiradas después (`cmp` sin diferencias):
  - esperar `return()` al cancelar: falla la variante "queda pendiente";
  - quitar la comprobación de cancelación antes del `link`: falla la cancelación durante el `lstat`;
  - tratar como ausencia un error de `lstat` en `listObjects`: falla la prueba de `EACCES`;
  - crear directorios sin modo: falla la de 0700, con 0777 en vez de 0700.
- **Local, sobre el árbol de `b450156`** (macOS 27.0.1, Node 24.22.1, pnpm 12.12.1):
  - `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `format:check`, `check:boundaries` y `build`: código 0;
  - pruebas (`pnpm --recursive --no-bail run test`): `db` 62, `flow-schema` 132, `contracts` 191 y `api` 64, aprobadas; `adapters` 175/176, con la falla única de §8.5 en APFS. Por eso `pnpm run check` termina con código 1 en macOS.
- **CI #46 sobre `b450156`:** los dos jobs en verde (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/40522033001). En Linux, `adapters` 176/176, incluidas las pruebas de reemplazo de la raíz y de `objects/` y la de §8.5 en 100 rondas.
- **No ejecutado en local:** `check:db`. El daemon de Docker estaba detenido (`docker info`, código 1) y no se arrancó, porque el bloque no toca la base ni la API. Lo cubre el job `db` de la CI.
- **Checkout limpio y CI del SHA final:** en la entrega.

Limitaciones:
- La prueba del contrato de §8.5 falla en macOS hasta que el propietario decida.
- Un directorio borrado y recreado puede reutilizar el inodo: `dev`/`ino` no distinguen ese reemplazo. Es el caso de un proceso del mismo usuario, fuera del modelo de amenazas (§6.6).
- El adaptador no puede obligar a una fuente que no coopera a liberar sus recursos; una escritura en disco ya iniciada no se interrumpe.
- Las pruebas de APFS se midieron en un solo equipo y una sola versión de macOS; Linux está cubierto solo por la CI (ubuntu-24.04).

Decisiones pendientes del propietario: **[Resueltas el mismo día: B1 y B2 del plan §18.1, implementadas en `89d7afb`; ver la entrada siguiente.]**
1. **§8.5 en APFS.** Una opción es cambiar `delete` para que la exclusión no dependa de `unlink`, por ejemplo con un `rename` previo a `.reclaim/`, que fue exclusivo en la medición; eso cambia el algoritmo y la durabilidad de §8.5 y requiere pruebas propias. La otra es modificar el contrato: al menos un `DELETED`, el objeto ausente y el reintento confirma `ALREADY_ABSENT`.
2. **`link` no verificable.** Hoy se informa `AFTER_PUBLISH` con `LEFT_IN_PLACE`. Un valor propio, como `UNKNOWN`, sería un cambio de contrato.

ADR creados o modificados: ninguno. Las correcciones aplican el plan aprobado (§5, §6.4, §8.4 y §15) sin cambiar la dirección.

Archivos:
- `packages/adapters/src/local/{file-ops,private-root,work-area,private-folder-storage}.ts` y `src/ports/storage.ts` (solo comentarios);
- `packages/adapters/test/support.ts` y `packages/adapters/test/{private-root,storage,storage-phases,environment-guards}.test.ts`; `storage-cleanup.test.ts`, solo el comentario de cabecera (en el commit de documentación);
- `packages/adapters/README.md`, `scripts/evidence/apfs-dup-unlink-repro.mjs`, `docs/reviews/PR-P1-T5-almacenamiento-privado.md` y este archivo.

Próxima tarea concreta: decisión del propietario sobre §8.5 en APFS y revisión del PR. El bloque 2 no se declara terminado mientras su prueba del contrato falle en macOS. El bloque 3 (captura de correo) no está autorizado.

### 27/10/2026 — P1-T5 bloque 2: segunda ronda de correcciones (publicación incierta, cierre, temporales y borrado exclusivo)

Fecha / rama / commit / etapa autorizada: 27/10/2026 / `p1/t5-private-storage` (base `589f683`, commits nuevos sin amend ni force push) / solo las cuatro correcciones del bloque 2 pedidas por el propietario, con sus decisiones. Sin fusionar, sin bloque 3, sin dependencias, migraciones, `.env` ni otros proyectos.

Estado al empezar: rama igual a `origin/p1/t5-private-storage` en `589f683`, árbol limpio, sin stash ni otros worktrees; nada que preservar.

Decisiones del propietario (registradas en el plan §18.1):
- **B1:** conservar el contrato del borrado concurrente, un `DELETED` y un `ALREADY_ABSENT`, también en macOS/APFS. Sin mutex en memoria, sin bloqueos que romper y sin omitir pruebas por plataforma.
- **B2:** representar de forma explícita una publicación cuyo resultado no se pudo determinar. No se clasifica como objeto propio confirmado ni autoriza su eliminación sin comprobar pertenencia.

El diseño se precisó en el plan antes de implementar: §7.1, §7.2, §7.4, §7.5 (nuevo), §8.1, §8.4, §8.4.1 (nuevo), §8.5, §8.6, §13 y §16.

Defectos y corrección (código en `89d7afb`):
1. **Publicación incierta y pertenencia.**
   - Defecto: con un objeto anterior en la clave, `link` con `EIO` y el `lstat` de comparación también con `EIO`, se informaba `AFTER_PUBLISH`/`LEFT_IN_PLACE`; borrar la clave, como indicaba la recuperación, borraba el objeto anterior.
   - Corrección: `UncertainPublicationError` con la clave, para cualquier código de error del `link`.
     - El temporal queda retenido como prueba: sigue enlazado al inodo de los bytes escritos, así que ningún otro archivo puede tener su `dev`/inodo.
     - La conciliación es `resolveUncertainPublication(clave)`. `WITHDRAWN` solo si la clave tiene ese inodo, con retiro exclusivo y comprobación posterior. `NOT_PUBLISHED` si está vacía. `KEY_HELD_BY_OTHER` si hay otra entrada, que no se toca. `NOT_RETAINED` sin registro. Si la comparación falla otra vez o la prueba se perdió, sigue incierta y no retira nada.
     - Mientras está pendiente, `delete` de la clave rechaza, la limpieza no toca la prueba y `close` conserva el directorio. `LEFT_IN_PLACE` vuelve a significar solo un objeto propio confirmado.
2. **Cierre concurrente.**
   - Defecto: `close()` comprobaba las operaciones activas y después esperaba el `rm`, y un `put` admitido en ese intervalo fallaba con `ENOENT`.
   - Corrección: estados `OPEN`/`CLOSING`/`CLOSED`.
     - `close` pasa a `CLOSING` antes de esperar; las operaciones nuevas rechazan con `StorageClosedError`, sin efectos.
     - `put`, `delete`, `resolveUncertainPublication` y `recoverWorkArea` se admiten antes de su primera espera, y `close` los espera.
     - Las llamadas concurrentes comparten el intento y, después de cerrar, devuelven el mismo informe sin tocar el disco. Un cierre fallido deja la instancia sin admitir operaciones y se reintenta.
     - Los streams abiertos antes siguen. Las entradas retenidas se conservan (`retainedEntries`).
3. **Temporales no creados.**
   - Defecto: con un `<op>.part` preexistente, `openTempForWrite` daba `EEXIST` y `put` lo borraba. Una colisión de id, además, quitaba del registro la operación activa.
   - Corrección:
     - registro exclusivo de ids: la operación nueva falla sin tocar el temporal ni el registro de la otra;
     - solo se borra lo que la operación creó; un `EEXIST` no borra nada;
     - si `fchmod` falla después de crear, la apertura borra lo suyo;
     - lo mismo para el destino privado `del-<op>/`.
4. **Borrado concurrente en APFS.**
   - Defecto: el resultado salía de `unlink`, que en APFS da éxito dos veces.
   - Corrección: retiro exclusivo.
     - `mkdir` exclusivo de `tmp/<instancia>/del-<op>/` y `rename(objects/<clave>, del-<op>/<clave>)`, que es el punto en que el objeto deja de estar disponible;
     - comprobación posterior de `dev`/inodo, con restitución por `link` y `TARGET_CHANGED` si cambió (lo no verificado nunca se borra);
     - `fsync` de `objects/` antes de `DELETED`;
     - borrado físico, con el evento `DELETED_OBJECT_RESIDUE` si falla.
   - La recuperación después de una caída, los reintentos y las lecturas abiertas están en el plan §8.5.

Evidencia del retiro exclusivo (macOS 27.0.1, APFS, Node 24.22.1; `scripts/evidence/apfs-dup-unlink-repro.mjs`, ampliado):
- `rename` del mismo origen a directorios privados distintos, recién creados: `ENOENT+OK` en 5000 de 5000 pares con `fs.promises`, y en 3000 de 3000 con dos `worker_threads` liberados por una barrera; siempre con un solo nombre después.
- En la misma corrida, `unlink` concurrente: `OK+OK` en 4962 de 5000.
- Una medición previa, fuera del repositorio y con el mismo diseño: `ENOENT+OK` en 10000 de 10000.

Pruebas (comando, resultado, limitación):
- **Regresiones contra el comportamiento anterior.** Con los módulos de `589f683` (`private-folder-storage`, `work-area` y `file-ops`) y el puerto nuevo, para que los tipos existieran, fallan 25 de 195. Los archivos se restauraron después y `cmp` no mostró diferencias. Los cuatro escenarios de la revisión fallan por la causa esperada:
  - publicación incierta: `StorageWriteError` (`AFTER_PUBLISH`) en vez de `UncertainPublicationError`;
  - cierre: el `put` admitido durante el `rm` en pausa termina en `StorageWriteError` porque `close` borró su directorio;
  - `.part` preexistente: desaparece;
  - borrado concurrente: `DELETED+DELETED` en 99 de 100 rondas.
- **Compuertas deterministas, sin depender de tiempos.** Cubren:
  - el `rm` del cierre en pausa con un `put` en pausa en su primera escritura;
  - `close` esperando a un `put` y a un `delete` admitidos (sin avanzar después de 20 vueltas del bucle);
  - dos borrados forzados a llegar juntos al `rename`;
  - la limpieza con un retiro en pausa.
- **Local** (macOS 27.0.1, APFS; Node 24.22.1, pnpm 12.12.1), árbol de `89d7afb`:
  - `pnpm install --frozen-lockfile` y `pnpm run check`, código 0: `db` 62, `flow-schema` 132, `contracts` 191, `api` 64 y `adapters` 195. Incluye las pruebas estrictas de §8.5 con una y con dos instancias, 100 rondas cada una;
  - suite de `adapters` tres veces seguidas: 195/195.
- **CI #48 sobre `89d7afb`:** los dos jobs en verde (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/40532460905). En Linux, `adapters` 195/195 con las mismas cantidades por archivo.
- **No ejecutado en local:** `check:db`. Docker estaba detenido (`docker info`, código 1) y no se arrancó, porque el bloque no toca la base ni la API. Lo cubre el job `db` de la CI.
- **Checkout limpio y CI del SHA final:** en la entrega.

Limitaciones:
- La publicación incierta se registra en la instancia: después de un cierre o una caída con pendientes, solo queda la prueba en disco, para el mantenimiento (§7.3, bloque posterior).
- La comprobación posterior del retiro usa `dev`/inodo de la comprobación previa. Un proceso del mismo usuario que borre y recree la entrada en el medio podría obtener el mismo inodo (§6.6).
- `close` espera a las operaciones admitidas: un `put` sin señal con una fuente que no responde lo retiene.
- El contenido de un objeto retirado puede quedar en `del-<op>/` de una instancia caída hasta el mantenimiento.
- Las instancias concurrentes se probaron en un proceso, y la exclusión con hilos en la evidencia; no con procesos separados.

ADR creados o modificados: ninguno. Las decisiones B1 y B2 están en el plan (§18.1) y precisan el contrato de §8 sin cambiar la dirección.

Archivos:
- `packages/adapters/src/ports/storage.ts`, `src/index.ts` y `src/local/{file-ops,work-area,private-folder-storage}.ts`;
- `packages/adapters/test/{support.ts,storage.test.ts,storage-phases.test.ts,storage-cleanup.test.ts,private-root.test.ts}`;
- `packages/adapters/README.md`, `docs/plans/P1-T5-adaptadores-locales.md`, `scripts/evidence/apfs-dup-unlink-repro.mjs`, `docs/reviews/PR-P1-T5-almacenamiento-privado.md` y este archivo.

Próxima tarea concreta: revisión del propietario del PR del bloque 2. El bloque 3 (captura de correo) no está autorizado.

### 27/10/2026 — P1-T5 bloque 2: permisos del destino privado del retiro

Fecha / rama / commit / etapa autorizada: 27/10/2026 / `p1/t5-private-storage` (base `a7c7d12`, commits nuevos sin amend ni force push) / exclusivamente el hallazgo de permisos de `withdrawExclusively`. Sin fusionar ni avanzar de bloque.

Estado al empezar: rama igual a `origin/p1/t5-private-storage` en `a7c7d12`, árbol limpio, sin stash ni otros worktrees.

Defecto y corrección (código en `afc789c`):
- **Defecto:** el destino privado del retiro (`tmp/<instancia>/del-<op>/`) se creaba con `mkdir(…, 0o700)`, sin reafirmar el modo. Con umask 0777 quedaba en 000 y el `rename` del retiro fallaba con `EACCES`, en `delete` y en la conciliación de una publicación incierta. Se reprodujo antes de corregir.
- **Corrección (plan §8.5, paso 2):** antes del traslado, el directorio recién creado se reafirma en 0700 con `chmod` y se verifica con `lstat` el tipo, el dueño y el modo exactos, con la convención de §6.4.
  - Si algo falla, el error es `BEFORE_REMOVE`, o `UncertainPublicationError` en la conciliación, y el objeto queda intacto.
  - Se retira solo ese directorio vacío con `rmdir` (agregado a la interfaz interna `FileOps`; nunca borra contenido). Si no se puede, queda retenido y ninguna limpieza lo toca.
  - Con `EEXIST`, el directorio que ya existía no se modifica ni se borra.

Pruebas (comando, resultado, limitación):
- **Regresiones nuevas en `storage-phases.test.ts`:**
  - umask 0777 en `delete` (con el modo observado justo antes del `rename`: 0700) y en la conciliación (`WITHDRAWN`);
  - restauración de la umask aunque la operación falle;
  - fallos de la preparación (`chmod`, modo, dueño y tipo): `BEFORE_REMOVE`, objeto intacto y directorio retirado;
  - directorio no retirable: retenido después de `recoverWorkArea` y de `close` (`retainedEntries: 1`);
  - en la prueba de `del-<op>/` preexistente, que conserve su inodo y su modo 0750.
- **Aislamiento de la umask:** la umask se cambia solo durante la llamada probada (`withUmask`) y se restaura en `finally`. Cada archivo de pruebas corre en su propio proceso de vitest y sus pruebas en orden.
- **Antes de corregir** (código de `a7c7d12`): fallan las 7 regresiones de comportamiento. La de `delete` con umask 0777, con `EACCES: permission denied, rename …/objects/<clave> -> …/del-<op>/<clave>`. La restauración de la umask y la prueba de `EEXIST` pasan antes y después: son de protección.
- **Mutaciones temporales sobre la corrección,** detectadas y retiradas (`cmp` sin diferencias):
  - sin `chmod`: fallan 4;
  - sin verificación: fallan 3;
  - sin retener si `rmdir` falla: falla 1.
- **Local** (macOS 27.0.1, APFS; Node 24.22.1, pnpm 12.12.1), árbol de `afc789c`: `pnpm install --frozen-lockfile` y `pnpm run check`, código 0: `db` 62, `flow-schema` 132, `contracts` 191, `api` 64 y `adapters` 203. Dos repeticiones más de la suite de `adapters`: 203/203.
- **No ejecutado en local:** `check:db`. El bloque no toca la base ni la API, y lo cubre el job `db` de la CI.
- **CI #50 sobre `afc789c`:** los dos jobs en verde (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/40536911505). En Linux, `adapters` 203/203.
- **CI del SHA final (este registro):** en la entrega.

Archivos:
- `packages/adapters/src/local/{private-folder-storage,file-ops}.ts`;
- `packages/adapters/test/{storage-phases.test.ts,support.ts}`;
- `packages/adapters/README.md`, el plan (§8.5 y §13), la descripción del PR y este archivo.

ADR creados o modificados: ninguno.

Próxima tarea concreta: revisión del propietario del PR del bloque 2. El bloque 3 no está autorizado.

### 27/10/2026 — Cierre del bloque 2 de P1-T5 e inicio del bloque 3

Fecha / rama / commit / etapa autorizada: 27/10/2026 / `main` y después `p1/t5-local-mail-capture` / base `88880a2` / exclusivamente P1-T5, bloque 3 (captura local de correo), conforme al plan aprobado.

Verificación del punto de partida:
- `origin/main` está en `88880a2`, el merge del PR #14 (`p1/t5-private-storage`). Contiene `828ac3b`, el último commit de la rama, y su árbol es idéntico al de `828ac3b` (`git diff 828ac3b origin/main` vacío).
- CI #52 sobre `88880a2`, en verde (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/40542188606).
- `main` local avanzó por fast-forward de `274b2d5` a `88880a2`, sin descartar nada. Árbol limpio, sin stash y con un solo worktree.
- Rama `p1/t5-local-mail-capture` creada desde `88880a2`.

Cierre del bloque 2: fusionado con las decisiones B1 y B2 (plan §18.1) y la corrección de permisos del retiro. Lo que depende del mantenimiento (§7.3) sigue pendiente para ese bloque.

### 27/10/2026 — P1-T5 bloque 3: captura local de correo (`p1/t5-local-mail-capture`)

Fecha / rama / commit / etapa autorizada: 27/10/2026 / `p1/t5-local-mail-capture` (base `88880a2`) / exclusivamente el bloque 3 de P1-T5. Sin SMTP, proveedores reales, scanner, WhatsApp, motor, panel, endpoints, integración con `deliveries` ni el mantenimiento de §7.3. Sin dependencias, migraciones, `.env` ni otros proyectos.

Objetivo: el puerto `EmailSender` y la captura local del plan §9, solo en `development` y `test`, sin red ni procesos.

Implementado (código en `9839c73`):
- **Puerto** (`src/ports/email.ts`):
  - `send` devuelve `CAPTURED` con `delivered: false`, y el emisor declara `deliversExternally: false`; o `REJECTED`, con un motivo sin valores;
  - errores tipados sin contenido: `CaptureWriteError` con su fase (`BEFORE_PUBLISH`, `AFTER_PUBLISH` o `PUBLISH_UNCERTAIN`), `CaptureKeyBusyError` (`KEY_BUSY`), `CaptureIntegrityError`, `CaptureNotFoundError`, `InvalidCaptureIdError` y `CaptureClosedError`.
- **Validación previa, sin escribir** (§9.2): asunto final sin CR ni LF, con la posición del salto (la parte del adaptador de T53); destinatarios, cuerpo, nombre y tipo del adjunto. El tamaño del adjunto se controla al copiarlo.
- **Captura** (§9.3 y §9.5):
  - se prepara en `tmp/<instancia>/lock-<op>/`, con `owner.json` y `staged/` (`record.json` y `payload/`, con `message.json` y el `attachment.bin` opcional);
  - el adjunto se copia por streaming, con el límite y el SHA-256 de los bytes reales;
  - `record.json` no tiene datos personales: hashes de la clave y del contenido, `publicationId`, fecha y `NOT_SENT_LOCAL_CAPTURE`;
  - el `captureId` son los primeros 32 hexadecimales del SHA-256 de la clave. Ni la clave ni los nombres forman rutas;
  - 0700 y 0600 reafirmados con `chmod`, también con una umask restrictiva;
  - `fsync` de cada archivo y directorio preparado antes de adquirir, y de `captures/` antes de liberar.
- **Bloqueo por clave entre instancias** (§9.4):
  - adquirir es el mismo `rename` de lo preparado, no vacío, a `locks/<captureId>`; `EEXIST` o `ENOTEMPTY` significa ocupado;
  - `send` espera de 20 a 200 ms hasta 5 s y después da `KEY_BUSY`. La purga no espera;
  - sin ruptura automática por antigüedad ni por PID;
  - la liberación solo mueve a `.reclaim/` un bloqueo verificado como propio (`dev`, inodo y token).
- **Duplicados** (§9.6): la misma clave con el mismo contenido da `duplicate: true` después de verificar los hashes; con otro contenido, `IDEMPOTENCY_CONFLICT`. Una entrada sin registro o inconsistente da `CaptureIntegrityError` y no se sobrescribe.
- `readCapture` (§9.7), `purgeCaptures` (§9.8), `recoverWorkArea` y `close` (§7.2 y §7.5).

Reutilización sin cambiar el comportamiento aprobado del almacenamiento:
- la copia por streaming (`byte-copy.ts`), extraída de `private-folder-storage.ts`;
- la escritura completa de un archivo nuevo (`writeNewFile`) y los directorios propios verificados (`createVerifiedPrivateDirectory`), que ya usaba el retiro exclusivo;
- el ciclo de vida del cierre (`WorkArea.closeWith`), con el error de cierre de cada adaptador.

Las pruebas del almacenamiento no se modificaron y siguen pasando.

Precisiones del plan (§9.10, cada una con su motivo):
- publicación incierta (`PUBLISH_UNCERTAIN`) y adquisición incierta;
- liberación verificada;
- errores de la raíz (`StorageIntegrityError`) y cierre (`CaptureClosedError`);
- lectura sin bloqueo con relectura final, y registro ajeno;
- `fsync` en los duplicados sin contenido;
- detalles de la validación;
- informe de la purga (`EIO` y `EACCES` nunca son ausencia);
- evidencia del bloqueo.

Ninguna cambia una decisión del plan.

Evidencia del bloqueo (macOS 27.0.1, xnu-13432.1.9, arm64, APFS, Node 24.22.1; `scripts/evidence/capture-lock-rename-repro.mjs`):
- dos `rename` simultáneos de directorios no vacíos al mismo `locks/<id>`: `ENOTEMPTY+OK` en 5000 de 5000 pares con `fs.promises`, y en 3000 de 3000 con dos hilos liberados por una barrera;
- sin anomalías: un solo ganador, con su `owner.json` en el bloqueo, y lo preparado por el otro intacto.

Pruebas (comando, resultado, limitación):
- **104 pruebas nuevas,** con archivos reales, fallos inyectados en `FileOps`, reloj manual y compuertas, sin esperas arbitrarias:
  - `capture-send.test.ts` (57): validación, con y sin adjunto, formato en disco, duplicados, conflictos, corrupción, escrituras parciales, fallos de copia, temporales preexistentes, directorio sin registro y umask restrictiva restaurada;
  - `capture-phases.test.ts` (16): orden de los `fsync`, fallos de adquisición y de publicación (incluida la incierta), fallos después de publicar y liberación;
  - `capture-lock.test.ts` (7):
    - adquisición simultánea en 50 rondas;
    - titular pausado más de 120 s: `KEY_BUSY` a los 5 s, la purga lo omite y nada lo rompe;
    - proceso caído con el bloqueo tomado;
    - envíos simultáneos en una y en dos instancias;
    - un proceso hijo real que toma el bloqueo y excluye al padre;
  - `capture-read-purge.test.ts` (14): lectura, retención, purgas concurrentes, `EIO` y los escenarios A, B y C de la purga pausada;
  - `capture-lifecycle.test.ts` (10): cierre concurrente, limpieza sin tocar material activo, colisión de id y guardas de entorno.
- **Mutaciones temporales,** detectadas y retiradas (`cmp` sin diferencias):
  - M1, purga sin comparar el `publicationId`: falla el escenario A;
  - M2, sin verificar el SHA-256 del adjunto: falla la prueba de corrupción;
  - M3, con ruptura automática del bloqueo: fallan 8;
  - M4, liberación sin comprobar el titular: falla la del bloqueo reemplazado.
- **Local** (macOS 27.0.1, APFS; Node 24.22.1, pnpm 12.12.1), árbol de `9839c73`:
  - `pnpm run check`, código 0: `db` 62, `flow-schema` 132, `contracts` 191, `api` 64 y `adapters` 307;
  - suite de `adapters` cinco veces seguidas: 307/307.
- **CI #53 sobre `9839c73`:** los dos jobs en verde (https://github.com/lihuen-OD/sistema-chatbot/actions/runs/40549543132). En Linux, `adapters` 307/307 con las mismas cantidades por archivo, incluida la prueba con el proceso hijo.
- **No ejecutado en local:** `check:db`. El bloque no toca la base ni la API, y lo cubre el job `db` de la CI.
- **Checkout limpio y CI del SHA final:** en la entrega.

Limitaciones:
- **Mantenimiento (§7.3, no implementado):** un bloqueo abandonado por una caída deja la clave en `KEY_BUSY` y la purga la omite hasta ese bloque. También quedan para él los pasos 3 y 4 del escenario C: terminar de borrar lo reclamado y quitar el bloqueo.
- **Alcance de la idempotencia:** mientras existe el registro (30 días por defecto). Después, la misma clave crea otra captura (§9.8).
- **Mismo usuario:** un proceso del mismo usuario que manipule la raíz fuera del protocolo queda fuera del modelo (§6.6). La liberación no toca un bloqueo ajeno, pero no impide la manipulación.
- **Datos personales:** `message.json` y `attachment.bin` contienen destinatarios, asunto, cuerpo y adjunto. Solo para datos ficticios, privados (0600) y purgados al vencer.
- **Medición en una máquina:** la exclusión del `rename` se midió en APFS local. En Linux la cubren las pruebas de la CI, no el script de evidencia.
- **No es una entrega:** `CAPTURED` no prueba SMTP, proveedor, MIME, rebotes ni webhooks (§9.9). El estado `CAPTURED` en `deliveries` es de P2.

ADR creados o modificados: ninguno. Las precisiones están en el plan §9.10.

Archivos:
- `packages/adapters/src/ports/email.ts`, `src/index.ts` y `src/local/{capture-email-sender,capture-key-lock,capture-message,own-files,byte-copy,file-ops,private-root,work-area,private-folder-storage}.ts`;
- `packages/adapters/test/{capture-support.ts,capture-send.test.ts,capture-phases.test.ts,capture-lock.test.ts,capture-read-purge.test.ts,capture-lifecycle.test.ts}` y `test/fixtures/{ts-source-hooks.mjs,register-ts-source.mjs,capture-lock-holder.ts}`;
- `scripts/evidence/capture-lock-rename-repro.mjs`, `packages/adapters/README.md`, el plan (§9.10 y §13), `docs/13_TRAZABILIDAD.md`, `docs/reviews/PR-P1-T5-captura-correo.md` y este archivo.

Pendientes / bloqueos: revisión del propietario. P1-T5 no está completa: faltan el scanner (§10), la composición (§11) y el mantenimiento (§7.3).

Próxima tarea concreta: revisión del propietario del PR del bloque 3. El scanner y el mantenimiento no están autorizados.
