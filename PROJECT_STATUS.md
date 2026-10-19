# Estado del proyecto

Actualizado: 19/10/2026

## Situación actual

- P0 cerrado: fusionado en `main` con el PR #1 (merge `7914dcb`). ADR-001 a ADR-014 en `docs/adr/`.
- P1 en curso. P1-T1 (base del monorepo y `packages/flow-schema`) está implementada en la rama `p1/t1-base-y-flow-schema`, con los tres hallazgos de la revisión de `f0d056f` corregidos; pendiente de PR y fusión. **P1-T1 completa no significa P1 terminada**: faltan P1-T2 a P1-T6.
- Código existente: solo validación de definiciones (`flow-schema`). No hay base de datos, API, worker, motor, panel ni adaptadores.
- Integraciones reales: no configuradas.
- Pruebas: 112 pruebas de `flow-schema`, en verde localmente, en un checkout limpio y en la CI. No hay pruebas de ejecución (concurrencia, idempotencia, confirmación en ejecución, archivos reales) porque esas partes todavía no existen.

## Repositorio

- Carpeta local de trabajo: `Desktop/Proyectos OD/sistema-chatbot-kit`.
- Remoto: `origin` → https://github.com/lihuen-OD/sistema-chatbot (público).
- Ramas:
  - `main`: P0 integrado.
  - `p0/arquitectura-y-decisiones`: ya fusionada (PR #1).
  - `p1/t1-base-y-flow-schema`: P1-T1, pendiente de PR.
- PR de P1-T1: el conector de GitHub no tuvo permiso para crearlo (403). Título y descripción en `docs/reviews/PR-P1-T1-base-y-flow-schema.md`. Se abre como borrador desde https://github.com/lihuen-OD/sistema-chatbot/compare/main...p1/t1-base-y-flow-schema?expand=1.
- CI: `.github/workflows/ci.yml` en cada push; resultados en https://github.com/lihuen-OD/sistema-chatbot/actions.
- Las etapas de implementación se desarrollan en ramas propias y llegan a `main` mediante PR revisado por el propietario (AGENTS.md).
- `MANIFEST.json` es la referencia histórica del kit tal como se entregó; el commit `8a28a3a` coincide con sus sha256. Los archivos modificados después dejan de coincidir, y es esperado.

## Etapas

| Etapa | Estado |
|---|---|
| P0 Definición y ADR | Cerrado (PR #1 fusionado) |
| P1 Base local y contratos | En curso: P1-T1 implementada y pendiente de revisión; P1-T2 a P1-T6 pendientes (`docs/15_PLAN_CONSOLIDADO_P0.md` §9) |
| P2 Motor y persistencia durable | Pendiente |
| P3 Editor y simulador | Pendiente |
| P4 Administración, permisos y publicación | Pendiente |
| P5 Documentos y correo | Pendiente |
| P6 WhatsApp de prueba | Pendiente |
| P7 Endurecimiento y lanzamiento | Pendiente |

## Pendientes del propietario

- Abrir el PR de P1-T1 en borrador (o dar al token del conector permiso de escritura sobre pull requests), revisarlo y decidir su fusión.
- Autorizar P1-T2 cuando corresponda.
- Actualizar el Node local a 24.21.0 (`.node-version`). La 24.18.0 instalada es anterior a una release de seguridad y el proyecto la rechaza.
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
