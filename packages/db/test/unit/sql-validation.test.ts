import { describe, expect, it } from "vitest";
import {
  MigrationSqlError,
  splitStatements,
  validateMigrationSql,
} from "../../src/sql-validation.js";

function problem(source: string): MigrationSqlError {
  try {
    validateMigrationSql(source);
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationSqlError);
    return error as MigrationSqlError;
  }
  throw new Error("se esperaba un rechazo");
}

describe("acepta funciones, triggers y bloques con BEGIN … END", () => {
  it("función PL/pgSQL con BEGIN, END, IF y bucles dentro de la cadena con dólar", () => {
    const source = `
      CREATE FUNCTION guard() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE n integer;
      BEGIN
        IF NEW.x IS NULL THEN
          RAISE EXCEPTION 'falta x';
        END IF;
        FOR n IN 1 .. 3 LOOP
          PERFORM n;
        END LOOP;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER t BEFORE UPDATE ON tabla FOR EACH ROW EXECUTE FUNCTION guard();`;
    expect(() => {
      validateMigrationSql(source);
    }).not.toThrow();
    expect(splitStatements(source).map((statement) => statement.words.slice(0, 2))).toEqual([
      ["create", "function"],
      ["create", "trigger"],
    ]);
  });

  it("cadenas con etiqueta que contienen $$, punto y coma y la palabra COMMIT", () => {
    const source = `
      CREATE OR REPLACE FUNCTION f() RETURNS text LANGUAGE plpgsql AS $body$
      BEGIN
        RETURN '$$; COMMIT;';
      END;
      $body$;
      SELECT 1;`;
    expect(() => {
      validateMigrationSql(source);
    }).not.toThrow();
    expect(splitStatements(source)).toHaveLength(2);
  });

  it("bloque DO con BEGIN … END", () => {
    expect(() => {
      validateMigrationSql("DO $$ BEGIN PERFORM 1; END $$;");
    }).not.toThrow();
  });

  it("cuerpo SQL estándar BEGIN ATOMIC … END con CASE, seguido de otra sentencia", () => {
    const source = `
      CREATE FUNCTION g(x integer) RETURNS integer LANGUAGE sql
      BEGIN ATOMIC
        SELECT CASE WHEN x > 0 THEN 1 ELSE 0 END;
        SELECT x;
      END;
      CREATE TABLE despues (id integer);`;
    expect(() => {
      validateMigrationSql(source);
    }).not.toThrow();
    const statements = splitStatements(source);
    expect(statements).toHaveLength(2);
    expect(statements[1]?.words.slice(0, 2)).toEqual(["create", "table"]);
  });

  it("las palabras de control dentro de literales, comentarios e identificadores no cuentan", () => {
    const source = `
      -- COMMIT;
      /* comentario /* anidado */ ROLLBACK; */
      CREATE TABLE t (
        "commit" text DEFAULT 'commit; begin;',
        nota text DEFAULT E'it\\'s; COMMIT',
        otra text DEFAULT U&'end; \\0041'
      );`;
    expect(() => {
      validateMigrationSql(source);
    }).not.toThrow();
    expect(splitStatements(source)).toHaveLength(1);
  });
});

describe("rechaza sentencias que cerrarían la transacción del ejecutor", () => {
  it.each([
    ["COMMIT;", "commit"],
    ["commit and chain;", "commit"],
    ["BEGIN;", "begin"],
    ["START TRANSACTION;", "start"],
    ["END;", "end"],
    ["ROLLBACK;", "rollback"],
    ["ABORT;", "abort"],
    ["SAVEPOINT s;", "savepoint"],
    ["RELEASE SAVEPOINT s;", "release"],
    ["PREPARE TRANSACTION 'x';", "prepare"],
    ["/* nota */ CoMmIt;", "commit"],
  ])("%s", (statement) => {
    expect(problem(`CREATE TABLE t (id integer);\n${statement}`).code).toBe("TRANSACTION_CONTROL");
  });

  it("un COMMIT después de una función con BEGIN ATOMIC", () => {
    const error = problem(`
      CREATE FUNCTION g() RETURNS integer LANGUAGE sql BEGIN ATOMIC SELECT 1; END;
      COMMIT;`);
    expect(error.code).toBe("TRANSACTION_CONTROL");
    expect(error.line).toBe(3);
  });

  it("un COMMIT en la misma línea que otra sentencia", () => {
    expect(problem("CREATE TABLE a (id integer); COMMIT; CREATE TABLE b (id integer);").code).toBe(
      "TRANSACTION_CONTROL",
    );
  });

  it("BEGIN sin ATOMIC no abre un cuerpo: el COMMIT siguiente se detecta", () => {
    // Una función llamada begin no debe ocultar el COMMIT que sigue.
    const error = problem(
      "CREATE FUNCTION begin() RETURNS integer LANGUAGE sql AS 'SELECT 1';\nCOMMIT;",
    );
    expect(error.code).toBe("TRANSACTION_CONTROL");
  });
});

describe("rechaza sentencias que no pueden ir dentro de la transacción", () => {
  it.each([
    "CREATE INDEX CONCURRENTLY i ON t (id);",
    "CREATE UNIQUE INDEX CONCURRENTLY i ON t (id);",
    "DROP INDEX CONCURRENTLY i;",
    "REINDEX TABLE CONCURRENTLY t;",
    "VACUUM t;",
    "CREATE DATABASE otra;",
    "DROP DATABASE otra;",
    "ALTER SYSTEM SET work_mem = '64MB';",
  ])("%s", (statement) => {
    expect(problem(statement).code).toBe("NOT_ALLOWED_IN_TRANSACTION");
  });

  it("un índice normal se acepta", () => {
    expect(() => {
      validateMigrationSql("CREATE UNIQUE INDEX i ON t (id) WHERE activo;");
    }).not.toThrow();
  });
});

describe("rechaza archivos con elementos sin cerrar", () => {
  it.each([
    ["literal", "SELECT 'sin cerrar;"],
    ["identificador", 'SELECT "sin cerrar;'],
    ["cadena con dólar", "DO $x$ BEGIN END; COMMIT;"],
    ["comentario", "/* sin cerrar COMMIT;"],
  ])("%s", (_kind, source) => {
    expect(problem(source).code).toBe("UNTERMINATED_TOKEN");
  });
});

describe("las migraciones del repositorio", () => {
  it("separa sentencias y reporta la línea donde empieza cada una", () => {
    const statements = splitStatements("SELECT 1;\n\n-- nota\nSELECT\n  2;");
    expect(statements.map((statement) => statement.line)).toEqual([1, 4]);
  });
});
