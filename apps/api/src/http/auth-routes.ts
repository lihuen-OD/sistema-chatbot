import {
  CSRF_HEADER,
  loginRequestSchema,
  type RequestProblem,
  type SessionResponse,
} from "@sistema-chatbot/contracts";
import { Router, type Request, type Response } from "express";
import { login, type LoginDependencies } from "../auth/login.js";
import {
  findActiveSession,
  revokeSession,
  touchSession,
  TOUCH_INTERVAL_MS,
  type ActiveSession,
} from "../auth/store.js";
import { csrfMatches, csrfTokenFor, decodeToken, encodeToken, tokenHash } from "../auth/tokens.js";
import type { Logger } from "../logger.js";
import { contextOf } from "./context.js";
import { clearSessionCookie, readCookie, setSessionCookie, type SessionCookie } from "./cookies.js";
import { HttpError, requestInvalid } from "./errors.js";

// Rutas de autenticación administrativa (docs/05; ADR-015). Los controllers son delgados: la
// admisión, la verificación y las sesiones viven en src/auth.

export interface AuthRouteDependencies {
  readonly login: LoginDependencies;
  readonly cookie: SessionCookie;
  readonly logger: Logger;
}

const LOGIN_FAILED = "El email o la contraseña no son correctos.";
const MAX_PROBLEMS = 50;

export function authRoutes(deps: AuthRouteDependencies): Router {
  const router = Router();
  const { db, clock, sessions } = deps.login;

  async function authenticate(req: Request, res: Response): Promise<AuthenticatedSession> {
    const raw = readCookie(req, deps.cookie.name);
    const token = decodeToken(raw);
    const session =
      token === undefined ? undefined : await findActiveSession(db, tokenHash(token), clock());
    if (token === undefined || session === undefined) {
      if (raw !== undefined) clearSessionCookie(res, deps.cookie);
      throw new HttpError("UNAUTHENTICATED");
    }
    const now = clock();
    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      await touchSession(db, session.id, now, sessions.idleMs);
    }
    return { session, token };
  }

  router.post("/auth/login", async (req, res) => {
    contextOf(req).route = "POST /api/v1/auth/login";
    if (req.is("application/json") === false || req.is("application/json") === null) {
      throw requestInvalid("CONTENT_TYPE");
    }
    const parsed = loginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError("REQUEST_INVALID", { problems: problemsOf(parsed.error.issues) });
    }
    const previousToken = decodeToken(readCookie(req, deps.cookie.name));
    const outcome = await login(deps.login, {
      email: parsed.data.email,
      password: parsed.data.password,
      network: req.socket.remoteAddress ?? "unknown",
      ...(previousToken === undefined ? {} : { previousToken }),
    });
    switch (outcome.kind) {
      case "SUCCESS": {
        setSessionCookie(res, deps.cookie, encodeToken(outcome.token));
        deps.logger({
          event: "login_succeeded",
          requestId: contextOf(req).requestId,
          userId: outcome.userId,
        });
        const body: SessionResponse = {
          user: { id: outcome.userId, email: outcome.email },
          permissions: [],
          csrfToken: outcome.csrfToken,
        };
        res.status(200).json(body);
        return;
      }
      case "INVALID":
        throw new HttpError("UNAUTHENTICATED", { message: LOGIN_FAILED });
      case "RATE_LIMITED":
        throw new HttpError("RATE_LIMITED", { retryAfterSeconds: outcome.retryAfterSeconds });
      case "SATURATED":
        throw new HttpError("SERVICE_UNAVAILABLE", { retryAfterSeconds: 1 });
    }
  });

  /**
   * Identidad, permisos y token CSRF de la sesión. El token CSRF se deriva de la sesión, así que
   * una recarga o cualquier pestaña obtienen el mismo valor sin otro login y sin invalidar a las
   * demás.
   */
  router.get("/auth/me", async (req, res) => {
    contextOf(req).route = "GET /api/v1/auth/me";
    const { session, token } = await authenticate(req, res);
    const body: SessionResponse = {
      user: { id: session.userId, email: session.email },
      permissions: [],
      csrfToken: csrfTokenFor(token),
    };
    res.status(200).json(body);
  });

  router.post("/auth/logout", async (req, res) => {
    contextOf(req).route = "POST /api/v1/auth/logout";
    const { session, token } = await authenticate(req, res);
    if (!csrfMatches(token, req.get(CSRF_HEADER))) throw new HttpError("FORBIDDEN");
    await revokeSession(db, session.id, "LOGOUT");
    deps.logger({
      event: "session_revoked",
      requestId: contextOf(req).requestId,
      userId: session.userId,
      reason: "LOGOUT",
    });
    clearSessionCookie(res, deps.cookie);
    res.status(204).end();
  });

  return router;
}

interface AuthenticatedSession {
  readonly session: ActiveSession;
  readonly token: Buffer;
}

/** Ruta y motivo de cada problema del esquema, sin repetir los valores recibidos. */
function problemsOf(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly code: string }[],
): RequestProblem[] {
  return issues.slice(0, MAX_PROBLEMS).map((issue) => ({
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number",
    ),
    reason: issue.code.slice(0, 64),
  }));
}
