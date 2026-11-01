/**
 * Incremental assembly: planned files reach the workspace as they are generated,
 * before any install/typecheck/test/build step, and survive a later abort.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleProject, type AssemblyFileEvent } from '@assembler/project-assembler';
import { planProject } from '@assembler/project-planner';
import { cleanup, createTestWorkspace, interpretWebRequest, requireSpec } from './helpers.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => cleanup(root)));
});

async function prepare() {
  const { workspace, root } = await createTestWorkspace('assembler-incremental-');
  roots.push(root);
  const spec = requireSpec(interpretWebRequest());
  const plan = await planProject({ workspace, spec, now: () => new Date('2026-01-01T00:00:00.000Z') });
  expect(plan.ready).toBe(true);
  return { workspace, root, spec, plan };
}

describe('incremental file writing', () => {
  it('writes every planned file into the workspace as it is generated', async () => {
    const { workspace, root, spec, plan } = await prepare();
    const events: AssemblyFileEvent[] = [];

    const report = await assembleProject({
      workspace,
      spec,
      plan,
      targetDir: root,
      publish: 'in-place',
      installDependencies: false,
      runTypecheck: false,
      runTests: false,
      runBuild: false,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      onFile: (event) => events.push(event),
    });

    expect(report.status).toBe('built');
    expect(report.published).toBe(true);
    expect(events).toHaveLength(plan.manifest.files.length);
    expect(report.filesWritten).toBe(plan.manifest.files.length);
    expect(events[0]?.writtenToWorkspace).toBe(true);
    expect(events[0]?.index).toBe(0);
    for (const file of plan.manifest.files) {
      await expect(fs.access(path.join(root, file.path))).resolves.toBeUndefined();
    }
    expect(report.verification.filesWritten).toBe(true);
  });

  it('keeps files that were already generated when a later step is cancelled', async () => {
    const { workspace, root, spec, plan } = await prepare();
    const controller = new AbortController();
    const written: string[] = [];

    const report = await assembleProject({
      workspace,
      spec,
      plan,
      targetDir: root,
      publish: 'in-place',
      installDependencies: false,
      runTypecheck: false,
      runTests: false,
      runBuild: false,
      abortSignal: controller.signal,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      onFile: (event) => {
        written.push(event.path);
        if (written.length === 2) controller.abort();
      },
    });

    expect(report.status).toBe('cancelled');
    expect(report.published).toBe(true);
    expect(report.filesWritten).toBe(2);
    expect(written).toHaveLength(2);
    for (const relative of written) {
      await expect(fs.access(path.join(root, relative))).resolves.toBeUndefined();
    }
    expect(report.notes.some((note) => note.includes('kept'))).toBe(true);
  });
});
