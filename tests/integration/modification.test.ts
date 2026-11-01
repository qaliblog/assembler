import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Workspace } from '@assembler/core';
import { assembleProject, verifyGeneratedProject } from '@assembler/project-assembler';
import { applyModification, loadGeneratedProject, planModification } from '@assembler/project-modifier';
import { planProject } from '@assembler/project-planner';
import { cleanup, createTestWorkspace, interpretWebRequest, requireSpec } from './helpers.js';

let workspace: Workspace;
let root: string;
let pristine: string;
let projectDir: string;

async function generate(targetDir: string): Promise<void> {
  const spec = requireSpec(interpretWebRequest());
  const environment = await import('@assembler/environment-manager').then((module) =>
    module.scanEnvironment({ workspace, probeNetwork: false }),
  );
  const plan = await planProject({ workspace, spec, environment });
  expect(plan.ready).toBe(true);
  const report = await assembleProject({
    workspace,
    spec,
    plan,
    targetDir,
    installDependencies: false,
    runTypecheck: false,
    runTests: false,
    runBuild: false,
  });
  expect(report.status).toBe('built');
}

beforeAll(async () => {
  ({ workspace, root } = await createTestWorkspace('assembler-modify-'));
  pristine = path.join(root, 'pristine');
  await generate(pristine);
}, 120_000);

beforeEach(async () => {
  // A fresh copy per test: assembling has its own coverage elsewhere, and an
  // unchanged copy proves the modifier never depends on a stale fixture.
  projectDir = path.join(root, 'app');
  await fs.cp(pristine, projectDir, { recursive: true });
});

afterAll(async () => {
  workspace.close();
  await cleanup(root);
});

describe('existing-project modification', () => {
  it('plans an explicit, dependency-aware change and applies it without regenerating the project', async () => {
    const loaded = await loadGeneratedProject(projectDir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const plan = planModification('Add a beautiful modern admin dashboard to this application', loaded.context);
    expect(plan.blockers).toEqual([]);
    expect(plan.page.route).toBe('/admin');
    expect(plan.tasks.map((task) => task.id)).toContain('verify');
    expect(plan.tasks.find((task) => task.id === 'verify')?.dependsOn).toEqual(['update-metadata']);

    const before = await fs.readFile(path.join(projectDir, 'src/pages/DashboardPage.tsx'), 'utf8');
    const report = await applyModification({ workspace, projectDir, plan, typecheck: false, tests: false });
    expect(report.status).toBe('modified');
    expect(report.verification.skipped).toBe(true);
    expect(report.rolledBack).toBe(false);

    const routes = await fs.readFile(path.join(projectDir, 'src/app/routes.tsx'), 'utf8');
    expect(routes).toContain("import { AdminPage } from '../pages/AdminPage';");
    expect(routes).toContain('path: "/admin"');
    expect(routes).toContain('path: "/dashboard"');
    await expect(fs.access(path.join(projectDir, 'src/pages/AdminPage.tsx'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(projectDir, 'src/pages/AdminPage.test.tsx'))).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(projectDir, 'src/pages/DashboardPage.tsx'), 'utf8')).toBe(before);

    const spec = JSON.parse(await fs.readFile(path.join(projectDir, 'assembler.spec.json'), 'utf8')) as {
      applications: Array<{ pages: Array<{ id: string; route?: string }> }>;
    };
    expect(spec.applications[0]?.pages.some((page) => page.route === '/admin')).toBe(true);

    const verification = await verifyGeneratedProject(workspace, projectDir);
    expect(verification).toEqual({ ok: true, missing: [], unexpected: [], altered: [] });
  });

  it('refuses to patch a route table that changed after planning', async () => {
    const loaded = await loadGeneratedProject(projectDir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const plan = planModification('Add an admin dashboard', loaded.context);
    const routesFile = path.join(projectDir, 'src/app/routes.tsx');
    await fs.appendFile(routesFile, '\n// user edit\n');

    await expect(
      applyModification({ workspace, projectDir, plan, typecheck: false, tests: false }),
    ).rejects.toMatchObject({
      code: 'MODIFICATION_CONFLICT',
    });
    expect(await fs.readFile(routesFile, 'utf8')).toContain('// user edit');
  });

  it('restores every touched file when verification fails', async () => {
    // A project without installed dependencies cannot typecheck; the modifier
    // must refuse before writing rather than claim a verified change.
    const loaded = await loadGeneratedProject(projectDir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const plan = planModification('Add an analytics dashboard', loaded.context);
    await expect(
      applyModification({ workspace, projectDir, plan, typecheck: true, tests: false }),
    ).rejects.toMatchObject({
      code: 'DEPENDENCIES_MISSING',
    });
    await expect(fs.access(path.join(projectDir, 'src/pages/AnalyticsPage.tsx'))).rejects.toBeDefined();
  });

  it('rolls back the page, routes and metadata when the project test script fails', async () => {
    await fs.mkdir(path.join(projectDir, 'node_modules'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'modify-fixture',
          private: true,
          scripts: { test: 'node -e "process.exit(1)"' },
        },
        null,
        2,
      )}\n`,
    );
    const loaded = await loadGeneratedProject(projectDir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const plan = planModification('Add a reports page', loaded.context);
    const routesBefore = await fs.readFile(path.join(projectDir, 'src/app/routes.tsx'), 'utf8');
    const specBefore = await fs.readFile(path.join(projectDir, 'assembler.spec.json'), 'utf8');

    const report = await applyModification({ workspace, projectDir, plan, typecheck: false, tests: true });
    expect(report.status).toBe('failed');
    expect(report.rolledBack).toBe(true);
    expect(report.commands.some((command) => !command.ok)).toBe(true);
    expect(await fs.readFile(path.join(projectDir, 'src/app/routes.tsx'), 'utf8')).toBe(routesBefore);
    expect(await fs.readFile(path.join(projectDir, 'assembler.spec.json'), 'utf8')).toBe(specBefore);
    await expect(fs.access(path.join(projectDir, 'src/pages/ReportsPage.tsx'))).rejects.toBeDefined();
  });

  it('refuses an arbitrary directory and unsupported changes honestly', async () => {
    const plain = path.join(root, 'plain');
    await fs.mkdir(plain, { recursive: true });
    await fs.writeFile(path.join(plain, 'package.json'), '{"name":"plain"}\n');
    const notGenerated = await loadGeneratedProject(plain);
    expect(notGenerated.ok).toBe(false);
    if (!notGenerated.ok) expect(notGenerated.code).toBe('NOT_GENERATED_PROJECT');
    expect(await fs.readdir(plain)).toEqual(['package.json']);

    const loaded = await loadGeneratedProject(projectDir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const plan = planModification('Fix the broken routing and improve the design', loaded.context);
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(plan.blockers[0]?.code).toBe('MODIFICATION_UNSUPPORTED');
    const entries = await fs.readdir(projectDir);
    expect(entries).toContain('package.json');
  });
});
