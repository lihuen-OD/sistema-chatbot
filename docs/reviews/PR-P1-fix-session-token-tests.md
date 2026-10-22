# Correctivo: fallo intermitente de las pruebas de sesiones

## Destino del PR

`main` (`fed2931`, con el primer bloque de P1-T5 ya fusionado en el PR #12). La rama `p1/fix-session-token-tests` sale de `main` actualizada y no depende de otra rama abierta. Correctivo autorizado explícitamente por el propietario; no avanza al siguiente bloque de P1-T5 ni fusiona.

## Problema resuelto

Las pruebas de sesiones (`apps/api/test/db/sessions.test.ts`) alteraban los tokens por sufijo:

- CSRF alterado: `${csrf.slice(0, -1)}A`. Si el aleatorio producía un token que ya terminaba en `A`, el reemplazo no cambiaba nada: se enviaba el CSRF válido y el logout devolvía 204 en lugar de 403, con fallo intermitente de la suite.
- Cookie alterada: `${value.slice(0, -2)}AA`. Si la cookie ya terminaba en `AA`, el valor original volvía intacto y `me()` devolvía 200 en lugar de 401.

Con tokens base64url de 64 símbolos, la probabilidad de cada final era 1/64: una sola ocurrencia aleatoria por ejecución hacía fallar el archivo. El fallo era de las pruebas, no del producto: los endpoints rechazan correctamente los tokens alterados.

## Solución

- **`apps/api/test/support/tampering.ts` (nuevo)**: helpers pequeños de prueba para compartir la lógica de alteración garantizada.
  - `withOneCharacterChanged(token)`: cambia el último símbolo por el siguiente del alfabeto base64url (con retorno al primero). Conserva longitud y alfabeto; entre 64 símbolos el reemplazo difiere siempre del original.
  - `withOneBitChanged(cookie)`: decodifica los bytes, cambia un bit del primer byte y recodifica en base64url (misma longitud de bytes y de símbolos). Un cambio a nivel de bytes evita tocar solo los bits de relleno del último símbolo (32 bytes ocupan 43 símbolos, con 2 bits sin datos): allí `'A'` y `'B'` decodifican los mismos bytes, y el reemplazo de texto por sufijo podía volver con la cookie original.
- **`apps/api/test/unit/tampering.test.ts` (nuevo)**: las dos alteraciones conservan longitud y alfabeto y difieren del original, también para originales que terminan en `A` y en `AA`; el reemplazo del último símbolo por `'B'` mantiene los bytes y el cambio de bit del helper no.
- **`apps/api/test/db/sessions.test.ts`**:
  - Usa los helpers en los dos puntos con alteración y afirma antes de enviar que el valor difiere del original y que la longitud se conserva.
  - Conserva los controles: los cinco rechazos de logout con 403, la sesión activa después de los rechazos, el logout válido con 204, la cookie alterada con 401 y su borrado de la jarra.
  - Agrega casos deterministas con `random` inyectado (`deps.random` de `AppDependencies`): una sesión fija cuyo CSRF derivado termina en `A` (alterado: 403; sesión activa; válido: 204) y otra cuya cookie termina en `AA` (cambio de bit: 401 con cookie borrada; sesión original en pie). Así la cobertura de los finales problemáticos ya no depende del azar.
- **Documentación**: este archivo y `PROJECT_STATUS.md`.

## No hay cambios de producción

- Sin cambios en la implementación de autenticación, en los endpoints ni en la comparación CSRF (`csrfMatches` sigue intacta).
- Sin reintentos automáticos ni pruebas omitidas: los cinco rechazos y las demás validaciones se mantienen, ahora con un valor alterado garantizadamente distinto del original y cuatro pruebas nuevas del helper.

## Validación (local, con el contenedor del proyecto)

- `pnpm run check` del repositorio: código 0 (lint, formato, límites, typecheck, pruebas unitarias sin base y build; la API con 64 pruebas incluye las 4 del helper nuevo).
- Suite completa contra PostgreSQL real (127.0.0.1:55432): `pnpm run test:db`, 46/46 en 7 archivos, con 15 de sesiones y los 2 casos deterministas nuevos.
- Estabilidad: `sessions.test.ts` repetido 10 veces consecutivas tras el arreglo, 15/15 en las 10 ejecuciones.
- Estado inicial: el daemon de Docker estaba detenido y nadie escuchaba en 55432; se arrancó Docker Desktop y el contenedor del proyecto para poder ejecutar la parte contra base real. Sin cambios de configuración.
- CI: del SHA final publicado, en la entrega.

## Limitaciones

- La repetición local mide la estabilidad del archivo de sesiones, no de la suite completa; la suite completa con PostgreSQL corre en la CI del PR.
- Los casos deterministas fijan el `random` solo dentro de esa prueba: el resto de la suite sigue usando aleatoriedad real, como corresponde.
