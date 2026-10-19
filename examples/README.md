# Fixtures ficticios

Estos JSON son ejemplos conceptuales del contrato, no payloads de Meta ni archivos ejecutados por una app existente. P1-T1 formaliza el esquema, los valida y los convierte en fixtures automatizados. Actualizados el 19/10/2026 según ADR-003, ADR-004, ADR-011, ADR-012 y ADR-014.

| Archivo | Contenido |
|---|---|
| `flujo_documental_demo.json` | Flujo v1: empresa por selección dinámica, tipo documental por selección estática, un adjunto con revisión y confirmación obligatorias, y correo |
| `reglas_distribucion_demo.json` | Conjunto de reglas `routing_demo`, versión 1, con dominio declarado y cobertura completa de 2 empresas × 2 tipos |
| `directorio_demo.json` | Organización, empresas, clasificaciones, catálogo documental, empleados con identidades de canal, contactos y grupos |

## Recorridos

- `employee_demo_both` tiene ámbito en ambas empresas y dos identidades (teléfono y BSUID): recorre todas las ramas y sirve para probar que no puede tener dos trámites activos en el mismo número (T29).
- `employee_demo_single` tiene una sola empresa: la selección dinámica le muestra una opción, y elegir `company_b` manipulando la respuesta debe rechazarse (T06, T34).
- Un empleado sin ámbitos llega a `no_scope` por la salida `onEmpty`.

## Paso documental (ADR-014)

El nodo `upload` exige revisión: después de validar el archivo, el empleado ve el texto de `review` con [Confirmar] [Reemplazar] [Cancelar]. Solo la confirmación lleva a `email`. Escenarios para recorrer con estos fixtures:

| Escenario | Resultado esperado | Prueba |
|---|---|---|
| Archivo A, después B sin Reemplazar | Se pide elegir entre A y B | T35 |
| "sí" escrito en la revisión | No confirma; se re-presenta la revisión | T36 |
| Botón Confirmar de una revisión anterior | `CONFIRMATION_STALE` | T37 |
| Reemplazar mientras A se analiza; resultado de A llega después | A no habilita envío | T38, T39 |
| Cancelar justo cuando empieza el despacho | Gana la primera transacción; después del despacho, `DISPATCH_ALREADY_STARTED` | T40 |
| `CORREGIR` después del correo aceptado | Trámite `CORRECTION` vinculado al original | T43 |

Las variables `{{fileName}}`, `{{fileType}}` y `{{fileSize}}` son reservadas del paso documental. `{{company}}` y `{{documentType}}` se muestran con su etiqueta del catálogo.

## Notas

- La clasificación sale del catálogo (`invoice` → `GENERAL`, `medical_certificate` → `SENSITIVE_HR`); las reglas no la declaran.
- El flujo referencia `ruleSetId: routing_demo`. La versión de reglas y la del catálogo se fijan al iniciar el trámite.
- La acción `email` espera `EMAIL_ACCEPTED` antes de continuar. Rechazos, entradas inválidas y errores son estados o eventos del host; no hay arista de éxito mientras el archivo está en cuarentena.
- Datos ficticios: correos de `example.com`; teléfonos del rango 555-0100 a 555-0199 de Norteamérica, reservado para ficción; BSUID y ámbito con valores de demostración que no siguen el formato real de Meta (se verifica en P6).
