# Experiencia del administrador

## Navegación

Flujos, Directorio, Contactos/grupos, Reglas de distribución, Trámites, Incidencias, Auditoría y Configuración. Mostrar solo funciones autorizadas, con permisos igualmente verificados en backend.

## Editor

Canvas central con zoom/selección; paleta de bloques; inspector lateral con configuración del nodo seleccionado; barra con estado, revision, guardar, validar, simular y publicar. Texto “Borrador”, “Publicado Vx” y cambios sin guardar visibles.

Agregar por arrastre o botón accesible. Conectar salidas específicas de opciones; etiquetas sobre conexiones; impedir conexiones obviamente incompatibles, validando además en servidor. Eliminar un nodo muestra impacto en referencias y no publica automáticamente. Plantillas seleccionan variables desde catálogo; no se espera que el usuario sepa JSON.

Cada campo explica su función: destinatarios se eligen de grupos autorizados, adjuntos de la variable documental. Mostrar clasificación/scope en certificados y avisar destinatarios incompatibles. Las reglas se configuran con selectores y predicados, no código.

Una selección puede usar opciones fijas o generadas desde una fuente (por ejemplo, "Empresas autorizadas del empleado"); el inspector exige el máximo de opciones y el paso a seguir si no hay ninguna (ADR-003).

La pantalla de reglas muestra el informe de cobertura como una grilla empresa × tipo documental: regla que aplica, combinaciones sin regla, solapamientos y grupos no autorizados (ADR-012). Si el catálogo o el directorio cambian y rompen la cobertura, se muestra una advertencia visible.

Los cambios que relajan restricciones (bajar la clasificación de un tipo, otorgar una clasificación sensible, agregar miembros a un grupo sensible) muestran una vista previa del impacto, piden motivo y confirmación explícita, y solo están disponibles con el permiso correspondiente. El texto aclara que no afectan trámites en curso.

El directorio muestra las identidades de cada empleado (teléfono, BSUID y su ámbito), cómo se vincularon y los conflictos pendientes (ADR-011).

## Validación y publicación

Panel de errores con clic que enfoca nodo. Distinguir errores bloqueantes, advertencias y conectores no disponibles. Publicar muestra resumen: versión, diferencia, reglaSet, contactos/grupos y efectos. Validar el servidor antes de activar. Guardar y publicar son acciones diferentes.

Cambios concurrentes: informar conflicto y comparar/recargar; nunca sobrescribir silenciosamente. Historial con autor/fecha y posibilidad de activar versión previa. Trámites existentes conservan su versión.

## Simulador

Vista tipo chat con opciones y adjunto; marca visible “Simulación: no envía mensajes ni correos”. El adjunto se simula con nombre, tipo y tamaño, y el resultado del análisis lo elige quien prueba; la interfaz lo indica como “Archivo simulado por metadatos” (ADR-005). Inspector de estado/variables y trace; mostrar destinatarios/ruleId y correo previsto al llegar a email. Se puede reiniciar con snapshot nuevo. No reutilizar como bandeja real ni ocultar si un scanner/proveedor es fake.

## Trámites e incidencias

Tabla paginada con empleado, empresa, tipo, versión, fecha, estado y último error sanitizado. Detalle con timeline, versiones de flujo/reglas/catálogo, clasificación aplicada, archivo según permiso, estados de entrega con motivo de bloqueo y mensajes retenidos por ventana cerrada. Filtros sensibles por empresa. No mostrar “Entregado” si solo aceptó el proveedor.

Retries con motivo, advertencia específica si resultado incierto y bloqueo por estado/permiso. Al editar un correo no modificar snapshots históricos. Permitir bloqueo urgente de contacto sin borrar su historia.

## Accesibilidad y dispositivos

Panel completo orientado a escritorio; móvil para consulta/operación y edición por formularios cuando canvas no sea cómodo. Foco, teclado, etiquetas, contraste y errores sin depender solo de color. Empleado usa WhatsApp; no instala app ni recibe datos técnicos internos.
