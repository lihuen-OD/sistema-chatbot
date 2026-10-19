# Plan consolidado de P0

- Fecha: 19/10/2026
- Estado: registrado en la rama `p0/arquitectura-y-decisiones`; P0 se cierra al aprobar y fusionar su PR.
- Decisiones: `docs/adr/` (ADR-001 a ADR-014).
- Descripción del PR: `docs/reviews/PR-P0-arquitectura-y-decisiones.md`.

## Origen y alcance de este documento

- **14/10/2026:** se presentó un plan inicial en una conversación con Claude Code, en respuesta a `prompts/01_PLAN_INICIAL.md`. Ese texto no se conservó en el repositorio ni está disponible ahora. Solo quedaron notas de sesión con sus recomendaciones principales, que se listan abajo como antecedente.
- **19/10/2026:** el propietario aceptó la dirección técnica y pidió ocho correcciones. Este documento consolida el estado actual con esa fecha. No reconstruye el plan del 14/10.

Antecedentes del 14/10/2026 según las notas de sesión. No son decisiones por sí mismos; lo vigente está en los ADR:

- Kysely con migraciones SQL en lugar de Prisma. Se mantiene la elección, pero el argumento de entonces se reemplaza por ADR-010, que no sostiene una incompatibilidad de Prisma.
- Node 24 LTS, TypeScript 6.0.x y pnpm con antigüedad mínima de publicación. Se verifican en P1 (ADR-009).
- Identificadores en inglés e interfaz en español (ADR-009).
- Identificador de usuario de negocio de Meta (BSUID) → identidades de canal en lugar de `EmployeePhone` (ADR-011).
- Catálogo documental dueño de la clasificación (ADR-012).
- Carpeta privada local en lugar de MinIO para desarrollo (ADR-007).
- Primera tarea P1-T1: monorepo mínimo + `packages/flow-schema`.

## 1. Alcance V1

Una organización propietaria con varias empresas internas y un número de WhatsApp. Conversaciones individuales. Un trámite activo por empleado y número, aunque el empleado use varias identidades.

Editor visual con bloques tipados, flujos y reglas versionados, simulador con el motor compartido, un adjunto PDF/JPG/PNG de hasta 10 MB por envío que el empleado revisa y confirma (con reemplazo antes de confirmar), cuarentena y análisis, distribución por correo a destinatarios autorizados con resolución fail-closed, correcciones vinculadas después de un envío aceptado y seguimiento con estados honestos.

Exclusiones y recortes con sus consecuencias: `docs/01_REQUISITOS.md` y ADR-013.

## 2. Dirección técnica aceptada

| Decisión | ADR |
|---|---|
| Monolito modular con API y worker | ADR-001 |
| TypeScript, React, PostgreSQL; identificadores en inglés, interfaz en español | ADR-009 |
| Kysely + pg con migraciones SQL revisadas | ADR-010 |
| Motor puro compartido entre simulador y WhatsApp | ADR-005 |
| Inbox/outbox y cola durables | ADR-002 |
| Flujos, reglas y catálogo versionados, fijados por trámite | ADR-004 |
| V1: un archivo PDF/JPG/PNG por trámite, hasta 10 MB | ADR-007, ADR-013 |
| Sin IA, ERP, SaaS ni mensajes proactivos fuera de ventana | ADR-008, ADR-013 |

## 3. Correcciones del propietario incorporadas

