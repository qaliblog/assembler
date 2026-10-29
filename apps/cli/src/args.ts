/**
 * Argument parsing without a dependency: flags are explicit, unknown flags are an
 * error (a typo must never be silently ignored), and every command documents the
 * flags it accepts.
 */
import { AssemblerError } from '@assembler/core';

export interface ParsedArgs {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

export interface CommandSpec {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  readonly valueFlags: readonly string[];
  readonly booleanFlags: readonly string[];
}

export function parseArgs(argv: readonly string[], valueFlags: readonly string[], booleanFlags: readonly string[]): ParsedArgs {
  const [command = '', ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined) continue;
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }
    const withoutDashes = token.replace(/^--?/, '');
    const [key, inlineValue] = withoutDashes.split('=', 2);
    if (key === undefined || key === '') {
      throw new AssemblerError({ code: 'USAGE_ERROR', message: `Invalid flag: ${token}` });
    }
    if (booleanFlags.includes(key)) {
      flags[key] = true;
      continue;
    }
    if (valueFlags.includes(key)) {
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
        continue;
      }
      const next = rest[index + 1];
      if (next === undefined || (next.startsWith('-') && !/^-\d/.test(next))) {
        throw new AssemblerError({
          code: 'USAGE_ERROR',
          message: `Flag --${key} requires a value`,
        });
      }
      flags[key] = next;
      index += 1;
      continue;
    }
    throw new AssemblerError({
      code: 'USAGE_ERROR',
      message: `Unknown flag: --${key}`,
      hint: 'Run `assembler help` to list supported flags.',
    });
  }

  return { command, positionals, flags };
}

export function flagString(flags: ParsedArgs['flags'], name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagBoolean(flags: ParsedArgs['flags'], name: string): boolean {
  return flags[name] === true;
}
