import { indexDirectory, type DirectoryIndex } from "./directory.js";
import { enumValueSet } from "./enum-values.js";
import {
  createIssue,
  type IssueCode,
  type IssueExtras,
  type IssuePath,
  type ValidationIssue,
} from "./issues.js";
import {
  ALLOWED_MIME_TYPES,
  ATTACHMENTS_PER_SEND,
  FLOW_LIMITS,
  MAX_FILE_BYTES,
  RESERVED_VARIABLE_NAMES,
  REVIEW_VARIABLES,
  RULE_LIMITS,
} from "./limits.js";
import type { Directory } from "./schemas/directory.js";
import type {
  FlowDefinition,
  FlowNode,
  Predicate,
  VariableDefinition,
  VariableType,
} from "./schemas/flow.js";
import type { RuleSet } from "./schemas/rule-set.js";
import { containsTemplateSyntax, lineBreakPosition, parseTemplate } from "./templates.js";

export interface FlowValidationContext {
  readonly directory: Directory;
  readonly ruleSets: readonly RuleSet[];
}

type NodeOf<T extends FlowNode["type"]> = Extract<FlowNode, { type: T }>;
type Scalar = string | boolean;

interface Edge {
  readonly from: string;
  readonly to: string;
  readonly assigns: boolean;
}

interface VariableUse {
  readonly nodeId: string;
  readonly variable: string;
  readonly path: IssuePath;
}

const FINITE_TYPES: ReadonlySet<VariableType> = new Set([
  "enum",
  "boolean",
  "companyRef",
  "documentTypeRef",
]);
const RENDERABLE_TYPES: ReadonlySet<VariableType> = new Set([
  "enum",
  "string",
  "date",
  "boolean",
  "companyRef",
  "documentTypeRef",
]);
const INPUT_NODE_TYPES: ReadonlySet<FlowNode["type"]> = new Set(["selection", "capture", "file"]);
const AUTOMATIC_NODE_TYPES: ReadonlySet<FlowNode["type"]> = new Set([
  "start",
  "message",
  "condition",
]);
const ORDER_OPERATORS: ReadonlySet<Predicate["operator"]> = new Set(["lt", "lte", "gt", "gte"]);
const LIST_OPERATORS: ReadonlySet<Predicate["operator"]> = new Set(["in", "notIn"]);

/**
 * Validación semántica de una definición de flujo ya validada estructuralmente (ADR-003,
 * ADR-012, ADR-014). Requiere el directorio y los conjuntos de reglas con los que se publicaría.
 */
export function validateFlowDefinition(
  flow: FlowDefinition,
  context: FlowValidationContext,
): ValidationIssue[] {
  return new FlowValidator(flow, context).run();
}

class FlowValidator {
  private readonly flow: FlowDefinition;
  private readonly context: FlowValidationContext;
  private readonly dir: DirectoryIndex;
  private readonly issues: ValidationIssue[] = [];
  private readonly uses: VariableUse[] = [];
  private readonly nodesById = new Map<string, { node: FlowNode; index: number }>();
  private readonly adjacency = new Map<string, Edge[]>();

  constructor(flow: FlowDefinition, context: FlowValidationContext) {
    this.flow = flow;
    this.context = context;
    this.dir = indexDirectory(context.directory);
  }

  run(): ValidationIssue[] {
    // Una definición que excede los límites de tamaño se rechaza antes de cualquier análisis:
    // los recorridos del grafo y la disjunción de ramas crecen con el tamaño de la entrada.
    if (!this.checkSizeLimits()) return this.issues;
    this.checkVariables();
    this.indexNodes();
    const entryValid = this.checkEntry();
    this.collectEdges();
    this.flow.nodes.forEach((node, index) => {
      this.checkNode(node, index);
    });

    const hasCycle = this.checkCycles();
    if (entryValid) {
      const reachable = this.reachableFrom(this.flow.entryNodeId);
      this.flow.nodes.forEach((node, index) => {
        if (!reachable.has(node.id)) {
          this.report("UNREACHABLE_NODE", "El nodo no es alcanzable desde el inicio.", index, [], {
            nodeId: node.id,
          });
        }
      });
      if (!hasCycle) this.checkDefinedVariables(reachable);
    }
    if (!hasCycle) {
      this.checkNoCaptureBetweenFileAndEmail();
      this.checkSingleEmailPerConfirmation();
      this.checkAutomaticTransitions();
    }
    return this.issues;
  }

  // --- Estructura global -------------------------------------------------------------------

