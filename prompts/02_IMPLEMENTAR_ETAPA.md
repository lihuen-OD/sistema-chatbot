# Prompt de implementación por etapa

Usar después de revisar y aprobar el plan. Reemplazar [ETAPA] y [ALCANCE] antes de pegar.

Implementá [ETAPA], con alcance aprobado: [ALCANCE]. Leé AGENTS.md, PROJECT_STATUS.md y documentos aplicables. Inspeccioná cambios existentes sin borrarlos.

Antes de editar, resumí qué vas a entregar y los checks que comprobarán su comportamiento. Después avanzá autónomamente dentro de esta etapa; no vuelvas a pedir permiso para acciones locales rutinarias ya autorizadas.

Respetá motor compartido, versiones inmutables, permisos de servidor, persistencia durable, idempotencia y aislamiento de simulación. No sustituyas garantías con memoria/mock y después las presentes como implementadas. Si un proveedor sigue simulado, indicá exactamente qué falta.

No agregues etapas futuras ni servicios externos. No envíes correos/WhatsApp reales ni despliegues salvo autorización explícita adicional. No uses agentes paralelos sin autorización.

Ejecutá pruebas pertinentes y registrá comando/resultado. Actualizá PROJECT_STATUS.md, matriz de trazabilidad y ADR si cambia un contrato. Cerrá con comportamiento logrado, evidencia, riesgos/bloqueos y próxima etapa. Si una prueba obligatoria falla o no puede correrse, no declares etapa completa.
