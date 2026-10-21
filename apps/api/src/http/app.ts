import { randomBytes, randomUUID } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { sql } from "kysely";
import type { CookieMode } from "../config.js";
import {
  createLimiters,
  LOGIN_LIMITS,
  type LoginLimits,
  type SessionDurations,
} from "../auth/login.js";
import type { PasswordHasher } from "../auth/passwords.js";
import type { Database } from "../auth/store.js";
import type { RandomBytes } from "../auth/tokens.js";
import { ARGON2_GATE, WorkGate } from "../auth/work-gate.js";
import { silentLogger, type Logger } from "../logger.js";
import { authRoutes } from "./auth-routes.js";
import { contextOf, setContext } from "./context.js";
import { sessionCookie } from "./cookies.js";
import { bodyParserError, HttpError } from "./errors.js";

// Aplicación HTTP de P1-T4 (plan §5): health, autenticación administrativa y manejo uniforme de
// errores. No tiene efectos al importarse: main.ts la compone y la pone a escuchar.

export interface AppDependencies {
  readonly adminOrigin: string;
  readonly cookieMode: CookieMode;
  readonly db: Database;
  readonly hasher: PasswordHasher;
  readonly dummyHash: string;
  readonly sessions: SessionDurations;
  /** Migraciones que el esquema debe tener aplicadas para declararse listo. */
  readonly expectedMigrations: readonly string[];
  readonly limits?: LoginLimits;
  readonly gate?: WorkGate;
  readonly clock?: () => Date;
  readonly random?: RandomBytes;
  readonly logger?: Logger;
  readonly readinessTimeoutMs?: number;
}

export interface ApiApp {
  readonly app: Express;
  readonly gate: WorkGate;
  /** Desde ahora `ready` responde 503 (apagado ordenado, §5.15). */
  beginShutdown(): void;
}

const JSON_BODY_LIMIT = "16kb";
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export function createApp(deps: AppDependencies): ApiApp {
  const clock = deps.clock ?? (() => new Date());
  const logger = deps.logger ?? silentLogger;
  const limits = deps.limits ?? LOGIN_LIMITS;
  const gate = deps.gate ?? new WorkGate(ARGON2_GATE);
  const cookie = sessionCookie(deps.cookieMode);
  let shuttingDown = false;

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  app.use((req, res, next) => {
    const requestId = randomUUID();
    setContext(req, { requestId, route: "unmatched" });
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    const started = performance.now();
    res.on("finish", () => {
      logger({
        event: "http_request",
        requestId,
        method: req.method,
        route: contextOf(req).route,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      });
    });
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      // HSTS solo cuando haya HTTPS (P7). En P1 la API escucha por HTTP en loopback.
      strictTransportSecurity: false,
      referrerPolicy: { policy: "no-referrer" },
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );

  // Sin CORS: el panel llega por el mismo origen. Un preflight no recibe permisos.
  app.use((req, _res, next) => {
    next(req.method === "OPTIONS" ? new HttpError("NOT_FOUND") : undefined);
  });

  app.get("/health/live", (req, res) => {
    contextOf(req).route = "GET /health/live";
    res.status(200).json({ status: "ok" });
  });

  app.get("/health/ready", async (req, res) => {
    contextOf(req).route = "GET /health/ready";
    const reason = shuttingDown
      ? "SHUTTING_DOWN"
      : await readinessProblem(deps.db, deps.expectedMigrations, deps.readinessTimeoutMs ?? 1_000);
    if (reason !== undefined) {
      logger({ event: "not_ready", requestId: contextOf(req).requestId, reason });
      throw new HttpError("SERVICE_UNAVAILABLE");
    }
    res.status(200).json({ status: "ready" });
  });

  const api = express.Router();
  // Toda mutación exige el origen del panel (§5.8), antes de leer el cuerpo.
  api.use((req, _res, next) => {
    next(
      SAFE_METHODS.has(req.method) || req.get("origin") === deps.adminOrigin
        ? undefined
        : new HttpError("FORBIDDEN"),
    );
  });
  api.use(
    express.json({
      limit: JSON_BODY_LIMIT,
      strict: true,
      inflate: false,
      type: "application/json",
    }),
  );
  const { networkLimiter, pairLimiter } = createLimiters(limits, () => clock().getTime());
  api.use(
    authRoutes({
      login: {
        db: deps.db,
        hasher: deps.hasher,
        dummyHash: deps.dummyHash,
        gate,
        limits,
        networkLimiter,
        pairLimiter,
        sessions: deps.sessions,
        clock,
        random: deps.random ?? randomBytes,
      },
      cookie,
      logger,
    }),
  );
  app.use("/api/v1", api);

  app.use((_req, _res, next) => {
    next(new HttpError("NOT_FOUND"));
  });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    // Si la respuesta ya empezó, solo Express puede cortarla.
    if (res.headersSent) {
      next(error);
      return;
    }
    const requestId = contextOf(req).requestId;
    const httpError =
      error instanceof HttpError
        ? error
        : (bodyParserError(error) ?? new HttpError("INTERNAL_ERROR"));
    if (httpError.code === "INTERNAL_ERROR") {
      logger({
        event: "unhandled_error",
        requestId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    if (httpError.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(httpError.retryAfterSeconds));
    }
    res.status(httpError.status).json(httpError.body(requestId));
  });

  return {
    app,
    gate,
    beginShutdown() {
      shuttingDown = true;
    },
  };
}

/** Base accesible y sin migraciones pendientes, dentro del plazo. Devuelve el motivo si no. */
async function readinessProblem(
  db: Database,
  expected: readonly string[],
  timeoutMs: number,
): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"TIMEOUT">((resolve) => {
    timer = setTimeout(() => {
      resolve("TIMEOUT");
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db),
      timeout,
    ]);
    if (result === "TIMEOUT") return "DATABASE_TIMEOUT";
    const applied = new Set(result.rows.map((row) => row.name));
    return expected.every((name) => applied.has(name)) ? undefined : "MIGRATIONS_PENDING";
  } catch {
    return "DATABASE_UNAVAILABLE";
  } finally {
    clearTimeout(timer);
  }
}
