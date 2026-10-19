import { z } from "zod";
import { LABEL_MAX_LENGTH, TEXT_MAX_LENGTH } from "../limits.js";

/** Identificadores estables en inglés y snake_case (ADR-009). */
export const idSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/** Nombres de variable en camelCase (ADR-009). */
export const variableNameSchema = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/);

/** Valores de enumeraciones y referencias a catálogo. */
export const valueSchema = z.string().min(1).max(64);

export const textSchema = z.string().min(1).max(TEXT_MAX_LENGTH);

export const labelSchema = z.string().min(1).max(LABEL_MAX_LENGTH);

/** Teléfono en formato E.164 (ADR-011). */
export const e164PhoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/);

/** Identificador de usuario de negocio de WhatsApp: valor opaco; su formato real se verifica en P6. */
export const bsuidValueSchema = z.string().min(1).max(128);