| # | Corrección | Dónde quedó |
|---|---|---|
| 1 | Teléfono y BSUID vinculados al empleado canónico, conservando el ámbito; un trámite activo por empleado y número | ADR-011; docs 01, 02, 04, 05, 07, 08; `examples/directorio_demo.json` |
| 2 | Leases de llamadas externas activas no se liberan al apagar; drain, fencing, recuperación e inciertos | ADR-002; docs 02, 04, 08, 10 |
| 3 | Clasificación aplicada fija en el trámite; cambios que relajan restricciones protegidos | ADR-004, ADR-012; docs 04, 05, 07, 11 |
| 4 | Opciones dinámicas y cobertura de reglas con límites; destinatarios ausentes, ambiguos o no autorizados bloquean | ADR-003, ADR-012; docs 05, 06; ejemplos |
| 5 | El simulador por metadatos no reemplaza las pruebas con archivos reales de P5 | ADR-005; docs 03, 06, 09, 11 |
| 6 | Kysely como elección técnica con alternativas y costos | ADR-010 |
| 7 | Recortes de V1 registrados con consecuencias | ADR-013; doc 01 |
| 8 | Afirmación sobre secret scanning corregida | `PROJECT_STATUS.md` |

### Requisito adicional del 19/10/2026: revisión y confirmación del documento

Registrado en ADR-014. Cubre:

- confirmación explícita del archivo exacto, que referencia trámite, revisión de contexto y documento;
- reemplazo y cancelación antes de confirmar, y elección cuando llega otro archivo sin Reemplazar;
- hasta 3 candidatos por trámite con un único adjunto seleccionado, con límites y purga (corrige la restricción física "un documento por trámite");
- invalidación por reemplazo y resultados tardíos sin efecto;
- coordinación atómica con el inicio del despacho;
- corrección posterior como trámite nuevo vinculado;
- confirmación del empleado distinta de una aprobación administrativa;
- estados internos del paso documental sin ciclos del editor;
- revalidación de mensajes retenidos.

Documentos actualizados: 01, 02, 03, 04, 05, 06, 07, 08, 09, 11, 13, este plan y `examples/`. ADR-003, ADR-007 y ADR-013 llevan la nota "precisada por ADR-014".

## 4. Arquitectura de código

Árbol del monorepo y reglas de dependencia en ADR-001. Resumen: `apps/admin`, `apps/api`, `apps/worker`; `packages/flow-schema`, `flow-engine`, `domain`, `contracts`, `db`, `adapters`. El motor no depende de HTTP, base de datos ni proveedores.

## 5. Modelo e invariantes clave

Detalle en `docs/04_MODELO_DATOS.md`. Invariantes que la base debe garantizar:

- Una identidad de canal activa pertenece a un solo empleado (índice único parcial).
- Un trámite activo por empleado y número empresarial (índice único parcial).
- Evento externo único por canal y clave; acción lógica única.
- Versiones publicadas inmutables (trigger o privilegios).
- Escrituras de jobs condicionadas por `fencingToken`.
- Hasta 3 candidatos por trámite y un solo candidato seleccionado por paso documental.
- Una confirmación por revisión de contexto y una entrega por confirmación (ADR-014).

## 6. Formalización del esquema y divergencias de los ejemplos

El esquema formal (tipos + validación) se implementa en P1-T1 a partir de ADR-003 y ADR-012. Divergencias del kit original resueltas en `examples/`:

| Divergencia | Resolución |
|---|---|
| El flujo referenciaba `routing_demo_v1`, es decir, una versión de reglas | El flujo referencia `ruleSetId: routing_demo`; la versión se fija al iniciar el trámite (ADR-004) |
| Cada regla declaraba `classification` | Se quita: la clasificación sale del catálogo (ADR-012) |
| Grupos y contactos dentro del archivo de reglas | Se mueven a `examples/directorio_demo.json`, porque el directorio no se versiona con las reglas |
| Empresa como `enum` con opciones estáticas | `companyRef` con selección dinámica `AUTHORIZED_COMPANIES` y salida `onEmpty` |
| Tipo documental como `enum` libre | `documentTypeRef` validado contra el catálogo |
| No había empleados ni identidades de ejemplo | Dos empleados ficticios: uno con teléfono + BSUID y dos empresas; otro con una empresa, para pruebas negativas |
| El conjunto de reglas no declaraba su dominio | `contextVariables` y `reviewOnly` explícitos para la cobertura |
| El nodo `file` pasaba directo al correo al aprobarse el análisis | Bloque `review` obligatorio; solo la confirmación lleva a `email` (ADR-014) |

