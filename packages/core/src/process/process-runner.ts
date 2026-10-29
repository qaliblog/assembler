/**
 * Cross-platform subprocess execution.
 *
 * Rules enforced here:
 *  - arguments are always passed as an array, never interpolated into a command
 *    string (the only exception is a Windows `.cmd`/`.bat` shim, which requires
 *    `cmd.exe`, and there every argument is quoted by us);
 *  - output is captured with a hard cap and the truncation is recorded;
 *  - a timeout and an AbortSignal are both supported and reported distinctly;
 *  - the exact executable, arguments and working directory are recorded so a
 *    diagnostic can be reproduced.
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { AssemblerError } from '../errors.js';
import type { Logger } from '../logger.js';

export interface ProcessSpec {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** Written to stdin and closed. Never logged. */
  readonly stdin?: string;
  /** When true, `env` replaces the inherited environment instead of merging. */
  readonly replaceEnv?: boolean;
}

export interface ProcessResult {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  /** Set when the process could not be spawned at all. */
  readonly spawnError: AssemblerError | null;
  readonly commandLine: string;
}

export interface ProcessRunnerOptions {
  readonly logger?: Logger;
  readonly defaultTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** Injected platform, so Windows behaviour can be unit-tested on Linux. */
  readonly platform?: NodeJS.Platform;
}

const WINDOWS_SHIM = /\.(cmd|bat)$/i;

