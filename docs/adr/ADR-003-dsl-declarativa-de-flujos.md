# ADR-003 — DSL declarativa de flujos, opciones dinámicas y límites

- Fecha: 19/10/2026
- Estado: Aceptada. Precisada por ADR-014: el bloque `file` incorpora una revisión obligatoria con estados internos controlados, y entre `file` y el `email` que adjunta su documento no puede haber nodos que capturen datos. La fila "Archivos por trámite: 1" de la tabla de límites se lee como "adjuntos seleccionados por envío: 1"; los candidatos por trámite se limitan en ADR-014.
- Responsable: propietario del proyecto
- Revisión: cuando un recorrido real necesite un bloque, una fuente de opciones o un límite que este ADR no cubre.

## Contexto

El editor debe permitir cambiar textos, preguntas, opciones y rutas sin código, sin abrir la puerta a ejecución arbitraria. El empleado solo puede elegir ámbitos autorizados, y eso depende de cada empleado: con opciones estáticas habría que duplicar flujos o mostrar opciones que después se rechazan (corrección 4).

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Expresiones libres (JavaScript en sandbox, JSONLogic sin restricción) | Rechazada: equivale a programar desde el panel |
| Motor BPMN | Excesivo para el alcance y difícil de editar para el administrador |
| Solo opciones estáticas | No resuelve ámbitos por empleado sin duplicar flujos |
| Opciones dinámicas desde fuentes cerradas | Elegida |

## Decisión

**Contrato.** `definition` = `schemaVersion` (1), `flowId`, `name`, `variables`, `entryNodeId`, `nodes`. El layout visual se guarda aparte y no influye en la ejecución. La formalización (tipos TypeScript + esquemas de validación) se implementa en P1-T1.

**Bloques V1:** `start`, `message`, `selection`, `capture`, `file`, `condition`, `email`, `end`.

**Tipos de variable:** `enum`, `string`, `date`, `boolean`, `companyRef`, `documentTypeRef`, `documentRefList`. `employeeId` proviene del contexto autenticado, nunca de una respuesta.

**Selección estática.** Opciones `{id, label, value, next}` con `id` estable. Los valores de `companyRef` y `documentTypeRef` deben existir en el catálogo usado al validar.

**Selección dinámica.** En lugar de `options`, el nodo declara `optionsSource` de un conjunto cerrado:

| Fuente | Opciones que produce |
|---|---|
| `AUTHORIZED_COMPANIES` | Empresas activas dentro de los ámbitos vigentes del empleado |
| `DOCUMENT_TYPES` | Tipos documentales activos de la versión de catálogo fijada en el trámite; si el tipo declara empresas habilitadas, se filtra por la empresa ya elegida (`companyVariable`) |

Reglas de la selección dinámica:

- `id` de opción = `<fuente>:<id de la entidad>`; `value` = id de la entidad; `label` del catálogo.
- Una sola salida `next` para todas las opciones; las bifurcaciones posteriores se hacen con `condition`.
- `onEmpty` es obligatorio y apunta a un nodo explícito (por ejemplo, un mensaje y fin).
- `maxOptions` es obligatorio y no puede superar el límite del canal.
- `autoSelectSingle` vale `false` por defecto: con una sola opción se pregunta igual, salvo que el flujo lo habilite.
- Las opciones presentadas se guardan con el prompt. La respuesta se valida contra ese snapshot **y** se revalida al recibirla: el empleado sigue autorizado y la entidad sigue activa.
- Si al ejecutar hay más opciones que `maxOptions` (por ejemplo, porque el catálogo creció), no se trunca: el trámite pasa a `NEEDS_REVIEW` y se alerta al administrador.
- Si la cota superior de opciones ya supera `maxOptions` al publicar (por ejemplo, más empresas activas que el límite), la publicación se rechaza.

**Condiciones.** El nodo `condition` tiene ramas con predicados `ALL` y una salida `else` obligatoria. Operadores: `eq`, `neq`, `in`, `notIn`, `exists`; comparaciones de orden solo para `date`. Las ramas deben ser disjuntas: sobre variables de dominio finito el validador lo comprueba de forma exhaustiva; si no puede demostrar que dos ramas son disjuntas, rechaza la publicación. No se resuelve ambigüedad por orden visual.

**Sin ciclos en V1.** Reintentar una entrada inválida no cuenta como transición semántica.

**Límites (valores iniciales, constantes de `flow-schema`):**

