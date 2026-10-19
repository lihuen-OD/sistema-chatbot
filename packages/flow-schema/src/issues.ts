/**
 * Códigos estables de validación. Un código no cambia aunque cambie su mensaje (ADR-009).
 * Agregar o quitar un código exige actualizar las pruebas y la documentación del paquete.
 */
export const ISSUE_CODES = [
  "STRUCTURE_INVALID",
  "SCHEMA_VERSION_UNSUPPORTED",
  "DUPLICATE_ID",
  "START_NODE_MISSING",
  "START_NODE_DUPLICATE",
  "ENTRY_NODE_INVALID",
  "MISSING_TARGET",
  "UNKNOWN_TARGET",
  "UNREACHABLE_NODE",
  "CYCLE_DETECTED",
  "UNDECLARED_VARIABLE",
  "VARIABLE_NAME_RESERVED",
  "VARIABLE_TYPE_MISMATCH",
  "VARIABLE_POSSIBLY_UNDEFINED",
  "ENUM_VALUES_INVALID",
  "VALUE_OUT_OF_DOMAIN",
  "SELECTION_OPTIONS_INVALID",
  "DYNAMIC_SOURCE_INVALID",
  "DYNAMIC_OPTIONS_LIMIT_EXCEEDED",
  "FLOW_LIMIT_EXCEEDED",
  "CONDITION_OPERATOR_INVALID",
  "CONDITION_BRANCHES_OVERLAP",
  "FILE_REVIEW_MISSING",
  "FILE_ATTACHMENT_COUNT_INVALID",
  "FILE_FORMAT_NOT_ALLOWED",
  "FILE_SIZE_LIMIT_EXCEEDED",
  "CAPTURE_BETWEEN_FILE_AND_EMAIL",
  "CONFIRMATION_REUSED",
  "RULE_SET_NOT_FOUND",
  "EMAIL_CONTEXT_MISMATCH",
  "EMAIL_SUBJECT_LINE_BREAK",
  "TEMPLATE_SYNTAX_INVALID",
  "TEMPLATE_VARIABLE_UNKNOWN",
  "TEMPLATE_VARIABLE_NOT_RENDERABLE",
  "TEMPLATE_RESERVED_VARIABLE_MISUSE",
  "TEMPLATE_NOT_ALLOWED",
  "RULE_CONTEXT_INVALID",
  "RULE_CONDITION_INVALID",
  "RULE_LIMIT_EXCEEDED",
  "RULE_COVERAGE_GAP",
  "RULE_OVERLAP",
  "REVIEW_ONLY_INVALID",
  "RECIPIENT_GROUP_NOT_FOUND",
  "RECIPIENT_GROUP_NOT_AUTHORIZED",
  "RECIPIENT_GROUP_EMPTY",
  "RECIPIENT_NOT_AUTHORIZED",
  "DIRECTORY_REFERENCE_INVALID",
  "IDENTITY_ACTIVE_DUPLICATE",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

export function isIssueCode(value: unknown): value is IssueCode {
  return typeof value === "string" && (ISSUE_CODES as readonly string[]).includes(value);
}

/** Ruta JSON dentro del documento validado, por ejemplo `["nodes", 3, "next"]`. */
export type IssuePath = readonly (string | number)[];

export interface ValidationIssue {
  readonly code: IssueCode;
  /** Texto para personas, en español. Puede cambiar; el código no. */
  readonly message: string;
  readonly path: IssuePath;
  /** Nodo del flujo involucrado, cuando el problema pertenece a un nodo. */
  readonly nodeId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface IssueExtras {
  readonly nodeId?: string | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export function createIssue(
  code: IssueCode,
  message: string,
  path: IssuePath,
  extras: IssueExtras = {},
): ValidationIssue {
  return {
    code,
    message,
    path,
    ...(extras.nodeId === undefined ? {} : { nodeId: extras.nodeId }),
    ...(extras.details === undefined ? {} : { details: extras.details }),
  };
}
