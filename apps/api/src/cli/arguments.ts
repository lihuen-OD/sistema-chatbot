// Argumentos de la CLI `admin` (plan de P1-T4, §5.13). La contraseña nunca es un argumento.

export const COMMANDS = ["create", "set-password", "disable", "revoke-sessions", "unlock"] as const;
export type Command = (typeof COMMANDS)[number];

export const USAGE = `Uso: admin <${COMMANDS.join("|")}> --email <email>`;
export const PASSWORD_ARGUMENT_REJECTED =
  "La contraseña no se acepta como argumento: se pide por la terminal.";

export interface ParsedArguments {
  readonly command: Command;
  readonly email: string;
}

/** Devuelve los argumentos o el mensaje de error para mostrar. */
export function parseArguments(argv: readonly string[]): ParsedArguments | string {
  if (argv.some((argument) => argument.startsWith("--password"))) {
    return PASSWORD_ARGUMENT_REJECTED;
  }
  // pnpm y npm pueden pasar el separador `--` como primer argumento.
  const [command, ...rest] = argv[0] === "--" ? argv.slice(1) : argv;
  const known = COMMANDS.find((candidate) => candidate === command);
  if (known === undefined) return USAGE;
  const [flag, email, ...extra] = rest;
  if (flag !== "--email" || email === undefined || extra.length > 0) return USAGE;
  return { command: known, email };
}

/** Comandos que piden contraseña (con confirmación en una terminal). */
export function needsPassword(command: Command): boolean {
  return command === "create" || command === "set-password";
}
