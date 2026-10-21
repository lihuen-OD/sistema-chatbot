import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  passwordLength,
} from "@sistema-chatbot/contracts";

// Contraseñas con Argon2id de node:crypto (plan de P1-T4, §5.5; ADR-015). Estable desde Node
// 24.19.0; el proyecto fija 24.22.1. Las contraseñas se normalizan con NFKC antes de calcular.

const argon2Async = promisify(argon2);

export interface Argon2Parameters {
  /** Memoria en bloques de 1 KiB. */
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
}

/** Segundo conjunto recomendado de RFC 9106 §4: 64 MiB, t=3, p=4. */
export const ARGON2_PARAMETERS: Argon2Parameters = Object.freeze({
  memory: 65_536,
  passes: 3,
  parallelism: 4,
});

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=([0-9]{1,10}),t=([0-9]{1,10}),p=([0-9]{1,3})\$([A-Za-z0-9+/]{11,})\$([A-Za-z0-9+/]{16,})$/;

export interface PasswordCheck {
  readonly valid: boolean;
  /** El hash usa parámetros distintos de los vigentes y conviene recalcularlo. */
  readonly needsRehash: boolean;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(stored: string, password: string): Promise<PasswordCheck>;
}

export type PasswordPolicyProblem = "TOO_SHORT" | "TOO_LONG";

/** Política del propietario: de 15 a 128 caracteres, sin reglas de composición. */
export function passwordPolicyProblem(password: string): PasswordPolicyProblem | undefined {
  const length = passwordLength(password);
  if (length < ADMIN_PASSWORD_MIN_LENGTH) return "TOO_SHORT";
  if (length > ADMIN_PASSWORD_MAX_LENGTH) return "TOO_LONG";
  return undefined;
}

export function createArgon2Hasher(
  parameters: Argon2Parameters = ARGON2_PARAMETERS,
): PasswordHasher {
  return {
    async hash(password) {
      const salt = randomBytes(SALT_BYTES);
      const tag = await derive(password, salt, parameters, TAG_BYTES);
      return encodePhc(parameters, salt, tag);
    },
    async verify(stored, password) {
      const parsed = parsePhc(stored);
      if (parsed === undefined) return { valid: false, needsRehash: false };
      const tag = await derive(password, parsed.salt, parsed.parameters, parsed.tag.length);
      return {
        valid: tag.length === parsed.tag.length && timingSafeEqual(tag, parsed.tag),
        needsRehash: !sameParameters(parsed.parameters, parameters),
      };
    },
  };
}

async function derive(
  password: string,
  salt: Buffer,
  parameters: Argon2Parameters,
  tagLength: number,
): Promise<Buffer> {
  return argon2Async("argon2id", {
    message: password.normalize("NFKC"),
    nonce: salt,
    parallelism: parameters.parallelism,
    tagLength,
    memory: parameters.memory,
    passes: parameters.passes,
  });
}

function encodePhc(parameters: Argon2Parameters, salt: Buffer, tag: Buffer): string {
  const { memory, passes, parallelism } = parameters;
  return `$argon2id$v=19$m=${String(memory)},t=${String(passes)},p=${String(parallelism)}$${unpadded(salt)}$${unpadded(tag)}`;
}

interface ParsedPhc {
  readonly parameters: Argon2Parameters;
  readonly salt: Buffer;
  readonly tag: Buffer;
}

export function parsePhc(stored: string): ParsedPhc | undefined {
  const match = PHC_PATTERN.exec(stored);
  if (match === null) return undefined;
  const [, memory, passes, parallelism, salt, tag] = match;
  if (
    memory === undefined ||
    passes === undefined ||
    parallelism === undefined ||
    salt === undefined ||
    tag === undefined
  ) {
    return undefined;
  }
  return {
    parameters: {
      memory: Number(memory),
      passes: Number(passes),
      parallelism: Number(parallelism),
    },
    salt: Buffer.from(salt, "base64"),
    tag: Buffer.from(tag, "base64"),
  };
}

function sameParameters(a: Argon2Parameters, b: Argon2Parameters): boolean {
  return a.memory === b.memory && a.passes === b.passes && a.parallelism === b.parallelism;
}

/** Base64 sin relleno, como en el formato PHC. */
function unpadded(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "");
}
