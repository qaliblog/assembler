/**
 * Entry points for the interactive UI and for scripted (`--prompt`) runs.
 *
 * The runner owns the terminal: raw mode, resize, signals and cleanup. Cleanup is
 * idempotent and runs in a `finally`, so a failed build, a thrown error or ctrl+c
 * always restores the shell's cursor and screen.
 */
import type { Readable, Writable } from 'node:stream';
import type { Workspace } from '@assembler/core';
import { EXIT } from '../commands.js';
import { decodeKeys } from './keys.js';
import { PlainView } from './plain.js';
import { TerminalScreen } from './screen.js';
import { TuiSession, type SessionOptions } from './session.js';

function exitCodeFor(session: TuiSession): number {
  const state = session.state;
  // Quitting without having run anything is a normal exit, not a failure.
  if (state.outcome === 'built' || state.outcome === 'modified' || state.outcome === 'idle') return EXIT.ok;
  if (session.lastErrorCode === 'CAPABILITY_UNSATISFIED') return EXIT.capability;
  if (state.outcome === 'blocked' || state.outcome === 'declined') return EXIT.usage;
  return EXIT.failure;
}

function isTty(stream: unknown): boolean {
  return typeof (stream as { isTTY?: unknown }).isTTY === 'boolean' && (stream as { isTTY: boolean }).isTTY;
}

/** True when both stdin and stdout are terminals the TUI can drive. */
export function hasInteractiveTerminal(): boolean {
  return isTty(process.stdin) && isTty(process.stdout);
}

/** Shown instead of the interactive UI when there is no terminal to drive. */
export const NON_TTY_GUIDANCE = [
  'The interactive interface needs a terminal (a TTY).',
  'Non-interactive use: assembler --prompt "Create a React dashboard"',
  'Command reference:  assembler help',
  '',
].join('\n');

export interface TuiRunOptions extends SessionOptions {
  readonly input?: Readable & { setRawMode?: (mode: boolean) => void; isTTY?: boolean };
  readonly output?: Writable & { columns?: number; rows?: number; isTTY?: boolean };
}

/**
 * Run the full-screen interface. Resolves with the process exit code once the user
 * quits (or the terminal closes). On a non-TTY it explains how to run headlessly
 * rather than emitting escape codes into a pipe.
 */
export async function runTui(workspace: Workspace, options: TuiRunOptions = {}): Promise<number> {
  const input = (options.input ?? process.stdin) as Readable & {
    setRawMode?: (mode: boolean) => void;
    isTTY?: boolean;
  };
  const output = (options.output ?? process.stdout) as Writable & {
    columns?: number;
    rows?: number;
    isTTY?: boolean;
  };

  if (!isTty(input) || !isTty(output)) {
    output.write(`${NON_TTY_GUIDANCE}\n`);
    workspace.close();
    return EXIT.usage;
  }

  const screen = new TerminalScreen(output, {
    columns: output.columns,
    ...(output.rows === undefined ? {} : { rows: output.rows }),
  });
  const session = new TuiSession(workspace, options);
  let finished = false;
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const cleanup = (): void => {
    if (finished) return;
    finished = true;
    input.off('data', onData);
    input.off('end', onEnd);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigint);
    process.off('SIGWINCH', onResize);
    try {
      input.setRawMode?.(false);
    } catch {
      // The TTY may already be gone; nothing left to restore.
    }
    input.pause();
    screen.stop();
    session.dispose();
    resolveDone();
  };

  const onData = (chunk: string | Buffer): void => {
    const keys = decodeKeys(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    for (const key of keys) {
      if (session.state.quit) break;
      switch (key.type) {
        case 'ctrl-c':
          if (session.state.busy || session.state.confirmation !== null) session.interrupt();
          else session.requestQuit();
          break;
        case 'ctrl-d':
          session.requestQuit();
          break;
        case 'enter':
          void session.submit(session.state.input).then(() => screen.render(session.state));
          break;
        case 'backspace':
          session.backspace();
          break;
        case 'escape':
          session.escape();
          break;
        case 'up':
          session.historyUp();
          break;
        case 'down':
          session.historyDown();
          break;
        case 'pageup':
          screen.scrollBy(+Math.max(1, (output.rows ?? 24) - 6));
          break;
        case 'pagedown':
          screen.scrollBy(-Math.max(1, (output.rows ?? 24) - 6));
          break;
        case 'ctrl-l':
          screen.render(session.state);
          break;
        case 'text':
          session.appendInput(key.text);
          break;
        default:
          break;
      }
      if (session.state.quit) {
        cleanup();
        return;
      }
    }
  };
  const onEnd = (): void => cleanup();
  const onSigint = (): void => {
    if (session.state.busy) session.interrupt();
    else cleanup();
  };
  const onResize = (): void => screen.resize(output.columns, output.rows);

  session.onChange = (state) => {
    screen.render(state);
  };

  screen.start();
  session.onChange(session.state);
  try {
    input.setEncoding?.('utf8');
    input.setRawMode?.(true);
  } catch {
    cleanup();
    return EXIT.failure;
  }
  input.resume();
  input.on('data', onData);
  input.on('end', onEnd);
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigint);
  process.on('SIGWINCH', onResize);

  try {
    await done;
  } finally {
    cleanup();
  }
  return exitCodeFor(session);
}

/**
 * Run one request without a TTY. Same session logic as the interactive path, so a
 * scripted build cannot behave differently from an interactive one.
 */
export async function runPrompt(
  workspace: Workspace,
  prompt: string,
  options: TuiRunOptions = {},
): Promise<number> {
  const output = (options.output ?? process.stdout) as Writable;
  const view = new PlainView(output);
  const session = new TuiSession(workspace, { ...options, nonInteractive: true });
  session.onChange = (state) => view.render(state);
  try {
    await session.submit(prompt);
    return exitCodeFor(session);
  } finally {
    session.dispose();
  }
}

/** Slash commands the interactive session actually implements. */
export const SLASH_COMMANDS = [
  '/help',
  '/workspace',
  '/plan',
  '/inspect',
  '/doctor',
  '/history',
  '/analyze',
  '/debug',
  '/test',
  '/clear',
  '/quit',
] as const;
