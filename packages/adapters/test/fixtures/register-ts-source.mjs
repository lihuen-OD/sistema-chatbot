// Registra el gancho de resolución de las fuentes TypeScript (ver ts-source-hooks.mjs).
import { register } from "node:module";

register("./ts-source-hooks.mjs", import.meta.url);