## 7. Contradicciones resueltas

| Contradicción | Documentos | Resolución |
|---|---|---|
| Hasta 3 archivos frente a 1 archivo | 02 §8; 06; 12 | Un archivo en V1 (ADR-007, ADR-013) |
| Prisma frente a Kysely | README; 02 §3; 04 | Kysely + pg (ADR-010) |
| Un trámite activo por conversación o remitente frente a uno por empleado y número | 01; 02 §6 y §10; 04 | Por empleado y número, con índice parcial (ADR-011) |
| Teléfono vinculado a dos empleados "de distinto ámbito" | 04 | Una identidad activa → un solo empleado (ADR-011) |
| "Plantilla permitida" fuera de ventana frente a la exclusión de mensajes proactivos en V1 | 01; 06; 08 | V1 retiene el mensaje hasta la próxima entrada (ADR-013) |
| "No matar jobs sin liberación/lease" frente a no liberar llamadas externas en curso | 10 | Solo se liberan trabajos sin efecto externo iniciado (ADR-002) |
| Estados en español (`ESPERANDO_ARCHIVO`) frente a inglés (`WAITING_FILE`) | 02 §6; 04; 06 | Códigos en inglés con etiqueta en español (ADR-009) |
| Clasificación en la regla frente a permisos del tipo documental | 02 §9; ejemplos | El catálogo es dueño de la clasificación (ADR-012) |
| Criterio de salida de la etapa 0 de la arquitectura ("recorrido real confirmado") frente a P0 del plan ("usar fixtures si faltan datos") | 02 §14; 03 | P0 cierra con fixtures ficticios; confirmar el recorrido real pasa a ser condición previa del piloto (sección 8) |
| Restricción física "un documento por trámite" frente a la necesidad de gestionar reemplazos | 04; ADR-007 | Hasta 3 candidatos, uno seleccionado; un adjunto por envío (ADR-014) |
| `DOCUMENT_APPROVED` habilitaba el correo frente a "validar no autoriza el envío" | 06 | Solo `DOCUMENT_CONFIRMED` válido habilita `email` (ADR-014) |
| "Volver a pasos reversibles" frente a la revisión ligada a la revisión de contexto | 06 | `VOLVER` no está disponible desde el paso documental; cambiar empresa o tipo requiere cancelar y reiniciar (ADR-014) |
| Mensaje retenido "se envía cuando el empleado vuelve a escribir" frente a no reproducir preguntas obsoletas | 06; 08 | Revalidación contra el estado vigente; los prompts nunca se reproducen (ADR-014) |

## 8. Pendientes: qué bloquea y cuándo

| Pendiente | Bloquea | Supuesto mientras tanto |
|---|---|---|
| Aprobación y fusión del PR de P0 | **Inicio de P1** | — |
| Verificar versiones exactas de runtime y tooling | Primer paso de P1-T1, sin decisión del propietario | Node LTS instalado localmente (v24.18.0) |
| Herramienta de migraciones | Tarea de base de P1 (no P1-T1) | Kysely Migrator o equivalente con SQL plano |
| Implementación propia o biblioteca de cola | P2 | Semántica de ADR-002 |
| Segunda aprobación para relajar clasificación | P4 | Permiso `classification.relax` + motivo + auditoría |
| Avisar o no a los destinatarios originales cuando una corrección cambia de destinatarios | P4 | Sin aviso automático; el operador decide (ADR-014) |
| Valores iniciales del paso documental (candidatos, entradas inesperadas, revisiones, plazos de corrección y retenidos, purga) | P2 (constantes del host) | Valores de ADR-014 §11 |
| Mostrar o no el área destinataria en la revisión | P3 | No se muestra |
| Proveedor de correo y dominio | Envíos reales en P5 | Adaptador de captura local |
| Scanner y almacenamiento de producción | P5 real / P7 | Carpeta privada local y scanner simulado etiquetado |
| Formato y ámbito real del BSUID; límites de mensajes interactivos | P6 | Valor opaco con ámbito; límite inicial de 10 opciones |
| Verificación adicional de identidad para documentos sensibles | Datos reales sensibles (piloto) | Solo datos ficticios |
| Recorrido, contactos y catálogo reales | Configuración del piloto | Fixtures de `examples/` |
| Retención, volumen, hosting, región y backups | P7 | 30 días propuestos; escenario de carga del kit |

