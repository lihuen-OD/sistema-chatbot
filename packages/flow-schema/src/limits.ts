/**
 * Límites de complejidad de la DSL v1 (ADR-003, ADR-012, ADR-014). Son valores iniciales:
 * cambiarlos exige actualizar el ADR, las pruebas y la trazabilidad.
 */
export const FLOW_LIMITS = {
  nodes: 100,
  variables: 30,
  staticOptions: 10,
  dynamicOptions: 10,
  conditionBranches: 10,
  predicatesPerBranch: 4,
  valuesPerList: 50,
  /** Valores de una variable enum. Igual a valuesPerList: un `in` puede nombrar a todos. */
  enumValues: 50,
  automaticTransitionsPerEvent: 20,
} as const;

export const RULE_LIMITS = {
  contextVariables: 4,
  combinations: 1000,
  rules: 200,
  conditionsPerRule: 4,
  valuesPerList: 50,
  /** Valores de una variable de contexto enum. Igual a valuesPerList. */
  enumValues: 50,
  groupsPerRule: 5,
  recipientsPerDelivery: 20,
} as const;

/**
 * Adjuntos seleccionados y confirmados por envío (ADR-007, ADR-014). No es el cupo de candidatos
 * del trámite: ese cupo lo aplica el host en P2 y una definición no puede configurarlo.
 */
export const ATTACHMENTS_PER_SEND = 1;

export const MAX_FILE_BYTES = 10_485_760;

export const ALLOWED_MIME_TYPES: readonly string[] = ["application/pdf", "image/jpeg", "image/png"];

/** Variables reservadas del texto de revisión del paso documental (ADR-014). */
export const REVIEW_VARIABLES: readonly string[] = ["fileName", "fileType", "fileSize"];

/** Nombres que una definición no puede declarar como variables. */
export const RESERVED_VARIABLE_NAMES: readonly string[] = [...REVIEW_VARIABLES, "employeeId"];

/** Cotas estructurales genéricas. Los límites propios del canal se verifican en P6 (ADR-003). */
export const TEXT_MAX_LENGTH = 4096;
export const LABEL_MAX_LENGTH = 100;
export const SUBJECT_MAX_LENGTH = 200;