  /**
   * Límites de tamaño de ADR-003. Primero los totales, sin recorrer colecciones que ya los
   * exceden, y después los de cada variable y cada nodo. Devuelve false si alguno se supera.
   */
  private checkSizeLimits(): boolean {
    const before = this.issues.length;
    if (this.flow.nodes.length > FLOW_LIMITS.nodes) {
      this.limit(["nodes"], undefined, "nodes", this.flow.nodes.length);
    }
    const variableCount = Object.keys(this.flow.variables).length;
    if (variableCount > FLOW_LIMITS.variables) {
      this.limit(["variables"], undefined, "variables", variableCount);
    }
    if (this.issues.length > before) return false;

    // Solo se lee la longitud: una lista excedida no se recorre.
    for (const [name, definition] of Object.entries(this.flow.variables)) {
      if (definition.type === "enum" && definition.values.length > FLOW_LIMITS.enumValues) {
        this.limit(
          ["variables", name, "values"],
          undefined,
          "enumValues",
          definition.values.length,
        );
      }
    }

    this.flow.nodes.forEach((node, index) => {
      if (node.type === "selection" && node.options !== undefined) {
        if (node.options.length > FLOW_LIMITS.staticOptions) {
          this.limit(["nodes", index, "options"], node.id, "staticOptions", node.options.length);
        }
      }
      if (node.type !== "condition") return;
      if (node.branches.length > FLOW_LIMITS.conditionBranches) {
        this.limit(
          ["nodes", index, "branches"],
          node.id,
          "conditionBranches",
          node.branches.length,
        );
        return;
      }
      node.branches.forEach((branch, b) => {
        const branchPath = ["nodes", index, "branches", b, "all"];
        if (branch.all.length > FLOW_LIMITS.predicatesPerBranch) {
          this.limit(branchPath, node.id, "predicatesPerBranch", branch.all.length);
        }
        branch.all.forEach((predicate, p) => {
          if (
            Array.isArray(predicate.value) &&
            predicate.value.length > FLOW_LIMITS.valuesPerList
          ) {
            this.limit(
              [...branchPath, p, "value"],
              node.id,
              "valuesPerList",
              predicate.value.length,
            );
          }
        });
      });
    });
    return this.issues.length === before;
  }

  private checkVariables(): void {
    for (const [name, definition] of Object.entries(this.flow.variables)) {
      if (RESERVED_VARIABLE_NAMES.includes(name)) {
        this.add("VARIABLE_NAME_RESERVED", `"${name}" es un nombre reservado.`, [
          "variables",
          name,
        ]);
      }
      if (definition.type === "enum") {
        const values = definition.values;
        if (values.length === 0 || new Set(values).size !== values.length) {
          this.add(
            "ENUM_VALUES_INVALID",
            "La enumeración debe tener valores no vacíos y sin repetir.",
            ["variables", name, "values"],
          );
        }
      }
    }
  }

  private indexNodes(): void {
    this.flow.nodes.forEach((node, index) => {
      if (this.nodesById.has(node.id)) {
        this.report("DUPLICATE_ID", `El identificador "${node.id}" está repetido.`, index, ["id"]);
        return;
      }
      this.nodesById.set(node.id, { node, index });
    });
  }

  private checkEntry(): boolean {
    const starts = this.flow.nodes.flatMap((node, index) => (node.type === "start" ? [index] : []));
    if (starts.length === 0) {
      this.add("START_NODE_MISSING", "El flujo no tiene un nodo de inicio.", ["nodes"]);
    }
    for (const index of starts.slice(1)) {
      this.report("START_NODE_DUPLICATE", "El flujo tiene más de un nodo de inicio.", index, []);
    }
    const entry = this.nodesById.get(this.flow.entryNodeId);
    if (entry?.node.type !== "start") {
      this.add(
        "ENTRY_NODE_INVALID",
        "entryNodeId debe referenciar el nodo de inicio.",
        ["entryNodeId"],
        { details: { entryNodeId: this.flow.entryNodeId } },
      );
      return false;
    }
    return true;
  }

  // --- Salidas -----------------------------------------------------------------------------

  private collectEdges(): void {
    this.flow.nodes.forEach((node, index) => {
      for (const exit of exitsOf(node)) {
        if (exit.target === undefined) {
          if (exit.required) {
            this.report("MISSING_TARGET", "Falta la salida de este paso.", index, exit.field);
          }
          continue;
        }
        if (!this.nodesById.has(exit.target)) {
          this.report(
            "UNKNOWN_TARGET",
            `La salida apunta a "${exit.target}", que no existe.`,
            index,
            exit.field,
            { details: { target: exit.target } },
          );
          continue;
        }
        const edges = this.adjacency.get(node.id) ?? [];
        edges.push({ from: node.id, to: exit.target, assigns: exit.assigns });
        this.adjacency.set(node.id, edges);
      }
    });
  }

  // --- Nodos -------------------------------------------------------------------------------

  private checkNode(node: FlowNode, index: number): void {
    switch (node.type) {
      case "start":
      case "end":
        return;
      case "message":
        this.checkTemplate(node.text, index, ["text"], false);
        return;
      case "selection":
        this.checkSelection(node, index);
        return;
      case "capture":
        this.checkCapture(node, index);
        return;
      case "condition":
        this.checkCondition(node, index);
        return;
      case "file":
        this.checkFile(node, index);
        return;
      case "email":
        this.checkEmail(node, index);
        return;
    }
  }