| Límite | Valor inicial |
|---|---|
| Nodos por flujo | 100 |
| Variables por flujo | 30 |
| Opciones por selección estática | 10 (verificar límite de listas interactivas en P6) |
| `maxOptions` en selección dinámica | 10 (ídem) |
| Ramas por `condition` | 10 |
| Predicados por rama | 4 |
| Valores en `in`/`notIn` | 50 |
| Transiciones automáticas por evento | 20 |
| Archivos por trámite | 1 (ADR-007, ADR-013) |
| Longitud de textos | Según límites del canal, a verificar en P6 |

Superar un límite es un error de validación, no una advertencia.

**Validación de publicación (servidor).** Estructural (esquema) y semántica: un único inicio; referencias existentes; nodos alcanzables; sin ciclos; salidas completas, incluido `onEmpty`; variables definidas en todos los caminos antes de usarse; tipos compatibles; fuentes dinámicas válidas; límites; cada nodo `email` provee las variables de contexto de su conjunto de reglas con tipos compatibles; informe de cobertura de reglas sin errores (ADR-012). Cada error devuelve `code`, `nodeId` y `field`.

## Costos

Cada bloque o fuente nueva requiere desarrollo y actualizar este ADR. Los límites pueden resultar estrechos para recorridos reales. El validador de disjunción y cobertura agrega complejidad que se mitiga con dominios finitos y límites.

## Consecuencias

- Las organizaciones con más empresas que el límite del canal necesitan otro diseño (búsqueda o paginación), fuera de V1.
- El fixture de ejemplo usa una selección dinámica para la empresa y una estática para el tipo documental.

## Invariantes

- Ninguna configuración del panel se evalúa como código.
- Una opción elegida es válida solo si coincide con el prompt activo y el empleado sigue autorizado.
- Una selección dinámica nunca trunca opciones en silencio.

## Pruebas

T02, T06 y T34; parte de T33.

## Documentos afectados

`docs/06_EDITOR_Y_MOTOR.md`, `docs/05_CONTRATOS_API.md`, `examples/flujo_documental_demo.json`.

## Addendum del 21/10/2026 — límite de valores de `enum`

La tabla de límites se amplía; la decisión no cambia.

| Límite | Valor inicial |
|---|---|
| Valores por variable `enum` | 50 (`FLOW_LIMITS.enumValues`), igual que los valores en `in`/`notIn`, para que un `in` pueda nombrar todos los valores |

**Motivo.** Hasta ahora la cantidad de valores no tenía máximo. Las comprobaciones de dominio comparaban listas completas: comparar el `enum` del flujo con el del conjunto de reglas costaba O(n·m). Medido en local, un flujo de 1 MiB con 120.000 valores tardaba 6,7 s en validarse y bloqueaba el único hilo de JavaScript (plan de P1-T4 §9).

**Comportamiento:**
- Se comprueba con los demás límites de tamaño, antes del análisis semántico, leyendo solo la longitud de cada lista.
- Error: `FLOW_LIMIT_EXCEEDED`, con `details.limit = "enumValues"`, `max` y `actual`, en la ruta `variables.<nombre>.values`. No hay códigos nuevos.
- Las comprobaciones de pertenencia usan además un conjunto, en lugar de búsquedas lineales. El conjunto se construye en cada ejecución del validador y no se reutiliza entre validaciones: quien llama puede modificar sus listas entre una validación y otra, y no se le impone inmutabilidad (corrección de la revisión del 21/10/2026).

**Compatibilidad:**
- Los ejemplos de `examples/` no declaran `enum`.
- No hay definiciones publicadas, así que ninguna queda inválida.
- `schemaVersion` no cambia: cambia un límite de validación, no el esquema.

**Pruebas:** `packages/flow-schema/test/enum-limits.test.ts` cubre la frontera (50 y 51), las entradas excesivas (120.000 y 250.000 valores, rechazadas sin leer la lista) y la semántica conservada.

## Addendum del 21/10/2026 — "Archivos por trámite" es el adjunto por envío

La fila "Archivos por trámite: 1 (ADR-007, ADR-013)" de la tabla de límites se lee "**Adjuntos por envío: 1**" (`ATTACHMENTS_PER_SEND`, `FILE_ATTACHMENT_COUNT_INVALID`). ADR-014 precisó que un trámite admite hasta **3 candidatos históricos**, uno seleccionado por paso documental, y un único adjunto por envío. El cupo de candidatos lo aplica el host (P2) y no lo configura una definición. El catálogo de configuración usa `MAX_CANDIDATE_FILES_PER_SUBMISSION` (addendum de ADR-014).
