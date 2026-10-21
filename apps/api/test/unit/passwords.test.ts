import { argon2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ARGON2_PARAMETERS,
  createArgon2Hasher,
  parsePhc,
  passwordPolicyProblem,
} from "../../src/auth/passwords.js";

// Argon2id de node:crypto (plan de P1-T4, §5.5; ADR-015).

const PASSWORD = "una frase de prueba bastante larga";

describe("Argon2id del runtime", () => {
  it("cumple el vector de prueba de RFC 9106 §5.3", () => {
    // Si el runtime no trae Argon2 o lo implementa distinto, falla acá y no en el login.
    const tag = argon2Sync("argon2id", {
      message: Buffer.alloc(32, 1),
      nonce: Buffer.alloc(16, 2),
      secret: Buffer.alloc(8, 3),
      associatedData: Buffer.alloc(12, 4),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
    });
    expect(tag.toString("hex")).toBe(
      "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
    );
  });

  it("los parámetros vigentes son los de RFC 9106 §4 (64 MiB, t=3, p=4)", () => {
    expect(ARGON2_PARAMETERS).toEqual({ memory: 65_536, passes: 3, parallelism: 4 });
  });
});

describe("hash de contraseñas", () => {
  const hasher = createArgon2Hasher();

  it("produce una cadena PHC con sal propia y la verifica", async () => {
    const first = await hasher.hash(PASSWORD);
    const second = await hasher.hash(PASSWORD);
    expect(first).toMatch(
      /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(first).not.toBe(second);
    expect(await hasher.verify(first, PASSWORD)).toEqual({ valid: true, needsRehash: false });
    expect(await hasher.verify(first, `${PASSWORD}.`)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("pide recalcular un hash con otros parámetros", async () => {
    const old = await createArgon2Hasher({ memory: 1024, passes: 1, parallelism: 1 }).hash(
      PASSWORD,
    );
    expect(parsePhc(old)?.parameters).toEqual({ memory: 1024, passes: 1, parallelism: 1 });
    expect(await hasher.verify(old, PASSWORD)).toEqual({ valid: true, needsRehash: true });
  });

  it("normaliza con NFKC: la ligadura ﬁ equivale a fi", async () => {
    const stored = await hasher.hash(`ﬁ${PASSWORD}`);
    expect((await hasher.verify(stored, `fi${PASSWORD}`)).valid).toBe(true);
  });

  it("un hash mal formado no verifica", async () => {
    for (const stored of ["", "texto", "$argon2i$v=19$m=1,t=1,p=1$AAAAAAAAAAA$BBBBBBBBBBBBBBBB"]) {
      expect(await hasher.verify(stored, PASSWORD)).toEqual({ valid: false, needsRehash: false });
    }
  });
});

describe("política de contraseñas", () => {
  it("de 15 a 128 caracteres, contados en puntos de código", () => {
    expect(passwordPolicyProblem("a".repeat(14))).toBe("TOO_SHORT");
    expect(passwordPolicyProblem("a".repeat(15))).toBeUndefined();
    expect(passwordPolicyProblem("a".repeat(128))).toBeUndefined();
    expect(passwordPolicyProblem("a".repeat(129))).toBe("TOO_LONG");
    expect(passwordPolicyProblem("😀".repeat(15))).toBeUndefined();
    expect(passwordPolicyProblem("😀".repeat(129))).toBe("TOO_LONG");
  });

  it("no exige reglas de composición", () => {
    expect(passwordPolicyProblem("solo minusculas sin numeros")).toBeUndefined();
  });
});
