export {
  AssemblerError,
  isAssemblerError,
  toAssemblerError,
  type AssemblerErrorOptions,
  type ErrorCode,
} from './errors.js';
export {
  createLogger,
  Logger,
  MemoryLogSink,
  redact,
  redactString,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type LoggerOptions,
} from './logger.js';
export {
  configSchema,
  CONFIG_FILENAME,
  loadConfig,
  resolvePaths,
  type AssemblerConfig,
  type DeepPartialConfig,
  type LoadedConfig,
  type LoadConfigOptions,
  type PackageManagerName,
  type ResolvedPaths,
} from './config.js';
export { contentHash, sha256, stableStringify } from './hash.js';
export { deterministicId, randomId } from './ids.js';
export {
  findCaseCollisions,
  isWithin,
  normalizeRelativePath,
  resolveWithin,
  toSafeName,
  type PathValidationOptions,
} from './fs/path-safety.js';
export {
  FileSystemService,
  type CaseSensitivity,
  type FileDigest,
  type ListOptions,
  type WriteOptions,
} from './fs/fs-service.js';
export {
  formatCommandLine,
  ProcessRunner,
  quoteForCmd,
  type ProcessResult,
  type ProcessRunnerOptions,
  type ProcessSpec,
} from './process/process-runner.js';
export {
  fromJsonColumn,
  nowIso,
  openDatabase,
  checkIntegrity,
  toJsonColumn,
  type SqlDatabase,
  type SqlValue,
} from './db/database.js';
export {
  currentVersion,
  migrate,
  MIGRATIONS,
  type Migration,
  type MigrationResult,
} from './db/migrations.js';
export { HttpClient, assertPublicUrl, type HttpRequestOptions, type HttpResponse } from './http.js';
export { createWorkspace, type CreateWorkspaceOptions, type Workspace } from './workspace.js';