/** Quote one argument for `cmd.exe`. Documented, conservative subset. */
export function quoteForCmd(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg;
  const escaped = arg.replace(/(["\\])/g, '\\$1').replace(/([&|<>^()%!])/g, '^$1');
  return `"${escaped}"`;
}

export function formatCommandLine(executable: string, args: readonly string[]): string {
  const quote = (value: string): string => (/[\s"'$`\\]/.test(value) ? JSON.stringify(value) : value);
  return [executable, ...args].map(quote).join(' ');
}

interface CapturedOutput {
  readonly text: string;
  readonly truncated: boolean;
}

export class ProcessRunner {
  private readonly logger?: Logger;
  private readonly defaultTimeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly platform: NodeJS.Platform;

  constructor(options: ProcessRunnerOptions = {}) {
    this.logger = options.logger;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 1_000_000;
    this.platform = options.platform ?? process.platform;
  }

  /** Build a spec that is safe to execute on this platform (handles npm.cmd etc.). */
  prepare(spec: ProcessSpec): { executable: string; args: string[] } {
    const args = [...(spec.args ?? [])];
    if (this.platform !== 'win32') return { executable: spec.executable, args };
    if (!WINDOWS_SHIM.test(spec.executable)) return { executable: spec.executable, args };
    const command = [spec.executable, ...args].map(quoteForCmd).join(' ');
    return { executable: process.env.COMSPEC ?? 'cmd.exe', args: ['/d', '/s', '/c', command] };
  }

  async run(spec: ProcessSpec, abortSignal?: AbortSignal): Promise<ProcessResult> {
    const startedAt = Date.now();
    const cwd = spec.cwd ?? process.cwd();
    const timeoutMs = spec.timeoutMs ?? this.defaultTimeoutMs;
    const maxBytes = spec.maxOutputBytes ?? this.maxOutputBytes;
    const prepared = this.prepare(spec);
    const commandLine = formatCommandLine(spec.executable, spec.args ?? []);

    if (abortSignal?.aborted === true) {
      return this.result({
        spec,
        cwd,
        commandLine,
        startedAt,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        cancelled: true,
        spawnError: null,
      });
    }

    const env: NodeJS.ProcessEnv = spec.replaceEnv === true
      ? { ...(spec.env as NodeJS.ProcessEnv) }
      : { ...process.env, ...(spec.env as NodeJS.ProcessEnv) };

    this.logger?.debug('exec', { commandLine, cwd, timeoutMs });

    return await new Promise<ProcessResult>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(prepared.executable, prepared.args, {
          cwd,
          env,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        resolve(
          this.result({
            spec,
            cwd,
            commandLine,
            startedAt,
            exitCode: null,
            signal: null,
            stdout: '',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: false,
            cancelled: false,
            spawnError: new AssemblerError({
              code: 'PROCESS_SPAWN_ERROR',
              message: `Cannot start executable: ${spec.executable}`,
              cause: error,
              hint: 'Check that the executable exists and is executable by the current user.',
            }),
          }),
        );
        return;
      }

      const stdoutCapture = createCapture(maxBytes);
      const stderrCapture = createCapture(maxBytes);
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGTERM');
              setTimeout(() => {
                if (!settled) child.kill('SIGKILL');
              }, 2_000).unref();
            }, timeoutMs)
          : null;
      timer?.unref();

      const onAbort = (): void => {
        cancelled = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, 2_000).unref();
      };
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null, spawnError: AssemblerError | null): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        abortSignal?.removeEventListener('abort', onAbort);
        const stdout = stdoutCapture.value();
        const stderr = stderrCapture.value();
        if (spawnError) {
          this.logger?.warn('process failed to start', { commandLine, code: spawnError.code });
        } else {
          this.logger?.debug('exit', { commandLine, exitCode, timedOut, cancelled, durationMs: Date.now() - startedAt });
        }
        resolve(
          this.result({
            spec,
            cwd,
            commandLine,
            startedAt,
            exitCode,
            signal,
            stdout: stdout.text,
            stderr: stderr.text,
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
            timedOut,
            cancelled,
            spawnError,
          }),
        );
      };

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => stdoutCapture.push(chunk));
      child.stderr.on('data', (chunk: string) => stderrCapture.push(chunk));

      child.on('error', (error: NodeJS.ErrnoException) => {
        const code = error.code === 'ENOENT' ? 'EXECUTABLE_NOT_FOUND' : 'PROCESS_SPAWN_ERROR';
        finish(
          null,
          null,
          new AssemblerError({
            code,
            message:
              error.code === 'ENOENT'
                ? `Executable not found: ${spec.executable}`
                : `Cannot execute ${spec.executable}: ${error.message}`,
            cause: error,
            hint:
              error.code === 'ENOENT'
                ? 'Run `assembler doctor` to inspect the toolchain, or install the missing tool.'
                : undefined,
          }),
        );
      });
      child.on('close', (exitCode, signal) => finish(exitCode, signal, null));

      if (spec.stdin !== undefined) {
        child.stdin.end(spec.stdin);
      } else {
        child.stdin.end();
      }
    });
  }

  /** Run and throw when the process fails, times out or cannot start. */
  async runOrThrow(spec: ProcessSpec, abortSignal?: AbortSignal): Promise<ProcessResult> {
    const result = await this.run(spec, abortSignal);
    if (result.spawnError || result.timedOut || result.cancelled || result.exitCode !== 0) {
      throw new AssemblerError({
        code: result.timedOut ? 'PROCESS_TIMEOUT' : result.spawnError ? result.spawnError.code : 'PROCESS_FAILED',
        message:
          result.spawnError?.message ??
          (result.timedOut
            ? `Command timed out after ${spec.timeoutMs ?? this.defaultTimeoutMs}ms: ${result.commandLine}`
            : `Command failed with exit code ${String(result.exitCode)}: ${result.commandLine}`),
        details: {
          commandLine: result.commandLine,
          cwd: result.cwd,
          exitCode: result.exitCode,
          stderrTail: result.stderr.slice(-4_000),
        },
        cause: result.spawnError ?? undefined,
      });
    }
    return result;
  }

  /** Locate an executable on PATH without invoking a shell. */
  async which(executable: string): Promise<string | null> {
    const extensions =
      this.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter((entry) => entry !== '')
        : [''];
    const pathValue = process.env.PATH ?? '';
    const separator = this.platform === 'win32' ? ';' : ':';
    const directories = pathValue.split(separator).filter((entry) => entry !== '');
    const candidates: string[] = [];
    if (path.isAbsolute(executable)) {
      candidates.push(executable);
    } else {
      for (const directory of directories) candidates.push(path.join(directory, executable));
    }
    const { access, constants } = await import('node:fs/promises');
    for (const candidate of candidates) {
      for (const extension of extensions) {
        const full = candidate.endsWith(extension) ? candidate : `${candidate}${extension.toLowerCase()}`;
        try {
          await access(full, constants.X_OK);
          return full;
        } catch {
          // keep looking
        }
      }
    }
    return null;
  }

  private result(input: {
    spec: ProcessSpec;
    cwd: string;
    commandLine: string;
    startedAt: number;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    timedOut: boolean;
    cancelled: boolean;
    spawnError: AssemblerError | null;
  }): ProcessResult {
    return {
      executable: input.spec.executable,
      args: input.spec.args ?? [],
      cwd: input.cwd,
      exitCode: input.exitCode,
      signal: input.signal,
      stdout: input.stdout,
      stderr: input.stderr,
      stdoutTruncated: input.stdoutTruncated,
      stderrTruncated: input.stderrTruncated,
      durationMs: Date.now() - input.startedAt,
      timedOut: input.timedOut,
      cancelled: input.cancelled,
      spawnError: input.spawnError,
      commandLine: input.commandLine,
    };
  }
}

function createCapture(maxBytes: number): {
  push(chunk: string): void;
  value(): CapturedOutput;
} {
  const chunks: string[] = [];
  let bytes = 0;
  let truncated = false;
  return {
    push(chunk: string): void {
      if (bytes >= maxBytes) {
        truncated = true;
        return;
      }
      const remaining = maxBytes - bytes;
      const encoded = Buffer.byteLength(chunk, 'utf8');
      if (encoded <= remaining) {
        chunks.push(chunk);
        bytes += encoded;
      } else {
        // Slice by characters conservatively to respect the byte budget.
        chunks.push(Buffer.from(chunk, 'utf8').subarray(0, remaining).toString('utf8'));
        bytes = maxBytes;
        truncated = true;
      }
    },
    value(): CapturedOutput {
      return { text: chunks.join(''), truncated };
    },
  };
}
