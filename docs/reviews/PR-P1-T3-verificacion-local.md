# P1-T3 — verificación local contra el contenedor del proyecto

## Problema resuelto

P1-T3 se fusionó con las pruebas de base aprobadas solo en la CI: la verificación local esperaba la confirmación de Docker Desktop. Con esa confirmación, este PR registra la ejecución local sobre `main` (`d441571`). Solo cambia documentación.

## Ejecución local

Entorno:
- Docker Desktop 29.7.2 y Compose v5.5.0;
- Node 24.21.0 y pnpm 12.12.1, las versiones fijadas;
- `.env` local con contraseñas aleatorias nuevas, fuera de Git;
- PostgreSQL 18.6 del `compose.yaml` en `127.0.0.1:55432`.

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | Código 0; lockfile sin cambios |
| `pnpm run check` | Código 0; 62 pruebas de `db` sin base, 112 de `flow-schema` y 182 de `contracts` |
| `pnpm db:up` | Código 0; roles y bases creados por `10-roles.sh`; contenedor `healthy` |
| `pnpm run check:db` | Código 0; "Tipos de la base al día"; 8 archivos y 79 pruebas contra PostgreSQL |
| `pnpm db:migrate` (dos veces) | Aplicó `0001` a `0005`; la segunda ejecución no tenía pendientes |
| `test:cleanup` (solo listado) | Sin bases temporales sobrantes |

El resultado coincide con la CI previa: #15 y #16 en `p1/t3-db` y #18 en `main`. No hubo fallos ni correcciones de código.

## Cambios

- `PROJECT_STATUS.md`:
  - entrada de la verificación local, separada de la CI previa;
  - P1-T3 cerrada, con los PR #4 y #5;
  - ramas y pendientes actualizados.
- `docs/15_PLAN_CONSOLIDADO_P0.md` §9: estado de P1-T3.
- `docs/plans/P1-T3-base-de-datos.md`: Docker Desktop confirmado y verificación local en §11.

## Límites

- Solo se usó el contenedor del proyecto. No se usó Postgres.app, el puerto 5432 ni ninguna base externa, y no se borraron volúmenes.
- Se verificó la base, no el host (P2).
- No inicia P1-T4.
