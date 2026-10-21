import type { Server } from "node:http";
import type { Express } from "express";

// Servidor HTTP con plazos explícitos y apagado ordenado (plan de P1-T4, §5.10 y §5.15).

export const SERVER_TIMEOUTS = Object.freeze({
  requestTimeoutMs: 15_000,
  headersTimeoutMs: 10_000,
  keepAliveTimeoutMs: 5_000,
});

export interface RunningServer {
  readonly server: Server;
  /** Puerto real (útil con el puerto 0 de las pruebas). */
  readonly port: number;
  /**
   * Deja de aceptar conexiones, espera las peticiones en curso hasta `graceMs` y después corta
   * las que queden. Resuelve cuando el servidor cerró.
   */
  close(graceMs: number): Promise<void>;
}

export async function startServer(
  app: Express,
  host: string,
  port: number,
): Promise<RunningServer> {
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(port, host, (error?: Error) => {
      if (error === undefined) resolve(listening);
      else reject(error);
    });
  });
  server.requestTimeout = SERVER_TIMEOUTS.requestTimeoutMs;
  server.headersTimeout = SERVER_TIMEOUTS.headersTimeoutMs;
  server.keepAliveTimeout = SERVER_TIMEOUTS.keepAliveTimeoutMs;
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Dirección inesperada.");

  return {
    server,
    port: address.port,
    close(graceMs) {
      return new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          server.closeAllConnections();
        }, graceMs);
        server.close(() => {
          clearTimeout(force);
          resolve();
        });
        server.closeIdleConnections();
      });
    },
  };
}
