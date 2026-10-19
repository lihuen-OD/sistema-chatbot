# @sistema-chatbot/flow-schema

DSL v1 de flujos, conjuntos de reglas y directorio/catálogo: esquemas estructurales y validación semántica (ADR-003, ADR-004, ADR-011, ADR-012, ADR-014). Paquete puro: no depende de otros paquetes internos ni de APIs de Node (ADR-001), así que puede usarse en el servidor y en el panel. El servidor sigue siendo la autoridad.

## Qué valida

- **Estructura:** objetos estrictos (claves desconocidas rechazadas), tipos, formatos de ids y `schemaVersion` 1.
- **Grafo del flujo:** ids únicos, inicio único, `entryNodeId`, salidas completas y existentes, alcanzabilidad y ausencia de ciclos.
- **Variables:** declaradas, nombres reservados, tipos compatibles por bloque, dominios de valores, y definidas en todos los caminos antes de usarse (la salida `onEmpty` no asigna).
- **Opciones dinámicas:** fuente compatible con el tipo, `maxOptions` obligatorio y dentro del límite del canal, y cota superior calculada con el catálogo vigente.
- **Condiciones:** operadores por tipo y ramas demostrablemente disjuntas.
- **Paso documental (ADR-014):**
  - `review` obligatorio;
  - un adjunto seleccionado por envío (`minCount` = `maxCount` = 1);
  - PDF/JPG/PNG hasta 10 MB;
  - ningún nodo que capture datos entre el `file` y el `email` que adjunta su documento.

  El cupo de candidatos del trámite (3) no es parte de la definición: lo aplica el host en P2, y una clave como `maxCandidates` se rechaza.
- **Correo:** conjunto de reglas existente y variables de contexto iguales, en nombre y tipo, a las del conjunto.
- **Plantillas:** solo `{{variable}}`; variables declaradas y mostrables; `{{fileName}}`, `{{fileType}}` y `{{fileSize}}` solo en `review.text`; etiquetas sin marcadores.
- **Reglas (ADR-012):** exactamente una variable `companyRef` y una `documentTypeRef`, condiciones válidas, límites de complejidad, y cobertura exhaustiva del dominio vigente (huecos, solapamientos, `reviewOnly`). Los grupos y miembros activos deben ser de la empresa de cada combinación y estar autorizados para la clasificación del tipo, con un máximo de destinatarios.
- **Directorio:** ids únicos, referencias existentes y unicidad de identidades activas dentro de su ámbito (ADR-011).

## Qué no valida

Son validaciones de definiciones, no de ejecución. No prueban:

- concurrencia, idempotencia ni orden de eventos;
- confirmación en ejecución, cupo atómico de candidatos ni vinculación de eventos (P2);
- descarga, almacenamiento ni análisis de archivos reales (P5);
- límites reales del canal de WhatsApp, que se verifican en P6.

Las cotas de longitud de textos son genéricas hasta P6.

## API

```ts
import { validatePublication } from "@sistema-chatbot/flow-schema";

const result = validatePublication({ flow, ruleSets: [ruleSet], directory });
// result.valid, result.flow, result.ruleSets[i].issues, result.ruleSets[i].coverage, result.directory
```

También exporta `parseFlowDefinition`, `parseRuleSet` y `parseDirectory` (validación estructural), además de `validateFlowDefinition`, `validateRuleSet` y `validateDirectory` (validación semántica de documentos ya parseados), los esquemas, los límites y `ISSUE_CODES`.

Cada problema es un `ValidationIssue`:

- `code`: estable;
- `message`: en español, puede cambiar;
- `path`: ruta JSON dentro del documento, por ejemplo `["nodes", 3, "review"]`;
- `nodeId`: cuando corresponde;
- `details`: motivo y valores involucrados.

## Códigos

