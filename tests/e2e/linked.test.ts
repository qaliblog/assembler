import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repositoryRoot } from '../integration/helpers.js';

/**
 * These tests exercise the *installed* executable the way a user does: the
 * package linked globally with `npm link`, invoked from a directory that is not
 * the repository. Nothing here resolves a path inside the checkout except the
 * link itself, so a build that only works next to the source would fail.
 */

const REQUEST = 'Create a React dashboard called Linked E2E with a dashboard page';

let executable: string;
let globalPrefix: string;
const outsideDirs: string[] = [];

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; timeout?: number; input?: string },
): { code: number | null; stdout: string; stderr: string } {
  const result: SpawnSyncReturns<string> = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1', ASSEMBLER_LOG_LEVEL: 'error' },
    timeout: options.timeout ?? 180_000,
    input: options.input ?? '',
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function makeOutsideDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  outsideDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  const build = spawnSync('pnpm', ['exec', 'tsc', '-b', 'tsconfig.build.json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (build.status !== 0) throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);

  const prefix = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf8' });
  if (prefix.status !== 0) throw new Error(`npm prefix failed: ${prefix.stderr}`);
  globalPrefix = (prefix.stdout ?? '').trim();
  executable = path.join(globalPrefix, 'bin', 'assembler');

  const link = spawnSync('npm', ['link'], { cwd: repositoryRoot, encoding: 'utf8', timeout: 300_000 });
  if (link.status !== 0) throw new Error(`npm link failed:\n${link.stdout}\n${link.stderr}`);
}, 400_000);

afterAll(async () => {
  spawnSync('npm', ['uninstall', '-g', 'assembler'], { encoding: 'utf8', timeout: 180_000 });
  await Promise.all(outsideDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

let genericCwd: string;

describe('global installation', () => {
  it('links an executable that runs from any directory', async () => {
    genericCwd = await makeOutsideDir('assembler-linked-generic-');
    expect(genericCwd.startsWith(path.resolve(repositoryRoot))).toBe(false);
    const result = run(executable, ['--version'], { cwd: genericCwd });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('assembler 0.1.0');
  });

  it('serves its assets from the installation, not the caller directory', () => {
    const cwd = genericCwd;
    const result = run(executable, ['plan', path.join('nonexistent', 'spec.json')], { cwd });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Specification file not found');
    // The failure came from the CLI, not from a missing assets directory.
    expect(result.stderr).not.toContain('Cannot locate the Assembler assets');
  });

  it('resolves the workspace from process.cwd()', () => {
    const cwd = genericCwd;
    const result = run(executable, ['doctor', '--json'], { cwd });
    expect([0, 3]).toContain(result.code);
    const payload = JSON.parse(result.stdout) as { platform: { os: string }; packageManager: { name: string } | null };
    expect(typeof payload.platform.os).toBe('string');
    expect(payload.packageManager?.name).toMatch(/pnpm|npm|yarn/);
  });

  it('explains how to proceed when the terminal is not interactive', () => {
    const cwd = genericCwd;
    const result = run(executable, [], { cwd, input: '' });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('needs a terminal');
    expect(result.stdout).toContain('--prompt');
  });

  it('reports unknown commands as usage errors', () => {
    const cwd = genericCwd;
    const result = run(executable, ['frobnicate'], { cwd });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown command');
  });
});

describe('building from a directory outside the repository', () => {
  it('generates, verifies and tests a real project in the current directory', async () => {
    const projectDir = await makeOutsideDir('assembler-linked-e2e-');
    const result = run(executable, ['--prompt', REQUEST], { cwd: projectDir, timeout: 600_000 });
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Project generated successfully.');
    expect(result.stdout).toContain('Verification: install=true typecheck=true test=true build=true');

    // Files landed in the directory the user was standing in.
    for (const file of ['package.json', 'src/App.tsx', 'src/pages/DashboardPage.tsx', 'index.html']) {
      await expect(fs.access(path.join(projectDir, file)), file).resolves.toBeUndefined();
    }
    const manifest = JSON.parse(await fs.readFile(path.join(projectDir, 'assembler.manifest.json'), 'utf8')) as {
      files: Array<{ path: string }>;
    };
    expect(manifest.files.length).toBeGreaterThan(30);

    // The manifest still matches what was written.
    const inspect = run(executable, ['inspect', projectDir], { cwd: projectDir });
    expect(inspect.code).toBe(0);
    expect(inspect.stdout).toContain('Manifest verification: ok');

    // The project passes its own checks in the directory it now lives in.
    const typecheck = run('pnpm', ['run', 'typecheck'], { cwd: projectDir, timeout: 300_000 });
    expect(typecheck.code, typecheck.stderr).toBe(0);
    const tests = run('pnpm', ['run', 'test'], { cwd: projectDir, timeout: 300_000 });
    expect(tests.code, tests.stderr).toBe(0);
    expect(tests.stdout).toContain('Tests');
    await expect(fs.access(path.join(projectDir, 'dist', 'index.html'))).resolves.toBeUndefined();
  }, 700_000);

  it('never touches files the user already owns', async () => {
    const projectDir = await makeOutsideDir('assembler-linked-conflict-');
    const mine = '// written by the user, keep me\n';
    await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'src', 'App.tsx'), mine);

    const result = run(executable, ['--prompt', REQUEST], { cwd: projectDir, timeout: 300_000 });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('Re-run with --yes');
    expect(await fs.readFile(path.join(projectDir, 'src', 'App.tsx'), 'utf8')).toBe(mine);
    // Nothing else was written either (beyond Assembler's own state directory).
    const entries = await fs.readdir(projectDir);
    expect(entries.filter((name) => name !== 'src' && name !== '.assembler')).toEqual([]);
  }, 400_000);

  it('supports --workspace to build elsewhere without changing directory', async () => {
    const callerDir = await makeOutsideDir('assembler-linked-caller-');
    const targetDir = path.join(callerDir, 'blog');
    const result = run(
      executable,
      ['--workspace', targetDir, '--prompt', REQUEST, '--no-install', '--no-typecheck', '--no-tests', '--no-build'],
      { cwd: callerDir, timeout: 300_000 },
    );
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    await expect(fs.access(path.join(targetDir, 'package.json'))).resolves.toBeUndefined();
    // The caller directory itself was not turned into a project.
    const callerEntries = await fs.readdir(callerDir);
    expect(callerEntries).not.toContain('package.json');
  }, 400_000);
});
