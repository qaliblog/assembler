import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Workspace } from '@assembler/core';
import { assembleProject, verifyGeneratedProject, type AssemblyReport } from '@assembler/project-assembler';
import { planProject } from '@assembler/project-planner';
import { cleanup, createTestWorkspace, interpretWebRequest, requireSpec } from '../integration/helpers.js';

/**
 * These tests build a real project: install, typecheck, tests and a production
 * build all run in the staging directory. They are slow by design; nothing here is
 * stubbed, because the promise being tested is that generated code actually builds.
 */
const FULL_BUILD_TIMEOUT = 900_000;

let workspace: Workspace;
let root: string;
let report: AssemblyReport;

beforeAll(async () => {
  ({ workspace, root } = await createTestWorkspace('assembler-e2e-'));
  const spec = requireSpec(interpretWebRequest());
  const plan = await planProject({ workspace, spec });
  expect(plan.ready).toBe(true);
  report = await assembleProject({
    workspace,
    spec,
    plan,
    targetDir: path.join(root, 'app'),
  });
}, FULL_BUILD_TIMEOUT);

afterAll(async () => {
  workspace.close();
  await cleanup(root);
});

describe('end-to-end assembly', () => {
  it('publishes a project that installed, typechecked, tested and built', () => {
    expect(report.status).toBe('built');
    expect(report.published).toBe(true);
    expect(report.verification).toEqual({
      filesWritten: true,
      manifestReconciled: true,
      dependenciesInstalled: true,
      typechecked: true,
      tested: true,
      built: true,
    });
    for (const command of report.commands) {
      expect(command.ok, `${command.kind}: ${command.commandLine}\n${command.stderrTail}`).toBe(true);
    }
    expect(report.failures).toEqual([]);
    expect(report.commands.map((command) => command.kind)).toEqual(['install', 'typecheck', 'test', 'build']);
  });

  it('writes the project files, metadata and a production bundle to the target', async () => {
    const target = report.targetDir;
    for (const file of ['package.json', 'src/App.tsx', 'src/pages/DashboardPage.tsx', 'index.html', 'README.md']) {
      await expect(fs.access(path.join(target, file)), file).resolves.toBeUndefined();
    }
    const builtHtml = await fs.readFile(path.join(target, 'dist', 'index.html'), 'utf8');
    expect(builtHtml).toContain('<div id="root">');
    const manifest = JSON.parse(await fs.readFile(path.join(target, 'assembler.manifest.json'), 'utf8')) as {
      files: Array<{ path: string; sha256: string }>;
    };
    expect(manifest.files.length).toBe(report.filesWritten);
    expect(manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true);
  });

  it('leaves the generated project verifiable against its own manifest', async () => {
    const result = await verifyGeneratedProject(workspace, report.targetDir);
    expect(result.missing).toEqual([]);
    expect(result.altered).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('records the assembly so `history` can explain what was built', () => {
    const rows = workspace
      .database()
      .all<{ status: string; target_path: string }>('SELECT status, target_path FROM assemblies');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('built');
    expect(rows[0]?.target_path).toBe(report.targetDir);
  });
});

describe('assembly safety', () => {
  let secondRoot: string;
  let secondWorkspace: Workspace;

  beforeAll(async () => {
    ({ workspace: secondWorkspace, root: secondRoot } = await createTestWorkspace('assembler-e2e-guard-'));
  });

  afterAll(async () => {
    secondWorkspace.close();
    await cleanup(secondRoot);
  });

  it('writes files without installing when installation is disabled', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace: secondWorkspace, spec });
    const target = path.join(secondRoot, 'files-only');
    const result = await assembleProject({
      workspace: secondWorkspace,
      spec,
      plan,
      targetDir: target,
      installDependencies: false,
      runTypecheck: false,
      runTests: false,
      runBuild: false,
    });
    expect(result.status).toBe('built');
    expect(result.verification.dependenciesInstalled).toBe(false);
    expect(result.verification.built).toBe(false);
    await expect(fs.access(path.join(target, 'src', 'App.tsx'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(target, 'node_modules'))).rejects.toThrow();
  }, 120_000);

  it('refuses to overwrite a non-empty directory under the deny policy', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace: secondWorkspace, spec });
    const target = path.join(secondRoot, 'occupied');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'keep.txt'), 'owned by the user\n');
    await expect(
      assembleProject({ workspace: secondWorkspace, spec, plan, targetDir: target, installDependencies: false }),
    ).rejects.toMatchObject({ code: 'OVERWRITE_DENIED' });
    // The user's file is untouched.
    expect(await fs.readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('owned by the user\n');
  });

  it('refuses to assemble a plan with blockers', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace: secondWorkspace, spec });
    const blocked = { ...plan, blueprint: { ...plan.blueprint, blockers: [plan.blockers[0] ?? { code: 'X', message: 'x' }] } };
    await expect(
      assembleProject({
        workspace: secondWorkspace,
        spec,
        plan: blocked as unknown as typeof plan,
        targetDir: path.join(secondRoot, 'blocked'),
        installDependencies: false,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_INVALID' });
    await expect(fs.access(path.join(secondRoot, 'blocked'))).rejects.toThrow();
  });

  it('refuses to assemble over the workspace root', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace: secondWorkspace, spec });
    await expect(
      assembleProject({
        workspace: secondWorkspace,
        spec,
        plan,
        targetDir: secondRoot,
        installDependencies: false,
      }),
    ).rejects.toMatchObject({ code: 'OVERWRITE_DENIED' });
  });
});
