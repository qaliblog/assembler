import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace, type Workspace } from '@assembler/core';
import { interpretRequirement, type InterpretationOutcome } from '@assembler/requirement-parser';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const templatesDir = path.join(repositoryRoot, 'templates');
export const knowledgeDir = path.join(repositoryRoot, 'knowledge');
export const librariesDir = path.join(repositoryRoot, 'libraries');

export async function createTestWorkspace(prefix = 'assembler-test-'): Promise<{ workspace: Workspace; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const workspace = createWorkspace({
    root,
    env: { ASSEMBLER_LOG_LEVEL: 'error' },
    overrides: {
      logLevel: 'error',
      paths: { templates: templatesDir, knowledge: knowledgeDir, libraries: librariesDir },
      registry: { databaseFile: path.join(root, '.assembler', 'assembler.db') },
      assembly: { stagingDir: '' },
      packageManagers: { installTimeoutMs: 900_000, preference: ['pnpm', 'npm', 'yarn'] },
    },
  });
  return { workspace, root };
}

export function interpretWebRequest(): InterpretationOutcome {
  return interpretRequirement(
    'Create a glassmorphism React dashboard called Demo Dashboard with a dashboard page, a users list page, a dark theme and tests',
    { source: 'test', interpretedAt: '2026-01-01T00:00:00.000Z' },
  );
}

export function requireSpec(outcome: InterpretationOutcome): NonNullable<InterpretationOutcome['spec']> {
  if (outcome.spec === null) {
    throw new Error(`Expected a specification but the interpreter returned ${outcome.status}`);
  }
  return outcome.spec;
}

export async function cleanup(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}
