import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Workspace } from '@assembler/core';
import { planProject } from '@assembler/project-planner';
import { interpretRequirement } from '@assembler/requirement-parser';
import { cleanup, createTestWorkspace, requireSpec } from './helpers.js';

let workspace: Workspace;
let root: string;

beforeEach(async () => {
  ({ workspace, root } = await createTestWorkspace('assembler-node-blog-'));
});

afterEach(async () => {
  workspace.close();
  await cleanup(root);
});

function blogSpec(text = 'Create a professional blog using Node.js with a dark theme and tests') {
  return requireSpec(
    interpretRequirement(text, { source: 'test', interpretedAt: '2026-01-01T00:00:00.000Z' }),
  );
}

describe('Node.js publication planning', () => {
  it('plans the complete server-rendered blog with no blockers', async () => {
    const spec = blogSpec();
    const plan = await planProject({ workspace, spec });

    expect(plan.ready).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.findings).toEqual([]);
    expect(plan.analysis.cycles).toEqual([]);
    expect(plan.analysis.missing).toEqual([]);
    expect(plan.blueprint.targets).toHaveLength(1);
    expect(plan.blueprint.targets[0]?.templateId).toBe('node-blog-server');
    expect(plan.blueprint.targets[0]?.deployment).toBe('node-server');

    const paths = plan.manifest.files.map((file) => file.path);
    for (const expected of [
      'src/app.ts',
      'src/server.ts',
      'src/router/router.ts',
      'src/router/routes.ts',
      'src/routes/pages.ts',
      'src/routes/api.ts',
      'src/services/content.ts',
      'src/views/post.ts',
      'src/views/styles.ts',
      'src/config.ts',
      'test/router.test.ts',
      'test/routes.test.ts',
      'test/links.test.ts',
      'package.json',
      'README.md',
      'assembler.spec.json',
    ]) {
      expect(paths, expected).toContain(expected);
    }
    expect([...paths].sort()).toEqual(paths);
  });

  it('declares every rendered route, including legacy-safe detail routes', async () => {
    const plan = await planProject({ workspace, spec: blogSpec() });
    const routes = plan.blueprint.routes.map((route) => route.path);
    for (const expected of [
      '/',
      '/posts',
      '/posts/:slug',
      '/categories',
      '/categories/:category',
      '/tags/:tag',
      '/search',
      '/about',
      '/contact',
      '/feed.xml',
      '/api/health',
      '/api/posts',
      '/api/posts/:slug',
    ]) {
      expect(routes, expected).toContain(expected);
    }
    expect(routes.indexOf('/posts')).toBeLessThan(routes.indexOf('/posts/:slug'));
  });

  it('injects the editorial design tokens and a serif typeface into the stylesheet', async () => {
    const plan = await planProject({ workspace, spec: blogSpec() });
    const styles = plan.manifest.files.find((file) => file.path === 'src/views/styles.ts');
    expect(styles?.content).toContain('--color-primary: #e2b457');
    expect(styles?.content).toContain('--font-serif:');
    expect(styles?.content).toContain('reading-progress');
    expect(plan.blueprint.design.style).toBe('editorial');
    expect(plan.blueprint.design.tokens.fontSerif).toContain('Palatino');
  });

  it('pins only development tooling, so the blog has no runtime dependencies', async () => {
    const plan = await planProject({ workspace, spec: blogSpec() });
    const packageFile = plan.manifest.files.find((file) => file.path === 'package.json');
    expect(packageFile).toBeDefined();
    const manifest = JSON.parse(packageFile?.content ?? '{}') as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({});
    expect(Object.keys(manifest.devDependencies).sort()).toEqual(['@types/node', 'typescript', 'vitest']);
    expect(manifest.scripts['typecheck']).toBe('tsc -p tsconfig.json');
    expect(manifest.scripts['build']).toBe('tsc -p tsconfig.build.json');
  });

  it('is deterministic for identical input', async () => {
    const spec = blogSpec();
    const first = await planProject({ workspace, spec, now: () => new Date('2026-02-01T00:00:00Z') });
    const second = await planProject({ workspace, spec, now: () => new Date('2026-03-01T00:00:00Z') });
    expect(JSON.stringify(first.manifest.files.map((file) => [file.path, file.sha256]))).toBe(
      JSON.stringify(second.manifest.files.map((file) => [file.path, file.sha256])),
    );
    expect(first.blueprint.knowledge).toEqual(second.blueprint.knowledge);
  });

  it('refuses to plan authenticated or admin screens on the publication target', async () => {
    const spec = blogSpec('Create a Node.js blog with a dashboard page and authentication');
    const plan = await planProject({ workspace, spec });
    expect(plan.ready).toBe(false);
    const capabilities = plan.blockers
      .filter((blocker) => blocker.code === 'UNSUPPORTED_CAPABILITY')
      .map((blocker) => blocker.message)
      .join(' ');
    expect(capabilities).toMatch(/authentication|dashboard/i);
    // Nothing was fabricated for the unsupported screens.
    expect(plan.manifest.files.some((file) => file.path.includes('DashboardPage'))).toBe(false);
  });
});
