# Estado del proyecto

Actualizado: 19/10/2026

## Situación actual

- Kit de especificación v1.0 versionado en Git y publicado en GitHub.
- Código de aplicación: no iniciado.
- Integraciones reales: no configuradas.
- Pruebas de aplicación: no ejecutadas; todavía no existe implementación.
- P0: el 14/10/2026 se presentó un plan inicial en una conversación con Claude Code. No quedó registrado en el repositorio, no hay ADR y el propietario todavía no lo aprobó. Sus recomendaciones no son decisiones hasta registrarse como ADR.

## Repositorio

- Carpeta local de trabajo: `Desktop/Proyectos OD/sistema-chatbot-kit`.
- Remoto: `origin` → https://github.com/lihuen-OD/sistema-chatbot (público).
- Ramas: `main` (documentación del kit y estado integrado). No existen ramas de implementación.
- Las etapas de implementación se desarrollan en ramas propias y llegan a `main` mediante PR revisado por el propietario (AGENTS.md).
- `MANIFEST.json` describe el kit tal como se entregó; el commit `8a28a3a` coincide con sus sha256. Los archivos que cambien después (por ejemplo, este) dejan de coincidir, y es esperado.

## Etapas

| Etapa | Estado |
|---|---|
| P0 Definición y ADR | Pendiente: plan presentado en conversación, sin aprobar ni registrar |
| P1 Base local y contratos | Pendiente |
| P2 Motor y persistencia durable | Pendiente |
| P3 Editor y simulador | Pendiente |
| P4 Administración, permisos y publicación | Pendiente |
| P5 Documentos y correo | Pendiente |
| P6 WhatsApp de prueba | Pendiente |
| P7 Endurecimiento y lanzamiento | Pendiente |

## Pendientes del propietario

- Revisar y aprobar (o corregir) el plan de P0.
- Confirmar flujo inicial, formatos, volumen, correos, identidad de empleados, conservación y hosting. Para el prototipo puede utilizarse el ejemplo ficticio del kit.

## Registro por sesión — completar, no borrar historial

### 19/10/2026 — Conexión con GitHub

Fecha / rama / commit / etapa autorizada: 19/10/2026 / `main` / base `8a28a3a` / ninguna etapa de implementación; tarea autorizada: conectar y publicar el estado actual en GitHub.

Objetivo: versionar la carpeta local y publicarla en el repositorio remoto sin perder trabajo ni exponer datos sensibles.

Cambios:
- Inicializado Git en esta carpeta (no tenía repositorio) y configurado `origin`. El remoto estaba vacío: sin ramas ni commits.
- `.gitignore` nuevo: entorno y credenciales (salvo `.env.example`), dependencias, builds, cachés, logs, documentos recibidos, almacenamiento local, bases, backups, datos personales reales y temporales.
- Commit del kit sin modificaciones (25 archivos verificados contra `MANIFEST.json`).
- Este archivo actualizado.

Pruebas (comando, resultado, limitación):
- Hash sha256 de los 25 archivos contra `MANIFEST.json`: todos coinciden.
- `git ls-remote` y API de GitHub: repositorio público, vacío, con permiso de escritura.
- Búsqueda local de correos, teléfonos, tokens, claves y URLs con credenciales: solo correos `@example.com` y la URL de base local de ejemplo de `.env.example` (usuario y contraseña de desarrollo local, no son credenciales reales).
- `git check-ignore` con rutas de muestra: excluye `.env*`, `node_modules`, `dist`, `storage/`, `uploads/`, dumps, `*.sqlite`, logs y `private/`; conserva `.env.example`, migraciones `*.sql`, fixtures y código fuente.
- Limitación: el escáner de secretos de GitHub no está disponible en este repositorio (requiere GitHub Advanced Security); la revisión de secretos fue local.

ADR creados o modificados: ninguno.

Pendientes / bloqueos: aprobación del plan de P0 por el propietario.

Próxima tarea concreta: el propietario revisa el plan de P0 (`prompts/01_PLAN_INICIAL.md`). Una vez aprobado, registrar las decisiones como ADR en una rama de P0 y abrir PR hacia `main`. P1 no empieza hasta entonces.
