import type { Request } from "express";

// Datos de cada petición que comparten los middlewares, sin extender los tipos de Express.

export interface RequestContext {
  readonly requestId: string;
  /** Ruta declarada para los logs (no la URL con parámetros). */
  route: string;
}

const contexts = new WeakMap<Request, RequestContext>();

export function setContext(req: Request, context: RequestContext): void {
  contexts.set(req, context);
}

export function contextOf(req: Request): RequestContext {
  const context = contexts.get(req);
  if (context === undefined) throw new Error("Petición sin contexto: falta el middleware inicial.");
  return context;
}