| Código | Documento | Significado |
|---|---|---|
| `STRUCTURE_INVALID` | todos | Estructura inválida; `details.reason` lleva el código de Zod |
| `SCHEMA_VERSION_UNSUPPORTED` | todos | `schemaVersion` distinto de 1 |
| `DUPLICATE_ID` | todos | Id repetido (nodo, opción, rama, regla, conjunto, entidad del directorio) |
| `START_NODE_MISSING` / `START_NODE_DUPLICATE` | flujo | Ninguno o más de un `start` |
| `ENTRY_NODE_INVALID` | flujo | `entryNodeId` no apunta al `start` |
| `MISSING_TARGET` / `UNKNOWN_TARGET` | flujo | Salida faltante o hacia un nodo inexistente |
| `UNREACHABLE_NODE` | flujo | Nodo no alcanzable desde el inicio |
| `CYCLE_DETECTED` | flujo | Ciclo (V1 no los admite) |
| `UNDECLARED_VARIABLE` | flujo | Variable no declarada |
| `VARIABLE_NAME_RESERVED` | flujo | Nombre reservado (`fileName`, `fileType`, `fileSize`, `employeeId`) |
| `VARIABLE_TYPE_MISMATCH` | flujo | Tipo de variable incompatible con el bloque o campo |
| `VARIABLE_POSSIBLY_UNDEFINED` | flujo | Uso sin asignación en todos los caminos |
| `ENUM_VALUES_INVALID` | flujo, reglas | Enumeración vacía o con repetidos |
| `VALUE_OUT_OF_DOMAIN` | flujo | Valor fuera del dominio vigente (incluye opciones de entidades inactivas) |
| `SELECTION_OPTIONS_INVALID` | flujo | Combinación inválida de `options` y `optionsSource`, o falta `maxOptions` |
| `DYNAMIC_SOURCE_INVALID` | flujo | Fuente dinámica incompatible |
| `DYNAMIC_OPTIONS_LIMIT_EXCEEDED` | flujo | `maxOptions` mayor que el límite del canal o menor que la cota del catálogo |
| `FLOW_LIMIT_EXCEEDED` | flujo | Límite de ADR-003 superado (`details.limit`) |
| `CONDITION_OPERATOR_INVALID` | flujo | Operador o forma de valor inválidos para el tipo |
| `CONDITION_BRANCHES_OVERLAP` | flujo | Ramas no demostrablemente disjuntas |
| `FILE_REVIEW_MISSING` | flujo | Paso documental sin `review` |
| `FILE_ATTACHMENT_COUNT_INVALID` | flujo | `minCount`/`maxCount` distintos de 1 adjunto por envío |
| `FILE_FORMAT_NOT_ALLOWED` / `FILE_SIZE_LIMIT_EXCEEDED` | flujo | Formato o tamaño fuera de V1 |
| `CAPTURE_BETWEEN_FILE_AND_EMAIL` | flujo | Nodo de captura entre el `file` y su `email` |
| `RULE_SET_NOT_FOUND` | flujo | El `email` referencia un conjunto inexistente o estructuralmente inválido |
| `EMAIL_CONTEXT_MISMATCH` | flujo | Variables de contexto distintas de las del conjunto de reglas |
| `TEMPLATE_SYNTAX_INVALID` | flujo | Marcadores mal formados |
| `TEMPLATE_VARIABLE_UNKNOWN` | flujo | Marcador con variable no declarada |
| `TEMPLATE_VARIABLE_NOT_RENDERABLE` | flujo | Marcador de una variable que no se muestra (`documentRefList`) |
| `TEMPLATE_RESERVED_VARIABLE_MISUSE` | flujo | Variable de revisión fuera de `review.text` |
| `TEMPLATE_NOT_ALLOWED` | flujo | Marcadores en una etiqueta |
| `RULE_CONTEXT_INVALID` | reglas | Sin exactamente una `companyRef` y una `documentTypeRef` |
| `RULE_CONDITION_INVALID` | reglas | Variable desconocida, forma de valor o valor fuera de dominio |
| `RULE_LIMIT_EXCEEDED` | reglas | Límite de ADR-012 superado (`details.limit`) |
| `RULE_COVERAGE_GAP` / `RULE_OVERLAP` | reglas | Combinación sin regla o con más de una |
| `REVIEW_ONLY_INVALID` | reglas | Entrada de `reviewOnly` mal formada, repetida o cubierta por una regla |
| `RECIPIENT_GROUP_NOT_FOUND` | reglas | Grupo destino inexistente |
| `RECIPIENT_GROUP_NOT_AUTHORIZED` | reglas | Grupo de otra empresa o sin la clasificación |
| `RECIPIENT_GROUP_EMPTY` | reglas | Grupo sin miembros activos |
| `RECIPIENT_NOT_AUTHORIZED` | reglas | Miembro activo de otra empresa o sin la clasificación |
| `DIRECTORY_REFERENCE_INVALID` | directorio | Referencia a empresa, clasificación o contacto inexistente |
| `IDENTITY_ACTIVE_DUPLICATE` | directorio | Identidad activa repetida en su ámbito |

Cada código tiene al menos un caso negativo en `test/negative-cases.test.ts`, y una prueba falla si se agrega un código sin caso.

## Comandos

Desde la raíz del repositorio (ver `README.md`):

```sh
pnpm --filter @sistema-chatbot/flow-schema run typecheck
pnpm --filter @sistema-chatbot/flow-schema run test
pnpm --filter @sistema-chatbot/flow-schema run build
```
