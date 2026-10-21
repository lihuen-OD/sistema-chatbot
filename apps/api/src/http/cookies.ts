import { parseCookie } from "cookie";
import type { CookieOptions, Request, Response } from "express";
import type { CookieMode } from "../config.js";

// Cookie de sesión (plan de P1-T4, §5.7; ADR-015).
// - "secure": `__Host-sc_session`, con Secure. Solo viaja por HTTPS al mismo host; el prefijo
//   impide que un subdominio la reemplace.
// - "local-http": `sc_dev_session`, sin Secure, solo en desarrollo o pruebas, con origen HTTP de
//   loopback y la API en loopback. Safari no envía cookies Secure a http://localhost (WebKit bug
//   281149) y `__Host-` exige origen seguro, así que en local no se depende de esa excepción.
// En los dos casos: HttpOnly, SameSite=Strict, Path=/, sin Domain y sin Max-Age; el vencimiento lo
// controla el servidor.

export interface SessionCookie {
  readonly name: string;
  readonly options: CookieOptions;
}

export function sessionCookie(mode: CookieMode): SessionCookie {
  const base = { httpOnly: true, sameSite: "strict", path: "/" } as const;
  return mode === "secure"
    ? { name: "__Host-sc_session", options: { ...base, secure: true } }
    : { name: "sc_dev_session", options: { ...base, secure: false } };
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  return header === undefined ? undefined : parseCookie(header)[name];
}

export function setSessionCookie(res: Response, cookie: SessionCookie, value: string): void {
  res.cookie(cookie.name, value, cookie.options);
}

export function clearSessionCookie(res: Response, cookie: SessionCookie): void {
  res.clearCookie(cookie.name, cookie.options);
}
