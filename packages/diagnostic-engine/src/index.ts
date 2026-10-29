/**
 * Diagnostics.
 *
 * Every tool's output is normalised into the same record shape, with a category
 * that keeps environment problems separate from source problems, and a fingerprint
 * that is stable across re-runs so history can be compared.
 */
import { AssemblerError, sha256, type ProcessResult } from '@assembler/core';

export type DiagnosticCategory =
  | 'syntax'
  | 'type'
  | 'missing-dependency'
  | 'contract'
  | 'environment'
  | 'build'
  | 'runtime'
  | 'test'
  | 'security'
  | 'warning';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  readonly id: string;
  readonly code: string;
  readonly category: DiagnosticCategory;
  readonly severity: DiagnosticSeverity;
  readonly tool: string;
  readonly toolVersion: string | null;
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly message: string;
  readonly symbol: string | null;
  readonly reproducer: string | null;
  readonly raw: string;
  readonly fingerprint: string;
}

export interface DiagnosticInput {
  readonly code: string;
  readonly category: DiagnosticCategory;
  readonly severity?: DiagnosticSeverity;
  readonly tool: string;
  readonly toolVersion?: string | null;
  readonly file?: string | null;
  readonly line?: number | null;
  readonly column?: number | null;
  readonly message: string;
  readonly symbol?: string | null;
  readonly reproducer?: string | null;
  readonly raw?: string;
}

/** Fingerprint ignores line numbers and absolute paths so the same defect matches. */
export function fingerprintDiagnostic(input: {
  code: string;
  category: string;
  file?: string | null;
  message: string;
}): string {
  const normalizedMessage = input.message
    .replace(/\b\d+(\.\d+){2,}\b/g, '<version>')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedFile = (input.file ?? '').replace(/\\/g, '/').replace(/^.*?(?=src\/|app\/)/, '');
  return sha256(`${input.category}|${input.code}|${normalizedFile}|${normalizedMessage}`).slice(0, 32);
}

export function createDiagnostic(input: DiagnosticInput): Diagnostic {
  const severity = input.severity ?? 'error';
  const fingerprint = fingerprintDiagnostic({
    code: input.code,
    category: input.category,
    file: input.file ?? null,
    message: input.message,
  });
  return {
    id: `${fingerprint}-${sha256(`${input.file ?? ''}:${input.line ?? ''}:${input.message}`).slice(0, 12)}`,
    code: input.code,
    category: input.category,
    severity,
    tool: input.tool,
    toolVersion: input.toolVersion ?? null,
    file: input.file ?? null,
    line: input.line ?? null,
    column: input.column ?? null,
    message: input.message,
    symbol: input.symbol ?? null,
    reproducer: input.reproducer ?? null,
    raw: input.raw ?? '',
    fingerprint,
  };
}

const TS_DIAGNOSTIC = /^(?<file>[^\s(]+)\((?<line>\d+),(?<column>\d+)\):\s+(?<severity>error|warning)\s+(?<code>TS\d+):\s+(?<message>.+)$/;
const PYTEST_FAILURE = /^(?<file>[^\s:]+\.py):(?<line>\d+):\s+(?<message>.+)$/;
const VITE_ERROR = /^(?<file>[^\s:]+\.(?:ts|tsx|js|jsx|css)):?(?<line>\d+)?:?\s*(?<message>.*error.*)$/i;

/** Parse TypeScript compiler output. Unknown lines are ignored, not guessed at. */
export function parseTypeScriptOutput(output: string, options: { tool?: string } = {}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const line of output.split('\n')) {
    const match = TS_DIAGNOSTIC.exec(line.trim());
    if (match?.groups === undefined) continue;
    const groups = match.groups as Record<string, string | undefined>;
    const code = groups['code'] ?? 'TS0000';
    diagnostics.push(
      createDiagnostic({
        code,
        category: code.startsWith('TS2307') || code.startsWith('TS7016') ? 'missing-dependency' : 'type',
        severity: groups['severity'] === 'warning' ? 'warning' : 'error',
        tool: options.tool ?? 'typescript',
        file: groups['file'] ?? null,
        line: Number(groups['line'] ?? 0),
        column: Number(groups['column'] ?? 0),
        message: groups['message'] ?? '',
        raw: line.trim(),
      }),
    );
  }
  return diagnostics;
}

