import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Workspace } from '@assembler/core';
import { assembleProject, verifyGeneratedProject, type AssemblyReport } from '@assembler/project-assembler';
import { planProject } from '@assembler/project-planner';
import { interpretRequirement } from '@assembler/requirement-parser';
import { cleanup, createTestWorkspace, requireSpec } from '../integration/helpers.js';

/**
 * A real build of the Node.js publication: install, typecheck, the generated
 * route/link suite and a production compile all run for real.
 */
const FULL_BUILD_TIMEOUT = 900_000;

let workspace: Workspace;
let root: string;
let report: AssemblyReport;

beforeAll(async () => {
  ({ workspace, root } = await createTestWorkspace('assembler-node-blog-e2e-'));
  const spec = requireSpec(
    interpretRequirement(
      'Create a professional blog using Node.js with a dark theme, categories, search and tests',
      { source: 'test', interpretedAt: '2026-01-01T00:00:00.000Z' },
    ),
  );
  const plan = await planProject({ workspace, spec });
  expect(plan.ready).toBe(true);
  report = await assembleProject({
    workspace,
    spec,
    plan,
    targetDir: path.join(root, 'publication'),
  });
}, FULL_BUILD_TIMEOUT);

afterAll(async () => {
  workspace.close();
  await cleanup(root);
});

describe('end-to-end Node.js publication', () => {
  it('installs, typechecks, runs the route suite and builds', () => {
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
    expect(report.commands.map((command) => command.kind)).toEqual(['install', 'typecheck', 'test', 'build']);
    for (const command of report.commands) {
      expect(command.ok, `${command.kind}: ${command.commandLine}\n${command.stderrTail}`).toBe(true);
    }
    expect(report.failures).toEqual([]);
  });

  it('publishes the layered router, views and compiled server', async () => {
    const target = report.targetDir;
    for (const file of [
      'package.json',
      'src/router/router.ts',
      'src/router/routes.ts',
      'src/views/styles.ts',
      'src/content/posts.ts',
      'test/routes.test.ts',
      'test/links.test.ts',
      'README.md',
      'dist/server.js',
      'dist/app.js',
      'dist/router/router.js',
    ]) {
      await expect(fs.access(path.join(target, file)), file).resolves.toBeUndefined();
    }

    const styles = await fs.readFile(path.join(target, 'src/views/styles.ts'), 'utf8');
    expect(styles).toContain('--color-primary: #e2b457');
    expect(styles).toContain('@media (max-width: 640px)');

    const readme = await fs.readFile(path.join(target, 'README.md'), 'utf8');
    expect(readme).toContain('/posts/:slug');
    expect(readme).toContain('route suite');
  });

  it('leaves the publication verifiable against its own manifest', async () => {
    const result = await verifyGeneratedProject(workspace, report.targetDir);
    expect(result).toEqual({ ok: true, missing: [], unexpected: [], altered: [] });
  });
});
