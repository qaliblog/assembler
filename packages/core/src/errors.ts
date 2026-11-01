/**
 * Stable, machine-readable error codes.
 *
 * Every failure surfaced by Assembler carries a code so callers, tests and the
 * CLI can branch on it without string matching. Codes are grouped by subsystem.
 */
export type ErrorCode =
  // configuration / usage
  | 'CONFIG_INVALID'
  | 'USAGE_ERROR'
  // filesystem
  | 'PATH_ESCAPE'
  | 'PATH_INVALID'
  | 'FILE_EXISTS'
  | 'FILE_MISSING'
  | 'FS_IO_ERROR'
  | 'SYMLINK_ESCAPE'
  // process execution
  | 'EXECUTABLE_NOT_FOUND'
  | 'PROCESS_FAILED'
  | 'PROCESS_TIMEOUT'
  | 'PROCESS_SPAWN_ERROR'
  // environment
  | 'CAPABILITY_UNSATISFIED'
  | 'CAPABILITY_UNKNOWN'
  | 'INSTALLATION_REFUSED'
  // specification / planning
  | 'SPEC_INVALID'
  | 'SPEC_CONTRADICTION'
  | 'SPEC_INCOMPLETE'
  | 'UNSUPPORTED_CAPABILITY'
  | 'PLAN_INVALID'
  // registry
  | 'REGISTRY_ENTRY_MISSING'
  | 'REGISTRY_ENTRY_INVALID'
  | 'REGISTRY_DUPLICATE'
  | 'REGISTRY_VERIFICATION_FAILED'
  // assembly
  | 'MANIFEST_VIOLATION'
  | 'ASSEMBLY_FAILED'
  | 'OVERWRITE_DENIED'
  | 'IMPORT_GRAPH_INVALID'
  // modification of an existing generated project
  | 'NOT_GENERATED_PROJECT'
  | 'PROJECT_INVALID'
  | 'MODIFICATION_UNSUPPORTED'
  | 'MODIFICATION_CONFLICT'
  | 'MODIFICATION_BLOCKED'
  | 'MODIFICATION_VERIFICATION_FAILED'
  | 'MODIFICATION_FAILED'
  | 'DEPENDENCIES_MISSING'
  | 'BACKUP_FAILED'
  | 'PAGE_EXISTS'
  // diagnostics / repair
  | 'DIAGNOSTIC_INVALID'
  | 'REPAIR_NOT_APPLICABLE'
  | 'REPAIR_FAILED'
  | 'ROLLBACK_FAILED'
  // storage
  | 'DATABASE_ERROR'
  | 'MIGRATION_FAILED'
  // internal
  | 'INTERNAL_ERROR'
  | 'CANCELLED';

export interface AssemblerErrorOptions {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
  /** Whether retrying the same operation could plausibly succeed. */
  readonly retryable?: boolean;
  /** Actionable next step shown to the user. */
  readonly hint?: string;
}

export class AssemblerError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;
  readonly hint?: string;

  constructor(options: AssemblerErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AssemblerError';
    this.code = options.code;
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? false;
    if (options.hint !== undefined) {
      this.hint = options.hint;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      hint: this.hint,
    };
  }
}

export function isAssemblerError(value: unknown): value is AssemblerError {
  return value instanceof AssemblerError;
}

/** Wrap any thrown value into an AssemblerError without losing the original. */
export function toAssemblerError(
  value: unknown,
  fallback: { code: ErrorCode; message: string; hint?: string },
): AssemblerError {
  if (isAssemblerError(value)) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new AssemblerError({
    code: fallback.code,
    message: fallback.message ? `${fallback.message}: ${message}` : message,
    cause: value,
    ...(fallback.hint === undefined ? {} : { hint: fallback.hint }),
  });
}
