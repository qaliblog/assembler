/**
 * Interactive session controller.
 *
 * This is the only place that sequences work for the TUI, and it sequences the
 * *real* pipeline: the same interpreter, planner and assembler the CLI commands
 * use. Progress labels are emitted around actual awaited operations, so a phase
 * never claims to be finished before its operation returned.
 *
 * The controller owns no terminal code. Views (full-screen or plain) observe the
 * state and render it; this keeps behaviour testable without a TTY.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssemblerError, isAssemblerError, type Workspace } from '@assembler/core';
import {
  scanEnvironment,
  summarizeScan,
  type EnvironmentScan,
} from '@assembler/environment-manager';
import {
  inspectTarget,
  verifyGeneratedProject,
  type AssemblyReport,
  type AssemblyStepEvent,
  type TargetInspection,
} from '@assembler/project-assembler';
import { assembleProject } from '@assembler/project-assembler';
import { analyzeProject, summarizeInventory } from '../analyze.js';
import { interpretRequirement, type InterpretationOutcome } from '@assembler/requirement-parser';
import { planProject, type PlanResult } from '@assembler/project-planner';
import type { ProjectSpec } from '@assembler/project-spec';

export type SessionPhase =
  | 'idle'
  | 'interpreting'
  | 'planning'
  | 'checking'
  | 'assembling'
  | 'building'
  | 'done'
  | 'failed';

export type EntryKind = 'user' | 'phase' | 'detail' | 'success' | 'error' | 'warning' | 'info';

export interface LogEntry {
  readonly id: number;
  readonly kind: EntryKind;
  readonly text: string;
  /** Optional secondary line, e.g. a hint or a failed command's output. */
  readonly detail?: string;
}

export interface SessionConfirmation {
  readonly question: string;
  readonly details: readonly string[];
}

export type SessionOutcome =
  | { readonly status: 'built'; readonly report: AssemblyReport }
  | { readonly status: 'blocked'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'declined' }
  | { readonly status: 'idle' };

export interface SessionState {
  readonly workspaceDir: string;
  readonly phase: SessionPhase;
  readonly phaseLabel: string;
  readonly busy: boolean;
  readonly entries: readonly LogEntry[];
  readonly input: string;
  readonly status: string;
  readonly confirmation: SessionConfirmation | null;
  readonly quit: boolean;
  readonly outcome: SessionOutcome['status'];
}

export interface SessionOptions {
  /** Accept overwrites without asking (used by --yes and CI). */
  readonly autoConfirm?: boolean;
  readonly install?: boolean;
  readonly typecheck?: boolean;
  readonly tests?: boolean;
  readonly build?: boolean;
  /** No human is watching: never wait for an answer. */
  readonly nonInteractive?: boolean;
  readonly now?: () => Date;
}

export interface SessionView {
  render(state: SessionState): void;
}

const STEP_TOTAL = 6;

