import { afterAll, describe, expect, it } from "vitest";
import {
  disableAdminUser,
  revokeAdminSessions,
  setAdminPassword,
} from "../../src/auth/admin-users.js";
import { fastHasher, HOUR, ManualClock, MINUTE } from "../support/fakes.js";
import { ADMIN_ORIGIN, Browser, csrfOf } from "../support/http.js";
import { withOneBitChanged, withOneCharacterChanged } from "../support/tampering.js";
import {
  apiWith,
  cleanup,
  createUser,
  migratedDatabase,
  PASSWORD,
  sessionsOf,
} from "./support/database.js";

afterAll(cleanup);

// Sesiones: CSRF, rotación, vencimientos en el servidor y revocación (plan de P1-T4, §5.6 y §5.8).

const EMAIL = "admin@example.com";

async function loggedIn(clock?: ManualClock): Promise<{
  browser: Browser;
  baseUrl: string;
  userId: string;
  db: Awaited<ReturnType<typeof migratedDatabase>>;
  csrf: string;
}> {
  const db = await migratedDatabase();
  const userId = await createUser(db, EMAIL);
  const { baseUrl } = await apiWith(db, clock === undefined ? {} : { clock: clock.now });
  const browser = new Browser(baseUrl);
  const response = await browser.login(EMAIL, PASSWORD);
  expect(response.status, response.text).toBe(200);
  return { browser, baseUrl, userId, db, csrf: csrfOf(response) };
}

