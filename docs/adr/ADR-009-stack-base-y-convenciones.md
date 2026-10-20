# ADR-009 — Stack base y convenciones de idioma

- Fecha: 19/10/2026
- Estado: Aceptada. Versiones exactas verificadas y registradas en P1-T1 (addendum al final).
- Responsable: propietario del proyecto
- Revisión: en cada actualización mayor de runtime o tooling, y al iniciar P1.

## Contexto

El propietario aceptó TypeScript, React y PostgreSQL. El kit proponía Node LTS con Express, Zod para esquemas y una biblioteca de nodos para el editor. Las versiones cambian con frecuencia y no deben fijarse sin comprobar compatibilidad y mantenimiento.

## Alternativas

Otros lenguajes de backend (Go, Python, Java) se descartan: perderían la posibilidad de compartir el motor y los esquemas entre panel, API y worker.

## Decisión

| Componente | Decisión | Se confirma en |
|---|---|---|
| Lenguaje | TypeScript estricto en todos los paquetes | P1-T1 |
| Runtime | Node.js en versión LTS vigente | P1-T1 |
| Gestor de paquetes | Workspaces con lockfile versionado; candidato pnpm con antigüedad mínima de publicación para dependencias nuevas | P1-T1 |
| Esquemas | Biblioteca de validación compartida (candidato Zod) | P1-T1 |
| Pruebas | Runner de pruebas a elegir con versión verificada | P1-T1 |
| Panel | React + Vite | P3 |
| Editor gráfico | Biblioteca de nodos y conexiones (candidato React Flow), con licencia y versión verificadas | P3 |
| HTTP | Express, según el kit | Tarea de API de P1 |
| Base de datos | PostgreSQL, con Kysely + pg (ADR-010) | Tarea de base de P1 |

**Convención de idioma.**

- En inglés: identificadores de código, tablas, columnas, claves JSON del DSL, códigos de estado, códigos de error y tipos de evento.
- En español: textos de la interfaz, mensajes al empleado, documentación y mensajes de commit.
- La interfaz traduce códigos a etiquetas en español. La documentación muestra código y etiqueta (por ejemplo, `NEEDS_REVIEW` / Requiere revisión).

**Versiones.** No se fijan en este ADR. Al iniciar P1-T1 se consultan fuentes oficiales y se registran versión, fecha y fuente en `PROJECT_STATUS.md`. Antecedentes del 14/10/2026 que no se verificaron de nuevo: Node 24 LTS; TypeScript 6.0.x en lugar de 7.x, por compatibilidad declarada de typescript-eslint; pnpm con `minimumReleaseAge`. Comprobación local del 19/10/2026: Node v24.18.0, corepack 0.35.0 y Docker 29.7.2 instalados; pnpm no instalado.

## Costos

Actualizar runtime y tooling es un trabajo recurrente. La compatibilidad entre TypeScript y el tooling de lint puede retrasar actualizaciones mayores.

## Consecuencias

Los documentos que listaban estados en español (`ESPERANDO_ARCHIVO`, `RESULTADO_INCIERTO`, etc.) pasan a códigos en inglés con etiqueta en español. Ver `docs/04_MODELO_DATOS.md`.

## Invariantes

Un código de estado o de error no cambia por una modificación de su texto visible.

## Pruebas

CI de P1: typecheck, lint y tests desde un checkout limpio con el lockfile.

## Documentos afectados

`README.md`, `docs/02_ARQUITECTURA.md` §3, `docs/04_MODELO_DATOS.md`, `docs/06_EDITOR_Y_MOTOR.md`.

## Addendum P1-T1 — versiones verificadas (19/10/2026)

Registro previsto por este ADR. No cambia la decisión.

**Política de antigüedad.** Solo se instalan versiones publicadas hace al menos 7 días (`minimumReleaseAge: 10080` minutos en `pnpm-workspace.yaml`). La política alcanza a las dependencias transitivas (documentación de pnpm, `settings/dependency-resolution`). La misma regla se aplicó a Node.js y a las acciones de la CI. No hubo excepciones.

| Componente | Versión | Publicada | Fuente | Motivo |
|---|---|---|---|---|
| Node.js | 24.21.0 (LTS "Krypton") | 07/09/2026 | `nodejs.org/dist/index.json`; SHA-256 verificado contra `SHASUMS256.txt` | Node 24 es la LTS mantenida (Node 26 todavía no es LTS). 24.22.0 tenía 5 días. La 24.18.0 instalada localmente es anterior a la release de seguridad 24.18.1 |
| pnpm | 12.12.1 (vía corepack, con hash sha512) | 11/10/2026 | registro de npm | 12.13.0 y 12.14.0 tenían menos de 7 días |
| TypeScript | 6.0.3 | 16/04/2026 | registro de npm | typescript-eslint 8.71.x declara `typescript >=4.8.4 <6.1.0`; TypeScript 7.0.2 (`latest`) no es compatible con el lint con tipos |
| typescript-eslint | 8.71.1 | 05/10/2026 | registro de npm | 8.71.2 tenía 6 días |
| ESLint / @eslint/js | 10.12.0 / 10.0.1 | 02/10/2026 / 06/02/2026 | registro de npm | 10.13.0 tenía 2 días |
| Prettier | 3.9.10 | 10/10/2026 | registro de npm | Última 3.x con más de 7 días |
| Zod | 4.6.6 | 11/10/2026 | registro de npm | 4.6.7 tenía 6 días |
| Vitest / Vite | 5.0.3 / 8.3.4 | 30/09/2026 / 08/10/2026 | registro de npm | Vitest 5 declara `vite` como peer obligatorio; 5.0.4 y 5.0.5 tenían menos de 7 días |
| @types/node | 24.19.2 | 09/10/2026 | registro de npm | Tipos de la línea 24 |
| actions/checkout | v7.0.1 (`3d3c42e5…`) | 20/07/2026 | API de GitHub | Fijada por SHA de commit |
| actions/setup-node | v7.1.0 (`949feb24…`) | 08/10/2026 | API de GitHub | Fijada por SHA de commit |
| kysely | 0.29.6 | 16/09/2026 | registro de npm | P1-T3. 0.29.7 tenía 2 días. Node `>=22` |
| pg / @types/pg | 8.23.1 / 8.23.1 | 30/09/2026 / 17/08/2026 | registro de npm | P1-T3. Driver de ADR-010 |
| kysely-codegen | 0.20.0 | 16/02/2026 | registro de npm | P1-T3, solo desarrollo. Peers `kysely >=0.27 <1` y `pg >=8.8 <9` satisfechos; comparte `zod` 4.6.6; sin scripts de instalación |
| PostgreSQL (imagen) | `postgres:18.6-trixie@sha256:74935e72…dcfc4336` | 13/08/2026 (release 18.6); imagen del 06/10/2026 | registro de Docker Hub y postgresql.org | P1-T3. Índice multiplataforma fijado por digest |

Las filas de P1-T3 se verificaron el 20/10/2026 con la misma política. `pnpm install` aplicó las políticas de cadena de suministro sin excepciones.

**Notas.**

- `skipLibCheck: true`. Las declaraciones de Zod asumen el global `URL` del host; el código propio se verifica completo.
- Node 25 o posterior ya no incluye corepack. Al migrar a Node 26 LTS habrá que instalar pnpm por otro medio. Revisar cuando Node 26 pase a LTS.
- No se verificó la firma GPG de `SHASUMS256.txt`, porque `gpg` no está instalado. La verificación fue de checksum sobre HTTPS.
