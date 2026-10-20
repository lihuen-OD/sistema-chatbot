// Validación de los archivos de migración antes de ejecutarlos (plan de P1-T3, §5.7).
//
// El Migrator de Kysely aplica todas las migraciones pendientes en una sola transacción. Una
// sentencia de control de transacciones de nivel superior (por ejemplo COMMIT) la cerraría antes de
// tiempo y dejaría una migración aplicada a medias. Para detectarlas sin buscar palabras sueltas,
// un analizador léxico separa las sentencias de nivel superior respetando:
// - literales ('…', E'…' con escapes, U&'…') e identificadores entre comillas dobles;
// - comentarios de línea y de bloque, incluidos los anidados;
// - cadenas con dólar ($$…$$, $tag$…$tag$), donde viven los cuerpos PL/pgSQL con BEGIN … END;
// - paréntesis y cuerpos BEGIN ATOMIC … END de funciones y procedimientos SQL, cuyos punto y coma
//   no terminan la sentencia (misma regla que psql, restringida a BEGIN seguido de ATOMIC).

export type MigrationSqlProblemCode =
  "UNTERMINATED_TOKEN" | "TRANSACTION_CONTROL" | "NOT_ALLOWED_IN_TRANSACTION";

export class MigrationSqlError extends Error {
  readonly code: MigrationSqlProblemCode;
  /** Línea (desde 1) donde empieza el problema. */
  readonly line: number;

  constructor(code: MigrationSqlProblemCode, line: number, message: string) {
    super(`Línea ${String(line)}: ${message}`);
    this.name = "MigrationSqlError";
    this.code = code;
    this.line = line;
  }
}

export interface SqlStatement {
  /** Línea (desde 1) donde empieza la sentencia. */
  readonly line: number;
  /** Palabras de nivel superior en minúsculas: sin literales, comentarios ni identificadores entre comillas. */
  readonly words: readonly string[];
}

const IDENTIFIER_START = /[A-Za-z_\u0080-￿]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$\u0080-￿]/;
const DOLLAR_QUOTE_TAG = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;
const WHITESPACE = /\s/;

