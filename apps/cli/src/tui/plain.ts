/**
 * Line-oriented renderer used by `--prompt` / non-interactive runs.
 *
 * It prints the same entries the full-screen view shows, which keeps scripted
 * output truthful: every phase line is still emitted around the real operation.
 */
import type { SessionState, SessionView } from './session.js';

const PREFIX: Record<string, string> = {
  user: '> ',
  phase: '  ',
  detail: '    ',
  success: '  ok: ',
  error: '  error: ',
  warning: '  warning: ',
  info: '  ',
};

export interface PlainTarget {
  write(chunk: string): boolean;
}

export class PlainView implements SessionView {
  private readonly out: PlainTarget;
  private printed = 0;
  private lastStatus = '';
  private lastEntryText = '';

  constructor(out: PlainTarget) {
    this.out = out;
  }

  render(state: SessionState): void {
    for (const entry of state.entries.slice(this.printed)) {
      const prefix = PREFIX[entry.kind] ?? '  ';
      this.out.write(`${prefix}${entry.text}\n`);
      if (entry.detail !== undefined) {
        for (const line of entry.detail.split('\n')) this.out.write(`      ${line}\n`);
      }
      this.lastEntryText = entry.text;
    }
    this.printed = state.entries.length;
    // Phase labels are already printed as entries; only print a status change that
    // carries information the log does not (e.g. "Running install…").
    if (
      state.busy &&
      state.status !== '' &&
      state.status !== this.lastStatus &&
      state.status !== this.lastEntryText
    ) {
      this.out.write(`  ${state.status}\n`);
    }
    this.lastStatus = state.status;
  }
}
