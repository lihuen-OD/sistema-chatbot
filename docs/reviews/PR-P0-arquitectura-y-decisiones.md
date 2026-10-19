# PR de P0 — título y descripción

Rama: `p0/arquitectura-y-decisiones` → `main`. Abrir como **borrador**. No fusionar sin revisión del propietario.

Para abrirlo: en GitHub, comparar `main...p0/arquitectura-y-decisiones`, pegar el título y la descripción siguientes y elegir "Create draft pull request".

---

## Título

P0: arquitectura, ADR y plan consolidado

## Descripción

### Alcance

Cierre documental de P0. Solo documentación y ejemplos: no hay código de aplicación, no se instalaron dependencias y no se conectó ningún servicio.

- **ADR-001 a ADR-014** en `docs/adr/`:
  - dirección técnica aceptada el 19/10/2026;
  - las ocho correcciones del propietario;
  - el requisito adicional de revisión y confirmación del documento (ADR-014).
- **Plan consolidado** en `docs/15_PLAN_CONSOLIDADO_P0.md`, con fecha 19/10/2026. El plan presentado el 14/10 no se conservó y no se reconstruye; solo se citan sus notas como antecedente.
- **Documentos actualizados:** requisitos, arquitectura, plan, modelo de datos, contratos, editor/motor, seguridad, confiabilidad, pruebas, entornos, UX, decisiones, trazabilidad, fuentes, README y PROJECT_STATUS.
- **Ejemplos:**
  - flujo con selección dinámica de empresa, referencia estable a reglas y revisión obligatoria del documento;
  - reglas con dominio declarado y sin clasificación;
  - nuevo `examples/directorio_demo.json` con catálogo, identidades y grupos.
- `MANIFEST.json` sin cambios: es la referencia histórica del kit original.

### Correcciones incorporadas

| # | Corrección | ADR |
|---|---|---|
| 1 | Teléfono y BSUID → empleado canónico, conservando el ámbito; un trámite activo por empleado y número | ADR-011 |
| 2 | No liberar leases de llamadas externas en curso al apagar; drain, fencing, recuperación e inciertos | ADR-002 |
| 3 | Clasificación aplicada fija en el trámite; cambios que relajan restricciones protegidos | ADR-004, ADR-012 |
| 4 | Opciones dinámicas y cobertura de reglas con límites; destinatarios ausentes, ambiguos o no autorizados bloquean | ADR-003, ADR-012 |
| 5 | El simulador por metadatos no reemplaza las pruebas de archivos reales de P5 | ADR-005 |
| 6 | Kysely como elección con alternativas y costos, sin afirmar incompatibilidad de Prisma | ADR-010 |
| 7 | Recortes de V1 registrados con consecuencias, sin eliminar requisitos | ADR-013 |
| 8 | Corrección de la afirmación sobre secret scanning | PROJECT_STATUS.md |

### Requisito adicional: revisión y confirmación del documento (ADR-014)

- Recibir y validar un archivo no autoriza el correo: el empleado confirma explícitamente el archivo exacto.
- La confirmación referencia trámite, revisión de contexto y documento. Una vieja o repetida no tiene efecto.
- Antes de confirmar se puede reemplazar o cancelar. Otro archivo sin Reemplazar pide elegir: nunca hay sustitución silenciosa.
- Hasta 3 candidatos por trámite y un único adjunto seleccionado por envío, con purga de los no seleccionados. Corrige la restricción física "un documento por trámite".
- Cada reemplazo invalida la confirmación. Los resultados tardíos de análisis no seleccionan nada ni habilitan envíos.
- Confirmar, reemplazar, cancelar e iniciar el despacho se serializan sobre el trámite. Después del punto de no retorno (`DISPATCHING`) no se promete cancelación ni reemplazo.
- Después de un correo aceptado, una corrección es un trámite nuevo vinculado y señalado como corrección. El historial original no se modifica.
- La confirmación del empleado no es una aprobación administrativa.
- El paso documental usa estados internos controlados, sin ciclos del editor y con límites.
- Los mensajes retenidos se revalidan al reabrirse la ventana: no se reproducen preguntas obsoletas.
- ADR-003, ADR-007 y ADR-013 llevan la nota "precisada por ADR-014".
- Pruebas nuevas T35–T45; T06, T13 y T22 conservan su ID.

### Precisiones de ADR-014 (revisión del commit 5323bf6)

Registradas en el historial de ADR-014, sin cambiar su dirección:

