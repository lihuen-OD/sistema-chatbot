# ADR-012 — Clasificación documental y distribución fail-closed

- Fecha: 19/10/2026
- Estado: Aceptada. La aprobación de una segunda persona para relajar restricciones queda pendiente de decisión del propietario antes de P4.
- Responsable: propietario del proyecto
- Revisión: al cargar el catálogo documental real y si los límites de complejidad resultan insuficientes.

## Contexto

Un certificado médico no puede llegar a los destinatarios de facturas. En el ejemplo original, cada regla declaraba su propia `classification`, duplicando información del tipo documental, y no había controles sobre cambios que amplían quién recibe documentos sensibles (corrección 3). Tampoco estaban formalizados la cobertura de reglas ni los límites de complejidad, y no se distinguían los destinatarios ausentes, ambiguos o no autorizados (corrección 4).

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Clasificación declarada en cada regla | Rechazada: duplicada y manipulable con una regla nueva |
| Clasificación evaluada siempre con el catálogo vigente | Rechazada: un cambio posterior altera trámites en curso |
| Catálogo versionado, clasificación aplicada fija en el trámite y la condición más restrictiva al ejecutar | Elegida |
| Regla por prioridad u orden cuando hay varias coincidencias | Rechazada: oculta errores de configuración |

## Decisión

**1. Catálogo documental.** `DocumentCatalogVersion` contiene los tipos documentales con su clasificación. V1 usa `GENERAL` y `SENSITIVE_HR` (marcada como sensible); agregar clasificaciones requiere actualizar este ADR. Las reglas no declaran clasificación: la toman del catálogo.

**2. Clasificación aplicada.** Al asignar `documentType`, el trámite guarda `appliedClassification` (ADR-004) y no la cambia.

**3. Autorización efectiva.** Al resolver y al ejecutar, cada contacto destinatario y su grupo deben:

- pertenecer a la empresa del trámite;
- estar autorizados para `appliedClassification`;
- estar autorizados también para la clasificación vigente del tipo, si cambió después.

Los endurecimientos se aplican de inmediato a entregas pendientes y las bloquean si dejan de cumplirse. Las relajaciones nunca afectan trámites en curso.

**4. Cambios que relajan restricciones.** Es relajación todo cambio que:

- baje la clasificación de un tipo documental a una no sensible o de menor sensibilidad;
- otorgue una clasificación sensible a un contacto o grupo;
- agregue miembros a un grupo autorizado para una clasificación sensible;
- publique reglas que envíen un tipo sensible a grupos que no lo recibían en la versión activa.

Estos cambios requieren:

- el permiso específico `classification.relax`, distinto de editar, publicar o administrar contactos;
- un motivo obligatorio;
- una vista previa del impacto (tipos, grupos y contactos afectados);
- una confirmación que referencia el hash de esa vista previa;
- un evento de auditoría con los valores anteriores y nuevos.

Rigen solo para resoluciones futuras. Endurecer no requiere ese permiso.

**5. Conjuntos de reglas.**

- Declaran `contextVariables` de dominio finito (`companyRef`, `documentTypeRef`, `enum`).
- Cada regla tiene condiciones `ALL` con `eq` o `in` y apunta a `targetGroupIds`.
- `defaultBehavior` solo admite `REQUIRES_REVIEW`.

**6. Cobertura al publicar.** El validador recorre el producto de los dominios: empresas activas × tipos activos del catálogo vigente al publicar × valores de los `enum`. Para cada combinación exige:

- exactamente una regla que coincida, o que la combinación figure en `reviewOnly` (aceptación explícita de que va a revisión);
- que los grupos de la regla sean de la empresa de la combinación;
- que esos grupos estén autorizados para la clasificación del tipo;
- que tengan al menos un miembro activo autorizado.

Los solapamientos y los huecos no aceptados son errores. El informe de cobertura y su hash se guardan con la versión. Si después cambian el catálogo o el directorio (empresa nueva, grupo vacío), el panel advierte de la cobertura rota y la ejecución sigue el punto 8.

**7. Límites de complejidad (valores iniciales).**

| Límite | Valor inicial |
|---|---|
| Variables de contexto por conjunto | 4 |
| Combinaciones del dominio | 1.000 |
| Reglas por conjunto | 200 |
| Condiciones por regla | 4 |
| Valores en `in` | 50 |
| Grupos por regla | 5 |
| Destinatarios por entrega, después de deduplicar | 20 |

Superar un límite rechaza la publicación; no hay heurísticas.

**8. Resolución en ejecución (fail-closed).** Antes de crear la entrega y otra vez antes de enviarla:

| Situación | Código de bloqueo |
|---|---|
| Ninguna regla coincide | `RULE_NOT_MATCHED` |
| Más de una regla coincide | `RULES_AMBIGUOUS` |
| El conjunto resuelto queda vacío (grupo sin miembros activos) | `RECIPIENTS_MISSING` |
| Un miembro activo de un grupo destino no está autorizado para la clasificación o la empresa | `RECIPIENT_NOT_AUTHORIZED` |
| Un contacto del snapshot fue bloqueado, desactivado o perdió autorización antes del envío | `RECIPIENT_BLOCKED` |
| Se supera el máximo de destinatarios | `RECIPIENTS_LIMIT_EXCEEDED` |
| La empresa ya no está en los ámbitos del empleado | `EMPLOYEE_SCOPE_REVOKED` |

En cualquiera de esos casos la entrega pasa a `BLOCKED` con su código, el trámite a `NEEDS_REVIEW` y se registra una incidencia. No hay envío parcial al resto de los destinatarios ni grupo genérico de respaldo. Al resolver, los contactos desactivados se excluyen como parte normal de su ciclo de vida. Un miembro activo no autorizado no se excluye en silencio: bloquea la entrega, porque indica un error de configuración.

## Costos

Validación de cobertura y vista previa de impacto en P4. Un permiso más que asignar. Los límites pueden requerir revisión para organizaciones grandes.

## Consecuencias

- Las reglas del ejemplo pierden el campo `classification` y el catálogo pasa a `examples/directorio_demo.json`.
- Agregar una empresa sin reglas manda sus trámites a revisión hasta publicar reglas nuevas.

## Invariantes

- Ningún documento sale hacia un destinatario no autorizado para la clasificación aplicada o la vigente.
- Ninguna relajación cambia trámites en curso.
- Ninguna resolución ambigua o incompleta envía correo.

## Pruebas

T11, T12, T17, T32 y T33.

## Documentos afectados

`docs/04_MODELO_DATOS.md`, `docs/05_CONTRATOS_API.md`, `docs/06_EDITOR_Y_MOTOR.md`, `docs/07_SEGURIDAD.md`, `docs/11_UX_ADMINISTRADOR.md`, `examples/reglas_distribucion_demo.json`, `examples/directorio_demo.json`.
