/**
 * Assembler.
 *
 * Writes a planned project into an isolated staging directory, validates the
 * result against the manifest, installs dependencies, runs typecheck/tests/build,
 * and only then publishes to the target location. A failed step leaves the target
 * untouched and keeps the staging directory for inspection.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AssemblerError,
  deterministicId,
  nowIso,
  randomId,
  sha256,
  type ProcessResult,
  type SqlDatabase,
  type Workspace,
} from '@assembler/core';
import { normalizeProcessFailure, type Diagnostic, type NormalizedFailure } from '@assembler/diagnostic-engine';
import { scanEnvironment, type EnvironmentScan } from '@assembler/environment-manager';
import {
  blueprintFingerprint,
  reconcileManifest,
  type Blueprint,
  type CommandPlan,
  type FileManifest,
} from '@assembler/project-planner';
import type { ProjectSpec } from '@assembler/project-spec';

export type AssemblyStatus = 'built' | 'failed' | 'cancelled';

export interface CommandReport {
  readonly kind: CommandPlan['kind'];
  readonly commandLine: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly stdoutTail: string;
  readonly stderrTail: string;
  readonly ok: boolean;
}

export interface AssemblyVerification {
  readonly filesWritten: boolean;
  readonly manifestReconciled: boolean;
  readonly dependenciesInstalled: boolean;
  readonly typechecked: boolean;
  readonly tested: boolean;
  readonly built: boolean;
}

export interface AssemblyReport {
  readonly status: AssemblyStatus;
  readonly projectName: string;
  readonly slug: string;
  readonly targetDir: string;
  readonly stagingDir: string;
  readonly published: boolean;
  readonly blueprintFingerprint: string;
  readonly specHash: string;
  readonly filesWritten: number;
  readonly components: Blueprint['components'];
  readonly verification: AssemblyVerification;
  readonly commands: readonly CommandReport[];
  readonly diagnostics: readonly Diagnostic[];
  readonly failures: readonly NormalizedFailure[];
  readonly reconciliation: Awaited<ReturnType<typeof reconcileManifest>> | null;
  readonly environmentSignature: string | null;
  readonly packageManager: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly notes: readonly string[];
}

export interface AssembleOptions {
  readonly workspace: Workspace;
  readonly spec: ProjectSpec;
  readonly plan: { readonly blueprint: Blueprint; readonly manifest: FileManifest };
  readonly targetDir: string;
  readonly installDependencies?: boolean;
  readonly runTypecheck?: boolean;
  readonly runTests?: boolean;
  readonly runBuild?: boolean;
  readonly overwritePolicy?: 'deny' | 'backup' | 'replace';
  readonly abortSignal?: AbortSignal;
  readonly keepStagingOnFailure?: boolean;
  readonly now?: () => Date;
}

function refuseDangerousTarget(workspace: Workspace, targetDir: string): void {
  const root = path.resolve(workspace.root);
  const target = path.resolve(targetDir);
  const relative = path.relative(root, target);
  const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (target === root || root.startsWith(`${target}${path.sep}`) || target === path.parse(target).root) {
    throw new AssemblerError({
      code: 'OVERWRITE_DENIED',
      message: `Refusing to assemble into ${target}: it would replace the workspace or a parent directory.`,
      hint: 'Choose a new subdirectory, for example ./my-app.',
    });
  }
  if (inside && relative.split(path.sep)[0] === workspace.config.dataDir.replace(/^\.\//, '')) {
    throw new AssemblerError({
      code: 'OVERWRITE_DENIED',
      message: `Refusing to assemble into the assembler data directory: ${target}`,
    });
  }
}

async function pathExists(maybePath: string): Promise<boolean> {
  try {
    await fs.access(maybePath);
    return true;
  } catch {
    return false;
  }
}

function summarizeOutput(output: string): string {
  return output.length > 4_000 ? output.slice(-4_000) : output;
}

export async function assembleProject(options: AssembleOptions): Promise<AssemblyReport> {
  const { workspace, plan, spec } = options;
  const startedAt = (options.now?.() ?? new Date()).toISOString();
  const targetDir = path.resolve(options.targetDir);
  refuseDangerousTarget(workspace, targetDir);

  const policy = options.overwritePolicy ?? workspace.config.assembly.overwritePolicy;
  const targetExists = await pathExists(targetDir);
  const targetNonEmpty = targetExists ? !(await workspace.fs.isEmptyDirectory(targetDir)) : false;
  if (targetNonEmpty && policy === 'deny') {
    throw new AssemblerError({
      code: 'OVERWRITE_DENIED',
      message: `Target directory is not empty: ${targetDir}`,
      hint: 'Choose an empty directory, or explicitly allow backup/replace.',
    });
  }
  if (plan.blueprint.blockers.length > 0) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: `Refusing to assemble a plan with ${plan.blueprint.blockers.length} blocker(s): ${plan.blueprint.blockers
        .map((blocker) => blocker.code)
        .join(', ')}`,
      details: { blockers: plan.blueprint.blockers },
      hint: 'Resolve the plan blockers first; run `assembler plan` to inspect them.',
    });
  }

  const stagingDir = path.join(workspace.paths.stagingDir, `${spec.slug}-${randomId('build')}`);
  await workspace.fs.ensureDir(stagingDir);

  const commands: CommandReport[] = [];
  const failures: NormalizedFailure[] = [];
  const diagnostics: Diagnostic[] = [];
  const notes: string[] = [];
  const verification: {
    filesWritten: boolean;
    manifestReconciled: boolean;
    dependenciesInstalled: boolean;
    typechecked: boolean;
    tested: boolean;
    built: boolean;
  } = {
    filesWritten: false,
    manifestReconciled: false,
    dependenciesInstalled: false,
    typechecked: false,
    tested: false,
    built: false,
  };

  const environment: EnvironmentScan = await scanEnvironment({
    workspace,
    probeNetwork: true,
  });
  const packageManager = environment.packageManager ?? null;
  const pmExecutable = packageManager?.executable ?? null;

  let status: AssemblyStatus = 'failed';
  let reconciliation: Awaited<ReturnType<typeof reconcileManifest>> | null = null;

  const writeFile = async (relativePath: string, content: string): Promise<void> => {
    const absolute = await workspace.fs.resolveSafe(stagingDir, relativePath);
    await workspace.fs.writeFileAtomic(absolute, content, { overwrite: false });
  };

  const runStep = async (kind: CommandPlan['kind'], executable: string, args: readonly string[]): Promise<boolean> => {
    const result: ProcessResult = await workspace.processes.run(
      {
        executable,
        args: [...args],
        cwd: stagingDir,
        timeoutMs:
          kind === 'install'
            ? workspace.config.packageManagers.installTimeoutMs
            : workspace.config.process.defaultTimeoutMs * 3,
        env: { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
      },
      options.abortSignal,
    );
    const ok = result.spawnError === null && !result.timedOut && !result.cancelled && result.exitCode === 0;
    commands.push({
      kind,
      commandLine: result.commandLine,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      stdoutTail: summarizeOutput(result.stdout),
      stderrTail: summarizeOutput(result.stderr),
      ok,
    });
    if (!ok) {
      const failure = normalizeProcessFailure(result, {
        tool: `${packageManager?.name ?? 'process'}:${kind}`,
        parser: kind === 'typecheck' ? 'typescript' : kind === 'test' ? 'test' : 'none',
      });
      failures.push(failure);
      diagnostics.push(...failure.diagnostics);
      workspace.logger.error('assembly step failed', {
        kind,
        commandLine: result.commandLine,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
    }
    return ok;
  };

  try {
    for (const file of plan.manifest.files) {
      await writeFile(file.path, file.content);
    }
    verification.filesWritten = true;

    reconciliation = await reconcileManifest(stagingDir, plan.manifest, workspace.fs);
    if (!reconciliation.ok) {
      throw new AssemblerError({
        code: 'MANIFEST_VIOLATION',
        message: `Staged project does not match its manifest (missing: ${reconciliation.missing.length}, unexpected: ${reconciliation.unexpected.length}, altered: ${reconciliation.altered.length})`,
        details: reconciliation as unknown as Record<string, unknown>,
      });
    }
    verification.manifestReconciled = true;

    const install = options.installDependencies ?? workspace.config.assembly.installDependencies;
    let runTypecheck = options.runTypecheck ?? workspace.config.testing.runTypecheckDuringBuild;
    let runTests = options.runTests ?? workspace.config.testing.runTestsDuringBuild;
    let runBuildStep = options.runBuild ?? true;

    if (install || runTypecheck || runTests || runBuildStep) {
      if (pmExecutable === null) {
        throw new AssemblerError({
          code: 'CAPABILITY_UNSATISFIED',
          message: 'No healthy Node.js package manager is available for dependency installation.',
          hint: 'Install pnpm or npm and re-run, or use --no-install to write files only.',
        });
      }
    }

    if (install) {
      const installCommand = plan.blueprint.commands.find((command) => command.kind === 'install');
      if (installCommand === undefined) {
        throw new AssemblerError({ code: 'PLAN_INVALID', message: 'The plan has no install command' });
      }
      const args = [...installCommand.args];
      if (packageManager?.name === 'pnpm') {
        // Copy-import is slower but works on filesystems that cannot hardlink from
        // the shared store; it is also the safest default across platforms.
        args.push('--package-import-method=copy');
      }
      if (packageManager?.name === 'npm') args.push('--no-audit', '--no-fund');
      const ok = await runStep('install', pmExecutable as string, args);
      if (!ok) throw new AssemblerError({ code: 'ASSEMBLY_FAILED', message: 'Dependency installation failed' });
      verification.dependenciesInstalled = true;
    }

    // Steps that execute project code need the dependencies to exist. Saying so is
    // better than reporting "type checking failed" when nothing was installed.
    const hasDependencies = await pathExists(path.join(stagingDir, 'node_modules'));
    if (!hasDependencies && (runTypecheck || runTests || runBuildStep)) {
      notes.push(
        `Skipped typecheck, tests and build because dependencies were not installed${install ? '' : ' (installation disabled)'}. Run the package manager in ${stagingDir} and re-run these steps.`,
      );
      runTypecheck = false;
      runTests = false;
      runBuildStep = false;
    }

    if (runTypecheck) {
      const command = plan.blueprint.commands.find((entry) => entry.kind === 'typecheck');
      if (command !== undefined) {
        const ok = await runStep('typecheck', pmExecutable as string, command.args);
        if (!ok) throw new AssemblerError({ code: 'ASSEMBLY_FAILED', message: 'Type checking failed' });
        verification.typechecked = true;
      }
    }

    if (runTests) {
      const command = plan.blueprint.commands.find((entry) => entry.kind === 'test');
      if (command !== undefined) {
        const ok = await runStep('test', pmExecutable as string, command.args);
        if (!ok) throw new AssemblerError({ code: 'ASSEMBLY_FAILED', message: 'Tests failed' });
        verification.tested = true;
      }
    }

    if (runBuildStep) {
      const command = plan.blueprint.commands.find((entry) => entry.kind === 'build');
      if (command !== undefined) {
        const ok = await runStep('build', pmExecutable as string, command.args);
        if (!ok) throw new AssemblerError({ code: 'ASSEMBLY_FAILED', message: 'Production build failed' });
        verification.built = true;
      }
    }

    const postReconciliation = await reconcileManifest(stagingDir, plan.manifest, workspace.fs);
    if (!postReconciliation.ok) {
      notes.push(
        `Post-build reconciliation found unexpected artefact(s): ${postReconciliation.unexpected.join(', ') || 'none'}.`,
      );
    }
    status = 'built';
  } catch (error) {
    const assemblerError =
      error instanceof AssemblerError
        ? error
        : new AssemblerError({
            code: 'ASSEMBLY_FAILED',
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          });
    failures.push({
      summary: assemblerError.message,
      category: assemblerError.code.startsWith('CAPABILITY') ? 'environment' : 'build',
      diagnostics: [],
      command: '',
      exitCode: null,
      timedOut: false,
      stderrTail: '',
    });
    notes.push(assemblerError.hint ?? 'See the failures list for details.');
    workspace.logger.error('assembly failed', { code: assemblerError.code, message: assemblerError.message });
    status = options.abortSignal?.aborted === true ? 'cancelled' : 'failed';
  }

  const finishedAt = (options.now?.() ?? new Date()).toISOString();
  const report: AssemblyReport = {
    status,
    projectName: spec.name,
    slug: spec.slug,
    targetDir,
    stagingDir,
    published: false,
    blueprintFingerprint: blueprintFingerprint(plan.blueprint),
    specHash: plan.blueprint.project.specHash,
    filesWritten: status === 'built' ? plan.manifest.files.length : 0,
    components: plan.blueprint.components,
    verification,
    commands,
    diagnostics,
    failures,
    reconciliation,
    environmentSignature: environment.signature,
    packageManager: packageManager?.name ?? null,
    startedAt,
    finishedAt,
    notes,
  };

  const writeMetadata = async (directory: string, finalReport: AssemblyReport): Promise<void> => {
    await workspace.fs.writeFileAtomic(
      path.join(directory, 'assembler.manifest.json'),
      `${JSON.stringify(
        {
          schemaVersion: '1.0',
          project: spec.slug,
          specHash: plan.blueprint.project.specHash,
          files: plan.manifest.files.map((file) => ({
            path: file.path,
            owner: file.owner,
            kind: file.kind,
            sha256: file.sha256,
            verified: file.verified,
            provenance: file.provenance,
          })),
        },
        null,
        2,
      )}\n`,
      { overwrite: true },
    );
    await workspace.fs.writeFileAtomic(
      path.join(directory, 'assembler.report.json'),
      `${JSON.stringify({ ...finalReport, diagnostics: finalReport.diagnostics }, null, 2)}\n`,
      { overwrite: true },
    );
  };

  if (status !== 'built') {
    await writeMetadata(stagingDir, report).catch(() => undefined);
    return report;
  }

  /* ------------------------------------------------------------- publish */
  let published = false;
  try {
    if (await pathExists(targetDir)) {
      if (policy === 'backup') {
        const backup = path.join(workspace.paths.backupsDir, `${spec.slug}-${Date.now()}`);
        await workspace.fs.ensureDir(path.dirname(backup));
        await fs.rename(targetDir, backup);
        notes.push(`Existing project moved to ${backup}`);
      } else if (policy === 'replace') {
        await workspace.fs.remove(targetDir);
        notes.push(`Existing project removed from ${targetDir} (explicit replace policy)`);
      }
    }
    await workspace.fs.ensureDir(path.dirname(targetDir));
    try {
      await fs.rename(stagingDir, targetDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await workspace.fs.copyDirectory(stagingDir, targetDir);
      await workspace.fs.remove(stagingDir);
      notes.push('Staging directory was on a different filesystem; the project was copied.');
    }
    published = true;
  } catch (error) {
    failures.push({
      summary: `Publishing failed: ${error instanceof Error ? error.message : String(error)}`,
      category: 'environment',
      diagnostics: [],
      command: '',
      exitCode: null,
      timedOut: false,
      stderrTail: '',
    });
    notes.push('The staged project was preserved; the target directory was not modified.');
    await writeMetadata(stagingDir, report).catch(() => undefined);
    return { ...report, status: 'failed', notes };
  }

  const final: AssemblyReport = { ...report, published: true, notes };
  await writeMetadata(targetDir, final).catch((error: unknown) => {
    workspace.logger.warn('could not write assembly metadata', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  recordAssembly(workspace, spec, plan, final);
  return final;
}

/** Persist the project and assembly record. Persistence failures never fail a build. */
function recordAssembly(
  workspace: Workspace,
  spec: ProjectSpec,
  plan: AssembleOptions['plan'],
  report: AssemblyReport,
): void {
  try {
    const db: SqlDatabase = workspace.database();
    const projectId = deterministicId('prj', plan.blueprint.project.specHash);
    const assemblyId = deterministicId('asm', plan.blueprint.project.specHash, report.finishedAt, report.blueprintFingerprint);
    db.transaction(() => {
      const existing = db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (existing === undefined) {
        db.run(
          `INSERT INTO projects (id, name, slug, spec_version, spec_hash, spec_json, assembler_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            projectId,
            spec.name,
            spec.slug,
            spec.schemaVersion,
            plan.blueprint.project.specHash,
            JSON.stringify(spec),
            plan.blueprint.assemblerVersion,
            report.startedAt,
          ],
        );
      }
      db.run(
        `INSERT INTO assemblies
          (id, project_id, status, blueprint_hash, manifest_json, registry_snapshot, environment_signature, target_path, report_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assemblyId,
          projectId,
          report.status,
          report.blueprintFingerprint,
          JSON.stringify(
            plan.manifest.files.map((file) => ({ path: file.path, sha256: file.sha256, owner: file.owner })),
          ),
          JSON.stringify(plan.blueprint.components),
          report.environmentSignature,
          report.targetDir,
          JSON.stringify({ commands: report.commands, verification: report.verification, notes: report.notes }),
          report.finishedAt,
        ],
      );
    });
  } catch (error) {
    workspace.logger.warn('could not persist the assembly record', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Verify a previously generated project against its recorded manifest. */
export async function verifyGeneratedProject(
  workspace: Workspace,
  projectDir: string,
): Promise<{ ok: boolean; missing: string[]; unexpected: string[]; altered: string[] }> {
  const manifestFile = path.join(projectDir, 'assembler.manifest.json');
  let manifest: FileManifest;
  try {
    const raw = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      files: Array<{ path: string; sha256: string }>;
    };
    manifest = {
      schemaVersion: '1.0',
      files: raw.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        content: '',
        owner: '',
        kind: 'source',
        action: 'create',
        applicationId: '',
        exports: [],
        imports: [],
        externalImports: [],
        verified: false,
        provenance: {},
      })),
    };
    const result = await reconcileManifest(projectDir, manifest, workspace.fs);
    return { ok: result.ok, missing: [...result.missing], unexpected: [...result.unexpected], altered: [...result.altered] };
  } catch (error) {
    throw new AssemblerError({
      code: 'FILE_MISSING',
      message: `No readable assembler.manifest.json in ${projectDir}`,
      cause: error,
    });
  }
}

export function assemblyDigest(report: AssemblyReport): string {
  return sha256(JSON.stringify({ specHash: report.specHash, files: report.filesWritten, status: report.status }));
}

export { nowIso };