  private checkSelection(node: NodeOf<"selection">, index: number): void {
    this.checkTemplate(node.text, index, ["text"], false);
    const definition = this.declared(node.variable, index, ["variable"]);
    if (definition !== undefined && !FINITE_TYPES.has(definition.type)) {
      this.report(
        "VARIABLE_TYPE_MISMATCH",
        "Una selección solo asigna variables enum, boolean, companyRef o documentTypeRef.",
        index,
        ["variable"],
        { details: { actual: definition.type } },
      );
    }

    const isStatic = node.options !== undefined;
    const isDynamic = node.optionsSource !== undefined;
    if (isStatic === isDynamic) {
      this.report(
        "SELECTION_OPTIONS_INVALID",
        "La selección debe declarar options u optionsSource, no ambos ni ninguno.",
        index,
        [],
        { details: { reason: isStatic ? "BOTH" : "NEITHER" } },
      );
    }

    if (node.options !== undefined) {
      const dynamicFields = (["next", "onEmpty", "maxOptions", "autoSelectSingle"] as const).filter(
        (field) => node[field] !== undefined,
      );
      if (dynamicFields.length > 0 && !isDynamic) {
        this.report(
          "SELECTION_OPTIONS_INVALID",
          "Una selección estática no usa next, onEmpty, maxOptions ni autoSelectSingle.",
          index,
          [],
          { details: { reason: "STATIC_WITH_DYNAMIC_FIELDS", fields: dynamicFields } },
        );
      }
      if (node.options.length === 0) {
        this.report(
          "SELECTION_OPTIONS_INVALID",
          "La selección no tiene opciones.",
          index,
          ["options"],
          {
            details: { reason: "EMPTY" },
          },
        );
      }
      const optionIds = new Set<string>();
      node.options.forEach((option, i) => {
        if (optionIds.has(option.id)) {
          this.report("DUPLICATE_ID", `El identificador "${option.id}" está repetido.`, index, [
            "options",
            i,
            "id",
          ]);
        }
        optionIds.add(option.id);
        this.checkPlainText(option.label, index, ["options", i, "label"]);
        if (definition !== undefined && FINITE_TYPES.has(definition.type)) {
          this.checkOptionValue(definition, option.value, index, ["options", i, "value"]);
        }
      });
    }

    if (node.optionsSource !== undefined) {
      this.checkDynamicOptions(node, node.optionsSource, definition, index);
    }
  }

  private checkDynamicOptions(
    node: NodeOf<"selection">,
    source: NonNullable<NodeOf<"selection">["optionsSource"]>,
    definition: VariableDefinition | undefined,
    index: number,
  ): void {
    const expectedType = source.kind === "AUTHORIZED_COMPANIES" ? "companyRef" : "documentTypeRef";
    if (definition !== undefined && definition.type !== expectedType) {
      this.report(
        "DYNAMIC_SOURCE_INVALID",
        `La fuente ${source.kind} solo asigna variables ${expectedType}.`,
        index,
        ["optionsSource", "kind"],
        { details: { reason: "VARIABLE_TYPE", expected: expectedType, actual: definition.type } },
      );
    }
    if (source.companyVariable !== undefined) {
      if (source.kind !== "DOCUMENT_TYPES") {
        this.report(
          "DYNAMIC_SOURCE_INVALID",
          "companyVariable solo se usa con la fuente DOCUMENT_TYPES.",
          index,
          ["optionsSource", "companyVariable"],
          { details: { reason: "COMPANY_VARIABLE_NOT_ALLOWED" } },
        );
      } else {
        const path = ["optionsSource", "companyVariable"];
        const companyDefinition = this.declared(source.companyVariable, index, path);
        if (companyDefinition !== undefined && companyDefinition.type !== "companyRef") {
          this.report(
            "DYNAMIC_SOURCE_INVALID",
            "companyVariable debe ser una variable companyRef.",
            index,
            path,
            { details: { reason: "COMPANY_VARIABLE_TYPE", actual: companyDefinition.type } },
          );
        } else if (companyDefinition !== undefined) {
          this.use(node.id, source.companyVariable, ["nodes", index, ...path]);
        }
      }
    }

    if (node.maxOptions === undefined) {
      this.report(
        "SELECTION_OPTIONS_INVALID",
        "Una selección dinámica debe declarar maxOptions.",
        index,
        ["maxOptions"],
        { details: { reason: "MAX_OPTIONS_REQUIRED" } },
      );
      return;
    }
    if (node.maxOptions > FLOW_LIMITS.dynamicOptions) {
      this.report(
        "DYNAMIC_OPTIONS_LIMIT_EXCEEDED",
        "maxOptions supera el límite de opciones del canal.",
        index,
        ["maxOptions"],
        {
          details: {
            reason: "CHANNEL_LIMIT",
            max: FLOW_LIMITS.dynamicOptions,
            actual: node.maxOptions,
          },
        },
      );
      return;
    }
    const upperBound = this.dynamicUpperBound(source);
    if (upperBound > node.maxOptions) {
      this.report(
        "DYNAMIC_OPTIONS_LIMIT_EXCEEDED",
        "El catálogo vigente puede producir más opciones que maxOptions.",
        index,
        ["maxOptions"],
        { details: { reason: "UPPER_BOUND", upperBound, maxOptions: node.maxOptions } },
      );
    }
  }

  private dynamicUpperBound(source: NonNullable<NodeOf<"selection">["optionsSource"]>): number {
    if (source.kind === "AUTHORIZED_COMPANIES") return this.dir.activeCompanyIds.length;
    if (source.companyVariable === undefined) return this.dir.activeDocumentTypeIds.length;
    if (this.dir.activeCompanyIds.length === 0) return 0;

    // Lineal en tipos y empresas: el directorio no tiene límite de tamaño (sin spread ni filtros
    // por empresa, que fallan o se degradan con directorios grandes).
    let unrestricted = 0;
    const restrictedByCompany = new Map<string, number>();
    for (const id of this.dir.activeDocumentTypeIds) {
      const type = this.dir.documentTypes.get(id);
      if (type === undefined) continue;
      if (type.companyIds === undefined) {
        unrestricted++;
        continue;
      }
      for (const companyId of new Set(type.companyIds)) {
        restrictedByCompany.set(companyId, (restrictedByCompany.get(companyId) ?? 0) + 1);
      }
    }
    let largest = 0;
    for (const companyId of this.dir.activeCompanyIds) {
      largest = Math.max(largest, restrictedByCompany.get(companyId) ?? 0);
    }
    return unrestricted + largest;
  }

