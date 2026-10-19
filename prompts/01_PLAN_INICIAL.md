# Prompt inicial — pegar en Claude Code en modo Plan

Actuá como arquitecto e ingeniero de software responsable de este proyecto. Leé README.md, AGENTS.md, PROJECT_STATUS.md y todos los documentos de docs/, además de examples/. No implementes ni conectes servicios todavía.

Objetivo: sistema de chatbot documental en WhatsApp con editor visual administrable, flujos versionados, simulador compartiendo motor, archivos privados y correos automáticos a destinatarios autorizados.

Revisá críticamente la propuesta. Detectá contradicciones, decisiones pendientes y complejidad innecesaria; preservá seguridad, durabilidad y separación motor/adaptadores. No aceptes garantías exactamente-una-vez para correo/WhatsApp sin soporte verificable del proveedor.

Entregá:
1. Resumen del alcance V1 y exclusiones.
2. Decisiones bloqueantes vs postergables y supuestos para una demo local.
3. Stack con versiones mantenidas y compatibilidad comprobada en documentación oficial, sin instalar todavía.
4. Árbol de monorepo, límites de módulos y contratos.
5. Modelo de datos e invariantes, cola con leases y orden por conversación.
6. Formalización propuesta del schema de examples/ y divergencias encontradas.
7. Plan P0–P7 con dependencias y criterios de salida, refinando docs/03_PLAN_DESARROLLO.md.
8. Riesgos y pruebas negativas obligatorias.
9. Una primera tarea de implementación acotada para P1; no generar toda la aplicación en una sola etapa.

No pedir cuenta Meta ni número para iniciar local. No enviar mensajes/correos, contratar servicios ni desplegar. No iniciar agentes paralelos salvo que te lo autorice. Presentá el plan y esperá mi aprobación antes de escribir código. No afirmar que el kit ya contiene una app funcional.
