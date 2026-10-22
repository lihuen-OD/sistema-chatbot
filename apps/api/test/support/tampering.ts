// Alteraciones de prueba para tokens de sesión y CSRF (ADR-015). Garantizan que el valor
// alterado difiere del original: la mutación ingenua por sufijo quedaba sin efecto cuando el
// aleatorio producía justamente el final esperado, y la prueba fallaba solo a veces.

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Cambia el último carácter del token por el siguiente del alfabeto base64url (con
 * retorno al primero): garantizadamente distinto, con la misma longitud y alfabeto. La
 * prueba afirma antes de enviarlo que difiere del original: así el rechazo del endpoint
 * verifica un token que sin duda no es el válido. */
export function withOneCharacterChanged(token: string): string {
  if (token === "") throw new Error("No hay carácter que alterar.");
  const original = token.slice(-1);
  const position = TOKEN_ALPHABET.indexOf(original);
  // Un carácter fuera del alfabeto se cambia por el primero; entre 64 símbolos siempre
  // hay uno que difiere del original.
  const replacement =
    position === -1
      ? TOKEN_ALPHABET.charAt(0)
      : TOKEN_ALPHABET.charAt((position + 1) % TOKEN_ALPHABET.length);
  return `${token.slice(0, -1)}${replacement}`;
}

/** Altera la cookie de sesión decodificando sus bytes, cambiando un bit del primer byte y
 * recodificando en base64url (misma longitud de bytes y de símbolos). Un cambio a nivel de
 * bytes evita tocar solo los bits de relleno del último símbolo (32 bytes ocupan 43 símbolos
 * con 2 bits sin datos al final), que dejaría los bytes y el token intactos. */
export function withOneBitChanged(cookie: string): string {
  const bytes = Buffer.from(cookie, "base64url");
  if (bytes.length === 0) throw new Error("La cookie no decodifica a bytes.");
  const first = bytes.at(0) ?? 0;
  bytes[0] = first ^ 0b00000001;
  return bytes.toString("base64url");
}
