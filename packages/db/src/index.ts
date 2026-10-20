export { openDatabase } from "./connection.js";
export { loadLocalEnv, ROOT_ENV_FILE } from "./env.js";
export type { DB } from "./generated/database.js";
export {
  assertTemporaryDatabaseName,
  CLUSTER_MARKER,
  DatabaseGuardError,
  DEVELOPMENT_DATABASE,
  DEVELOPMENT_ROLE,
  developmentTarget,
  LOCAL_DATABASE_PORT,
  poolConfig,
  TEMPORARY_DATABASE_PATTERN,
  temporaryDatabaseName,
  temporaryTarget,
  TEST_ADMIN_DATABASE,
  TEST_ROLE,
  testAdminTarget,
  verifyClusterMarker,
  type ConnectionPurpose,
  type ConnectionTarget,
  type GuardErrorCode,
} from "./guards.js";
export {
  CHECKSUM_TABLE,
  MIGRATION_CONTROL_TABLES,
  MigrationIntegrityError,
  migrationFile,
  MIGRATIONS_DIRECTORY,
  readMigrationFiles,
  runMigrations,
  type MigrationFile,
  type MigrationIntegrityCode,
  type MigrationRunOptions,
  type MigrationRunResult,
} from "./migrator.js";
export { newRunId, TemporaryDatabases } from "./temporary-databases.js";
export {
  MigrationSqlError,
  splitStatements,
  validateMigrationSql,
  type MigrationSqlProblemCode,
  type SqlStatement,
} from "./sql-validation.js";