  private checkOptionValue(
    definition: VariableDefinition,
    value: Scalar,
    index: number,
    path: IssuePath,
  ): void {
    const reason = this.domainProblem(definition, value);
    const inactive =
      reason === undefined &&
      typeof value === "string" &&
      ((definition.type === "companyRef" && this.dir.companies.get(value)?.active === false) ||
        (definition.type === "documentTypeRef" &&
          this.dir.documentTypes.get(value)?.active === false));
    if (reason !== undefined || inactive) {
      this.report(
        "VALUE_OUT_OF_DOMAIN",
        "El valor de la opción no pertenece al dominio vigente de la variable.",
        index,
        path,
        { details: { reason: reason ?? "INACTIVE", value } },
      );
    }
  }

  private checkCapture(node: NodeOf<"capture">, index: number): void {
    this.checkTemplate(node.text, index, ["text"], false);
    const definition = this.declared(node.variable, index, ["variable"]);
    if (definition === undefined) return;
    if (definition.type !== "string" && definition.type !== "date") {
      this.report(
        "VARIABLE_TYPE_MISMATCH",
        "Una captura solo asigna variables string o date.",
        index,
        ["variable"],
        { details: { actual: definition.type } },
      );
    } else if (definition.type === "date" && node.maxLength !== undefined) {
      this.report(
        "VARIABLE_TYPE_MISMATCH",
        "maxLength solo se usa con variables string.",
        index,
        ["maxLength"],
        { details: { actual: definition.type } },
      );
    }
  }

  private checkCondition(node: NodeOf<"condition">, index: number): void {
    const branchIds = new Set<string>();
    let invalidPredicates = 0;

    node.branches.forEach((branch, b) => {
      if (branchIds.has(branch.id)) {
        this.report("DUPLICATE_ID", `El identificador "${branch.id}" está repetido.`, index, [
          "branches",
          b,
          "id",
        ]);
      }
      branchIds.add(branch.id);
      for (const [p, predicate] of branch.all.entries()) {
        const path = ["branches", b, "all", p];
        if (!this.checkPredicate(node.id, predicate, index, path)) invalidPredicates++;
      }
    });

    if (invalidPredicates === 0) this.checkDisjointBranches(node, index);
  }

  /** Devuelve false si el predicado no es evaluable (para no sumar ruido en la disjunción). */
  private checkPredicate(
    nodeId: string,
    predicate: Predicate,
    index: number,
    path: (string | number)[],
  ): boolean {
    const definition = this.declared(predicate.variable, index, [...path, "variable"]);
    if (definition === undefined) return false;

    const operatorProblem = operatorProblemFor(definition.type, predicate);
    if (operatorProblem !== undefined) {
      this.report(
        "CONDITION_OPERATOR_INVALID",
        `El operador "${predicate.operator}" no es válido para esta variable o valor.`,
        index,
        [...path, "operator"],
        { details: { reason: operatorProblem, type: definition.type } },
      );
      return false;
    }
    if (predicate.operator !== "exists") {
      this.use(nodeId, predicate.variable, ["nodes", index, ...path, "variable"]);
    }

    const values =
      predicate.value === undefined
        ? []
        : Array.isArray(predicate.value)
          ? predicate.value
          : [predicate.value];
    let valid = true;
    values.forEach((value, v) => {
      const reason = this.domainProblem(definition, value);
      if (reason !== undefined) {
        valid = false;
        const valuePath = Array.isArray(predicate.value)
          ? [...path, "value", v]
          : [...path, "value"];
        this.report(
          "VALUE_OUT_OF_DOMAIN",
          "El valor no pertenece al dominio de la variable.",
          index,
          valuePath,
          { details: { reason, value } },
        );
      }
    });
    return valid;
  }

  /**
   * Las ramas deben ser disjuntas. Se recorre el dominio de las variables finitas; los
   * predicados sobre variables no finitas o `exists` se consideran posiblemente verdaderos,
   * así que lo que no puede demostrarse disjunto se rechaza (ADR-003).
   */
  private checkDisjointBranches(node: NodeOf<"condition">, index: number): void {
    const finiteVariables = [
      ...new Set(
        node.branches.flatMap((branch) =>
          branch.all
            .filter((predicate) => predicate.operator !== "exists")
            .map((predicate) => predicate.variable)
            .filter((name) => {
              const type = this.variable(name)?.type;
              return type !== undefined && FINITE_TYPES.has(type);
            }),
        ),
      ),
    ];
    const domains = finiteVariables.map((name) => this.finiteDomain(name));
    const combinations = domains.reduce((product, domain) => product * domain.length, 1);
    if (combinations > RULE_LIMITS.combinations) {
      this.report(
        "CONDITION_BRANCHES_OVERLAP",
        "El dominio es demasiado grande para demostrar que las ramas son disjuntas.",
        index,
        ["branches"],
        { details: { reason: "DOMAIN_TOO_LARGE", combinations } },
      );
      return;
    }
    const assignments = cartesian(finiteVariables, domains);
    for (let j = 1; j < node.branches.length; j++) {
      for (let i = 0; i < j; i++) {
        const first = node.branches[i];
        const second = node.branches[j];
        if (first === undefined || second === undefined) continue;
        const overlaps = assignments.some(
          (assignment) =>
            branchMayHold(first.all, assignment) && branchMayHold(second.all, assignment),
        );
        if (overlaps) {
          this.report(
            "CONDITION_BRANCHES_OVERLAP",
            `La rama "${second.id}" puede coincidir con "${first.id}".`,
            index,
            ["branches", j],
            { details: { reason: "NOT_PROVABLY_DISJOINT", overlapsWith: first.id } },
          );
        }
      }
    }
  }

