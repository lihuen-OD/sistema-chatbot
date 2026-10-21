import {
  apiErrorStatus,
  MAX_REQUEST_PROBLEMS,
  type ApiErrorCode,
  type ApiErrorResponse,
  type RequestProblem,
} from "@sistema-chatbot/contracts";

// Errores HTTP con el catálogo de `contracts` (docs/05). Los mensajes son para personas y no
// repiten datos recibidos; `details` solo existe donde el contrato lo declara.

type HttpErrorCode = Extract<
  ApiErrorCode,
  | "REQUEST_INVALID"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR"
>;

const MESSAGES: Record<HttpErrorCode, string> = {
  REQUEST_INVALID: "La solicitud no es válida.",
  UNAUTHENTICATED: "Hace falta iniciar sesión.",
  FORBIDDEN: "La acción no está permitida.",
  NOT_FOUND: "No existe el recurso.",
  PAYLOAD_TOO_LARGE: "La solicitud es demasiado grande.",
  RATE_LIMITED: "Hubo demasiados intentos. Esperá antes de volver a intentar.",
  SERVICE_UNAVAILABLE: "El servicio no está disponible en este momento.",
  INTERNAL_ERROR: "Ocurrió un error interno.",
};

export interface HttpErrorOptions {
  readonly message?: string;
  readonly retryAfterSeconds?: number;
  readonly problems?: readonly RequestProblem[];
}

export class HttpError extends Error {
  readonly code: HttpErrorCode;
  readonly retryAfterSeconds: number | undefined;
  readonly problems: readonly RequestProblem[] | undefined;

  constructor(code: HttpErrorCode, options: HttpErrorOptions = {}) {
    super(options.message ?? MESSAGES[code]);
    this.name = "HttpError";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.problems = options.problems;
  }

  get status(): number {
    return apiErrorStatus(this.code);
  }

  body(requestId: string): ApiErrorResponse {
    if (this.code === "REQUEST_INVALID") {
      const problems = (this.problems ?? [{ path: [], reason: "INVALID" }]).slice(
        0,
        MAX_REQUEST_PROBLEMS,
      );
      return {
        error: { code: this.code, message: this.message, requestId, details: { problems } },
      };
    }
    return { error: { code: this.code, message: this.message, requestId } };
  }
}

export function requestInvalid(reason: string, path: RequestProblem["path"] = []): HttpError {
  return new HttpError("REQUEST_INVALID", { problems: [{ path, reason }] });
}

/** Errores del lector de cuerpos de Express (body-parser), por su `type`. */
export function bodyParserError(error: unknown): HttpError | undefined {
  if (typeof error !== "object" || error === null || !("type" in error)) return undefined;
  const { type } = error as { type?: unknown };
  switch (type) {
    case "entity.too.large":
      return new HttpError("PAYLOAD_TOO_LARGE");
    case "entity.parse.failed":
      return requestInvalid("JSON_INVALID");
    case "encoding.unsupported":
      return requestInvalid("CONTENT_ENCODING");
    case "charset.unsupported":
      return requestInvalid("CHARSET");
    case undefined:
      return undefined;
    default:
      return typeof type === "string" ? requestInvalid("BODY_INVALID") : undefined;
  }
}
