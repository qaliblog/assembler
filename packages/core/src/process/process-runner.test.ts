import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProcessRunner, formatCommandLine, quoteForCmd } from './process-runner.js';

describe('ProcessRunner', () => {
  it('captures stdout, stderr and exit code', async () => {
    const runner = new ProcessRunner();
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("out"); process.stderr.write("err");'],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.spawnError).toBeNull();
  });

  it('passes arguments as an array, never through a shell', async () => {
    const runner = new ProcessRunner();
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', 'a; echo INJECTED'],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('a; echo INJECTED');
    expect(result.stdout).not.toContain('INJECTED\n');
  });

  it('reports a missing executable without throwing', async () => {
    const runner = new ProcessRunner();
    const result = await runner.run({ executable: 'assembler-definitely-missing-binary' });
    expect(result.spawnError?.code).toBe('EXECUTABLE_NOT_FOUND');
    expect(result.exitCode).toBeNull();
  });

  it('enforces a timeout', async () => {
    const runner = new ProcessRunner({ defaultTimeoutMs: 500 });
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
  });

  it('truncates oversized output and records it', async () => {
    const runner = new ProcessRunner({ maxOutputBytes: 100 });
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(5000))'],
    });
    expect(result.stdoutTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(100);
  });

  it('honours the working directory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'assembler-proc-'));
    const runner = new ProcessRunner();
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(process.cwd())'],
      cwd: directory,
    });
    expect(await fs.realpath(result.stdout)).toBe(await fs.realpath(directory));
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('runOrThrow raises a typed error on a non-zero exit', async () => {
    const runner = new ProcessRunner();
    await expect(
      runner.runOrThrow({ executable: process.execPath, args: ['-e', 'process.exit(3)'] }),
    ).rejects.toMatchObject({ code: 'PROCESS_FAILED' });
  });

  it('supports cancellation through an AbortSignal', async () => {
    const runner = new ProcessRunner();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await runner.run(
      { executable: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'] },
      controller.signal,
    );
    expect(result.cancelled).toBe(true);
  });
});

describe('Windows shim handling', () => {
  it('quotes arguments for cmd.exe', () => {
    expect(quoteForCmd('plain')).toBe('plain');
    expect(quoteForCmd('has space')).toBe('"has space"');
    expect(quoteForCmd('a&b')).toBe('"a^&b"');
    expect(quoteForCmd('')).toBe('""');
  });

  it('wraps .cmd shims through COMSPEC on win32 only', () => {
    const runner = new ProcessRunner({ platform: 'win32' });
    const prepared = runner.prepare({ executable: 'npm.cmd', args: ['install'] });
    expect(prepared.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(prepared.args[3]).toContain('npm.cmd');

    const posix = new ProcessRunner({ platform: 'linux' });
    expect(posix.prepare({ executable: 'npm', args: ['install'] })).toEqual({
      executable: 'npm',
      args: ['install'],
    });
  });

  it('formats a command line for reports', () => {
    expect(formatCommandLine('node', ['-e', 'a b'])).toBe('node -e "a b"');
  });
});
