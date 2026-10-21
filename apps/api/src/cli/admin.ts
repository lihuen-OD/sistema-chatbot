import {
  DatabaseGuardError,
  developmentTarget,
  loadLocalEnv,
  openDatabase,
} from "@sistema-chatbot/db";
import {
  createAdminUser,
  disableAdminUser,
  revokeAdminSessions,
  setAdminPassword,
  unlockAdminEmail,
  type AdminUserResult,
} from "../auth/admin-users.js";
import { createArgon2Hasher, type PasswordHasher } from "../auth/passwords.js";
import type { Database } from "../auth/store.js";
import { needsPassword, parseArguments, type ParsedArguments } from "./arguments.js";
import { readSecret } from "./secret.js";

// Usuarios administrativos locales (plan de P1-T4, §5.13):
//   pnpm --filter @sistema-chatbot/api run admin -- <comando> --email <email>
// Comandos: create, set-password, disable, revoke-sessions y unlock. Rechaza APP_ENV=production y
// pasa por las guardas de base. La contraseña se lee de la terminal sin eco (o de la entrada
// estándar si no es una terminal), nunca de un argumento: quedaría en el historial.

const MESSAGES: Record<Extract<AdminUserResult, { ok: false }>["problem"], string> = {
  EMAIL_INVALID: "El email no tiene una forma válida.",
  EMAIL_TAKEN: "Ya existe un usuario con ese email.",
  USER_NOT_FOUND: "No existe un usuario con ese email.",
  TOO_SHORT: "La contraseña debe tener al menos 15 caracteres.",
  TOO_LONG: "La contraseña admite hasta 128 caracteres.",
};

async function askPassword(): Promise<string> {
  const password = await readSecret("Contraseña: ");
  if (process.stdin.isTTY && (await readSecret("Repetir contraseña: ")) !== password) {
    throw new Error("Las contraseñas no coinciden.");
  }
  return password;
}

async function execute(
  db: Database,
  hasher: PasswordHasher,
  args: ParsedArguments,
  password: string,
): Promise<AdminUserResult> {
  switch (args.command) {
    case "create":
      return createAdminUser(db, hasher, args.email, password);
    case "set-password":
      return setAdminPassword(db, hasher, args.email, password);
    case "disable":
      return disableAdminUser(db, args.email);
    case "revoke-sessions":
      return revokeAdminSessions(db, args.email);
    case "unlock":
      return unlockAdminEmail(db, args.email);
  }
}

async function main(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2));
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n`);
    return 2;
  }
  if (process.env["APP_ENV"] === "production") {
    process.stderr.write("La CLI de usuarios locales no se usa con APP_ENV=production.\n");
    return 1;
  }
  loadLocalEnv();
  const password = needsPassword(parsed.command) ? await askPassword() : "";
  const db = await openDatabase(developmentTarget(process.env), "sistema-chatbot-admin-cli");
  try {
    const result = await execute(db, createArgon2Hasher(), parsed, password);
    if (!result.ok) {
      process.stderr.write(`${MESSAGES[result.problem]}\n`);
      return 1;
    }
    const count = result.count === undefined ? "" : ` (${String(result.count)})`;
    process.stdout.write(`Hecho: ${parsed.command}${count}.\n`);
    return 0;
  } finally {
    await db.destroy();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const detail =
      error instanceof DatabaseGuardError
        ? error.code
        : error instanceof Error
          ? error.message
          : "error desconocido";
    process.stderr.write(`No se pudo completar: ${detail}\n`);
    process.exitCode = 1;
  },
);
