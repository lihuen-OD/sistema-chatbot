# Prompt de revisión independiente

Revisá los cambios de la etapa indicada en PROJECT_STATUS.md contra requisitos, contratos y arquitectura. Empezá en solo lectura y no implementes mejoras fuera del alcance de la revisión.

Priorizá defectos de permisos, privacidad, pérdida de datos, duplicados, orden y efectos externos. Verificá raw-body/HMAC, commit antes de ACK, locks por conversación, fencing de leases, outbox atómica, snapshots, versionado, cuarentena, scanner real, resultados inciertos y aislamiento de simulación.

Comprobá pruebas y logs de ejecución; ejecutá checks autorizados de solo lectura/test en entorno aislado sin efectos externos. No inventes vulnerabilidades ni resultados de tests. Diferenciá hallazgo confirmado, riesgo pendiente y recomendación opcional.

Para cada hallazgo: severidad, archivo/localización, escenario reproducible, impacto, evidencia y corrección mínima sugerida. Indicá si afecta el gate de la etapa. No certifiques seguridad ni disponibilidad por inspección del código.

Al final, criterio de aceptación cumplido/no cumplido con evidencias y pendientes. Si no hay hallazgos, mencioná límites y escenarios no probados.