  private checkFile(node: NodeOf<"file">, index: number): void {
    this.checkTemplate(node.text, index, ["text"], false);
    const definition = this.declared(node.variable, index, ["variable"]);
    if (definition !== undefined && definition.type !== "documentRefList") {
      this.report(
        "VARIABLE_TYPE_MISMATCH",
        "El paso documental asigna una variable documentRefList.",
        index,
        ["variable"],
        { details: { actual: definition.type } },
      );
    }
    node.allowedMimeTypes.forEach((mimeType, i) => {
      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        this.report(
          "FILE_FORMAT_NOT_ALLOWED",
          "V1 solo admite PDF, JPG y PNG.",
          index,
          ["allowedMimeTypes", i],
          { details: { mimeType, allowed: ALLOWED_MIME_TYPES } },
        );
      }
    });
    if (node.maxBytes > MAX_FILE_BYTES) {
      this.report(
        "FILE_SIZE_LIMIT_EXCEEDED",
        "El tamaño máximo supera 10 MB.",
        index,
        ["maxBytes"],
        {
          details: { max: MAX_FILE_BYTES, actual: node.maxBytes },
        },
      );
    }
    // Un adjunto seleccionado por envío. No confundir con el cupo de candidatos del trámite.
    for (const field of ["minCount", "maxCount"] as const) {
      if (node[field] !== ATTACHMENTS_PER_SEND) {
        this.report(
          "FILE_ATTACHMENT_COUNT_INVALID",
          "V1 admite exactamente un adjunto seleccionado por envío.",
          index,
          [field],
          { details: { expected: ATTACHMENTS_PER_SEND, actual: node[field] } },
        );
      }
    }
    if (node.review === undefined) {
      this.report(
        "FILE_REVIEW_MISSING",
        "El paso documental exige revisión y confirmación del empleado (ADR-014).",
        index,
        ["review"],
      );
      return;
    }
    this.checkTemplate(node.review.text, index, ["review", "text"], true);
    for (const field of ["confirmLabel", "replaceLabel", "cancelLabel"] as const) {
      this.checkPlainText(node.review[field], index, ["review", field]);
    }
  }

  private checkEmail(node: NodeOf<"email">, index: number): void {
    // El asunto va a una cabecera: CR o LF permitirían inyectar cabeceras. Valida la plantilla;
    // el renderizado y el adaptador de correo deben volver a validar el asunto ya interpolado.
    const lineBreak = lineBreakPosition(node.subject);
    if (lineBreak !== -1) {
      this.report(
        "EMAIL_SUBJECT_LINE_BREAK",
        "El asunto no admite saltos de línea (CR o LF).",
        index,
        ["subject"],
        { details: { position: lineBreak } },
      );
    }
    this.checkTemplate(node.subject, index, ["subject"], false);
    this.checkTemplate(node.body, index, ["body"], false);

    const documentDefinition = this.declared(node.documentVariable, index, ["documentVariable"]);
    if (documentDefinition !== undefined) {
      if (documentDefinition.type === "documentRefList") {
        this.use(node.id, node.documentVariable, ["nodes", index, "documentVariable"]);
      } else {
        this.report(
          "VARIABLE_TYPE_MISMATCH",
          "documentVariable debe ser una variable documentRefList.",
          index,
          ["documentVariable"],
          { details: { actual: documentDefinition.type } },
        );
      }
    }

    const seen = new Set<string>();
    node.contextVariables.forEach((name, i) => {
      const path = ["contextVariables", i];
      if (seen.has(name)) {
        this.report(
          "EMAIL_CONTEXT_MISMATCH",
          `"${name}" está repetida en contextVariables.`,
          index,
          path,
          {
            details: { reason: "DUPLICATE", variable: name },
          },
        );
      }
      seen.add(name);
      if (this.declared(name, index, path) !== undefined) {
        this.use(node.id, name, ["nodes", index, ...path]);
      }
    });

    const ruleSet = this.context.ruleSets.find(
      (candidate) => candidate.ruleSetId === node.ruleSetId,
    );
    if (ruleSet === undefined) {
      this.report(
        "RULE_SET_NOT_FOUND",
        `El conjunto de reglas "${node.ruleSetId}" no existe o su estructura no es válida.`,
        index,
        ["ruleSetId"],
        { details: { ruleSetId: node.ruleSetId } },
      );
      return;
    }
    for (const name of Object.keys(ruleSet.contextVariables)) {
      if (!seen.has(name)) {
        this.report(
          "EMAIL_CONTEXT_MISMATCH",
          `Falta la variable de contexto "${name}" que exige el conjunto de reglas.`,
          index,
          ["contextVariables"],
          { details: { reason: "MISSING", variable: name } },
        );
      }
    }
    node.contextVariables.forEach((name, i) => {
      const path = ["contextVariables", i];
      if (!Object.hasOwn(ruleSet.contextVariables, name)) {
        this.report(
          "EMAIL_CONTEXT_MISMATCH",
          `"${name}" no es una variable de contexto del conjunto de reglas.`,
          index,
          path,
          { details: { reason: "UNEXPECTED", variable: name } },
        );
        return;
      }
      const expected = ruleSet.contextVariables[name];
      const actual = this.variable(name);
      if (expected === undefined || actual === undefined) return;
      if (expected.type !== actual.type) {
        this.report(
          "EMAIL_CONTEXT_MISMATCH",
          `El tipo de "${name}" no coincide con el del conjunto de reglas.`,
          index,
          path,
          {
            details: {
              reason: "TYPE",
              variable: name,
              expected: expected.type,
              actual: actual.type,
            },
          },
        );
      } else if (
        expected.type === "enum" &&
        actual.type === "enum" &&
        !actual.values.every((value) => enumValueSet(expected.values).has(value))
      ) {
        this.report(
          "EMAIL_CONTEXT_MISMATCH",
          `Los valores de "${name}" no están todos en el dominio del conjunto de reglas.`,
          index,
          path,
          { details: { reason: "ENUM_VALUES", variable: name } },
        );
      }
    });
  }

  // --- Plantillas --------------------------------------------------------------------------

  private checkTemplate(
    text: string,
    index: number,
    field: IssuePath,
    allowReviewVariables: boolean,
  ): void {
    const parsed = parseTemplate(text);
    if (!parsed.ok) {
      this.report("TEMPLATE_SYNTAX_INVALID", "La plantilla no es válida.", index, field, {
        details: { position: parsed.position },
      });
      return;
    }
    const nodeId = this.flow.nodes[index]?.id ?? "";
    for (const name of parsed.variables) {
      if (REVIEW_VARIABLES.includes(name)) {
        if (!allowReviewVariables) {
          this.report(
            "TEMPLATE_RESERVED_VARIABLE_MISUSE",
            `{{${name}}} solo se usa en el texto de revisión del paso documental.`,
            index,
            field,
            { details: { variable: name } },
          );
        }
        continue;
      }
      const definition = this.variable(name);
      if (definition === undefined) {
        this.report(
          "TEMPLATE_VARIABLE_UNKNOWN",
          `{{${name}}} no es una variable declarada.`,
          index,
          field,
          {
            details: { variable: name },
          },
        );
      } else if (!RENDERABLE_TYPES.has(definition.type)) {
        this.report(
          "TEMPLATE_VARIABLE_NOT_RENDERABLE",
          `{{${name}}} no puede mostrarse como texto.`,
          index,
          field,
          { details: { variable: name, type: definition.type } },
        );
      } else {
        this.use(nodeId, name, ["nodes", index, ...field]);
      }
    }
  }

  private checkPlainText(text: string, index: number, field: IssuePath): void {
    if (containsTemplateSyntax(text)) {
      this.report("TEMPLATE_NOT_ALLOWED", "Este campo no admite plantillas.", index, field);
    }
  }

  // --- Grafo -------------------------------------------------------------------------------

  private checkCycles(): boolean {
    const state = new Map<string, "visiting" | "done">();
    const reported = new Set<string>();
    const visit = (id: string): void => {
      state.set(id, "visiting");
      for (const edge of this.adjacency.get(id) ?? []) {
        const targetState = state.get(edge.to);
        if (targetState === "visiting") {
          if (!reported.has(edge.to)) {
            reported.add(edge.to);
            const target = this.nodesById.get(edge.to);
            if (target !== undefined) {
              this.report(
                "CYCLE_DETECTED",
                "El flujo contiene un ciclo; V1 no los admite.",
                target.index,
                [],
                {
                  details: { from: edge.from },
                },
              );
            }
          }
        } else if (targetState === undefined) {
          visit(edge.to);
        }
      }
      state.set(id, "done");
    };
    for (const id of this.nodesById.keys()) if (!state.has(id)) visit(id);
    return reported.size > 0;
  }

  private reachableFrom(start: string): Set<string> {
    const reached = new Set<string>([start]);
    const pending = [start];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      for (const edge of this.adjacency.get(id) ?? []) {
        if (!reached.has(edge.to)) {
          reached.add(edge.to);
          pending.push(edge.to);
        }
      }
    }
    return reached;
  }

  /** Flujo de datos sobre el DAG: una variable está definida si se asigna en todos los caminos. */
  private checkDefinedVariables(reachable: ReadonlySet<string>): void {
    const order = this.topologicalOrder(this.flow.entryNodeId);
    const definedIn = new Map<string, Set<string>>([[this.flow.entryNodeId, new Set()]]);
    for (const id of order) {
      const incoming = definedIn.get(id) ?? new Set<string>();
      const node = this.nodesById.get(id)?.node;
      for (const edge of this.adjacency.get(id) ?? []) {
        const outgoing = new Set(incoming);
        const assigned = node === undefined ? undefined : assignedVariable(node);
        if (edge.assigns && assigned !== undefined) outgoing.add(assigned);
        const current = definedIn.get(edge.to);
        definedIn.set(
          edge.to,
          current === undefined
            ? outgoing
            : new Set([...current].filter((name) => outgoing.has(name))),
        );
      }
    }
    for (const use of this.uses) {
      if (!reachable.has(use.nodeId)) continue;
      if (definedIn.get(use.nodeId)?.has(use.variable) === true) continue;
      this.add(
        "VARIABLE_POSSIBLY_UNDEFINED",
        `"${use.variable}" puede no estar definida en todos los caminos que llegan a este paso.`,
        use.path,
        { nodeId: use.nodeId, details: { variable: use.variable } },
      );
    }
  }

  private topologicalOrder(start: string): string[] {
    const visited = new Set<string>();
    const postOrder: string[] = [];
    const visit = (id: string): void => {
      visited.add(id);
      for (const edge of this.adjacency.get(id) ?? []) if (!visited.has(edge.to)) visit(edge.to);
      postOrder.push(id);
    };
    visit(start);
    return postOrder.reverse();
  }

  /** ADR-014: entre el paso documental y el correo que adjunta su documento no se capturan datos. */
  private checkNoCaptureBetweenFileAndEmail(): void {
    const reach = new Map<string, Set<string>>();
    const reachOf = (id: string): Set<string> => {
      const cached = reach.get(id);
      if (cached !== undefined) return cached;
      const result = new Set<string>();
      reach.set(id, result);
      for (const edge of this.adjacency.get(id) ?? []) {
        result.add(edge.to);
        for (const next of reachOf(edge.to)) result.add(next);
      }
      return result;
    };

    for (const { node: file } of this.nodesById.values()) {
      if (file.type !== "file") continue;
      const fromFile = reachOf(file.id);
      for (const { node: email } of this.nodesById.values()) {
        if (email.type !== "email" || email.documentVariable !== file.variable) continue;
        if (!fromFile.has(email.id)) continue;
        for (const id of fromFile) {
          const entry = this.nodesById.get(id);
          if (entry === undefined || id === email.id) continue;
          if (!INPUT_NODE_TYPES.has(entry.node.type) || !reachOf(id).has(email.id)) continue;
          this.report(
            "CAPTURE_BETWEEN_FILE_AND_EMAIL",
            "No puede haber pasos que capturen datos entre el paso documental y su correo.",
            entry.index,
            [],
            { details: { fileNodeId: file.id, emailNodeId: email.id } },
          );
        }
      }
    }
  }

  /**
   * ADR-014: la identidad de cada envío deriva de su confirmación, y cada confirmación habilita un
   * solo envío. En ningún camino puede haber dos correos con el mismo documento sin un paso
   * documental intermedio sobre esa variable, que produce una confirmación nueva. Se consideran
   * ejecutables todos los caminos del grafo: no se evalúa la satisfacibilidad conjunta de las
   * condiciones.
   */
  private checkSingleEmailPerConfirmation(): void {
    const reported = new Set<string>();
    for (const { node: first } of this.nodesById.values()) {
      if (first.type !== "email") continue;
      const variable = first.documentVariable;
      const visited = new Set<string>();
      const pending = (this.adjacency.get(first.id) ?? []).map((edge) => edge.to);
      for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
        if (visited.has(id)) continue;
        visited.add(id);
        const entry = this.nodesById.get(id);
        if (entry === undefined) continue;
        const current = entry.node;
        if (current.type === "file" && current.variable === variable) continue;
        if (current.type === "email" && current.documentVariable === variable) {
          if (!reported.has(current.id)) {
            reported.add(current.id);
            this.report(
              "CONFIRMATION_REUSED",
              `Este correo usaría la misma confirmación que "${first.id}": cada confirmación habilita un solo envío.`,
              entry.index,
              [],
              { details: { documentVariable: variable, previousEmailNodeId: first.id } },
            );
          }
          continue;
        }
        for (const edge of this.adjacency.get(id) ?? []) pending.push(edge.to);
      }
    }
  }

  private checkAutomaticTransitions(): void {
    const memo = new Map<string, number>();
    const chain = (id: string): number => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      let longest = 0;
      for (const edge of this.adjacency.get(id) ?? []) {
        const target = this.nodesById.get(edge.to)?.node;
        const continues = target !== undefined && AUTOMATIC_NODE_TYPES.has(target.type);
        longest = Math.max(longest, 1 + (continues ? chain(edge.to) : 0));
      }
      memo.set(id, longest);
      return longest;
    };
    let longest = 0;
    for (const id of this.nodesById.keys()) longest = Math.max(longest, chain(id));
    if (longest > FLOW_LIMITS.automaticTransitionsPerEvent) {
      this.limit(["nodes"], undefined, "automaticTransitionsPerEvent", longest);
    }
  }

  // --- Variables y dominios ----------------------------------------------------------------

  private variable(name: string): VariableDefinition | undefined {
    return Object.hasOwn(this.flow.variables, name) ? this.flow.variables[name] : undefined;
  }

  private declared(name: string, index: number, field: IssuePath): VariableDefinition | undefined {
    const definition = this.variable(name);
    if (definition === undefined) {
      this.report("UNDECLARED_VARIABLE", `La variable "${name}" no está declarada.`, index, field, {
        details: { variable: name },
      });
    }
    return definition;
  }

  private use(nodeId: string, variable: string, path: IssuePath): void {
    this.uses.push({ nodeId, variable, path });
  }

  private domainProblem(definition: VariableDefinition, value: Scalar): string | undefined {
    switch (definition.type) {
      case "enum":
        return typeof value === "string" && enumValueSet(definition.values).has(value)
          ? undefined
          : "NOT_IN_ENUM";
      case "boolean":
        return typeof value === "boolean" ? undefined : "NOT_BOOLEAN";
      case "companyRef":
        return typeof value === "string" && this.dir.companies.has(value)
          ? undefined
          : "UNKNOWN_COMPANY";
      case "documentTypeRef":
        return typeof value === "string" && this.dir.documentTypes.has(value)
          ? undefined
          : "UNKNOWN_DOCUMENT_TYPE";
      case "string":
        return typeof value === "string" ? undefined : "NOT_STRING";
      case "date":
        return typeof value === "string" && isIsoDate(value) ? undefined : "NOT_ISO_DATE";
      case "documentRefList":
        return "NOT_COMPARABLE";
    }
  }

  private finiteDomain(name: string): readonly Scalar[] {
    const definition = this.variable(name);
    switch (definition?.type) {
      case "enum":
        return definition.values;
      case "boolean":
        return [true, false];
      case "companyRef":
        return [...this.dir.companies.keys()];
      case "documentTypeRef":
        return [...this.dir.documentTypes.keys()];
      default:
        return [];
    }
  }

  // --- Informe -----------------------------------------------------------------------------

  private add(code: IssueCode, message: string, path: IssuePath, extras: IssueExtras = {}): void {
    this.issues.push(createIssue(code, message, path, extras));
  }

  private report(
    code: IssueCode,
    message: string,
    index: number,
    field: IssuePath,
    extras: IssueExtras = {},
  ): void {
    this.add(code, message, ["nodes", index, ...field], {
      nodeId: extras.nodeId ?? this.flow.nodes[index]?.id,
      details: extras.details,
    });
  }

  private limit(
    path: IssuePath,
    nodeId: string | undefined,
    limit: keyof typeof FLOW_LIMITS,
    actual: number,
  ): void {
    this.add("FLOW_LIMIT_EXCEEDED", `Se supera el límite "${limit}".`, path, {
      nodeId,
      details: { limit, max: FLOW_LIMITS[limit], actual },
    });
  }
}