/** Word-wrap text to a maximum width, preserving explicit line breaks. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      if (word === '') continue;
      if (current === '') {
        current = word;
      } else if (current.length + 1 + word.length <= width) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
      while (current.length > width) {
        lines.push(current.slice(0, width));
        current = current.slice(width);
      }
    }
    if (current !== '') lines.push(current);
  }
  return lines;
}

export class TuiSession {
  readonly workspace: Workspace;
  private readonly options: SessionOptions;
  private readonly entries: LogEntry[] = [];
  private entryId = 0;
  private phase: SessionPhase = 'idle';
  private phaseLabel = 'Ready';
  private input = '';
  private status = '';
  private quit = false;
  private busy = false;
  private confirmation: SessionConfirmation | null = null;
  private confirmationAnswer: ((value: boolean) => void) | null = null;
  private abortController: AbortController | null = null;
  private outcome: SessionOutcome = { status: 'idle' };
  private lastRequest: string | null = null;
  private buildPromise: Promise<void> | null = null;
  private errorCode: string | null = null;
  private readonly history: string[] = [];
  private historyIndex = 0;
  private disposed = false;

  constructor(workspace: Workspace, options: SessionOptions = {}) {
    this.workspace = workspace;
    this.options = options;
  }

  get projectDir(): string {
    return this.workspace.root;
  }

  /** Stable error code of the last failed operation, for exit-code mapping. */
  get lastErrorCode(): string | null {
    return this.errorCode;
  }

  get state(): SessionState {
    return {
      workspaceDir: this.workspace.root,
      phase: this.phase,
      phaseLabel: this.phaseLabel,
      busy: this.busy,
      entries: [...this.entries],
      input: this.input,
      status: this.status,
      confirmation: this.confirmation,
      quit: this.quit,
      outcome: this.outcome.status,
    };
  }

  /** Set by the runner; called whenever the observable state changes. */
  onChange: ((state: SessionState) => void) | null = null;

  private emit(): void {
    this.onChange?.(this.state);
  }

  private push(kind: EntryKind, text: string, detail?: string): void {
    this.entryId += 1;
    this.entries.push({
      id: this.entryId,
      kind,
      text,
      ...(detail === undefined ? {} : { detail }),
    });
    this.emit();
  }

  private setPhase(phase: SessionPhase, label: string): void {
    this.phase = phase;
    this.phaseLabel = label;
    this.status = label;
    this.emit();
  }

  private step(index: number, label: string): void {
    // The log entry is written first so a line-oriented view never prints the
    // same label twice (once as status, once as an entry).
    this.push('phase', `[${index}/${STEP_TOTAL}] ${label}…`);
    this.setPhase(
      index <= 1 ? 'interpreting' : index === 2 ? 'planning' : index === 3 ? 'checking' : 'assembling',
      `[${index}/${STEP_TOTAL}] ${label}…`,
    );
  }

  /* ------------------------------------------------------------------ input */

  setInput(text: string): void {
    this.input = text;
    this.emit();
  }

  appendInput(text: string): void {
    this.input += text;
    this.emit();
  }

  backspace(): void {
    this.input = [...this.input].slice(0, -1).join('');
    this.emit();
  }

  historyUp(): void {
    if (this.history.length === 0) return;
    this.historyIndex = Math.max(0, this.historyIndex - 1);
    this.input = this.history[this.historyIndex] ?? '';
    this.emit();
  }

  historyDown(): void {
    if (this.history.length === 0) return;
    this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
    this.input = this.history[this.historyIndex] ?? '';
    this.emit();
  }

  requestQuit(): void {
    this.quit = true;
    this.emit();
  }

  /** Ctrl+C: cancel the running operation, or ask the runner to exit. */
  interrupt(): void {
    if (this.confirmation !== null) {
      this.confirmationAnswer?.(false);
      return;
    }
    if (this.busy) {
      this.abortController?.abort();
      this.push('warning', 'Cancelling…');
      return;
    }
    this.push('info', 'Press ctrl+c again to exit, or use /quit.');
  }

  /** Escape key: drop a pending confirmation or clear the input. */
  escape(): void {
    if (this.confirmation !== null) {
      this.confirmationAnswer?.(false);
      return;
    }
    this.input = '';
    this.emit();
  }

  clearLog(): void {
    this.entries.length = 0;
    this.emit();
  }

  /** Resolves when the current operation (if any) has finished. */
  async whenIdle(): Promise<void> {
    await this.buildPromise;
  }

  /* ------------------------------------------------------------------ submit */

  /**
   * Handle one submitted line. Returns a promise that settles when the operation
   * it started has finished, which is what tests and non-interactive mode await.
   */
  async submit(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (text === '') {
      this.setInput('');
      return;
    }
    this.setInput('');
    if (this.confirmation !== null) {
      this.answerConfirmation(text);
      return;
    }
    this.history.push(text);
    this.historyIndex = this.history.length;
    if (text.startsWith('/')) {
      await this.runCommand(text);
      return;
    }
    this.lastRequest = text;
    this.buildPromise = this.generate(text);
    await this.buildPromise;
  }

  private answerConfirmation(text: string): void {
    const normalised = text.toLowerCase();
    const resolve = this.confirmationAnswer;
    const accepted = ['y', 'yes', 'overwrite'].includes(normalised);
    const declined = ['n', 'no', 'cancel'].includes(normalised);
    if (!accepted && !declined) {
      this.push('warning', 'Please answer "yes" to overwrite the conflicting files, or "no" to leave them untouched.');
      return;
    }
    this.confirmation = null;
    this.confirmationAnswer = null;
    this.push('info', accepted ? 'Overwrite confirmed.' : 'Overwrite declined; nothing was written.');
    resolve?.(accepted);
  }

  private ask(question: string, details: readonly string[]): Promise<boolean> {
    if (this.options.autoConfirm === true) {
      this.push('info', `${question} (auto-confirmed)`);
      return Promise.resolve(true);
    }
    if (this.options.nonInteractive === true) {
      this.push(
        'warning',
        `${question} No interactive answer is possible, so existing files were left untouched. Re-run with --yes to overwrite them, or choose an empty directory with --workspace.`,
      );
      for (const detail of details) this.push('detail', detail);
      return Promise.resolve(false);
    }
    this.confirmation = { question, details };
    this.push('warning', question);
    for (const detail of details) this.push('detail', detail);
    return new Promise<boolean>((resolve) => {
      this.confirmationAnswer = resolve;
      this.emit();
    });
  }

  /* ---------------------------------------------------------------- commands */

  private async runCommand(line: string): Promise<void> {
    const [rawName = '', ...rest] = line.split(/\s+/);
    const name = rawName.toLowerCase();
    const argument = rest.join(' ').trim();
    this.push('user', line);

    switch (name) {
      case '/help':
        this.push('info', 'Commands:');
        this.push('detail', '/help                 show this list');
        this.push('detail', '/workspace            show the absolute workspace path and contents');
        this.push('detail', '/plan [request]       preview a plan without writing files');
        this.push('detail', '/inspect              verify the project against its recorded manifest');
        this.push('detail', '/doctor               check runtimes, package managers and capabilities');
        this.push('detail', '/history              list recorded assemblies for this workspace');
        this.push('detail', '/analyze              inventory existing code in the workspace');
        this.push('detail', '/clear                clear the log');
        this.push('detail', '/quit                 exit');
        this.push('detail', 'Type a request to build a project, or use up/down for history.');
        return;
      case '/workspace':
        await this.showWorkspace();
        return;
      case '/plan':
        await this.previewPlan(argument === '' ? this.lastRequest : argument);
        return;
      case '/inspect':
        await this.inspectProject();
        return;
      case '/doctor':
        await this.doctor();
        return;
      case '/history':
        this.showHistory();
        return;
      case '/analyze':
        await this.analyzeWorkspace();
        return;
      case '/clear':
        this.clearLog();
        return;
      case '/quit':
      case '/exit':
        this.requestQuit();
        return;
      default:
        this.push('error', `Unknown command: ${rawName}`);
        this.push('detail', 'Type /help to see the available commands.');
        return;
    }
  }

  private async showWorkspace(): Promise<void> {
    this.push('info', `Workspace: ${this.workspace.root}`);
    try {
      const listing = await fs.readdir(this.workspace.root, { withFileTypes: true });
      const names = listing
        .filter((entry) => entry.name !== '.assembler')
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
      this.push(
        'detail',
        names.length === 0
          ? 'The workspace is empty.'
          : `Contains ${names.length} entr${names.length === 1 ? 'y' : 'ies'}: ${names.slice(0, 12).join(', ')}${
              names.length > 12 ? ', …' : ''
            }`,
      );
    } catch (error) {
      this.push('error', `Cannot read the workspace: ${(error as Error).message}`);
    }
  }

  private async doctor(): Promise<void> {
    const scan = await scanEnvironment({ workspace: this.workspace, probeNetwork: true });
    this.push('info', `Environment: ${scan.platform.os}/${scan.platform.arch}, node ${scan.platform.nodeVersion}`);
    for (const line of summarizeScan(scan)) this.push('detail', line);
    if (scan.packageManager !== null) {
      this.push('detail', `Selected package manager: ${scan.packageManager.name} ${scan.packageManager.version}`);
    }
    const unsatisfied = scan.capabilities.filter((entry) => entry.status === 'unsatisfied');
    if (unsatisfied.length > 0) {
      this.push('warning', `${unsatisfied.length} capability(ies) unsatisfied: ${unsatisfied.map((e) => e.capability).join(', ')}`);
    }
  }

  private showHistory(): void {
    const rows = this.workspace
      .database()
      .all<{ status: string; target_path: string; created_at: string; id: string }>(
        'SELECT id, status, target_path, created_at FROM assemblies ORDER BY created_at DESC LIMIT 20',
      );
    if (rows.length === 0) {
      this.push('info', 'No assemblies have been recorded in this workspace yet.');
      return;
    }
    this.push('info', `${rows.length} recorded assembl${rows.length === 1 ? 'y' : 'ies'}:`);
    for (const row of rows) {
      this.push('detail', `${row.created_at}  ${row.status.padEnd(7)}  ${row.target_path}  (${row.id})`);
    }
  }

  private async analyzeWorkspace(): Promise<void> {
    const inventory = await analyzeProject(this.workspace.root);
    for (const line of summarizeInventory(inventory)) this.push('detail', line);
  }

  private async inspectProject(): Promise<void> {
    try {
      const result = await verifyGeneratedProject(this.workspace, this.workspace.root);
      if (result.ok) {
        this.push('success', 'Manifest verification: ok — every generated file matches its recorded hash.');
        return;
      }
      this.push('error', 'Manifest verification failed.');
      for (const entry of result.missing) this.push('detail', `missing: ${entry}`);
      for (const entry of result.altered) this.push('detail', `altered: ${entry}`);
      for (const entry of result.unexpected) this.push('detail', `unexpected: ${entry}`);
    } catch (error) {
      if (isAssemblerError(error) && error.code === 'FILE_MISSING') {
        this.push('warning', 'This workspace has no assembler.manifest.json yet — build a project first.');
        return;
      }
      throw error;
    }
  }

  /** Interpret and plan without writing anything, including the conflict report. */
  private async previewPlan(request: string | null): Promise<void> {
    if (request === null) {
      this.push('warning', 'Nothing to plan yet: type a request first, or `/plan <request>`.');
      return;
    }
    const outcome = interpretRequirement(request, { source: 'user-request' });
    if (outcome.spec === null) {
      this.reportInterpretationFailure(outcome);
      return;
    }
    const environment = await scanEnvironment({ workspace: this.workspace, probeNetwork: false });
    const plan = await planProject({ workspace: this.workspace, spec: outcome.spec, environment });
    this.describeSpec(outcome.spec);
    if (!plan.ready) {
      this.reportBlockers(plan);
      return;
    }
    this.push('info', `Plan: ${plan.manifest.files.length} files for ${outcome.spec.name} (${outcome.spec.slug}).`);
    const inspection = await inspectTarget(this.workspace, this.workspace.root, plan.manifest);
    this.describeInspection(inspection);
    this.push('info', 'Preview only: no files were written.');
  }

  private describeSpec(spec: ProjectSpec): void {
    this.push('info', `Project: ${spec.name} (${spec.slug})`);
    for (const application of spec.applications) {
      this.push(
        'detail',
        `${application.kind}: ${application.framework} · ${application.language} · ${application.buildSystem}` +
          (application.pages.length > 0
            ? ` · pages: ${application.pages.map((page) => page.route ?? page.title).join(', ')}`
            : ''),
      );
    }
    this.push('detail', `Design: ${spec.design.style} / ${spec.design.theme} / ${spec.design.layout}`);
  }

  private describeInspection(inspection: TargetInspection): void {
    this.push(
      'detail',
      `Workspace check: ${inspection.create.length} new file(s), ${inspection.identical.length} unchanged, ${inspection.conflicts.length} conflicting, ${inspection.untouched.length} unrelated entr${inspection.untouched.length === 1 ? 'y' : 'ies'} left untouched.`,
    );
    if (inspection.regenerated.length > 0) {
      this.push('detail', `Refreshing assembler metadata: ${inspection.regenerated.join(', ')}`);
    }
    if (inspection.conflicts.length > 0) {
      this.push('warning', `Would overwrite: ${inspection.conflicts.slice(0, 8).join(', ')}${inspection.conflicts.length > 8 ? ', …' : ''}`);
    }
    if (inspection.untouched.length > 0) {
      this.push('detail', `Not touched: ${inspection.untouched.slice(0, 8).join(', ')}${inspection.untouched.length > 8 ? ', …' : ''}`);
    }
  }

  private reportInterpretationFailure(outcome: InterpretationOutcome): void {
    this.push('error', `The request could not be turned into a specification (status: ${outcome.status}).`);
    for (const clarification of outcome.clarifications) {
      this.push('detail', `${clarification.severity === 'blocking' ? 'blocking' : 'question'}: ${clarification.question}`);
    }
    for (const entry of outcome.unsupported) this.push('detail', `unsupported: ${entry.description} — ${entry.reason}`);
    for (const contradiction of outcome.contradictions) {
      this.push('detail', `contradiction: ${JSON.stringify(contradiction)}`);
    }
    this.push('detail', 'Nothing was written.');
  }

  private reportBlockers(plan: PlanResult): void {
    this.push('error', `The plan has ${plan.blockers.length} blocker(s); nothing was written.`);
    for (const blocker of plan.blockers) this.push('detail', `[${blocker.code}] ${blocker.message}`);
    if (plan.blueprint.unresolved.length > 0) {
      this.push('detail', `Unresolved: ${plan.blueprint.unresolved.join('; ')}`);
    }
  }

  /* ---------------------------------------------------------------- pipeline */

  private async generate(request: string): Promise<void> {
    this.busy = true;
    this.outcome = { status: 'idle' };
    this.errorCode = null;
    this.abortController = new AbortController();
    this.push('user', request);
    try {
      this.step(1, 'Interpreting request');
      const outcome = interpretRequirement(request, { source: 'user-request' });
      if (outcome.spec === null) {
        this.errorCode = 'SPEC_INCOMPLETE';
        this.outcome = { status: 'blocked', reason: 'interpretation failed' };
        this.reportInterpretationFailure(outcome);
        this.finish('failed');
        return;
      }
      let spec = outcome.spec;
      // When the request names no project, use the workspace directory: building a
      // blog in `my-blog/` should not produce a package called "react-app".
      if (spec.name === 'React App') {
        const derived = nameFromDirectory(this.workspace.root);
        if (derived !== null) {
          spec = { ...spec, name: derived.name, slug: derived.slug };
          this.push('info', `No project name was requested; using the workspace directory: ${derived.name} (${derived.slug}).`);
        }
      }
      for (const entry of outcome.unsupported) this.push('warning', `unsupported: ${entry.description}`);
      for (const note of outcome.notes) this.push('detail', note);
      for (const entry of outcome.ledger.filter((item) => item.status === 'assumption')) {
        this.push('warning', `assumed: ${entry.value}`);
      }

      this.step(2, 'Creating project specification');
      this.describeSpec(spec);

      this.step(3, 'Checking environment and dependencies');
      // A local capability check; the assembler performs its own networked scan
      // when it actually needs to talk to a registry.
      const environment: EnvironmentScan = await scanEnvironment({ workspace: this.workspace, probeNetwork: false });
      this.push(
        'detail',
        `Environment: node ${environment.platform.nodeVersion}; package manager: ${
          environment.packageManager === null ? 'none detected' : `${environment.packageManager.name} ${environment.packageManager.version}`
        }`,
      );
      const unsatisfied = environment.capabilities.filter((entry) => entry.status === 'unsatisfied');
      if (unsatisfied.length > 0) {
        this.errorCode = 'CAPABILITY_UNSATISFIED';
        this.outcome = { status: 'failed', reason: 'unsatisfied capabilities' };
        this.push('error', 'Required capabilities are unsatisfied; nothing was written.');
        for (const entry of unsatisfied) this.push('detail', `[${entry.capability}] ${entry.reason}`);
        this.finish('failed');
        return;
      }

      this.step(4, 'Generating blueprint');
      const plan = await planProject({ workspace: this.workspace, spec, environment });
      if (!plan.ready) {
        this.errorCode = plan.blockers[0]?.code ?? 'PLAN_INVALID';
        this.outcome = { status: 'blocked', reason: 'plan blockers' };
        this.reportBlockers(plan);
        this.finish('failed');
        return;
      }
      this.push('detail', `${plan.manifest.files.length} files, ${plan.blueprint.components.length} verified component(s).`);

      this.step(5, 'Assembling project');
      const inspection = await inspectTarget(this.workspace, this.workspace.root, plan.manifest);
      this.describeInspection(inspection);
      let overwrite = false;
      if (inspection.conflicts.length > 0) {
        overwrite = await this.ask(
          `The workspace already contains ${inspection.conflicts.length} file(s) this project would replace. Overwrite them?`,
          inspection.conflicts.slice(0, 10),
        );
        if (!overwrite) {
          this.errorCode = 'OVERWRITE_DENIED';
          this.outcome = { status: 'declined' };
          this.push('warning', 'Cancelled: no files were changed.');
          this.finish('failed');
          return;
        }
      }

      this.push('phase', `[${STEP_TOTAL}/${STEP_TOTAL}] Validating and building…`);
      this.setPhase('building', `[${STEP_TOTAL}/${STEP_TOTAL}] Validating and building…`);
      const report = await assembleProject({
        workspace: this.workspace,
        spec,
        plan,
        targetDir: this.workspace.root,
        publish: 'in-place',
        conflictPolicy: overwrite ? 'overwrite' : 'deny',
        installDependencies: this.options.install,
        runTypecheck: this.options.typecheck,
        runTests: this.options.tests,
        runBuild: this.options.build,
        abortSignal: this.abortController.signal,
        ...(this.options.now === undefined ? {} : { now: this.options.now }),
        onStep: (event) => this.onStep(event),
      });

      this.reportAssembly(report);
      if (report.status === 'built') {
        this.outcome = { status: 'built', report };
        this.push('success', 'Project generated successfully.');
      } else if (report.status === 'cancelled') {
        this.outcome = { status: 'cancelled' };
        this.push('warning', 'Assembly cancelled. The workspace was not published.');
      } else {
        this.outcome = { status: 'failed', reason: report.failures[0]?.summary ?? 'assembly failed' };
        this.push('error', 'Build failed. The workspace was left as it was.');
      }
    } catch (error) {
      const assemblerError = isAssemblerError(error)
        ? error
        : new AssemblerError({
            code: 'ASSEMBLY_FAILED',
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          });
      this.errorCode = assemblerError.code;
      this.outcome = {
        status: assemblerError.code === 'CANCELLED' ? 'cancelled' : 'failed',
        reason: assemblerError.message,
      };
      this.push('error', `${assemblerError.code}: ${assemblerError.message}`);
      if (assemblerError.hint !== undefined) this.push('detail', assemblerError.hint);
    } finally {
      this.finish(this.outcome.status === 'built' ? 'done' : 'failed');
      this.busy = false;
      this.abortController = null;
      this.emit();
    }
  }

  /** Map real assembler step events onto the status line. */
  private onStep(event: AssemblyStepEvent): void {
    if (event.phase === 'start') {
      this.status = `Running ${event.kind}…`;
      this.emit();
      return;
    }
    const seconds = ((event.durationMs ?? 0) / 1000).toFixed(1);
    this.push(
      event.ok === true ? 'detail' : 'error',
      `${event.kind}: ${event.ok === true ? 'ok' : 'failed'} (${seconds}s) — ${event.commandLine ?? ''}`,
    );
    this.status = `${event.kind} finished in ${seconds}s`;
    this.emit();
  }

  private reportAssembly(report: AssemblyReport): void {
    this.push('info', `Assembly status: ${report.status}; target: ${report.targetDir}`);
    this.push(
      'detail',
      `Verification: install=${report.verification.dependenciesInstalled} typecheck=${report.verification.typechecked} test=${report.verification.tested} build=${report.verification.built}`,
    );
    for (const failure of report.failures) {
      this.push('error', `[${failure.category}] ${failure.summary}`);
      if (failure.stderrTail.trim() !== '') {
        this.push('detail', failure.stderrTail.trim().split('\n').slice(-12).join('\n'));
      }
    }
    for (const note of report.notes) this.push('detail', note);
  }

  private finish(phase: SessionPhase): void {
    this.phase = phase;
    this.phaseLabel = phase === 'done' ? 'Ready' : 'Ready — last operation failed';
    this.status = '';
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController?.abort();
    this.confirmationAnswer?.(false);
    this.workspace.close();
  }
}

/** Absolute workspace path, displayed at startup and by /workspace. */
export function describeWorkspace(workspaceDir: string): string {
  return path.resolve(workspaceDir);
}

/** Derive a display name and slug from the workspace directory name. */
export function nameFromDirectory(workspaceDir: string): { name: string; slug: string } | null {
  const base = path.basename(path.resolve(workspaceDir));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') return null;
  const name = slug
    .split('-')
    .filter((part) => part !== '')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
  return { name, slug };
}