- **Archivo durante la elección:** un tercer candidato admisible en `WAITING_FILE_CHOICE` actualiza la lista, incrementa `contextRevision` e invalida los botones anteriores. Nunca se elige automáticamente. Los candidatos rechazados, inconclusos, con descarga fallida o purgados no se ofrecen ni se aceptan (`CANDIDATE_NOT_SELECTABLE`).
- **Cupo:** es por trámite completo, no por nodo ni por ejecución. Se reserva con un incremento condicional de `candidateCount` y `candidateSeq` es único por trámite (1 a 3, con `CHECK`). Reprocesar un evento no reserva otro lugar, y rechazar o purgar no devuelve cupo. Con dos archivos simultáneos cerca del máximo, se crea exactamente un candidato.
- **Entregas:** la identidad de cada entrega (`actionKey` y clave de idempotencia) deriva de su confirmación. Después de cancelar D1 y confirmar otro archivo, D2 es una entrega nueva; repetir la misma confirmación no crea D3. La outbox y el job de D1 quedan `CANCELLED` y D1 nunca se despacha.
- **Límite de cambios según estado:** se cuenta solo sobre acciones del empleado; los eventos internos nunca se bloquean. Confirmar nunca se ofrece ni se acepta sin un candidato seleccionado, aprobado y disponible. Sin seleccionable ni cupo, la salida segura es Cancelar o `REINICIAR`, o el vencimiento por inactividad.
- **Vinculación y generación:**
  - los eventos se vinculan en la transacción de transición, en orden de llegada por clave, y registran trámite, `generation` y revisión una sola vez;
  - las respuestas se vinculan al trámite de su prompt;
  - los trabajos derivados conservan su referencia y nunca se reasignan al reiniciar;
  - un archivo se asocia solo si su timestamp del proveedor es posterior al ancla de pedido de archivo; si no, `FILE_NOT_CORRELATED`, sin descarga, y se pide reenviarlo (asociación explícita).
- Pruebas nuevas T46–T52.

### Contradicciones resueltas

Ver §7 del plan consolidado:

- 1 frente a 3 archivos;
- Prisma frente a Kysely;
- unicidad por conversación frente a unicidad por empleado;
- plantillas fuera de ventana;
- liberación de leases al apagar;
- estados en español frente a inglés;
- clasificación en reglas frente a catálogo;
- criterio de salida de P0;
- restricción física de un documento por trámite;
- aprobación del análisis frente a confirmación;
- `VOLVER` desde el paso documental;
- reproducción de mensajes retenidos.

### Validaciones realizadas (documentales)

- Los JSON de `examples/` son válidos.
- Un script ad hoc de coherencia (no versionado) no encontró errores en los fixtures:
  - nodos y destinos existentes, alcanzabilidad, sin ciclos, un adjunto;
  - `review` obligatorio con variables permitidas, sin nodos de captura entre `file` y `email`;
  - cobertura 2×2 con exactamente una regla por combinación;
  - grupos de la empresa correcta y autorizados para la clasificación, con miembros activos autorizados;
  - correos `@example.com` e identidades activas únicas.
- Dos variantes alteradas (sin `review`; con un nodo de captura intermedio) fueron detectadas por ese script.
- El catálogo de pruebas contiene T01–T52, cada ID una sola vez.
- No quedan referencias a la secuencia de candidatos por nodo ni al código anterior de límite de revisiones.
- Todos los enlaces a archivos ADR existen.
- `MANIFEST.json` no tiene diferencias con `main`.

**No se ejecutaron pruebas de aplicación: todavía no hay código.** Las afirmaciones sobre BSUID, límites de mensajes interactivos, MinIO y tooling vienen de la revisión del 14/10 y se verifican en P1/P6 (`docs/14_FUENTES.md`).

### Pendientes

- **Bloquea P1:** la aprobación y fusión de este PR, más la autorización explícita para iniciar P1-T1.
- **Primer paso de P1-T1, sin decisión del propietario:** verificar versiones exactas de runtime y tooling.
- **Decisiones que no bloquean P1:**
  - segunda aprobación para relajar clasificación (antes de P4);
  - aviso a destinatarios originales en correcciones con destinatarios distintos (antes de P4);
  - valores iniciales del paso documental (P2);
  - mostrar el área destinataria en la revisión (P3);
  - verificar la semántica del timestamp del proveedor usado para correlacionar archivos (P6);
  - proveedor de correo (P5);
  - scanner y almacenamiento de producción (P5/P7);
  - BSUID real (P6);
  - verificación adicional de identidad para sensibles y recorrido/catálogo reales (piloto);
  - retención y hosting (P7).

### P1-T1 propuesto

Monorepo mínimo (workspace con lockfile, TypeScript estricto, lint con límites de dependencias, CI mínima) y `packages/flow-schema`:

- esquemas de flujo v1 (incluido `review` obligatorio), reglas v1 y catálogo/directorio;
- validación estructural y semántica, y cobertura de reglas con límites;
- los tres archivos de `examples/` como fixtures;
- pruebas negativas por cada código de error.

Sin base de datos, API, motor ni panel.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
