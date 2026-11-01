/**
 * Minimal structured logger. One JSON object per line on stdout/stderr so log
 * collectors can parse it; no timestamps are written into generated files.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Readonly<Record<string, string | number | boolean | null | undefined>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly silent?: boolean;
  readonly now?: () => Date;
  readonly write?: (line: string, level: LogLevel) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVEL_ORDER[options.level ?? 'info'];
  const now = options.now ?? (() => new Date());
  const write =
    options.write ??
    ((line: string, level: LogLevel): void => {
      if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
    });

  const log = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (options.silent === true || LEVEL_ORDER[level] < threshold) return;
    write(
      JSON.stringify({
        level,
        time: now().toISOString(),
        message,
        ...fields,
      }),
      level,
    );
  };

  return {
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
  };
}

export const silentLogger: Logger = createLogger({ silent: true });
