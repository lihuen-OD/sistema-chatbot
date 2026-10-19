# ADR-008 — Una organización propietaria, sin SaaS

- Fecha: 19/10/2026
- Estado: Aceptada
- Responsable: propietario del proyecto
- Revisión: solo ante un requisito explícito de ofrecer el sistema a otras organizaciones.

## Contexto

El sistema sirve a una organización propietaria con varias empresas internas. AGENTS.md prohíbe construir un SaaS multitenant sin requisito explícito.

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Multitenant desde el inicio | Rechazada: aislamiento, facturación y operación sin necesidad |
| Una organización con empresas internas | Elegida |

## Decisión

- `Organization` identifica a la propietaria; `Company` representa las empresas internas.
- Los permisos administrativos y de empleados se acotan por empresa.
- No hay autoservicio de cuentas ni aislamiento entre organizaciones.

## Costos

Si en el futuro se ofrece a terceros, hará falta un rediseño de aislamiento: no alcanza con agregar un campo.

## Consecuencias

Las restricciones por empresa se verifican en backend en cada operación.

## Invariantes

Contactos, grupos, empleados y trámites pertenecen a empresas de la organización propietaria y no se cruzan sin permiso explícito.

## Pruebas

T17 y T20; pruebas cruzadas entre empresas (RNF01).

## Documentos afectados

`docs/01_REQUISITOS.md`, `docs/02_ARQUITECTURA.md` §10.
