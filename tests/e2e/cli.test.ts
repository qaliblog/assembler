import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, createTestWorkspace, repositoryRoot } from '../integration/helpers.js';

const cliEntry = path.join(repositoryRoot, 'apps', 'cli', 'dist', 'main.js');

interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd,
      env: { ...process.env, CI: '1', NO_COLOR: '1', ASSEMBLER_LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function parseJson<T>(stdout: string): T {
  const start = Math.min(
    ...[stdout.indexOf('{'), stdout.indexOf('[')].filter((index) => index >= 0),
  );
  return JSON.parse(stdout.slice(start)) as T;
}

let root: string;

beforeAll(async () => {
  ({ root } = await createTestWorkspace('assembler-cli-'));
  // The CLI is executed as the user runs it, so its build output must exist.
  await fs.access(cliEntry).catch(async () => {
    const build = spawn('pnpm', ['exec', 'tsc', '-b', 'tsconfig.build.json'], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });
    await new Promise<void>((resolve, reject) => {
      build.on('error', reject);
      build.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tsc -b exited with ${String(code)}`))));
    });
  });
}, 300_000);

afterAll(async () => {
  await cleanup(root);
});

describe('assembler CLI', () => {
  it('prints help and exits 0', async () => {
    const result = await runCli(['help'], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('assembler — deterministic software assembly');
    expect(result.stdout).toContain('Exit codes: 0 ok');
  });

  it('interprets a request and writes a specification that can be planned', async () => {
    const interpret = await runCli(
      ['interpret', 'Create a glassmorphism React dashboard called CLI Demo with a dashboard page', '--out', 'project.json', '--json'],
      root,
    );
    expect(interpret.code).toBe(0);
    const interpreted = parseJson<{ spec: { name: string; slug: string; applications: Array<{ kind: string }> } }>(
      interpret.stdout,
    );
    expect(interpreted.spec.slug).toBe('cli-demo');
    expect(interpreted.spec.applications[0]?.kind).toBe('web');

    const specFile = path.join(root, 'project.json');
    await expect(fs.access(specFile)).resolves.toBeUndefined();

    const plan = await runCli(['plan', specFile, '--root', repositoryRoot, '--json'], root);
    expect(plan.code).toBe(0);
    const payload = parseJson<{ ready: boolean; blockers: unknown[]; blueprint: { files: unknown[] } }>(
      plan.stdout,
    );
    expect(payload.ready).toBe(true);
    expect(payload.blockers).toEqual([]);
    expect(payload.blueprint.files.length).toBeGreaterThan(20);
  }, 120_000);

  it('writes a project without installing and verifies it with inspect', async () => {
    const specFile = path.join(root, 'project.json');
    const build = await runCli(
      ['build', specFile, '--root', repositoryRoot, '--target', './cli-app', '--no-install', '--no-build', '--json'],
      root,
    );
    expect(build.code).toBe(0);
    const report = parseJson<{ status: string; published: boolean; filesWritten: number }>(build.stdout);
    expect(report.status).toBe('built');
    expect(report.published).toBe(true);
    expect(report.filesWritten).toBeGreaterThan(20);

    const inspect = await runCli(['inspect', './cli-app', '--root', repositoryRoot, '--json'], root);
    expect(inspect.code).toBe(0);
    expect(parseJson<{ ok: boolean }>(inspect.stdout).ok).toBe(true);
  }, 180_000);

  it('refuses to build into a non-empty directory with the default policy', async () => {
    const specFile = path.join(root, 'project.json');
    const result = await runCli(
      ['build', specFile, '--root', repositoryRoot, '--target', './cli-app', '--no-install', '--no-build', '--json'],
      root,
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('Target directory is not empty');
  }, 120_000);

  it('reports unknown commands and flags as usage errors', async () => {
    const unknownCommand = await runCli(['frobnicate'], root);
    expect(unknownCommand.code).toBe(2);
    expect(unknownCommand.stderr).toContain('Unknown command: frobnicate');

    const unknownFlag = await runCli(['plan', 'project.json', '--nope', '--json'], root);
    expect(unknownFlag.code).toBe(2);
    expect(unknownFlag.stderr).toContain('Unknown flag: --nope');
  });

  it('exits 2 for a missing specification and 4 for unimplemented features', async () => {
    const missing = await runCli(['plan', 'absent.json', '--json'], root);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Specification file not found');

    const repair = await runCli(['repair', '.'], root);
    expect(repair.code).toBe(4);
    expect(repair.stdout).toContain('not implemented');
  });

  it('indexes the component library and finds verified components', async () => {
    const sync = await runCli(['registry', 'add', '--root', repositoryRoot, '--json'], root);
    expect(sync.code).toBe(0);
    expect(parseJson<{ total: number }>(sync.stdout).total).toBeGreaterThan(0);

    const search = await runCli(['registry', 'search', 'metric', '--root', repositoryRoot, '--json'], root);
    expect(search.code).toBe(0);
    const records = parseJson<Array<{ name: string; lifecycle: string }>>(search.stdout);
    expect(records[0]?.name).toBe('metric-card');

    const verify = await runCli(['registry', 'verify', 'metric-card', '--root', repositoryRoot, '--json'], root);
    expect(verify.code).toBe(0);
    expect(parseJson<{ passed: boolean }>(verify.stdout).passed).toBe(true);
  }, 120_000);

  it('records the build in history', async () => {
    const history = await runCli(['history', '--root', repositoryRoot, '--json'], root);
    expect(history.code).toBe(0);
    const rows = parseJson<Array<{ status: string; target: string }>>(history.stdout);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.status).toBe('built');
  });
});
