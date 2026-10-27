// Punto de entrada público del paquete (ADR-001, plan de P1-T5 §4). Solo exports con
// implementación: los puertos con implementación local real, y las fábricas que ya
// existen. El mantenimiento con consumidores detenidos tendrá su punto de entrada
// separado (`@sistema-chatbot/adapters/maintenance`) en su propio bloque.
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
export {
  LOCAL_PRIVATE_FOLDER_KIND,
  OBJECT_KEY_PATTERN,
  STORAGE_WRITE_PHASES,
  EmptyObjectError,
  InvalidObjectKeyError,
  ObjectNotFoundError,
  ObjectTooLargeError,
  StorageClosedError,
  StorageIntegrityError,
  StorageWriteError,
  UncertainPublicationError,
  isBeforePublishWrite,
  type OpenedObject,
  type ObjectStorage,
  type PublishedObjectState,
  type PutObjectOptions,
  type StorageIntegrityReason,
  type StorageWritePhase,
  type StoredObject,
  type UncertainPublicationResolution,
} from "./ports/storage.js";
export {
  CAPTURE_ID_PATTERN,
  LOCAL_CAPTURE_KIND,
  CaptureClosedError,
  CaptureIntegrityError,
  CaptureKeyBusyError,
  CaptureNotFoundError,
  CaptureWriteError,
  InvalidCaptureIdError,
  type CaptureIntegrityReason,
  type CapturePurgeReport,
  type CaptureWritePhase,
  type CapturedEmail,
  type CapturedMessage,
  type EmailCapturedResult,
  type EmailRejectedResult,
  type EmailRejectionReason,
  type EmailSendResult,
  type EmailSender,
  type OutgoingAttachment,
  type OutgoingEmail,
} from "./ports/email.js";
export {
  createLocalCaptureEmailSender,
  type CaptureCleanupReport,
  type CaptureCloseReport,
  type CaptureMaintenanceEvent,
  type LocalCaptureEmailSenderOptions,
} from "./local/capture-email-sender.js";
export { CAPTURE_LOCK_WAIT } from "./local/capture-key-lock.js";
export {
  STORAGE_ABSOLUTE_MAX_FILE_BYTES,
  createLocalPrivateFolderStorage,
  type PrivateFolderStorageOptions,
  type StorageCloseReport,
  type StorageMaintenanceEvent,
} from "./local/private-folder-storage.js";
