/**
 * Full-screen ANSI renderer.
 *
 * Everything here is presentation: it reads a state snapshot and paints a frame.
 * No pipeline call, no filesystem access, no decision about what to build. It uses
 * the alternate screen and restores the terminal on stop, which also makes an
 * abrupt exit (or a thrown error) leave the user's shell usable.
 */
import type { SessionState } from './session.js';
import { wrapText } from './session.js';

export interface RenderTarget {
  readonly columns?: number;
  readonly rows?: number;
  write(chunk: string): boolean;
}

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const COLORS: Record<string, string> = {
  user: `${ESC}1;36m`,
  phase: `${ESC}1;33m`,
  detail: `${ESC}2m`,
  success: `${ESC}1;32m`,
  error: `${ESC}1;31m`,
  warning: `${ESC}1;33m`,
  info: '',
  header: `${ESC}1;36m`,
  dim: `${ESC}2m`,
  status: `${ESC}7m`,
};

const MARKERS: Record<string, string> = {
  user: '› ',
  phase: '• ',
  detail: '  ',
  success: '✓ ',
  error: '✗ ',
  warning: '! ',
  info: '  ',
};

type WrappedLine = { readonly text: string; readonly kind: string };

export class TerminalScreen {
  private readonly out: RenderTarget;
  private columns: number;
  private rows: number;
  private started = false;
  private lastState: SessionState | null = null;
  private scroll = 0;

  constructor(out: RenderTarget, dimensions: { columns?: number; rows?: number } = {}) {
    this.out = out;
    this.columns = clamp(dimensions.columns ?? out.columns ?? 80, 40, 200);
    this.rows = clamp(dimensions.rows ?? out.rows ?? 24, 12, 100);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.out.write(`${ESC}?1049h${ESC}?25l${ESC}H${ESC}2J`);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.out.write(`${ESC}?25h${ESC}?1049l`);
  }

  resize(columns?: number, rows?: number): void {
    this.columns = clamp(columns ?? this.columns, 40, 200);
    this.rows = clamp(rows ?? this.rows, 12, 100);
    if (this.lastState !== null) this.render(this.lastState);
  }

  scrollBy(lines: number): void {
    this.scroll = Math.max(0, this.scroll + lines);
    if (this.lastState !== null) this.render(this.lastState);
  }

  render(state: SessionState): void {
    this.lastState = state;
    if (!this.started) return;

    const width = this.columns;
    const bodyHeight = Math.max(1, this.rows - 6);

    const header = this.headerLine(state);
    const workspace = truncateEnd(`Workspace: ${state.workspaceDir}`, width);
    const divider = COLORS.dim + '─'.repeat(width) + RESET;

    const body = this.bodyLines(state, width);
    const maxScroll = Math.max(0, body.length - bodyHeight);
    if (this.scroll > maxScroll) this.scroll = maxScroll;
    const end = body.length - this.scroll;
    const visible = body.slice(Math.max(0, end - bodyHeight), end);
    while (visible.length < bodyHeight) visible.unshift({ text: '', kind: 'info' });

    const inputLine = this.inputLine(state, width);
    const statusLine = this.statusLine(state, width);

    const lines = [
      header,
      workspace,
      divider,
      ...visible.map((line) => `${COLORS[line.kind] ?? ''}${line.text}${RESET}`),
      inputLine,
      divider,
      statusLine,
    ];

    const frame = `${ESC}H${lines.map((line) => `${line}${ESC}K`).join('\r\n')}${ESC}J`;
    this.out.write(frame);
  }

  private headerLine(state: SessionState): string {
    const left = `${COLORS.header}ASSEMBLER${RESET}${COLORS.dim} 0.1.0${RESET}`;
    const leftPlain = 'ASSEMBLER 0.1.0';
    const right = state.busy ? `● ${state.phaseLabel}` : '○ idle';
    const gap = Math.max(1, this.columns - leftPlain.length - right.length);
    return `${left}${' '.repeat(gap)}${COLORS.dim}${truncateEnd(right, Math.max(0, this.columns - leftPlain.length - 1))}${RESET}`;
  }

  private inputLine(state: SessionState, width: number): string {
    if (state.confirmation !== null) {
      return `${COLORS.warning}? ${truncateEnd(state.confirmation.question, width - 2)}${RESET}`;
    }
    const available = Math.max(1, width - 4);
    const chars = [...state.input];
    const shown = chars.length > available ? chars.slice(chars.length - available).join('') : state.input;
    const cursor = state.busy ? '' : `${ESC}?25h`;
    return `${COLORS.user}>${RESET} ${shown}${cursor}\u258f`;
  }

  private statusLine(state: SessionState, width: number): string {
    let hint: string;
    if (state.confirmation !== null) {
      hint = 'type yes to overwrite · no to keep the existing files · ctrl+c cancels';
    } else if (state.busy) {
      hint = `${state.status === '' ? state.phaseLabel : state.status} · ctrl+c cancels`;
    } else {
      hint = 'enter submit · /help commands · /quit exit · ctrl+c interrupt';
    }
    const padded = truncateEnd(hint, width).padEnd(width, ' ');
    return `${COLORS.status}${padded}${RESET}`;
  }

  private bodyLines(state: SessionState, width: number): WrappedLine[] {
    const lines: WrappedLine[] = [];
    for (const entry of state.entries) {
      const marker = MARKERS[entry.kind] ?? '  ';
      const wrapped = wrapText(entry.text, Math.max(8, width - marker.length));
      wrapped.forEach((text, index) => {
        lines.push({ text: `${index === 0 ? marker : ' '.repeat(marker.length)}${text}`, kind: entry.kind });
      });
      if (entry.detail !== undefined) {
        for (const detailLine of wrapText(entry.detail, Math.max(8, width - 4))) {
          lines.push({ text: `    ${detailLine}`, kind: 'detail' });
        }
      }
    }
    return lines;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function truncateEnd(text: string, width: number): string {
  const chars = [...text];
  if (chars.length <= width) return text;
  if (width <= 1) return chars.slice(0, Math.max(0, width)).join('');
  return `${chars.slice(0, width - 1).join('')}…`;
}
