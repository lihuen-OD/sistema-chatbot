# Estado del proyecto

Actualizado: 20/10/2026

## Situación actual

- P0 cerrado: fusionado en `main` con el PR #1 (merge `7914dcb`). ADR-001 a ADR-014 en `docs/adr/`.
- P1 en curso:
  - **P1-T1 cerrada:** fusionada en `main` con el PR #2 (merge `5e67f54`).
  - **P1-T2 cerrada:** fusionada en `main` con el PR #3 (merge `6c3804f`).
  - **P1-T3** (`packages/db`): implementada en la rama `p1/t3-db` según el plan aprobado, pendiente de revisión. La rama depende de `p1/t2-cierre`, que tampoco está fusionada.
  - Faltan P1-T4 a P1-T6.
- Código existente:
  - validación de definiciones (`flow-schema`);
  - contratos con validación en tiempo de ejecución (`contracts`);
  - base de datos con migraciones, checksums, guardas y tipos generados (`db`, en revisión).
- No hay API, worker, motor, panel ni adaptadores.
- Integraciones reales: no configuradas.
- Pruebas:
  - 112 de `flow-schema` y 182 de `contracts`;
  - en `db`, 62 sin base y 76 contra PostgreSQL real aislado, que solo corren en el job `db` de la CI mientras Docker Desktop no esté confirmado.
- Las pruebas de base cubren restricciones y concurrencia de la base, no el host. No hay pruebas de ejecución del motor, autenticidad, autorización ni archivos reales: esas partes todavía no existen.

## Repositorio

- Carpeta local de trabajo: `Desktop/Proyectos OD/sistema-chatbot-kit`.
- Remoto: `origin` → https://github.com/lihuen-OD/sistema-chatbot (público).
- Ramas:
  - `main`: P0, P1-T1 y P1-T2 integrados (`6c3804f`).
  - `p0/arquitectura-y-decisiones`: fusionada (PR #1).
  - `p1/t1-base-y-flow-schema`: fusionada (PR #2).
  - `p1/t2-contracts`: fusionada (PR #3).
  - `p1/t2-cierre`: cierre documental de P1-T2 y plan de P1-T3. Solo documentación, publicada para revisión y sin fusionar.
  - `p1/t3-db`: P1-T3, creada desde `p1/t2-cierre`. Descripción del PR en `docs/reviews/PR-P1-T3-db.md`.
- CI: `.github/workflows/ci.yml` en cada push; resultados en https://github.com/lihuen-OD/sistema-chatbot/actions.
- Las etapas de implementación se desarrollan en ramas propias y llegan a `main` mediante PR revisado por el propietario (AGENTS.md).
- `MANIFEST.json` es la referencia histórica del kit tal como se entregó; el commit `8a28a3a` coincide con sus sha256. Los archivos modificados después dejan de coincidir, y es esperado.

## Etapas

| Etapa | Estado |
|---|---|
| P0 Definición y ADR | Cerrado (PR #1 fusionado) |
| P1 Base local y contratos | En curso: P1-T1 y P1-T2 cerradas (PR #2 y #3); P1-T3 implementada y pendiente de revisión; P1-T4 a P1-T6 pendientes (`docs/15_PLAN_CONSOLIDADO_P0.md` §9) |
| P2 Motor y persistencia durable | Pendiente |
| P3 Editor y simulador | Pendiente |
| P4 Administración, permisos y publicación | Pendiente |
| P5 Documentos y correo | Pendiente |
| P6 WhatsApp de prueba | Pendiente |
| P7 Endurecimiento y lanzamiento | Pendiente |

## Pendientes del propietario

- Revisar y fusionar `p1/t2-cierre`; después, revisar el PR de P1-T3 (`p1/t3-db`).
- Abrir Docker Desktop y confirmar que su uso corresponde. Con eso se ejecutan las verificaciones locales contra el contenedor (`pnpm db:up` y `pnpm run check:db`), que siguen pendientes.
- Decidir si `flow-schema` acota la cantidad de valores de las variables `enum` (observación de la revisión de P1-T2; hoy no tiene máximo).
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