/** Separa un archivo SQL en sentencias de nivel superior. */
export function splitStatements(source: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let words: string[] = [];
  let startLine = 0;
  let line = 1;
  let parenDepth = 0;
  let atomicDepth = 0;
  let index = 0;

  const markContent = (): void => {
    if (startLine === 0) startLine = line;
  };
  const finishStatement = (): void => {
    if (startLine !== 0) statements.push({ line: startLine, words });
    words = [];
    startLine = 0;
    parenDepth = 0;
    atomicDepth = 0;
  };
  const skipTo = (end: number): void => {
    for (let position = index; position < end; position++) {
      if (source[position] === "\n") line++;
    }
    index = end;
  };

  while (index < source.length) {
    const char = source.charAt(index);
    const next = source.charAt(index + 1);

    if (char === "\n") {
      line++;
      index++;
    } else if (WHITESPACE.test(char)) {
      index++;
    } else if (char === "-" && next === "-") {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
    } else if (char === "/" && next === "*") {
      skipTo(blockCommentEnd(source, index, line));
    } else if (char === "'") {
      markContent();
      skipTo(quotedEnd(source, index, "'", false, line));
    } else if (char === '"') {
      markContent();
      skipTo(quotedEnd(source, index, '"', false, line));
    } else if (char === "$") {
      markContent();
      DOLLAR_QUOTE_TAG.lastIndex = index;
      const tag = DOLLAR_QUOTE_TAG.exec(source)?.[0];
      if (tag === undefined) {
        index++;
      } else {
        const close = source.indexOf(tag, index + tag.length);
        if (close === -1) throw unterminated(line, `cadena con dólar ${tag}`);
        skipTo(close + tag.length);
      }
    } else if (IDENTIFIER_START.test(char)) {
      let end = index + 1;
      while (end < source.length && IDENTIFIER_PART.test(source.charAt(end))) end++;
      const word = source.slice(index, end).toLowerCase();
      markContent();
      if (word === "e" && source.charAt(end) === "'") {
        index = end;
        skipTo(quotedEnd(source, index, "'", true, line));
      } else if (
        word === "u" &&
        source.charAt(end) === "&" &&
        /['"]/.test(source.charAt(end + 1))
      ) {
        index = end + 1;
        const quote = source.charAt(index);
        skipTo(quotedEnd(source, index, quote, false, line));
      } else {
        const previous = words.at(-1);
        words.push(word);
        if (parenDepth === 0 && isRoutineDefinition(words)) {
          if (word === "atomic" && previous === "begin") atomicDepth++;
          else if (word === "case" && atomicDepth > 0) atomicDepth++;
          else if (word === "end" && atomicDepth > 0) atomicDepth--;
        }
        index = end;
      }
    } else if (char === "(") {
      markContent();
      parenDepth++;
      index++;
    } else if (char === ")") {
      markContent();
      if (parenDepth > 0) parenDepth--;
      index++;
    } else if (char === ";") {
      if (parenDepth === 0 && atomicDepth === 0) finishStatement();
      index++;
    } else {
      markContent();
      index++;
    }
  }
  finishStatement();
  return statements;
}

/**
 * Rechaza sentencias de nivel superior que cerrarían la transacción del ejecutor o que no pueden
 * ejecutarse dentro de una transacción. Los bloques BEGIN … END dentro de funciones, triggers y
 * DO quedan en sus cadenas con dólar y se aceptan.
 */
export function validateMigrationSql(source: string): void {
  for (const statement of splitStatements(source)) {
    const problem = classify(statement.words);
    if (problem !== undefined)
      throw new MigrationSqlError(problem.code, statement.line, problem.message);
  }
}

const TRANSACTION_CONTROL_FIRST_WORDS = new Set([
  "begin",
  "commit",
  "end",
  "rollback",
  "abort",
  "savepoint",
  "release",
]);

function classify(
  words: readonly string[],
): { code: MigrationSqlProblemCode; message: string } | undefined {
  const [first, second, third] = words;
  if (first === undefined) return undefined;

  if (
    TRANSACTION_CONTROL_FIRST_WORDS.has(first) ||
    ((first === "start" || first === "prepare") && second === "transaction")
  ) {
    return {
      code: "TRANSACTION_CONTROL",
      message: `${first.toUpperCase()} controla transacciones y cerraría la transacción del ejecutor de migraciones.`,
    };
  }

  const createOrDrop = first === "create" || first === "drop";
  const isIndexStatement =
    (createOrDrop && second === "index") ||
    (first === "create" && second === "unique" && third === "index") ||
    first === "reindex";
  if (
    first === "vacuum" ||
    (first === "alter" && second === "system") ||
    (createOrDrop && (second === "database" || second === "tablespace")) ||
    (first === "reindex" && (second === "database" || second === "system")) ||
    (isIndexStatement && words.includes("concurrently"))
  ) {
    return {
      code: "NOT_ALLOWED_IN_TRANSACTION",
      message: `La sentencia ${words.slice(0, 3).join(" ").toUpperCase()} no puede ejecutarse dentro de la transacción de migraciones.`,
    };
  }
  return undefined;
}

function isRoutineDefinition(words: readonly string[]): boolean {
  const [first, second, third, fourth] = words;
  if (first !== "create") return false;
  if (second === "function" || second === "procedure") return true;
  return (
    second === "or" && third === "replace" && (fourth === "function" || fourth === "procedure")
  );
}

/** Índice siguiente al cierre de un literal o identificador entre comillas que empieza en `start`. */
function quotedEnd(
  source: string,
  start: number,
  quote: string,
  backslashEscapes: boolean,
  line: number,
): number {
  let position = start + 1;
  while (position < source.length) {
    const char = source.charAt(position);
    if (backslashEscapes && char === "\\") {
      position += 2;
    } else if (char === quote) {
      if (source.charAt(position + 1) === quote) position += 2;
      else return position + 1;
    } else {
      position++;
    }
  }
  throw unterminated(line, quote === "'" ? "literal de texto" : "identificador entre comillas");
}

/** Índice siguiente al cierre de un comentario de bloque, contando los anidados. */
function blockCommentEnd(source: string, start: number, line: number): number {
  let depth = 0;
  let position = start;
  while (position < source.length) {
    if (source.startsWith("/*", position)) {
      depth++;
      position += 2;
    } else if (source.startsWith("*/", position)) {
      depth--;
      position += 2;
      if (depth === 0) return position;
    } else {
      position++;
    }
  }
  throw unterminated(line, "comentario de bloque");
}

function unterminated(line: number, what: string): MigrationSqlError {
  return new MigrationSqlError("UNTERMINATED_TOKEN", line, `${what} sin cerrar.`);
}
