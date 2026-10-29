/**
 * Test support: a deterministic `CommandProbe`.
 *
 * Host-dependent detection must be testable on machines that do not have every
 * supported toolchain installed (and must be able to simulate *broken*
 * toolchains). This fake lets tests describe a machine instead of borrowing one.
 */
import type { CommandOutcome, CommandProbe } from '../types.js';

export interface FakeExecutable {
  /** Absolute path the executable resolves to. */
  readonly path: string;
  /** Version output for the adapter's version arguments. */
  readonly versionOutput?: string;
  /** Whether invoking the executable works at all. */
  readonly executable?: boolean;
  /** Explicit outcomes for specific argument lists. */
  readonly outcomes?: Record<string, { exitCode: number; stdout: string; stderr: string }>;
}

export interface FakeEnvironment {
  /** Executable names as they would be found on PATH. */
  readonly path?: Record<string, FakeExecutable>;
  /** Absolute paths that exist (files or directories). */
  readonly files?: readonly string[];
  /** Directory listings, keyed by absolute path. */
  readonly directories?: Record<string, readonly string[]>;
  /** A tool that exists but hangs on its version probe. */
  readonly hanging?: readonly string[];
}

function key(executable: string, args: readonly string[]): string {
  return `${executable} ${args.join(' ')}`;
}

export function createFakeProbe(environment: FakeEnvironment): CommandProbe {
  return {
    async run(executable: string, args: readonly string[]): Promise<CommandOutcome> {
      if (environment.hanging?.includes(executable) === true) {
        return { exitCode: null, stdout: '', stderr: '', timedOut: true, error: null };
      }
      const entry = Object.values(environment.path ?? {}).find((candidate) => candidate.path === executable);
      if (entry === undefined) {
        return {
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          error: {
            code: 'EXECUTABLE_NOT_FOUND',
            message: `Executable not found: ${executable}`,
            details: {},
            retryable: false,
            name: 'AssemblerError',
          } as unknown as CommandOutcome['error'],
        };
      }
      if (entry.executable === false) {
        return {
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          error: {
            code: 'PROCESS_SPAWN_ERROR',
            message: `Permission denied: ${executable}`,
            details: {},
            retryable: false,
            name: 'AssemblerError',
          } as unknown as CommandOutcome['error'],
        };
      }
      const explicit = entry.outcomes?.[key(executable, args)];
      if (explicit !== undefined) {
        return { ...explicit, timedOut: false, error: null };
      }
      return {
        exitCode: 0,
        stdout: entry.versionOutput ?? '',
        stderr: '',
        timedOut: false,
        error: null,
      };
    },

    async findOnPath(name: string): Promise<string | null> {
      return environment.path?.[name]?.path ?? null;
    },

    async exists(candidate: string): Promise<boolean> {
      if (environment.files?.includes(candidate) === true) return true;
      if (environment.directories?.[candidate] !== undefined) return true;
      return Object.values(environment.path ?? {}).some((entry) => entry.path === candidate);
    },

    async listDirectory(candidate: string): Promise<string[]> {
      return [...(environment.directories?.[candidate] ?? [])];
    },
  };
}