interface Exit {
  readonly field: (string | number)[];
  readonly target: string | undefined;
  readonly required: boolean;
  readonly assigns: boolean;
}

function exitsOf(node: FlowNode): Exit[] {
  switch (node.type) {
    case "start":
    case "message":
    case "email":
      return [{ field: ["next"], target: node.next, required: true, assigns: false }];
    case "capture":
    case "file":
      return [{ field: ["next"], target: node.next, required: true, assigns: true }];
    case "selection": {
      const exits: Exit[] = [];
      node.options?.forEach((option, i) => {
        exits.push({
          field: ["options", i, "next"],
          target: option.next,
          required: true,
          assigns: true,
        });
      });
      if (node.optionsSource !== undefined) {
        exits.push({ field: ["next"], target: node.next, required: true, assigns: true });
        exits.push({ field: ["onEmpty"], target: node.onEmpty, required: true, assigns: false });
      }
      return exits;
    }
    case "condition":
      return [
        ...node.branches.map((branch, i) => ({
          field: ["branches", i, "next"],
          target: branch.next,
          required: true,
          assigns: false,
        })),
        { field: ["else"], target: node.else, required: true, assigns: false },
      ];
    case "end":
      return [];
  }
}

function assignedVariable(node: FlowNode): string | undefined {
  switch (node.type) {
    case "selection":
    case "capture":
    case "file":
      return node.variable;
    default:
      return undefined;
  }
}

