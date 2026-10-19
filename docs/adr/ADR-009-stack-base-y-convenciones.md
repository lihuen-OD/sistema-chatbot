# ADR-009 — Stack base y convenciones de idioma

- Fecha: 19/10/2026
- Estado: Aceptada. Las versiones exactas se verifican y registran al iniciar P1.
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