/** Parse Vitest/Pytest style failure lines and Vite build errors. */
export function parseTestOutput(output: string, options: { tool?: string } = {}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    const pytest = PYTEST_FAILURE.exec(trimmed);
    if (pytest?.groups !== undefined) {
      diagnostics.push(
        createDiagnostic({
          code: 'TEST_FAILURE',
          category: 'test',
          tool: options.tool ?? 'pytest',
          file: pytest.groups['file'] ?? null,
          line: Number(pytest.groups['line']),
          message: pytest.groups['message'] ?? trimmed,
          raw: trimmed,
        }),
      );
      continue;
    }
    if (/FAIL\s+src\/.+\.test\./.test(trimmed) || /AssertionError/.test(trimmed)) {
      diagnostics.push(
        createDiagnostic({
          code: 'TEST_FAILURE',
          category: 'test',
          tool: options.tool ?? 'vitest',
          message: trimmed,
          raw: trimmed,
        }),
      );
      continue;
    }
    const vite = VITE_ERROR.exec(trimmed);
    if (vite?.groups !== undefined && vite.groups['file'] !== undefined) {
      diagnostics.push(
        createDiagnostic({
          code: 'BUILD_ERROR',
          category: 'build',
          tool: options.tool ?? 'vite',
          file: vite.groups['file'],
          line: vite.groups['line'] === undefined ? null : Number(vite.groups['line']),
          message: vite.groups['message'] ?? trimmed,
          raw: trimmed,
        }),
      );
    }
  }
  return diagnostics;
}

export interface NormalizedFailure {
  readonly summary: string;
  readonly category: DiagnosticCategory;
  readonly diagnostics: readonly Diagnostic[];
  readonly command: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stderrTail: string;
}

/**
 * Normalise a failed process into diagnostics. A missing executable or a timeout is
 * an environment failure, never a source-code failure.
 */
export function normalizeProcessFailure(
  result: ProcessResult,
  options: { tool?: string; parser?: 'typescript' | 'test' | 'none' } = {},
): NormalizedFailure {
  const base = {
    command: result.commandLine,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stderrTail: result.stderr.slice(-4_000),
  };
  if (result.spawnError !== null) {
    return {
      ...base,
      summary: result.spawnError.message,
      category: 'environment',
      diagnostics: [
        createDiagnostic({
          code: result.spawnError.code,
          category: 'environment',
          tool: options.tool ?? result.executable,
          message: result.spawnError.message,
          reproducer: result.commandLine,
          raw: '',
        }),
      ],
    };
  }
  if (result.timedOut) {
    return {
      ...base,
      summary: `Command timed out: ${result.commandLine}`,
      category: 'environment',
      diagnostics: [
        createDiagnostic({
          code: 'PROCESS_TIMEOUT',
          category: 'environment',
          tool: options.tool ?? result.executable,
          message: `Command timed out: ${result.commandLine}`,
          reproducer: result.commandLine,
        }),
      ],
    };
  }
  const parser = options.parser ?? 'none';
  const diagnostics =
    parser === 'typescript'
      ? parseTypeScriptOutput(`${result.stdout}\n${result.stderr}`, { tool: options.tool ?? 'typescript' })
      : parser === 'test'
        ? parseTestOutput(`${result.stdout}\n${result.stderr}`, { tool: options.tool ?? 'test' })
        : [];
  const combined = `${result.stdout}\n${result.stderr}`;
  const environmentHint = /EACCES|ENOSPC|ECONNREFUSED|ENOTFOUND|network|permission denied/i.test(combined);
  return {
    ...base,
    summary: `Command failed with exit code ${String(result.exitCode)}: ${result.commandLine}`,
    category: environmentHint ? 'environment' : 'build',
    diagnostics,
  };
}

/** Group by fingerprint while preserving every original record. */
export function deduplicateDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();
  for (const diagnostic of diagnostics) {
    const existing = seen.get(diagnostic.fingerprint);
    if (existing === undefined) seen.set(diagnostic.fingerprint, diagnostic);
  }
  return [...seen.values()];
}

export function filterByCategory(diagnostics: readonly Diagnostic[], category: DiagnosticCategory): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.category === category);
}

export function summarizeDiagnostics(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) return 'No diagnostics.';
  const counts = new Map<DiagnosticCategory, number>();
  for (const diagnostic of diagnostics) counts.set(diagnostic.category, (counts.get(diagnostic.category) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([category, count]) => `${category}: ${count}`)
    .join(', ');
}

export function assertDiagnosticWellFormed(diagnostic: Diagnostic): void {
  if (diagnostic.message.trim() === '') {
    throw new AssemblerError({ code: 'DIAGNOSTIC_INVALID', message: 'A diagnostic must carry a message' });
  }
}