function operatorProblemFor(type: VariableType, predicate: Predicate): string | undefined {
  const { operator, value } = predicate;
  if (operator === "exists") return value === undefined ? undefined : "EXISTS_WITHOUT_VALUE";
  if (type === "documentRefList") return "TYPE_ONLY_SUPPORTS_EXISTS";
  if (ORDER_OPERATORS.has(operator) && type !== "date") return "ORDER_ONLY_FOR_DATE";
  if (LIST_OPERATORS.has(operator)) {
    if (type === "boolean" || type === "date") return "LIST_NOT_SUPPORTED_FOR_TYPE";
    return Array.isArray(value) && value.length > 0 ? undefined : "LIST_VALUE_REQUIRED";
  }
  return value !== undefined && !Array.isArray(value) ? undefined : "SCALAR_VALUE_REQUIRED";
}

function branchMayHold(
  predicates: readonly Predicate[],
  assignment: ReadonlyMap<string, Scalar>,
): boolean {
  return predicates.every((predicate) => {
    const actual = assignment.get(predicate.variable);
    if (actual === undefined || predicate.operator === "exists") return true;
    const value = predicate.value;
    switch (predicate.operator) {
      case "eq":
        return actual === value;
      case "neq":
        return actual !== value;
      case "in":
        return Array.isArray(value) && value.includes(actual);
      case "notIn":
        return Array.isArray(value) && !value.includes(actual);
      default:
        return true;
    }
  });
}

function cartesian(
  names: readonly string[],
  domains: readonly (readonly Scalar[])[],
): ReadonlyMap<string, Scalar>[] {
  let result: Map<string, Scalar>[] = [new Map<string, Scalar>()];
  names.forEach((name, i) => {
    const domain = domains[i] ?? [];
    result = result.flatMap((partial) =>
      domain.map((value) => new Map<string, Scalar>(partial).set(name, value)),
    );
  });
  return result;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
