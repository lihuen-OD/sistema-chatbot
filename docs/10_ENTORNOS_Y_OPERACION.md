# Entornos, CI y operación

## Desarrollo local

API/worker/panel, PostgreSQL aislado, almacenamiento en carpeta privada local fuera del control de versiones (`/storage/`, ADR-007) y correo capturado. No depende de Meta para ejecutar motor/editor. Docker Compose puede preparar PostgreSQL (y, si hace falta, el capturador de correo); se implementará en P1 con versiones verificadas. El .env.example de este kit es un catálogo, no configuración ejecutable lista.

Simulación utiliza namespace separado y sink que registra acciones. Connector fake devuelve estados explícitamente simulados. Nunca cargar credenciales reales en el frontend o en el sink. Tests crean sus bases/contenedores y limpian solo recursos de test.

## Integración y staging

Meta test + webhook HTTPS; usar túnel temporal para local si procede. La computadora debe seguir encendida. Tokens/recursos de prueba sujetos a límites de Meta. Staging usa BD, bucket y secretos separados; allowlist de teléfonos y correos. Datos ficticios, no copiar producción automáticamente.

## Producción

Frontend servido por hosting estático; API y worker permanentes; scanner en servicio/proceso aislado dimensionado; PostgreSQL con backups; storage privado; correo y Meta. TLS, controles de red, alertas, permisos y retención. Cuenta/número/hosting bajo control de la empresa.

Sin API/worker dormidos como base de disponibilidad prometida. No asumir que USD 7 cubre todos los procesos y requisitos: costear API, worker, scanner, storage, BD, backup, correo y monitoreo. El diseño modular permite un despliegue inicial compartido si se analiza aislamiento y se demuestra capacidad, pero la separación lógica permanece.

## CI y despliegue

Estado al 19/10/2026 (P1-T1):

- `.github/workflows/ci.yml` corre en cada push. Usa Node de `.node-version`, pnpm fijado vía corepack y `pnpm install --frozen-lockfile`.
- Ejecuta `pnpm run check`: tipos, lint, formato, límites entre paquetes, pruebas y build.
- Acciones fijadas por SHA de commit y permisos de solo lectura.
- La migración de base vacía y el control de divergencia de tipos llegan con la tarea de base de datos de P1.

Checks: tipos, lint (incluidos límites de dependencias entre paquetes), tests dominio/BD, migración de base vacía y control de divergencia de tipos (ADR-010), build frontend/API, validación de fixtures, escaneo de secretos/dependencias. GitHub ofrece secret scanning gratuito para repositorios públicos; su estado en el repositorio y el acceso a sus alertas se verifican en la configuración de seguridad de GitHub. No scripts inventados: configurar y documentar comandos reales en P1. Dependencias con lockfile y revisión de actualizaciones.

Migraciones revisadas en staging, backup y expand/contract. API/worker temporalmente de versiones distintas deben tolerar el schema vigente. Deploy con health/readiness, manejo de SIGTERM y drain según ADR-002: liberar solo trabajos sin efecto externo iniciado; los que tienen una llamada externa en curso conservan su lease hasta registrar el resultado o hasta el plazo de gracia, y después la recuperación concilia. El plazo de gracia de la plataforma debe superar el timeout de llamada más el margen de registro. Rollback de código requiere schema compatible; no ejecutar down migrations destructivas automáticamente.

## Observabilidad

Correlación: requestId, eventId, conversationId, submissionId, actionKey, deliveryId y providerId. Logs no guardan contenido de documentos, tokens, correos completos innecesarios ni URLs firmadas. Métricas de ACK, cola, leases, scanner, entregas, errores y costo aproximado por trámite. Dashboard no reemplaza alertas.

Propuesta de alertas: edad de trabajo >60s sin archivos o >5min para tareas documentales (ajustar); errores sostenidos >5%; scanner inactivo; backlog creciente; token inválido; espacio/DB al límite; backup atrasado. Los valores se calibran en P6/P7.

## Backup y recuperación

Definir RPO <=1h y RTO <=4h como objetivos iniciales, validar proveedor y responsabilidad. Backups cifrados/PITR si disponible, versionado/retención de objetos según política, export de configuración. Ejercicio restore aislado incluyendo referencias de documentos y jobs. Antes de reactivar worker tras restore, conciliar efectos externos realizados después del punto restaurado: un backup antiguo puede reintroducir trabajos ya enviados.

## Runbooks mínimos

1. Meta caído/credencial vencida: pausar salientes, conservar eventos/trabajos, alertar, renovar y verificar antes de reactivar.
2. Correo caído: cola y estado pendiente, no éxito; backoff; operador concilia inciertos.
3. Scanner caído: cuarentena, nada se distribuye; reactivar con análisis pendientes.
4. Incidente de privacidad: bloquear descargas/envíos afectados, preservar evidencia, rotar credenciales y comunicar según procedimiento empresarial.
5. Despliegue defectuoso: detener consumo si riesgo, revertir código compatible y reconciliar estado.
6. Purga: ejecución por lote, dry-run, límites y evidencia de eliminación sin contenido.

Responsable y guardia operativa deben asignarse antes del piloto. Reintentar manualmente es una acción con consecuencias y auditoría, no un botón genérico de “arreglar”.
