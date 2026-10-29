/**
 * CLI commands. Every command is a thin adapter over a core service: the CLI owns
 * no planning, assembly or verification logic of its own.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AssemblerError,
  FileSystemService,
  createWorkspace,
  type Workspace,
} from '@assembler/core';
import { ComponentRegistry } from '@assembler/component-registry';
import {
  scanEnvironment,
  summarizeScan,
  type EnvironmentScan,
} from '@assembler/environment-manager';
import {
  assembleProject,
  verifyGeneratedProject,
  type AssemblyReport,
} from '@assembler/project-assembler';
import { describePlan, planProject, type PlanResult } from '@assembler/project-planner';
import { parseProjectSpec, type ProjectSpec } from '@assembler/project-spec';
import { interpretRequirement } from '@assembler/requirement-parser';
import { analyzeProject, summarizeInventory } from './analyze.js';
import { flagBoolean, flagString, type ParsedArgs } from './args.js';
import { createOutput } from './output.js';

export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  capability: 3,
  unimplemented: 4,
} as const;

export interface CommandContext {
  readonly args: ParsedArgs;
  readonly cwd: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Find the repository root that provides templates/knowledge/libraries. */
async function resolveAssetsRoot(explicit: string | undefined, cwd: string): Promise<string> {
  if (explicit !== undefined) return path.resolve(cwd, explicit);
  let directory = cwd;
  for (let depth = 0; depth < 6; depth += 1) {
    if (await exists(path.join(directory, 'templates', 'react-web', 'template.json'))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return cwd;
}

async function openWorkspace(context: CommandContext, json: boolean): Promise<Workspace> {
  const root = await resolveAssetsRoot(flagString(context.args.flags, 'root'), context.cwd);
  return createWorkspace({
    root,
    overrides: { logLevel: json ? 'error' : 'warn' },
  });
}

async function loadSpec(file: string): Promise<ProjectSpec> {
  const resolved = path.resolve(file);
  let candidate = resolved;
  if (await exists(resolved)) {
    const stats = await fs.stat(resolved);
    if (stats.isDirectory()) {
      for (const name of ['assembler.spec.json', 'project.json', 'project-spec.json']) {
        const next = path.join(resolved, name);
        if (await exists(next)) {
          candidate = next;
          break;
        }
      }
    }
  } else {
    throw new AssemblerError({
      code: 'FILE_MISSING',
      message: `Specification file not found: ${file}`,
      hint: 'Run `assembler interpret "<request>" --out project.json` first.',
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(candidate, 'utf8'));
  } catch (error) {
    throw new AssemblerError({
      code: 'SPEC_INVALID',
      message: `Cannot read the specification as JSON: ${candidate}`,
      cause: error,
    });
  }
  const parsed = parseProjectSpec(raw);
  if ('issues' in parsed) {
    throw new AssemblerError({
      code: 'SPEC_INVALID',
      message: `Specification does not match schema ${'1.0'}: ${parsed.issues.join('; ')}`,
      details: { issues: parsed.issues },
    });
  }
  return parsed.spec;
}

function environmentSummary(scan: EnvironmentScan): string[] {
  return summarizeScan(scan);
}

export async function runInterpret(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const text = context.args.positionals.join(' ').trim();
  if (text === '') {
    throw new AssemblerError({
      code: 'USAGE_ERROR',
      message: 'interpret requires a natural-language requirement',
      hint: 'assembler interpret "Create a React dashboard with a login page"',
    });
  }
  const result = interpretRequirement(text);
  const outFile = flagString(context.args.flags, 'out');
  if (outFile !== undefined && result.spec !== null) {
    const service = new FileSystemService();
    await service.writeFileAtomic(path.resolve(context.cwd, outFile), `${JSON.stringify(result.spec, null, 2)}\n`, {
      overwrite: true,
    });
  }

  const payload = {
    status: result.status,
    spec: result.spec,
    clarifications: result.clarifications,
    contradictions: result.contradictions,
    unsupported: result.unsupported,
    ledger: result.ledger,
    notes: result.notes,
    unmatchedClauses: result.extraction.unmatchedClauses,
  };

  const lines: string[] = [];
  lines.push(`Interpretation status: ${result.status}`);
  if (result.spec !== null) {
    const spec = result.spec;
    lines.push(`Project: ${spec.name} (${spec.slug})`);
    for (const application of spec.applications) {
      lines.push(
        `  ${application.kind}: ${application.framework} (${application.language}, ${application.buildSystem})`,
      );
      if (application.pages.length > 0) {
        lines.push(`    pages: ${application.pages.map((page) => `${page.title}${page.route === undefined ? '' : ` ${page.route}`}`).join(', ')}`);
      }
      if (application.apiEndpoints.length > 0) {
        lines.push(`    endpoints: ${application.apiEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ')}`);
      }
    }
    lines.push(`Design: ${spec.design.style} / ${spec.design.theme} / ${spec.design.layout}`);
    const counts = new Map<string, number>();
    for (const entry of result.ledger) counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
    lines.push(
      `Requirements: ${[...counts.entries()].map(([status, count]) => `${status}=${count}`).join(', ') || 'none'}`,
    );
    if (outFile !== undefined) lines.push(`Specification written to ${outFile}`);
  }
  for (const clarification of result.clarifications) {
    lines.push(`  ? ${clarification.question}${clarification.severity === 'blocking' ? ' [blocking]' : ''}`);
  }
  for (const entry of result.unsupported) {
    lines.push(`  ! unsupported: ${entry.description} — ${entry.reason}`);
  }
  for (const note of result.notes) lines.push(`  note: ${note}`);

  out.result(payload, lines);
  return result.status === 'ready' ? EXIT.ok : EXIT.usage;
}

export async function planOnly(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const specFile = context.args.positionals[0];
  if (specFile === undefined) {
    throw new AssemblerError({ code: 'USAGE_ERROR', message: 'plan requires a specification file' });
  }
  const spec = await loadSpec(specFile);
  const workspace = await openWorkspace(context, json);
  try {
    const environment = await scanEnvironment({ workspace, probeNetwork: false });
    const plan: PlanResult = await planProject({ workspace, spec, environment });
    const outFile = flagString(context.args.flags, 'out');
    if (outFile !== undefined) {
      await workspace.fs.writeFileAtomic(
        path.resolve(context.cwd, outFile),
        `${JSON.stringify(plan.blueprint, null, 2)}\n`,
        { overwrite: true },
      );
    }
    const payload = {
      ready: plan.ready,
      blockers: plan.blockers,
      blueprint: plan.blueprint,
      findings: plan.findings,
      graph: plan.graph,
      analysis: plan.analysis,
      environment: {
        signature: environment.signature,
        capabilities: environment.capabilities,
        packageManager: environment.packageManager,
      },
    };
    const lines = describePlan(plan.blueprint);
    lines.push(`Capabilities: ${plan.blueprint.capabilities.map((entry) => `${entry.capability}=${entry.status}`).join(', ')}`);
    if (outFile !== undefined) lines.push(`Blueprint written to ${outFile}`);
    out.result(payload, lines);
    return plan.ready ? EXIT.ok : plan.blockers.some((blocker) => blocker.code === 'CAPABILITY_UNSATISFIED') ? EXIT.capability : EXIT.usage;
  } finally {
    workspace.close();
  }
}

function reportLines(report: AssemblyReport): string[] {
  const lines: string[] = [];
  lines.push(`Assembly status: ${report.status}`);
  lines.push(`Target: ${report.targetDir}${report.published ? ' (published)' : ' (not published)'}`);
  lines.push(`Files written: ${report.filesWritten}`);
  lines.push(
    `Verification: install=${report.verification.dependenciesInstalled} typecheck=${report.verification.typechecked} test=${report.verification.tested} build=${report.verification.built}`,
  );
  for (const command of report.commands) {
    lines.push(`  ${command.ok ? 'ok  ' : 'FAIL'} ${command.commandLine} (${command.durationMs}ms)`);
  }
  for (const failure of report.failures) lines.push(`  failure [${failure.category}]: ${failure.summary}`);
  for (const note of report.notes) lines.push(`  note: ${note}`);
  if (!report.published && report.stagingDir !== '') lines.push(`Inspect the staged project at ${report.stagingDir}`);
  return lines;
}

export async function buildProject(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const specFile = context.args.positionals[0];
  if (specFile === undefined) {
    throw new AssemblerError({ code: 'USAGE_ERROR', message: 'build requires a specification file' });
  }
  const spec = await loadSpec(specFile);
  const workspace = await openWorkspace(context, json);
  try {
    const environment = await scanEnvironment({ workspace, probeNetwork: true });
    const plan = await planProject({ workspace, spec, environment });
    if (!plan.ready) {
      out.result(
        { ready: false, blockers: plan.blockers, blueprint: plan.blueprint },
        [...describePlan(plan.blueprint), 'Refusing to write a project with unresolved blockers.'],
      );
      return plan.blockers.some((blocker) => blocker.code === 'CAPABILITY_UNSATISFIED') ? EXIT.capability : EXIT.usage;
    }
    const target = flagString(context.args.flags, 'target') ?? `./${spec.slug}`;
    const overwrite = flagString(context.args.flags, 'overwrite');
    if (overwrite !== undefined && !['deny', 'backup', 'replace'].includes(overwrite)) {
      throw new AssemblerError({ code: 'USAGE_ERROR', message: `Invalid --overwrite value: ${overwrite}` });
    }
    const report = await assembleProject({
      workspace,
      spec,
      plan,
      targetDir: path.resolve(context.cwd, target),
      ...(overwrite === undefined ? {} : { overwritePolicy: overwrite as 'deny' | 'backup' | 'replace' }),
      ...(flagBoolean(context.args.flags, 'no-install') ? { installDependencies: false } : {}),
      ...(flagBoolean(context.args.flags, 'no-tests') ? { runTests: false } : {}),
      ...(flagBoolean(context.args.flags, 'no-typecheck') ? { runTypecheck: false } : {}),
      ...(flagBoolean(context.args.flags, 'no-build') ? { runBuild: false } : {}),
    });
    out.result(report, reportLines(report));
    return report.status === 'built' && report.published ? EXIT.ok : EXIT.failure;
  } finally {
    workspace.close();
  }
}

export async function doctor(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const workspace = await openWorkspace(context, json);
  try {
    const scan = await scanEnvironment({ workspace, probeNetwork: true });
    const { persistScan } = await import('@assembler/environment-manager');
    persistScan(workspace, scan);
    const payload = {
      platform: scan.platform,
      tools: scan.tools,
      capabilities: scan.capabilities,
      packageManager: scan.packageManager,
      packageManagerCandidates: scan.packageManagerCandidates,
      android: scan.android,
      signature: scan.signature,
      limitations: scan.limitations,
    };
    out.result(payload, environmentSummary(scan));
    const unsatisfied = scan.capabilities.filter((entry) => entry.status === 'unsatisfied');
    return unsatisfied.length === 0 ? EXIT.ok : EXIT.capability;
  } finally {
    workspace.close();
  }
}

export async function analyze(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const target = context.args.positionals[0] ?? '.';
  const inventory = await analyzeProject(path.resolve(context.cwd, target));
  out.result(inventory, summarizeInventory(inventory));
  return inventory.unresolvedImports.length === 0 ? EXIT.ok : EXIT.failure;
}

export async function inspect(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const target = context.args.positionals[0];
  if (target === undefined) {
    throw new AssemblerError({ code: 'USAGE_ERROR', message: 'inspect requires a project directory' });
  }
  const workspace = await openWorkspace(context, json);
  try {
    const result = await verifyGeneratedProject(workspace, path.resolve(context.cwd, target));
    out.result(result, [
      `Manifest verification: ${result.ok ? 'ok' : 'failed'}`,
      ...result.missing.map((entry) => `  missing: ${entry}`),
      ...result.unexpected.map((entry) => `  unexpected: ${entry}`),
      ...result.altered.map((entry) => `  altered: ${entry}`),
    ]);
    return result.ok ? EXIT.ok : EXIT.failure;
  } finally {
    workspace.close();
  }
}

export async function registry(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const [subcommand, ...rest] = context.args.positionals;
  const workspace = await openWorkspace(context, json);
  try {
    const store = new ComponentRegistry(workspace, workspace.paths.librariesDir);
    switch (subcommand) {
      case 'add':
      case 'sync': {
        const result = await store.sync();
        out.result(result, [
          `Indexed ${result.total} component manifest(s): ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged.`,
        ]);
        return EXIT.ok;
      }
      case 'search': {
        const query = rest.join(' ').trim();
        if (query === '') throw new AssemblerError({ code: 'USAGE_ERROR', message: 'registry search requires a query' });
        const records = store.search(query);
        out.result(records, records.length === 0
          ? ['No components matched.']
          : records.map(
              (record) =>
                `${record.name}@${record.version} [${record.lifecycle}/${record.verificationLevel}] ${record.description}`,
            ));
        return records.length === 0 ? EXIT.failure : EXIT.ok;
      }
      case 'inspect': {
        const name = rest[0];
        if (name === undefined) throw new AssemblerError({ code: 'USAGE_ERROR', message: 'registry inspect requires a component name' });
        const record = store.inspect(name, flagString(context.args.flags, 'version'));
        if (record === null) {
          out.result(null, [`No component named "${name}" is indexed. Run \`assembler registry add\` first.`]);
          return EXIT.failure;
        }
        out.result(record, [
          `${record.name}@${record.version} — ${record.description}`,
          `  lifecycle: ${record.lifecycle} (verification: ${record.verificationLevel})`,
          `  framework: ${record.framework}; platforms: ${record.platforms.join(', ')}`,
          `  source: ${record.sourcePath} (sha256 ${record.sourceHash.slice(0, 12)}…)`,
          `  exports: ${record.exports.join(', ') || 'none'}`,
          `  tags: ${record.tags.join(', ') || 'none'}`,
          `  verified at: ${record.verifiedAt ?? 'never'}`,
        ]);
        return EXIT.ok;
      }
      case 'verify': {
        const name = rest[0];
        if (name === undefined) throw new AssemblerError({ code: 'USAGE_ERROR', message: 'registry verify requires a component name' });
        const report = await store.verify(name, flagString(context.args.flags, 'version'));
        out.result(report, [
          `${report.component}@${report.version}: ${report.passed ? 'structural checks passed' : 'structural checks failed'}`,
          `  level: ${report.level}${report.claimsTested ? ' (manifest claims execution-level verification)' : ''}`,
          ...report.findings.map((finding) => `  ${finding.severity}: [${finding.code}] ${finding.message}`),
        ]);
        return report.passed ? EXIT.ok : EXIT.failure;
      }
      case 'deprecate': {
        const name = rest[0];
        if (name === undefined) throw new AssemblerError({ code: 'USAGE_ERROR', message: 'registry deprecate requires a component name' });
        const record = store.deprecate(name, flagString(context.args.flags, 'version'), flagString(context.args.flags, 'replaced-by'));
        out.result(record, [`${record.name}@${record.version} is now deprecated.`]);
        return EXIT.ok;
      }
      case 'list':
      case undefined: {
        const records = store.list();
        out.result(records, records.length === 0
          ? ['The registry index is empty. Run `assembler registry add`.'.replace(/\s+/g, ' ')]
          : records.map((record) => `${record.name}@${record.version} [${record.lifecycle}] ${record.description}`));
        return EXIT.ok;
      }
      default:
        throw new AssemblerError({
          code: 'USAGE_ERROR',
          message: `Unknown registry subcommand: ${subcommand}`,
          hint: 'Use search, inspect, add, verify, deprecate or list.',
        });
    }
  } finally {
    workspace.close();
  }
}

export async function history(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const workspace = await openWorkspace(context, json);
  try {
    const limit = Number(flagString(context.args.flags, 'limit') ?? '20');
    const rows = workspace.database().all<{
      id: string;
      status: string;
      target_path: string;
      created_at: string;
      blueprint_hash: string;
    }>('SELECT id, status, target_path, created_at, blueprint_hash FROM assemblies ORDER BY created_at DESC LIMIT ?', [
      Number.isFinite(limit) ? limit : 20,
    ]);
    const payload = rows.map((row) => ({
      id: row.id,
      status: row.status,
      target: row.target_path,
      createdAt: row.created_at,
      blueprintHash: row.blueprint_hash,
    }));
    out.result(payload, rows.length === 0
      ? ['No assemblies have been recorded yet.']
      : rows.map((row) => `${row.created_at} ${row.status.padEnd(7)} ${row.target_path} (${row.id})`));
    return EXIT.ok;
  } finally {
    workspace.close();
  }
}

export async function testProject(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const target = context.args.positionals[0];
  if (target === undefined) {
    throw new AssemblerError({ code: 'USAGE_ERROR', message: 'test requires a project directory' });
  }
  const workspace = await openWorkspace(context, json);
  try {
    const projectDir = path.resolve(context.cwd, target);
    const scan = await scanEnvironment({ workspace, probeNetwork: false });
    const manager = scan.packageManager;
    if (manager === null) {
      throw new AssemblerError({
        code: 'CAPABILITY_UNSATISFIED',
        message: 'No healthy package manager is available to run the tests',
      });
    }
    const result = await workspace.processes.run({
      executable: manager.executable,
      args: ['run', 'test'],
      cwd: projectDir,
      timeoutMs: workspace.config.process.defaultTimeoutMs * 3,
      env: { CI: '1', NO_COLOR: '1' },
    });
    const payload = {
      commandLine: result.commandLine,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
    out.result(payload, [
      `Test command: ${result.commandLine}`,
      `Exit code: ${String(result.exitCode)} (${result.durationMs}ms)`,
      ...result.stdout.split('\n').slice(-25),
    ]);
    return result.exitCode === 0 && !result.timedOut ? EXIT.ok : EXIT.failure;
  } finally {
    workspace.close();
  }
}

export async function adopt(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const target = context.args.positionals[0] ?? '.';
  const inventory = await analyzeProject(path.resolve(context.cwd, target));
  out.result(
    {
      status: 'analysis-only',
      inventory,
      message:
        'Adoption (recording an existing project, planning modifications and applying them in isolation) is not implemented yet.',
    },
    [
      ...summarizeInventory(inventory),
      'Adoption is not implemented: no files were modified. Analysis results above are read-only.',
    ],
  );
  return EXIT.unimplemented;
}

export async function runInit(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const workspace = await openWorkspace(context, json);
  try {
    const configFile = path.join(workspace.root, 'assembler.config.json');
    const created: string[] = [];
    if (!(await exists(configFile))) {
      await workspace.fs.writeFileAtomic(
        configFile,
        `${JSON.stringify(
          {
            logLevel: 'info',
            packageManagers: { preference: ['pnpm', 'npm', 'yarn'], offline: false },
            assembly: { overwritePolicy: 'deny', installDependencies: true },
            registry: { allowUnverifiedComponents: false },
          },
          null,
          2,
        )}\n`,
      );
      created.push(configFile);
    }
    await workspace.fs.ensureDir(workspace.paths.dataDir);
    created.push(workspace.paths.dataDir);
    out.result(
      { root: workspace.root, created, configFile },
      [
        `Workspace initialised at ${workspace.root}`,
        ...created.map((entry) => `  ${entry}`),
        'Next: assembler interpret "Create a React dashboard" --out project.json',
      ],
    );
    return EXIT.ok;
  } finally {
    workspace.close();
  }
}

export async function debug(context: CommandContext): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  const target = context.args.positionals[0] ?? '.';
  const inventory = await analyzeProject(path.resolve(context.cwd, target));
  const workspace = await openWorkspace(context, json);
  try {
    const scan = await scanEnvironment({ workspace, probeNetwork: false });
    const projectDir = path.resolve(context.cwd, target);
    const rows = workspace.database().all<{
      fingerprint: string;
      category: string;
      severity: string;
      message: string;
      created_at: string;
    }>(
      'SELECT fingerprint, category, severity, message, created_at FROM diagnostics WHERE project_path = ? ORDER BY created_at DESC LIMIT 20',
      [projectDir],
    );
    out.result(
      { inventory, environment: scan, diagnostics: rows },
      [
        ...summarizeInventory(inventory),
        `Environment: ${scan.capabilities.filter((entry) => entry.status === 'satisfied').length}/${scan.capabilities.length} capabilities satisfied`,
        ...(rows.length === 0
          ? ['Diagnostics: none recorded for this project']
          : rows.map((row) => `  [${row.category}/${row.severity}] ${row.message} (${row.fingerprint})`)),
      ],
    );
    return EXIT.ok;
  } finally {
    workspace.close();
  }
}

export async function unimplemented(context: CommandContext, feature: string, detail: string): Promise<number> {
  const json = flagBoolean(context.args.flags, 'json');
  const out = createOutput(json);
  out.result({ status: 'unimplemented', feature, detail }, [detail]);
  return EXIT.unimplemented;
}
