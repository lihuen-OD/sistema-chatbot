# Fixtures ficticios

Estos JSON son ejemplos conceptuales del contrato, no payloads de Meta ni archivos ejecutados por una app existente. P0/P1 debe formalizar el schema, validarlos y convertirlos en fixtures automatizados.

El flujo usa un archivo, dos empresas y dos tipos. Todas las direcciones son de example.com. El empleado de demo debe tener ambas empresas en sus permisos para recorrer todas las ramas; usar otro empleado con un solo ámbito para las pruebas negativas.

La acción email espera EMAIL_ACCEPTED antes de continuar. Los rechazos, entradas inválidas y errores son estados/eventos del host; no hay arista de éxito cuando el archivo está en cuarentena. routing_demo_v1 es una referencia ficticia a versión de reglas.
