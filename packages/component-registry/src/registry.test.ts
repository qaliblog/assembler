import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace, type Workspace } from '@assembler/core';
import { loadCatalog } from './catalog.js';
import { ComponentRegistry } from './registry.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const librariesDir = path.join(repositoryRoot, 'libraries');

let root: string;
let workspace: Workspace;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'assembler-registry-test-'));
  workspace = createWorkspace({ root, env: { ASSEMBLER_LOG_LEVEL: 'silent' } });
});

afterEach(async () => {
  workspace.close();
  await fs.rm(root, { recursive: true, force: true });
});

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'demo-card',
    version: '1.0.0',
    category: 'ui',
    description: 'Demo card',
    license: 'MIT',
    provenance: 'internal',
    framework: 'react',
    platforms: ['web'],
    exports: [{ name: 'DemoCard', from: 'DemoCard.tsx' }],
    files: [{ source: 'DemoCard.tsx', target: 'src/components/DemoCard.tsx', mode: 'copy', kind: 'source' }],
    tags: ['demo'],
    lifecycle: 'verified',
    verification: { level: 'tested', method: 'test' },
    ...overrides,
  };
}

async function writeComponent(directory: string, overrides: Record<string, unknown> = {}, source = 'export function DemoCard() { return null; }'): Promise<string> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'component.json'), JSON.stringify(manifest(overrides), null, 2));
  await fs.writeFile(path.join(directory, 'DemoCard.tsx'), source);
  return directory;
}

describe('loadCatalog', () => {
  it('indexes the repository component library', async () => {
    const records = await loadCatalog(librariesDir);
    expect(records.length).toBeGreaterThan(0);
    const metric = records.find((record) => record.manifest.name === 'metric-card');
    expect(metric?.manifest.lifecycle).toBe('verified');
    expect(metric?.sourceHash).toHaveLength(64);
  });

  it('rejects an invalid manifest with an actionable error', async () => {
    const bad = await writeComponent(path.join(root, 'libraries', 'bad'), { name: 'Bad Name' });
    await expect(loadCatalog(path.join(root, 'libraries'))).rejects.toMatchObject({
      code: 'REGISTRY_ENTRY_INVALID',
    });
    expect(bad).toContain('bad');
  });

  it('excludes unverified components unless asked', async () => {
    await writeComponent(path.join(root, 'libraries', 'draft'), { name: 'draft-card', lifecycle: 'draft' });
    expect(await loadCatalog(path.join(root, 'libraries'))).toHaveLength(0);
    expect(await loadCatalog(path.join(root, 'libraries'), { includeUnverified: true })).toHaveLength(1);
  });
});

describe('ComponentRegistry', () => {
  it('syncs the catalogue into SQLite and searches it', async () => {
    const registry = new ComponentRegistry(workspace, librariesDir);
    const result = await registry.sync();
    expect(result.total).toBeGreaterThan(0);
    expect(result.added).toBe(result.total);

    const found = registry.search('metric card');
    expect(found.map((record) => record.name)).toContain('metric-card');

    const inspected = registry.inspect('metric-card');
    expect(inspected?.version).toBe('1.0.0');
    expect(inspected?.tags).toContain('dashboard');
    expect(inspected?.license).toBe('MIT');
  });

  it('is idempotent when nothing changed', async () => {
    const registry = new ComponentRegistry(workspace, librariesDir);
    await registry.sync();
    const second = await registry.sync();
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
  });

  it('records structural verification without inventing a test run', async () => {
    const registry = new ComponentRegistry(workspace, librariesDir);
    await registry.sync();
    const report = await registry.verify('metric-card');
    expect(report.passed).toBe(true);
    expect(report.level).toBe('structural');
    expect(report.claimsTested).toBe(true);
    expect(report.findings.some((finding) => finding.code === 'VERIFY_TESTED_CLAIM')).toBe(true);
    expect(registry.history('metric-card').length).toBe(1);
  });

  it('downgrades verification when component sources change', async () => {
    const libraries = path.join(root, 'libraries');
    await writeComponent(path.join(libraries, 'demo'));
    const registry = new ComponentRegistry(workspace, libraries);
    await registry.sync();
    expect(registry.inspect('demo-card')?.lifecycle).toBe('verified');

    await fs.writeFile(
      path.join(libraries, 'demo', 'DemoCard.tsx'),
      'export function DemoCard() { return "changed"; }',
    );
    const sync = await registry.sync();
    expect(sync.updated).toBe(1);
    expect(registry.inspect('demo-card')?.lifecycle).toBe('candidate');
  });

  it('fails verification for a target path that escapes the project', async () => {
    const libraries = path.join(root, 'libraries');
    await writeComponent(path.join(libraries, 'escape'), {
      name: 'escape-card',
      files: [{ source: 'DemoCard.tsx', target: '../outside/DemoCard.tsx', mode: 'copy', kind: 'source' }],
    });
    const registry = new ComponentRegistry(workspace, libraries);
    await registry.sync();
    const report = await registry.verify('escape-card');
    expect(report.passed).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain('VERIFY_TARGET_ESCAPE');
  });

  it('fails verification when a declared export is missing', async () => {
    const libraries = path.join(root, 'libraries');
    await writeComponent(path.join(libraries, 'noexport'), { name: 'noexport-card' }, 'export const Other = 1;');
    const registry = new ComponentRegistry(workspace, libraries);
    await registry.sync();
    const report = await registry.verify('noexport-card');
    expect(report.passed).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain('VERIFY_EXPORT_MISSING');
  });

  it('deprecates a component and refuses unknown names', async () => {
    const libraries = path.join(root, 'libraries');
    await writeComponent(path.join(libraries, 'demo'));
    const registry = new ComponentRegistry(workspace, libraries);
    await registry.sync();
    const deprecated = registry.deprecate('demo-card', undefined, 'demo-card@2.0.0');
    expect(deprecated.lifecycle).toBe('deprecated');
    expect(deprecated.deprecatedBy).toBe('demo-card@2.0.0');
    expect(() => registry.deprecate('missing-card', undefined)).toThrowError(/unknown component/i);
  });
});
