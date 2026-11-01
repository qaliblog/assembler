/**
 * Apply a planned modification.
 *
 * The order is deliberate: validate the plan against the *current* files, back
 * up everything that will change, write the change, run the project's own
 * typecheck and test scripts, and only then report success. A failed command or
 * an interrupted run restores the backup and removes newly created files.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssemblerError, sha256, type ProcessResult, type Workspace } from '@assembler/core';
import { scanEnvironment } from '@assembler/environment-manager';
import { parseProjectSpec, specHash } from '@assembler/project-spec';
import { loadGeneratedProject } from './context.js';
import { patchRouteTable } from './patch.js';
import type {
  GeneratedProjectContext,
  ModificationCommandResult,
  ModificationPlan,
  ModificationReport,
  ModificationVerification,
  RecordedFile,
} from './types.js';

export interface ApplyModificationOptions {
  readonly workspace: Workspace;
  /** Project directory; defaults to the workspace root. */
  readonly projectDir?: string;
  readonly plan: ModificationPlan;
  /** Default true. The caller may explicitly disable this for offline previews. */
  readonly typecheck?: boolean;
  readonly tests?: boolean;
  readonly abortSignal?: AbortSignal;
  readonly now?: () => Date;
}

interface Scripts {
  readonly typecheck: string | null;
  readonly test: string | null;
}

async function readScripts(root: string): Promise<Scripts> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    const scripts = raw.scripts ?? {};
    return {
      typecheck: typeof scripts['typecheck'] === 'string' ? scripts['typecheck'] : null,
      test: typeof scripts['test'] === 'string' ? scripts['test'] : null,
    };
  } catch {
    return { typecheck: null, test: null };
  }
}

function tail(output: string): string {
  return output.length > 4_000 ? output.slice(-4_000) : output;
}

