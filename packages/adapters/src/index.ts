export {
  ADAPTER_ENVIRONMENT_ERROR_CODE,
  AdapterEnvironmentError,
  assertLocalAdapterEnvironment,
  isLocalAdapterEnvironment,
  type AdapterEnvironmentGuardReason,
} from "./environment.js";
export { LOCAL_ADAPTER_ENVIRONMENTS, type LocalAdapterEnvironment } from "./types.js";
export {
  DEFAULT_IN_REPO_MAIL_CAPTURE_DIR,
  DEFAULT_IN_REPO_STORAGE_DIR,
  DEFAULT_MAIL_CAPTURE_RECORD_DAYS,
  DEFAULT_MAIL_CAPTURE_RETENTION_DAYS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_SCANNER_SIMULATED_SCENARIO,
  SCANNER_SIMULATED_SCENARIOS,
  formatLocalAdaptersConfigProblems,
  loadLocalAdaptersConfig,
  type LocalAdaptersConfig,
  type LocalAdaptersConfigOptions,
  type LocalAdaptersConfigProblem,
  type LocalAdaptersConfigProblemCode,
  type LocalAdaptersConfigResult,
  type ScannerSimulatedScenario,
} from "./config.js";