## 9. P1 desglosado

Cada tarea requiere autorización. Ninguna conecta servicios externos.

| Tarea | Alcance | Salida verificable |
|---|---|---|
| **P1-T1** | Monorepo mínimo y `packages/flow-schema` | Ver detalle abajo |
| P1-T2 | `packages/contracts`: envelope de eventos, códigos de error y DTO iniciales | Tests de esquema y ejemplos de error |
| P1-T3 | `packages/db`: PostgreSQL local en contenedor, ejecutor de migraciones, migraciones iniciales con las invariantes de la sección 5 (incluidas candidatos, confirmación y entrega única), generación de tipos y control de divergencia | Tests de restricciones contra PostgreSQL real aislado |
| P1-T4 | `apps/api` mínima: configuración validada, health, sesiones administrativas locales | Tests de configuración que rechazan modos simulados en producción |
| P1-T5 | Adaptadores locales: carpeta privada, captura de correo, scanner simulado etiquetado | Tests que impiden usarlos con `APP_ENV=production` |
| P1-T6 | CI mínima completa y seed ficticio idempotente con guard de entorno | Checkout limpio → instalar → migrar → checks |

**P1-T1 (propuesta):**

- Antes de escribir código: verificar y registrar versiones vigentes de Node LTS, TypeScript, gestor de paquetes, biblioteca de esquemas y runner de pruebas.
- Workspace con lockfile, TypeScript estricto, lint con regla de límites de dependencias, formato, scripts reales y CI mínima (typecheck, lint, test).
- `packages/flow-schema`:
  - esquemas del flujo v1 (ADR-003), del conjunto de reglas v1 (ADR-012) y del catálogo/directorio necesario para validar;
  - validación estructural y semántica: inicio único, referencias, alcanzabilidad, sin ciclos, salidas completas con `onEmpty`, variables definidas, tipos, fuentes dinámicas, límites, `maxCount` = 1, `review` obligatorio en `file` con variables reservadas válidas, y ningún nodo de captura entre `file` y su `email` (ADR-014);
  - validación de cobertura de reglas: huecos, solapamientos, empresa y clasificación de grupos, límites de complejidad;
  - los tres archivos de `examples/` como fixtures que deben validar;
  - pruebas negativas, al menos una por código de error.
- Fuera de alcance: base de datos, API, motor (incluida la máquina de estados del paso documental, que es P2), panel, adaptadores y cualquier servicio externo.
- Salida: instalación desde checkout limpio y checks en verde en CI, con comandos y resultados reales registrados en `PROJECT_STATUS.md`.

## 10. Riesgos y pruebas negativas obligatorias

Catálogo completo en `docs/09_PRUEBAS_Y_ACEPTACION.md`. Pruebas agregadas en P0 (ninguna ejecutada todavía):

- T29: un trámite con varias identidades.
- T30: conflicto de identidad.
- T31: apagado con llamada externa en curso.
- T32: clasificación aplicada y relajación protegida.
- T33: cobertura y límites de reglas.
- T34: opciones dinámicas.
- T35 a T45: paso documental (ADR-014). Archivo A seguido de B, texto inesperado, confirmación vieja o repetida, reemplazo durante el análisis, resultado tardío, carreras con el despacho, reinicio con eventos pendientes, archivo posterior al despacho, corrección, retenidos de trámites terminados, y límites y purga. Riesgos nuevos en `docs/12_DECISIONES_Y_RIESGOS.md`.

## 11. Próximo paso

El propietario revisa el PR de P0. Con la fusión y la autorización explícita, se inicia P1-T1.