function summarize(result: ProcessResult): ModificationCommandResult {
  return {
    commandLine: result.commandLine,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    ok: result.spawnError === null && !result.timedOut && !result.cancelled && result.exitCode === 0,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

function updateSpec(content: string, plan: ModificationPlan): { content: string; hash: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new AssemblerError({
      code: 'PROJECT_INVALID',
      message: 'assembler.spec.json is not valid JSON.',
      cause: error,
    });
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new AssemblerError({ code: 'PROJECT_INVALID', message: 'assembler.spec.json is not an object.' });
  }
  const record = raw as Record<string, unknown>;
  const applications = record['applications'];
  if (!Array.isArray(applications)) {
    throw new AssemblerError({ code: 'PROJECT_INVALID', message: 'assembler.spec.json has no applications.' });
  }
  let updated = false;
  const nextApplications = applications.map((entry) => {
    if (updated || typeof entry !== 'object' || entry === null) return entry;
    const application = entry as Record<string, unknown>;
    if (application['kind'] !== 'web' || application['framework'] !== 'react') return entry;
    const pages = Array.isArray(application['pages']) ? application['pages'] : [];
    const usedIds = new Set(
      pages.map((page) =>
        typeof page === 'object' && page !== null ? String((page as Record<string, unknown>)['id'] ?? '') : '',
      ),
    );
    let pageId = plan.page.id;
    let index = 2;
    while (usedIds.has(pageId)) {
      pageId = `${plan.page.id}-${String(index)}`;
      index += 1;
    }
    updated = true;
    return {
      ...application,
      pages: [
        ...pages,
        {
          id: pageId,
          name: plan.page.title,
          route: plan.page.route,
          archetype: plan.page.archetype,
          title: plan.page.title,
          requiresAuth: plan.page.requiresAuth,
        },
      ],
    };
  });
  if (!updated) {
    throw new AssemblerError({
      code: 'PROJECT_INVALID',
      message: 'The specification has no React web application to add the page to.',
    });
  }
  const next = { ...record, applications: nextApplications };
  const parsed = parseProjectSpec(next);
  if ('issues' in parsed) {
    throw new AssemblerError({
      code: 'PROJECT_INVALID',
      message: `The modified specification is invalid: ${parsed.issues.join('; ')}`,
    });
  }
  return { content: `${JSON.stringify(next, null, 2)}\n`, hash: specHash(parsed.spec) };
}

function updateManifest(
  content: string,
  plan: ModificationPlan,
  context: GeneratedProjectContext,
  routesContent: string,
  specContent: string,
  nextSpecHash: string,
): string {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new AssemblerError({
      code: 'PROJECT_INVALID',
      message: 'assembler.manifest.json is not valid JSON.',
      cause: error,
    });
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new AssemblerError({ code: 'PROJECT_INVALID', message: 'assembler.manifest.json is not an object.' });
  }
  const record = raw as Record<string, unknown>;
  const files = record['files'];
  if (!Array.isArray(files)) {
    throw new AssemblerError({ code: 'PROJECT_INVALID', message: 'assembler.manifest.json has no files.' });
  }

  const newFiles: RecordedFile[] = [
    {
      path: plan.page.sourceFile,
      owner: 'project-modifier',
      kind: 'source',
      sha256: sha256(plan.page.source),
      verified: true,
      provenance: { generator: 'project-modifier', templateId: context.templateId },
    },
    {
      path: plan.page.testFile,
      owner: 'project-modifier',
      kind: 'test',
      sha256: sha256(plan.page.test),
      verified: true,
      provenance: { generator: 'project-modifier', templateId: context.templateId },
    },
    {
      path: plan.page.styleFile,
      owner: 'project-modifier',
      kind: 'style',
      sha256: sha256(plan.page.style),
      verified: true,
      provenance: { generator: 'project-modifier', templateId: context.templateId },
    },
  ];

  const nextFiles = files.map((entry) => {
    if (typeof entry !== 'object' || entry === null) return entry;
    const file = entry as Record<string, unknown>;
    if (file['path'] === 'src/app/routes.tsx') return { ...file, sha256: sha256(routesContent) };
    if (file['path'] === 'assembler.spec.json') return { ...file, sha256: sha256(specContent) };
    return entry;
  });
  nextFiles.push(...newFiles);
  nextFiles.sort((a, b) => {
    const left = typeof a === 'object' && a !== null ? String((a as Record<string, unknown>)['path'] ?? '') : '';
    const right = typeof b === 'object' && b !== null ? String((b as Record<string, unknown>)['path'] ?? '') : '';
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return `${JSON.stringify({ ...record, specHash: nextSpecHash, files: nextFiles }, null, 2)}\n`;
}

async function assertManifestMatches(root: string, manifest: readonly RecordedFile[]): Promise<string[]> {
  const altered: string[] = [];
  for (const file of manifest) {
    try {
      const content = await fs.readFile(path.join(root, file.path));
      if (sha256(content) !== file.sha256) altered.push(file.path);
    } catch {
      altered.push(`${file.path} (missing)`);
    }
  }
  return altered;
}

export async function applyModification(options: ApplyModificationOptions): Promise<ModificationReport> {
  const { workspace, plan } = options;
  const projectDir = path.resolve(options.projectDir ?? workspace.root);
  const startedAt = (options.now?.() ?? new Date()).toISOString();
  if (plan.blockers.length > 0) {
    throw new AssemblerError({
      code: plan.blockers[0]?.code ?? 'MODIFICATION_BLOCKED',
      message: `Refusing to apply a plan with ${String(plan.blockers.length)} blocker(s): ${plan.blockers[0]?.message ?? ''}`,
      details: { blockers: plan.blockers },
    });
  }

  const loaded = await loadGeneratedProject(projectDir);
  if (!loaded.ok) {
    throw new AssemblerError({ code: loaded.code, message: loaded.message });
  }
  const context = loaded.context;
  if (context.routesSha256 !== plan.baseRoutesSha256) {
    throw new AssemblerError({
      code: 'MODIFICATION_CONFLICT',
      message: 'src/app/routes.tsx changed after the plan was computed. Re-plan before applying.',
      hint: 'A concurrent edit is never overwritten; run the request again.',
    });
  }
  const targets = [plan.page.sourceFile, plan.page.testFile, plan.page.styleFile];
  for (const target of targets) {
    if (await workspace.fs.exists(path.join(context.root, target))) {
      throw new AssemblerError({
        code: 'MODIFICATION_CONFLICT',
        message: `Refusing to overwrite ${target}: it appeared after the plan was computed.`,
      });
    }
  }

  const runTypecheck = options.typecheck !== false;
  const runTests = options.tests !== false;
  const verificationRequested = runTypecheck || runTests;
  const scripts = await readScripts(context.root);
  const scan = verificationRequested ? await scanEnvironment({ workspace, probeNetwork: false }) : null;
  const manager = scan?.packageManager ?? null;
  if (verificationRequested && manager === null) {
    throw new AssemblerError({
      code: 'CAPABILITY_UNSATISFIED',
      message: 'No healthy package manager is available to verify the modification.',
      hint: 'Install pnpm or npm, or pass --no-typecheck --no-tests to write files without verification.',
    });
  }
  if (verificationRequested && !(await workspace.fs.exists(path.join(context.root, 'node_modules')))) {
    throw new AssemblerError({
      code: 'DEPENDENCIES_MISSING',
      message: `The project has no node_modules, so the change cannot be verified in ${context.root}.`,
      hint: 'Run the package manager in the project first, or pass --no-typecheck --no-tests to skip verification.',
    });
  }

  const originals = new Map<string, string | null>();
  for (const relative of ['src/app/routes.tsx', 'assembler.spec.json', 'assembler.manifest.json', ...targets]) {
    try {
      originals.set(relative, await fs.readFile(path.join(context.root, relative), 'utf8'));
    } catch {
      originals.set(relative, null);
    }
  }

  const stamp = startedAt.replace(/[:.]/g, '-');
  const backupDir = path.join(workspace.paths.backupsDir, `modify-${stamp}-${plan.page.id}`);
  const notes: string[] = [];
  try {
    await workspace.fs.ensureDir(backupDir);
    for (const [relative, content] of originals) {
      if (content === null) continue;
      const destination = path.join(backupDir, relative);
      await workspace.fs.ensureDir(path.dirname(destination));
      await fs.writeFile(destination, content, 'utf8');
    }
  } catch (error) {
    throw new AssemblerError({
      code: 'BACKUP_FAILED',
      message: `Could not create a recovery backup in ${backupDir}. Nothing was modified.`,
      cause: error,
    });
  }

  const commands: ModificationCommandResult[] = [];
  const verification: { typechecked: boolean; tested: boolean; skipped: boolean } = {
    typechecked: false,
    tested: false,
    skipped: false,
  };
  let rolledBack = false;

  const rollback = async (): Promise<void> => {
    for (const [relative, content] of originals) {
      const absolute = path.join(context.root, relative);
      try {
        if (content === null) await workspace.fs.remove(absolute);
        else await workspace.fs.writeFileAtomic(absolute, content, { overwrite: true });
      } catch {
        notes.push(`Rollback could not restore ${relative}; the backup is at ${backupDir}.`);
      }
    }
    rolledBack = true;
  };

  try {
    const routePatch = patchRouteTable({
      content: context.routesContent,
      route: plan.page.route,
      title: plan.page.title,
      componentName: plan.page.componentName,
      requiresAuth: plan.page.requiresAuth,
    });

    for (const file of [
      { path: plan.page.sourceFile, content: plan.page.source },
      { path: plan.page.testFile, content: plan.page.test },
      { path: plan.page.styleFile, content: plan.page.style },
    ]) {
      const absolute = await workspace.fs.resolveSafe(context.root, file.path);
      await workspace.fs.writeFileAtomic(absolute, file.content, { overwrite: false });
    }
    await workspace.fs.writeFileAtomic(await workspace.fs.resolveSafe(context.root, 'src/app/routes.tsx'), routePatch.content, {
      overwrite: true,
    });

    const spec = updateSpec(context.specContent, plan);
    const manifest = updateManifest(context.manifestContent, plan, context, routePatch.content, spec.content, spec.hash);
    await workspace.fs.writeFileAtomic(await workspace.fs.resolveSafe(context.root, 'assembler.spec.json'), spec.content, {
      overwrite: true,
    });
    await workspace.fs.writeFileAtomic(
      await workspace.fs.resolveSafe(context.root, 'assembler.manifest.json'),
      manifest,
      { overwrite: true },
    );

    if (verificationRequested && manager !== null) {
      const run = async (kind: 'typecheck' | 'test', script: string | null): Promise<boolean> => {
        if (script === null) {
          notes.push(`package.json has no "${kind}" script, so ${kind} was not run.`);
          return true;
        }
        if (options.abortSignal?.aborted === true) {
          throw new AssemblerError({ code: 'CANCELLED', message: 'Modification cancelled before verification.' });
        }
        const result = await workspace.processes.run(
          {
            executable: manager.executable,
            args: ['run', kind],
            cwd: context.root,
            timeoutMs: workspace.config.process.defaultTimeoutMs * 3,
            env: { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
          },
          options.abortSignal,
        );
        commands.push(summarize(result));
        const ok = commands[commands.length - 1]?.ok === true;
        if (ok && kind === 'typecheck') verification.typechecked = true;
        if (ok && kind === 'test') verification.tested = true;
        return ok;
      };

      if (runTypecheck && !(await run('typecheck', scripts.typecheck))) {
        throw new AssemblerError({
          code: 'MODIFICATION_VERIFICATION_FAILED',
          message: 'Type checking failed after the change.',
          hint: 'The project was restored from the backup.',
        });
      }
      if (runTests && !(await run('test', scripts.test))) {
        throw new AssemblerError({
          code: 'MODIFICATION_VERIFICATION_FAILED',
          message: 'The project tests failed after the change.',
          hint: 'The project was restored from the backup.',
        });
      }
    } else {
      verification.skipped = true;
      notes.push('Verification was skipped by request; the change was written without running typecheck or tests.');
    }

    const writtenManifest = JSON.parse(manifest) as { files?: unknown };
    const declared = Array.isArray(writtenManifest.files) ? (writtenManifest.files as RecordedFile[]) : [];
    const altered = await assertManifestMatches(context.root, declared);
    if (altered.length > 0) {
      throw new AssemblerError({
        code: 'MODIFICATION_VERIFICATION_FAILED',
        message: `Manifest reconciliation failed: ${altered.slice(0, 5).join(', ')}`,
      });
    }

    const finishedAt = (options.now?.() ?? new Date()).toISOString();
    return {
      status: 'modified',
      project: context.spec.name,
      summary: plan.summary,
      page: { title: plan.page.title, route: plan.page.route, component: plan.page.componentName },
      changes: plan.changes,
      verification,
      commands,
      backupDir,
      rolledBack: false,
      notes,
      startedAt,
      finishedAt,
    };
  } catch (error) {
    await rollback();
    const assemblerError =
      error instanceof AssemblerError
        ? error
        : new AssemblerError({
            code: 'MODIFICATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          });
    notes.push(`${assemblerError.code}: ${assemblerError.message}`);
    if (assemblerError.hint !== undefined) notes.push(assemblerError.hint);

    const failure = commands.find((command) => !command.ok);
    if (failure !== undefined && failure.stderrTail.trim() !== '') {
      notes.push(failure.stderrTail.trim().split('\n').slice(-12).join('\n'));
    }

    return {
      status: 'failed',
      project: context.spec.name,
      summary: plan.summary,
      page: { title: plan.page.title, route: plan.page.route, component: plan.page.componentName },
      changes: plan.changes,
      verification,
      commands,
      backupDir,
      rolledBack,
      notes,
      startedAt,
      finishedAt: (options.now?.() ?? new Date()).toISOString(),
    };
  }
}
