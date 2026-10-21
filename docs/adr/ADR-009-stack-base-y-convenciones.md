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

## Addendum del 21/10/2026 — Node 24.22.1 con excepción a la política de antigüedad

Registro de una excepción autorizada por el propietario. La decisión de stack no cambia.

**Versión adoptada:** Node.js 24.22.1 (LTS "Krypton"), publicada el 21/10/2026, en reemplazo de 24.21.0.
- `.node-version` pasa a 24.22.1.
- `engines` pasa a `>=24.22.1 <25`, así que las versiones anteriores quedan rechazadas.
- La CI toma la versión de `.node-version`, sin otros cambios.

**Excepción.** La política de 7 días (addendum de P1-T1) no se cumplió: la versión tenía horas de publicada.
- **Autorización:** del propietario, el 21/10/2026, por ser una actualización de seguridad.
- **Alcance:** solo esta versión de Node. No se extiende a dependencias de npm ni a futuras versiones: la próxima vuelve a respetar la política, salvo otra excepción explícita.

**Motivo.** El aviso oficial de octubre de 2026 (`nodejs.org/en/blog/vulnerability/october-2026-security-releases`) informa:
- severidad máxima HIGH en las líneas 26.x, 24.x y 22.x;
- versiones corregidas: v26.12.1, v24.22.1 y v22.23.4;
- CVE corregidos en 24.22.1, según el changelog: CVE-2026-105481 (`http`), CVE-2026-105482 (`dns`), CVE-2026-105483 y CVE-2026-106069 (`tls`), CVE-2026-106073 (modelo de permisos), CVE-2026-106074 (`crypto`) y CVE-2026-111497 (brotli);
- además actualiza OpenSSL a 3.5.9 y undici a 7.30.1.

Al adoptarla, el aviso todavía no publicaba la severidad de cada CVE. El análisis por componente está en `docs/plans/P1-T4-api-minima.md` §6.

**Verificación:**

| Comprobación | Resultado |
|---|---|
| Checksum del binario local (`node-v24.22.1-darwin-arm64.tar.gz`) | `89c68259…dfbc0a7`. Coincide con `nodejs.org/dist/v24.22.1/SHASUMS256.txt` y con el bloque de checksums del post de la release en el repositorio `nodejs/nodejs.org` |
| Checksum del binario de la CI (`node-v24.22.1-linux-x64.tar.gz`, el que descarga `actions/setup-node`) | `eb6728e7…c6002d7c`. Coincide en las mismas dos fuentes. El log de la CI confirma la descarga de ese archivo desde nodejs.org |
| Firma GPG | No verificada: `gpg` no está instalado, como en el addendum de P1-T1 |
| Componentes | OpenSSL 3.5.9 (antes 3.5.8); corepack 0.36.0, que respeta `packageManager` (pnpm 12.12.1 con hash) |
| Argon2id (`node:crypto`) | El vector de prueba de RFC 9106 §5.3 coincide. No hay `ExperimentalWarning`. Con 64 MiB, t=3 y p=4, mediana de 21 ms (Apple M5). Argon2 es estable desde 24.19.0, y 24.22.x no lo modifica |
| Compatibilidad | `engines` de las dependencias instaladas compatibles; `pnpm install --frozen-lockfile`, `pnpm run check` y `pnpm run check:db` completos. Resultados en `PROJECT_STATUS.md` |

**Sin cambios:** el Node del sistema (24.18.0) no se modificó. Las verificaciones usan una copia aislada de 24.22.1, igual que antes con 24.21.0. Actualizarlo queda a cargo del propietario.

**Nota del 21/10/2026, después de fusionar P1-T4:** el propietario instaló Node 24.22.1 en el sistema con el paquete oficial. Comprobado en un shell de login nuevo: v24.22.1 en `/usr/local/bin/node` (paquete `org.nodejs.node.pkg` v24.22.1) y pnpm 12.12.1. Las verificaciones locales ya no necesitan la copia aislada.

## Addendum del 21/10/2026 — dependencias de `apps/api` (P1-T4)

Confirma "HTTP: Express" en la tarea de API de P1. Verificadas en el registro de npm el 21/10/2026, con la política de 7 días y sin excepciones. Ninguna tiene scripts de instalación.

| Componente | Versión | Publicada | Uso |
|---|---|---|---|
| express | 5.3.0 | 09/10/2026 | Servidor HTTP; incluye `body-parser` 2.3.0 |
| @types/express | 5.0.6 | 01/12/2025 | Tipos (desarrollo) |
| cookie | 2.0.1 | 30/06/2026 | Leer la cookie de sesión (`parseCookie`) |
| helmet | 8.3.0 | 12/07/2026 | Cabeceras de seguridad |

- Argon2id viene de `node:crypto` (addendum de Node 24.22.1): no se agrega un módulo nativo.
- Las pruebas HTTP usan `fetch` de Node, sin `supertest`.
- `pnpm install` aplicó las políticas de cadena de suministro sin excepciones.
