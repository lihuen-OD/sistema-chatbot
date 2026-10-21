import { createHash } from "node:crypto";
import { apiErrorResponseSchema, sessionResponseSchema } from "@sistema-chatbot/contracts";
import { parseSetCookie } from "cookie";
import { afterAll, describe, expect, it } from "vitest";
import { disableAdminUser } from "../../src/auth/admin-users.js";
import { createArgon2Hasher, parsePhc } from "../../src/auth/passwords.js";
import { decodeToken } from "../../src/auth/tokens.js";
import { countingHasher, fastHasher } from "../support/fakes.js";
import { Browser, type ApiResponse } from "../support/http.js";
import {
  apiWith,
  cleanup,
  createUser,
  migratedDatabase,
  PASSWORD,
  sessionsOf,
} from "./support/database.js";

afterAll(cleanup);

// Login (plan de P1-T4, §5.6, §5.7 y §5.9; ADR-015).

function sessionCookieOf(response: ApiResponse): ReturnType<typeof parseSetCookie> {
  const header = response.headers.getSetCookie()[0];
  if (header === undefined) throw new Error("La respuesta no puso una cookie.");
  return parseSetCookie(header);
}

describe("login correcto", () => {
  it("pone la cookie local sin Secure, HttpOnly y SameSite=Strict, y no devuelve el token", async () => {
    const db = await migratedDatabase();
    await createUser(db);
    const browser = new Browser((await apiWith(db)).baseUrl);

    const response = await browser.login("admin@example.com", PASSWORD);
    expect(response.status, response.text).toBe(200);
    expect(sessionResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({ user: { email: "admin@example.com" }, permissions: [] });

    const cookie = sessionCookieOf(response);
    expect(cookie).toMatchObject({
      name: "sc_dev_session",
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    expect(cookie.secure).not.toBe(true);
    expect(cookie.domain).toBeUndefined();
    expect(cookie.maxAge).toBeUndefined();
    expect(cookie.expires).toBeUndefined();
    expect(response.text).not.toContain(cookie.value);
  });

  it("fuera del modo local usa __Host-sc_session con Secure", async () => {
    const db = await migratedDatabase();
    await createUser(db);
    const origin = "https://admin.example.com";
    const browser = new Browser(
      (await apiWith(db, { cookieMode: "secure", adminOrigin: origin })).baseUrl,
    );
    const response = await browser.request("POST", "/api/v1/auth/login", {
      json: { email: "admin@example.com", password: PASSWORD },
      origin,
    });
    expect(response.status).toBe(200);
    expect(sessionCookieOf(response)).toMatchObject({
      name: "__Host-sc_session",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
  });

  it("la base guarda solo el SHA-256 del token", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db);
    const browser = new Browser((await apiWith(db)).baseUrl);
    await browser.login("admin@example.com", PASSWORD);

    const token = decodeToken(browser.cookie("sc_dev_session"));
    if (token === undefined) throw new Error("Sin token de sesión.");
    const [stored] = await sessionsOf(db, userId);
    expect(stored?.tokenHash.equals(createHash("sha256").update(token).digest())).toBe(true);
    expect(stored?.tokenHash.equals(token)).toBe(false);
  });

  it("normaliza el email: mayúsculas y espacios no cambian la cuenta", async () => {
    const db = await migratedDatabase();
    await createUser(db);
    const browser = new Browser((await apiWith(db)).baseUrl);
    const response = await browser.login("  Admin@Example.COM ", PASSWORD);
    expect(response.status).toBe(200);
  });

  it("funciona con los parámetros vigentes de Argon2 (64 MiB, t=3, p=4)", async () => {
    const db = await migratedDatabase();
    const hasher = createArgon2Hasher();
    await createUser(db, "admin@example.com", PASSWORD, hasher);
    const browser = new Browser(
      (await apiWith(db, { hasher, dummyHash: await hasher.hash("ficticio") })).baseUrl,
    );
    expect((await browser.login("admin@example.com", PASSWORD)).status).toBe(200);
    expect((await browser.login("admin@example.com", `${PASSWORD}!`)).status).toBe(401);
  });

  it("recalcula un hash con parámetros viejos sin revocar otras sesiones", async () => {
    const db = await migratedDatabase();
    const userId = await createUser(db);
    const other = new Browser((await apiWith(db)).baseUrl);
    await other.login("admin@example.com", PASSWORD);

    const hasher = createArgon2Hasher();
    const browser = new Browser(
      (await apiWith(db, { hasher, dummyHash: await hasher.hash("ficticio") })).baseUrl,
    );
    expect((await browser.login("admin@example.com", PASSWORD)).status).toBe(200);

    const user = await db
      .selectFrom("adminUsers")
      .select(["passwordHash", "credentialVersion"])
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    expect(parsePhc(user.passwordHash)?.parameters).toEqual({
      memory: 65_536,
      passes: 3,
      parallelism: 4,
    });
    expect(user.credentialVersion).toBe(1);
    expect((await sessionsOf(db, userId)).map((session) => session.revokeReason)).toEqual([
      null,
      null,
    ]);
    expect((await other.me()).status).toBe(200);
  });
});

describe("enumeración de cuentas", () => {
  it("incorrecto, inexistente y desactivado responden igual, con una sola verificación", async () => {
    const db = await migratedDatabase();
    await createUser(db, "activo@example.com");
    await createUser(db, "baja@example.com");
    await disableAdminUser(db, "baja@example.com");
    const hasher = countingHasher(fastHasher);
    const browser = new Browser((await apiWith(db, { hasher })).baseUrl);

    const attempts: [string, string][] = [
      ["activo@example.com", `${PASSWORD} incorrecta`],
      ["nadie@example.com", PASSWORD],
      ["baja@example.com", PASSWORD],
    ];
    const shapes: unknown[] = [];
    for (const [email, password] of attempts) {
      const before = hasher.verifications;
      const response = await browser.login(email, password);
      expect(hasher.verifications - before, email).toBe(1);
      expect(response.status, email).toBe(401);
      const parsed = apiErrorResponseSchema.parse(response.body);
      const headerNames = [...response.headers.keys()]
        .filter((name) => !["date", "x-request-id", "content-length", "etag"].includes(name))
        .sort();
      shapes.push({ code: parsed.error.code, message: parsed.error.message, headerNames });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });
});
