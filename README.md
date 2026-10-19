# Sistema de chatbot documental — Kit de desarrollo

Versión 1.0 · 14/10/2026

Base de trabajo para Claude Code y revisión humana. Incluye especificación, arquitectura, contratos propuestos, recorrido de ejemplo, plan y pruebas. **Este paquete no contiene una aplicación implementada ni un despliegue.** Los ejemplos son fixtures de diseño, no pruebas de funcionamiento.

## Inicio rápido

1. Descomprimir la carpeta completa y abrir `sistema-chatbot-kit` en Claude Code.
2. Leer `AGENTS.md`, requisitos y arquitectura.
3. Pegar `prompts/01_PLAN_INICIAL.md` en modo Plan. Ese prompt pide un plan revisable, no implementación inmediata.
4. Resolver los bloqueos de P0 y revisar el plan.
5. Autorizar una etapa específica y usar `prompts/02_IMPLEMENTAR_ETAPA.md`.
6. Al terminar cada etapa, revisar evidencia y actualizar `PROJECT_STATUS.md`.

No contratar servicios para iniciar. El simulador y adaptadores locales permiten trabajar antes de tener cuenta de Meta o número definitivo. La integración real necesita cuentas y acceso del propietario.

## Qué se construirá

Panel autenticado → editor visual → publicación de versión → motor compartido → simulador/WhatsApp → archivo en cuarentena → validación y análisis → reglas autorizadas → correo → seguimiento.

La empresa debe poder modificar textos, preguntas, opciones, rutas, contactos y plantillas sin tocar código. Agregar nuevas capacidades requiere desarrollar nuevos bloques/adaptadores seguros.

## Orden de lectura

| Archivo | Contenido |
|---|---|
| `AGENTS.md` | Reglas de trabajo y límites del agente |
| `docs/01_REQUISITOS.md` | Alcance, roles y requisitos verificables |
| `docs/02_ARQUITECTURA.md` | Arquitectura completa original |
| `docs/03_PLAN_DESARROLLO.md` | Etapas y criterios de salida |
| `docs/04_MODELO_DATOS.md` | Entidades, relaciones, estados e índices |
| `docs/05_CONTRATOS_API.md` | Recursos, errores y semántica HTTP |
| `docs/06_EDITOR_Y_MOTOR.md` | DSL, validación, versión y ejecución |
| `docs/07_SEGURIDAD.md` | Amenazas, permisos y controles |
| `docs/08_CONFIABILIDAD.md` | Inbox/outbox, orden, reintentos y resultados inciertos |
| `docs/09_PRUEBAS_Y_ACEPTACION.md` | Casos, evidencia y condiciones de entrega |
| `docs/10_ENTORNOS_Y_OPERACION.md` | Desarrollo, CI, despliegue y recuperación |
| `docs/11_UX_ADMINISTRADOR.md` | Pantallas y comportamiento del editor |
| `docs/12_DECISIONES_Y_RIESGOS.md` | Decisiones propuestas, pendientes y ADR |
| `docs/13_TRAZABILIDAD.md` | Requisitos → etapas → pruebas |
| `docs/14_FUENTES.md` | Referencias oficiales y límites de la propuesta |
| `examples/` | Flujo y reglas ficticias para usar en desarrollo |
| `prompts/` | Plan, ejecución, revisión y continuidad |
| `PROJECT_STATUS.md` | Estado inicial y handoff |

## Principios que no se negocian dentro del alcance

- Simulador y WhatsApp utilizan el mismo motor.
- El webhook persiste antes de confirmar; las tareas lentas son asíncronas.
- Ningún correo real sale del simulador.
- No hay destinatarios elegidos libremente por el empleado.
- Las versiones publicadas son inmutables.
- No se distribuye un archivo sin aprobarlo.
- Reintentar no equivale a garantizar una única entrega externa.
- No llamar a una interfaz mock una integración real.

El stack es una propuesta a verificar en P0: React/TypeScript, Node LTS/Express, PostgreSQL/Prisma, worker durable y archivos privados. No se fijan versiones de dependencias sin consultar compatibilidad y mantenimiento vigentes. Los servicios opcionales de producción se presupuestan por separado.
