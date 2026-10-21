# Node 24.22.1 (seguridad), con excepción a la política de antigüedad

## Dependencia

Esta rama sale de `p1/t4-plan` (plan de P1-T4, solo documentación, sin fusionar). Conviene fusionar primero ese PR. Mientras tanto, el diff exclusivo es https://github.com/lihuen-OD/sistema-chatbot/compare/p1/t4-plan...p1/node-24.22.1.

Es el primer PR de la serie autorizada: Node, límite de `enum` y API mínima.

## Destino del PR

Serie y orden de fusión:
1. `p1/t4-plan`;
2. `p1/node-24.22.1` (este);
3. `p1/flow-schema-enum-limit`;
4. `p1/t4-api`.

- **Mientras la dependencia no esté fusionada,** este PR apunta a `p1/t4-plan`, para que el diff muestre solo sus cambios.
- **Después de fusionar `p1/t4-plan`,** hay que cambiar el destino de este PR a `main`, actualizada con esa fusión, antes de revisarlo y fusionarlo.
- **Lo mismo vale para cada PR siguiente:** al fusionar su dependencia, su destino pasa a ser `main` actualizada.

## Problema resuelto

El 21/10/2026 Node publicó versiones de seguridad para las líneas 26.x, 24.x y 22.x, con severidad máxima HIGH. El proyecto estaba fijado en 24.21.0, que está afectada. El propietario autorizó una excepción a la espera de 7 días para adoptar 24.22.1.

## Cambios

- `.node-version`: 24.22.1.
- `engines`: `>=24.22.1 <25`.
- README: requisito de Node.
- ADR-009: addendum con la excepción, su alcance (solo esta versión) y la verificación.
- PROJECT_STATUS: entrada de la actualización.

## Validación

- Checksums de los binarios darwin-arm64 y linux-x64 `.tar.gz` (el que descarga la CI), coincidentes en dos fuentes oficiales. Firma GPG no verificada: `gpg` no está instalado.
- Argon2id: el vector de RFC 9106 coincide y no hay `ExperimentalWarning`.
- Local con 24.22.1:
  - `pnpm install --frozen-lockfile`: código 0;
  - `pnpm run check`: código 0 (62, 112 y 182 pruebas);
  - `pnpm run check:db`: código 0 (79 pruebas y tipos al día).
- Checkout limpio y CI: en el informe de la entrega.

## Limitaciones

- El aviso oficial todavía no publica la severidad de cada CVE.
- El Node del sistema (24.18.0) no se cambia: queda a cargo del propietario.
