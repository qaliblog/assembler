import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import type { Workspace } from '@assembler/core';
import { loadCatalog } from '@assembler/component-registry';
import { planProject, validateManifest } from '@assembler/project-planner';
import {
  cleanup,
  createTestWorkspace,
  interpretWebRequest,
  librariesDir,
  repositoryRoot,
  requireSpec,
} from './helpers.js';

let workspace: Workspace;
let root: string;

beforeEach(async () => {
  ({ workspace, root } = await createTestWorkspace('assembler-plan-test-'));
});

afterEach(async () => {
  workspace.close();
  await cleanup(root);
});

describe('specification to blueprint', () => {
  it('plans a complete web project with an inspectable manifest', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace, spec });

    expect(plan.ready).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.manifest.files.length).toBeGreaterThan(30);
    expect(plan.findings).toEqual([]);
    expect(plan.analysis.cycles).toEqual([]);
    expect(plan.analysis.missing).toEqual([]);

    const paths = plan.manifest.files.map((file) => file.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('src/App.tsx');
    expect(paths).toContain('src/pages/DashboardPage.tsx');
    expect(paths).toContain('src/pages/RecordsPage.tsx');
    expect(paths).toContain('src/components/MetricCard.tsx');
    expect(paths).toContain('src/pages/Page.test.tsx');
    expect(paths).toContain('assembler.spec.json');
    // The generated project manifest is sorted so plans diff cleanly.
    expect([...paths].sort()).toEqual(paths);
  });

  it('assigns every file an owner and records provenance', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace, spec });
    for (const file of plan.manifest.files) {
      expect(file.owner, file.path).not.toBe('');
      expect(file.sha256, file.path).toHaveLength(64);
    }
    const metric = plan.manifest.files.find((file) => file.path === 'src/components/MetricCard.tsx');
    expect(metric?.provenance.component).toBe('metric-card');
    expect(metric?.provenance.componentVersion).toBe('1.0.0');
    expect(plan.blueprint.components.map((component) => component.name)).toContain('metric-card');
  });

  it('produces identical file content on repeated planning', async () => {
    const spec = requireSpec(interpretWebRequest());
    const first = await planProject({ workspace, spec, now: () => new Date('2026-02-01T00:00:00Z') });
    const second = await planProject({ workspace, spec, now: () => new Date('2026-03-01T00:00:00Z') });
    const digest = (plan: typeof first): string =>
      JSON.stringify(plan.manifest.files.map((file) => [file.path, file.sha256]));
    expect(digest(first)).toBe(digest(second));
    expect(first.blueprint.project.specHash).toBe(second.blueprint.project.specHash);
    expect(first.blueprint.knowledge).toEqual(second.blueprint.knowledge);
  });

  it('injects the requested design tokens into the stylesheet', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace, spec });
    const tokens = plan.manifest.files.find((file) => file.path === 'src/styles/tokens.css');
    expect(tokens).toBeDefined();
    expect(tokens?.content).toContain('--blur: 18px');
    expect(tokens?.content).toContain('--color-primary: #6366f1');
    expect(tokens?.content).toContain('color-scheme: dark');
    expect(plan.blueprint.design.style).toBe('glassmorphism');
    expect(plan.blueprint.design.tokens.colorPrimaryContrast).toBe('#ffffff');
  });

  it('validates the manifest it produces', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace, spec });
    expect(validateManifest(plan.manifest)).toEqual([]);
  });

  it('wires dashboard routes and generated tests together', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace, spec });
    const routes = plan.manifest.files.find((file) => file.path === 'src/app/routes.tsx');
    expect(routes?.content).toContain("path: \"/dashboard\"");
    expect(routes?.content).toContain("path: \"/records\"");
    expect(routes?.content).toContain('<DashboardPage />');
    const pageTests = plan.manifest.files.find((file) => file.path === 'src/pages/Page.test.tsx');
    expect(pageTests?.content).toContain("renders the Dashboard page");
  });
});

describe('blocked plans', () => {
  it('refuses to plan a project whose verified component is missing', async () => {
    const spec = requireSpec(interpretWebRequest());
    const catalog = (await loadCatalog(librariesDir)).filter((record) => record.manifest.name !== 'metric-card');
    const plan = await planProject({ workspace, spec, catalog });
    expect(plan.ready).toBe(false);
    expect(plan.blockers.map((blocker) => blocker.code)).toContain('COMPONENT_MISSING');
  });

  it('reports backend targets as not implemented instead of approximating them', async () => {
    const spec = requireSpec(
      (await import('@assembler/requirement-parser')).interpretRequirement(
        'Create a React website with a dashboard page and a separate FastAPI backend that uses SQLite',
        { source: 'test' },
      ),
    );
    const plan = await planProject({ workspace, spec });
    expect(plan.ready).toBe(false);
    expect(plan.blockers.map((blocker) => blocker.code)).toContain('TARGET_NOT_IMPLEMENTED');
    expect(plan.blueprint.unresolved.join(' ')).toContain('backend');
    // No fabricated backend files were planned.
    expect(plan.manifest.files.some((file) => file.path.includes('requirements.txt'))).toBe(false);
  });

  it('reports an unsupported capability as a blocker', async () => {
    const spec = requireSpec(
      (await import('@assembler/requirement-parser')).interpretRequirement(
        'Create a React dashboard with end-to-end tests',
        { source: 'test' },
      ),
    );
    const plan = await planProject({ workspace, spec });
    expect(plan.ready).toBe(false);
    expect(plan.blockers.map((blocker) => blocker.code)).toContain('UNSUPPORTED_CAPABILITY');
  });
});

describe('knowledge integrity', () => {
  it('records hashes of the knowledge files used for the plan', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace, spec });
    expect(plan.blueprint.knowledge.versionsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.blueprint.knowledge.designHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.blueprint.knowledge.templateId).toBe('react-web-vite');
  });

  it('fails clearly when the template directory is missing', async () => {
    const spec = requireSpec(interpretWebRequest());
    workspace.close();
    const { createWorkspace } = await import('@assembler/core');
    const broken = createWorkspace({
      root,
      env: { ASSEMBLER_LOG_LEVEL: 'error' },
      overrides: {
        logLevel: 'error',
        paths: {
          templates: path.join(root, 'missing-templates'),
          knowledge: path.join(repositoryRoot, 'knowledge'),
          libraries: path.join(repositoryRoot, 'libraries'),
        },
      },
    });
    try {
      await expect(planProject({ workspace: broken, spec })).rejects.toMatchObject({ code: 'PLAN_INVALID' });
    } finally {
      broken.close();
    }
  });
});
