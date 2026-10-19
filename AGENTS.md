# Instrucciones para trabajar en este proyecto

## Contexto y autoridad

El objetivo es un chatbot documental de WhatsApp administrable visualmente. Leer README, requisitos, arquitectura, plan y PROJECT_STATUS antes de empezar. Las instrucciones explícitas del propietario prevalecen sobre este archivo. Si los documentos se contradicen, registrar la diferencia y proponer resolución; no alterar el alcance silenciosamente.

La conversación inicial aprobó la dirección del producto. Este kit **no autoriza todavía contratar servicios, enviar correos reales, modificar cuentas empresariales ni publicar producción**. Trabajar dentro de la etapa que el propietario autorice. El prompt de plan solicita una pausa porque el propietario quiere revisar ese plan; no repetir permisos para acciones locales rutinarias ya incluidas en una etapa aprobada.

## Desarrollo

- Monorepo modular; dominio y motor independientes de HTTP, UI y proveedores.
- TypeScript estricto. Validación en servidor; tipado del frontend no reemplaza controles.
- Lógica de negocio en dominio/motor; controllers delgados.
- Especificación del flujo con schemaVersion y validación estructural/semántica.
- Usar transacciones y restricciones de BD para invariantes, no solamente ifs.
- No eval, scripts configurables, SQL arbitrario ni URLs arbitrarias ejecutadas desde flujos.
- No automatizar WhatsApp Web para sustituir la API oficial.
- No construir un SaaS multitenant ni agregar IA sin un requisito explícito.
- No hardcodear secretos, contactos de producción ni proveedores en el motor.
- Mantener lockfile; comprobar versiones mantenidas y compatibilidad. No inventar resultados de comandos.
- No introducir servicios nuevos sin documentar motivo, costo y alternativa.

## Datos y efectos externos

- Datos de demo ficticios y correos example.com; sin datos personales reales.
- Simulación aislada: efectos enviados a un action sink local, nunca a adaptadores reales.
- En integración/staging, destinatarios limitados por allowlist.
- Firma de webhooks sobre cuerpo original. Persistir antes de devolver 200.
- Credenciales solo del servidor. Verificar permisos en cada recurso.
- Archivos en cuarentena, análisis y acceso privado.
- No marcar ENTREGADO por recibir HTTP 200 del proveedor.
- Registrar estado incierto si un efecto externo no se puede reconciliar.

## Git, agentes y alcance

No iniciar agentes paralelos salvo autorización explícita del propietario. Si se autorizan, cada tarea usa rama/worktree aislado, dueño, archivos y contrato; no trabajar dos agentes sobre la misma rama/archivo sin coordinación. No descartar cambios del propietario ni hacer reset/clean destructivos.

Inspeccionar estado del repositorio y trabajar en rama de etapa si está autorizada. Cambios pequeños y coherentes; evitar refactors fuera de alcance. No fusionar ni desplegar por cuenta propia salvo autorización.

## Verificación y entrega

Ejecutar checks definidos por la etapa. Escribir pruebas que comprueben comportamiento y fallos, no copias de implementación. Guardar comandos, resultados y limitaciones; si un check no corre, indicarlo.

Al terminar actualizar PROJECT_STATUS: etapa, evidencia, archivos, decisiones, problemas, siguiente paso. Informe final: comportamiento implementado, pruebas ejecutadas, pendientes y diferencias frente al plan. No usar “listo para producción” sin cumplir el gate de P7.

## Continuidad

Decisiones con impacto en contratos o operación se registran como ADR. No tratar un placeholder como implementación. Las pantallas pueden preceder a integraciones, pero los estados deben identificarlo de forma explícita. Un test de simulador no prueba Meta, antimalware ni entrega real de correo.
