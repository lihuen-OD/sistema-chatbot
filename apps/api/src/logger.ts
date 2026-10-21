// Logs estructurados mínimos (plan de P1-T4, §5.14): una línea JSON por evento. Nunca reciben
// cookies, cabeceras de autenticación, cuerpos, contraseñas, tokens ni el email de un intento
// fallido; los llamadores pasan solo campos escalares acotados.

export type LogEvent = Readonly<Record<string, string | number | boolean | null>>;

export type Logger = (event: LogEvent) => void;

export const stdoutLogger: Logger = (event) => {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
};

export const silentLogger: Logger = () => undefined;