describe("token CSRF después de recargar y entre pestañas", () => {
  it("/auth/me devuelve el mismo token sin otro login, y una pestaña no invalida a otra", async () => {
    const { browser, csrf } = await loggedIn();
    // Recarga: el panel perdió el token y lo recupera con la cookie.
    const reloaded = await browser.me();
    expect(reloaded.status).toBe(200);
    expect(csrfOf(reloaded)).toBe(csrf);
    // Dos pestañas del mismo navegador comparten la cookie: piden /auth/me cada una.
    const tabA = csrfOf(await browser.me());
    const tabB = csrfOf(await browser.me());
    expect(tabB).toBe(tabA);
    expect(browser.cookie("sc_dev_session")).toBeDefined();
    // La pestaña A usa su token después de que B consultó: sigue valiendo.
    expect((await browser.logout(tabA)).status).toBe(204);
  });

  it("otro dispositivo tiene su propia sesión y su propio token", async () => {
    const { browser, baseUrl, csrf } = await loggedIn();
    const other = new Browser(baseUrl);
    const otherCsrf = csrfOf(await other.login(EMAIL, PASSWORD));
    expect(otherCsrf).not.toBe(csrf);
    expect((await browser.logout(otherCsrf)).status).toBe(403);
    expect((await other.logout(otherCsrf)).status).toBe(204);
    expect((await browser.me()).status).toBe(200);
  });

  it("logout sin token, con token ajeno o con otro origen: 403 y la sesión sigue activa", async () => {
    const { browser, baseUrl, csrf } = await loggedIn();
    const foreign = csrfOf(await new Browser(baseUrl).login(EMAIL, PASSWORD));
    // Alteración con un carácter garantizadamente distinto (misma longitud y alfabeto),
    // afirmada antes de enviarla: el rechazo examina un token que no es el válido, sin
    // depender del azar (un original que ya terminaba en A volvía intacto).
    const tamperedCsrf = withOneCharacterChanged(csrf);
    expect(tamperedCsrf.length).toBe(csrf.length);
    expect(tamperedCsrf).not.toBe(csrf);
    const rejected = [
      await browser.logout(undefined),
      await browser.logout(foreign),
      await browser.logout(tamperedCsrf),
      await browser.logout(csrf, { origin: "https://otro.example.com" }),
      await browser.logout(csrf, { origin: null }),
    ];
    expect(rejected.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    expect((await browser.me()).status).toBe(200);
    expect((await browser.logout(csrf)).status).toBe(204);
  });
});

describe("cookie de sesión", () => {
  it("sin cookie, alterada o desconocida: 401, y la cookie inválida se borra", async () => {
    const { browser, baseUrl } = await loggedIn();
    expect((await new Browser(baseUrl).me()).status).toBe(401);

    const tampered = new Browser(baseUrl);
    const value = browser.cookie("sc_dev_session") ?? "";
    // Cambio de un bit en los bytes decodificados y recodificación en base64url: un
    // reemplazo por sufijo podía volver con la cookie original (final en AA) intacta.
    const originalBytes = Buffer.from(value, "base64url");
    const tamperedCookie = withOneBitChanged(value);
    expect(Buffer.from(tamperedCookie, "base64url").equals(originalBytes)).toBe(false);
    tampered.setCookie("sc_dev_session", tamperedCookie);
    expect((await tampered.me()).status).toBe(401);
    expect(tampered.cookie("sc_dev_session")).toBeUndefined();

    const malformed = new Browser(baseUrl);
    malformed.setCookie("sc_dev_session", "no-es-un-token");
    expect((await malformed.me()).status).toBe(401);
    expect(malformed.cookie("sc_dev_session")).toBeUndefined();
  });
});

describe("casos deterministas: originales que terminan en A y en AA", () => {
  // Las alteraciones ingenuas por sufijo eran nulas exactamente cuando el aleatorio
  // producía un CSRF que ya terminaba en A o una cookie que ya terminaba en AA: el
  // rechazo dependía del azar. Con `random` determinista se fijan esos finales y la
  // prueba deja de ser intermitente.
  /** Sesión cuyo token CSRF derivado (HMAC-SHA256 en base64url) termina en "A". */
  const CSRF_EN_A = Buffer.from(
    "1800000000000000000000000000000000000000000000000000000000000000",
    "hex",
  );
  /** Sesión cuya cookie (token en base64url) termina en "AA". */
  const COOKIE_EN_AA = Buffer.from(
    "0300000000000000000000000000005c00000000000000000000000000000000",
    "hex",
  );

  it("un CSRF original que termina en A: alterado se rechaza (403), la sesión queda activa y el válido cierra (204)", async () => {
    const db = await migratedDatabase();
    await createUser(db, EMAIL);
    const { baseUrl } = await apiWith(db, { random: () => CSRF_EN_A });
    const browser = new Browser(baseUrl);
    const login = await browser.login(EMAIL, PASSWORD);
    expect(login.status, login.text).toBe(200);
    const csrf = csrfOf(login);
    // El caso que con el reemplazo por sufijo volvía sin alteración alguna.
    expect(csrf.lastIndexOf("A")).toBe(csrf.length - 1);
    const tampered = withOneCharacterChanged(csrf);
    expect(tampered.length).toBe(csrf.length);
    expect(tampered).not.toBe(csrf);
    expect((await browser.logout(tampered)).status).toBe(403);
    expect((await browser.me()).status).toBe(200);
    expect((await browser.logout(csrf)).status).toBe(204);
  });

  it("una cookie original que termina en AA: el cambio de bit produce 401 y la sesión original queda activa", async () => {
    const db = await migratedDatabase();
    await createUser(db, EMAIL);
    const { baseUrl } = await apiWith(db, { random: () => COOKIE_EN_AA });
    const browser = new Browser(baseUrl);
    const login = await browser.login(EMAIL, PASSWORD);
    expect(login.status, login.text).toBe(200);
    const value = browser.cookie("sc_dev_session") ?? "";
    // El caso que con el reemplazo por sufijo exactamente volvía a la cookie original.
    expect(value.endsWith("AA")).toBe(true);
    const originalBytes = Buffer.from(value, "base64url");
    const tamperedCookie = withOneBitChanged(value);
    expect(Buffer.from(tamperedCookie, "base64url").equals(originalBytes)).toBe(false);
    const tampered = new Browser(baseUrl);
    tampered.setCookie("sc_dev_session", tamperedCookie);
    expect((await tampered.me()).status).toBe(401);
    expect(tampered.cookie("sc_dev_session")).toBeUndefined();
    // La petición rechazada no afecta a la sesión original.
    expect((await browser.me()).status).toBe(200);
  });
});

describe("vencimientos comprobados en el servidor", () => {
  it("vence a los 30 minutos sin actividad; la actividad lo extiende", async () => {
    const clock = new ManualClock();
    const { browser } = await loggedIn(clock);
    clock.advance(29 * MINUTE);
    expect((await browser.me()).status).toBe(200);
    clock.advance(29 * MINUTE);
    expect((await browser.me()).status).toBe(200);
    clock.advance(30 * MINUTE);
    expect((await browser.me()).status).toBe(401);
  });

  it("vence a las 8 horas aunque haya actividad", async () => {
    const clock = new ManualClock();
    const { browser } = await loggedIn(clock);
    for (let elapsed = 20 * MINUTE; elapsed < 8 * HOUR; elapsed += 20 * MINUTE) {
      clock.advance(20 * MINUTE);
      expect((await browser.me()).status, `${String(elapsed / MINUTE)} min`).toBe(200);
    }
    clock.advance(20 * MINUTE);
    expect((await browser.me()).status).toBe(401);
  });

  it("la inactividad nunca pasa el vencimiento absoluto", async () => {
    const clock = new ManualClock();
    const { browser, db, userId } = await loggedIn(clock);
    // Actividad cada 20 minutos hasta 7 h 40 min, y una última consulta a las 7 h 55 min.
    for (let elapsed = 20 * MINUTE; elapsed <= 7 * HOUR + 40 * MINUTE; elapsed += 20 * MINUTE) {
      clock.advance(20 * MINUTE);
      expect((await browser.me()).status).toBe(200);
    }
    clock.advance(15 * MINUTE);
    expect((await browser.me()).status).toBe(200);
    const session = await db
      .selectFrom("adminSessions")
      .select(["idleExpiresAt", "absoluteExpiresAt"])
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();
    expect(session.idleExpiresAt.getTime()).toBe(session.absoluteExpiresAt.getTime());
  });

  it("last_seen_at se escribe como mucho una vez por minuto", async () => {
    const clock = new ManualClock();
    const { browser, db, userId } = await loggedIn(clock);
    const lastSeen = async (): Promise<number> =>
      (
        await db
          .selectFrom("adminSessions")
          .select("lastSeenAt")
          .where("userId", "=", userId)
          .executeTakeFirstOrThrow()
      ).lastSeenAt.getTime();
    const created = await lastSeen();
    clock.advance(30_000);
    await browser.me();
    expect(await lastSeen()).toBe(created);
    clock.advance(31_000);
    await browser.me();
    expect(await lastSeen()).toBe(created + 61_000);
  });
});

describe("rotación y revocación", () => {
  it("un login con una cookie previa emite otro token y revoca la sesión anterior", async () => {
    const { browser, baseUrl, db, userId } = await loggedIn();
    const previous = browser.cookie("sc_dev_session") ?? "";
    expect((await browser.login(EMAIL, PASSWORD)).status).toBe(200);
    expect(browser.cookie("sc_dev_session")).not.toBe(previous);
    expect((await sessionsOf(db, userId)).map((session) => session.revokeReason)).toEqual([
      "LOGIN_REPLACED",
      null,
    ]);
    const stolen = new Browser(baseUrl);
    stolen.setCookie("sc_dev_session", previous);
    expect((await stolen.me()).status).toBe(401);
    expect((await browser.me()).status).toBe(200);
  });

  it.each([
    { reason: "LOGOUT", cause: "logout" },
    { reason: "PASSWORD_CHANGED", cause: "cambio de contraseña" },
    { reason: "USER_DISABLED", cause: "desactivación" },
    { reason: "ADMIN_REVOKED", cause: "revoke-sessions" },
  ] as const)(
    "$reason ($cause) deja la sesión inutilizable en la petición siguiente",
    async ({ reason }) => {
      const { browser, baseUrl, db, userId, csrf } = await loggedIn();
      const otherDevice = new Browser(baseUrl);
      await otherDevice.login(EMAIL, PASSWORD);

      switch (reason) {
        case "LOGOUT":
          expect((await browser.logout(csrf)).status).toBe(204);
          break;
        case "PASSWORD_CHANGED":
          await setAdminPassword(db, fastHasher, EMAIL, `${PASSWORD} nueva`);
          break;
        case "USER_DISABLED":
          await disableAdminUser(db, EMAIL);
          break;
        case "ADMIN_REVOKED":
          await revokeAdminSessions(db, EMAIL);
          break;
      }
      const me = await browser.request("GET", "/api/v1/auth/me", { origin: ADMIN_ORIGIN });
      expect(me.status).toBe(401);
      expect(browser.cookie("sc_dev_session")).toBeUndefined();
      const reasons = (await sessionsOf(db, userId)).map((session) => session.revokeReason);
      expect(reasons[0]).toBe(reason);
      // El logout cierra solo su sesión; las demás causas alcanzan a todas.
      expect((await otherDevice.me()).status).toBe(reason === "LOGOUT" ? 200 : 401);
    },
  );
});
