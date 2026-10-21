import { parseSetCookie } from "cookie";
import { createApp, type ApiApp, type AppDependencies } from "../../src/http/app.js";
import { startServer } from "../../src/server.js";

// Servidor real en un puerto efímero de 127.0.0.1 y un "navegador" mínimo con su propio frasco de
// cookies. Dos pestañas del mismo navegador comparten el frasco; otro dispositivo es otro Browser.

export const ADMIN_ORIGIN = "http://localhost:5173";

export interface StartedApi {
  readonly api: ApiApp;
  readonly baseUrl: string;
  close(graceMs?: number): Promise<void>;
}

export async function startApi(deps: AppDependencies): Promise<StartedApi> {
  const api = createApp(deps);
  const running = await startServer(api.app, "127.0.0.1", 0);
  return {
    api,
    baseUrl: `http://127.0.0.1:${String(running.port)}`,
    close: (graceMs = 1_000) => running.close(graceMs),
  };
}

export interface ApiResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

export interface RequestOptions {
  readonly json?: unknown;
  readonly body?: string | Uint8Array;
  readonly headers?: Record<string, string>;
  /** Origen de la petición. Por defecto el del panel en las mutaciones; `null` lo omite. */
  readonly origin?: string | null;
}

export class Browser {
  readonly baseUrl: string;
  readonly #cookies = new Map<string, string>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse> {
    const headers: Record<string, string> = { ...options.headers };
    const origin =
      options.origin === undefined ? (method === "GET" ? null : ADMIN_ORIGIN) : options.origin;
    if (origin !== null) headers["Origin"] = origin;
    if (this.#cookies.size > 0) {
      headers["Cookie"] = [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    let body = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers["Content-Type"] ??= "application/json";
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "manual",
    });
    for (const header of response.headers.getSetCookie()) {
      const cookie = parseSetCookie(header);
      const expired = cookie.expires !== undefined && cookie.expires.getTime() <= Date.now();
      const value = cookie.value ?? "";
      if (expired || value === "") this.#cookies.delete(cookie.name);
      else this.#cookies.set(cookie.name, value);
    }
    const text = await response.text();
    const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
    return {
      status: response.status,
      headers: response.headers,
      text,
      body: isJson && text !== "" ? (JSON.parse(text) as unknown) : undefined,
    };
  }

  cookie(name: string): string | undefined {
    return this.#cookies.get(name);
  }

  setCookie(name: string, value: string): void {
    this.#cookies.set(name, value);
  }

  login(email: string, password: string): Promise<ApiResponse> {
    return this.request("POST", "/api/v1/auth/login", { json: { email, password } });
  }

  me(): Promise<ApiResponse> {
    return this.request("GET", "/api/v1/auth/me");
  }

  logout(csrfToken: string | undefined, options: RequestOptions = {}): Promise<ApiResponse> {
    return this.request("POST", "/api/v1/auth/logout", {
      ...options,
      headers: {
        ...(csrfToken === undefined ? {} : { "X-CSRF-Token": csrfToken }),
        ...options.headers,
      },
    });
  }
}

/** Token CSRF de una respuesta de sesión. */
export function csrfOf(response: ApiResponse): string {
  const body = response.body as { csrfToken?: unknown } | undefined;
  if (typeof body?.csrfToken !== "string")
    throw new Error(`Respuesta sin token CSRF: ${response.text}`);
  return body.csrfToken;
}
