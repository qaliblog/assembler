/**
 * Logging with redaction and structured context.
 *
 * Logs are a first-class artefact: every diagnostic and assembly record points at
 * log lines. Secrets are redacted before any sink sees them.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const SECRET_KEY_PATTERN =
  /(pass(word)?|secret|token|api[-_]?key|authorization|credential|private[-_]?key|cookie)/i;

/** Values that look like credentials, independent of the key they appear under. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-+/=]{10,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

export function redactString(input: string): string {
  let out = input;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

/**
 * Deep-redact a record. Keys matching the secret pattern have their values
 * replaced; strings are additionally scrubbed for credential-shaped substrings.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(entry, depth + 1);
  }
  return out;
}

export interface LogRecord {
  readonly time: string;
  readonly level: Exclude<LogLevel, 'silent'>;
  readonly message: string;
  readonly scope?: string;
  readonly context?: Record<string, unknown>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly scope?: string;
  readonly sink?: LogSink;
  /** Injectable clock so log output is reproducible in tests. */
  readonly now?: () => Date;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly scope?: string;
  private readonly sink: LogSink;
  private readonly now: () => Date;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.scope = options.scope;
    this.sink = options.sink ?? { write: (record) => defaultWrite(record) };
    this.now = options.now ?? (() => new Date());
  }

  child(scope: string, context?: Record<string, unknown>): Logger {
    const parent = this;
    return new Logger({
      level: this.level,
      scope: this.scope ? `${this.scope}:${scope}` : scope,
      now: this.now,
      sink: {
        write(record) {
          parent.sink.write(
            context === undefined ? record : { ...record, context: { ...context, ...record.context } },
          );
        },
      },
    });
  }

  withContext(context: Record<string, unknown>): Logger {
    const parent = this;
    return new Logger({
      level: this.level,
      scope: this.scope,
      now: this.now,
      sink: {
        write(record) {
          parent.sink.write({ ...record, context: { ...context, ...record.context } });
        },
      },
    });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit('error', message, context);
  }

  isEnabled(level: Exclude<LogLevel, 'silent'>): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private emit(level: Exclude<LogLevel, 'silent'>, message: string, context?: Record<string, unknown>): void {
    if (!this.isEnabled(level)) return;
    const record: LogRecord = {
      time: this.now().toISOString(),
      level,
      message: redactString(message),
      ...(this.scope === undefined ? {} : { scope: this.scope }),
      ...(context === undefined ? {} : { context: redact(context) as Record<string, unknown> }),
    };
    this.sink.write(record);
  }
}

function defaultWrite(record: LogRecord): void {
  const prefix = record.scope === undefined ? '' : `[${record.scope}] `;
  const suffix =
    record.context === undefined || Object.keys(record.context).length === 0
      ? ''
      : ` ${JSON.stringify(record.context)}`;
  const line = `${record.time} ${record.level.toUpperCase()} ${prefix}${record.message}${suffix}`;
  if (record.level === 'error' || record.level === 'warn') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

/** Collects records in memory. Used by tests and by structured CLI output. */
export class MemoryLogSink implements LogSink {
  readonly records: LogRecord[] = [];

  write(record: LogRecord): void {
    this.records.push(record);
  }

  messages(level?: Exclude<LogLevel, 'silent'>): string[] {
    return this.records.filter((r) => level === undefined || r.level === level).map((r) => r.message);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}
