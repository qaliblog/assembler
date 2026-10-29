import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssemblerError } from '../errors.js';
import { FileSystemService } from './fs-service.js';

let root: string;
let service: FileSystemService;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'assembler-fs-test-'));
  service = new FileSystemService();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('FileSystemService writes', () => {
  it('writes atomically and returns a digest', async () => {
    const target = path.join(root, 'src', 'a.ts');
    const digest = await service.writeFileAtomic(target, 'export const a = 1;\n');
    expect(digest.bytes).toBe(Buffer.byteLength('export const a = 1;\n'));
    expect(digest.sha256).toHaveLength(64);
    expect(await service.readText(target)).toBe('export const a = 1;\n');
  });

  it('protects existing files unless overwrite is explicit', async () => {
    const target = path.join(root, 'file.txt');
    await service.writeFileAtomic(target, 'first');
    await expect(service.writeFileAtomic(target, 'second')).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    expect(await service.readText(target)).toBe('first');
    await service.writeFileAtomic(target, 'second', { overwrite: true });
    expect(await service.readText(target)).toBe('second');
  });

  it('leaves no temporary files behind on success', async () => {
    await service.writeFileAtomic(path.join(root, 'a.txt'), 'x');
    const entries = await fs.readdir(root);
    expect(entries).toEqual(['a.txt']);
  });
});

describe('FileSystemService traversal', () => {
  it('lists files recursively, sorted and relative', async () => {
    await service.writeFileAtomic(path.join(root, 'src', 'b.ts'), 'b');
    await service.writeFileAtomic(path.join(root, 'src', 'a.ts'), 'a');
    await service.writeFileAtomic(path.join(root, 'package.json'), '{}');
    await service.writeFileAtomic(path.join(root, 'node_modules', 'ignored.ts'), 'x');
    expect(await service.listFiles(root)).toEqual(['package.json', 'src/a.ts', 'src/b.ts']);
  });

  it('does not follow symlinks when listing', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'assembler-outside-'));
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    await fs.symlink(outside, path.join(root, 'link'));
    expect(await service.listFiles(root)).toEqual([]);
    await fs.rm(outside, { recursive: true, force: true });
  });
});

describe('FileSystemService containment', () => {
  it('rejects a lexical escape', async () => {
    await expect(service.resolveSafe(root, '../outside.ts')).rejects.toMatchObject({ code: 'PATH_ESCAPE' });
  });

  it('rejects a symlink that escapes the root', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'assembler-outside-'));
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    const link = path.join(root, 'escape');
    await fs.symlink(outside, link);
    try {
      await service.resolveSafe(root, 'escape/secret.txt');
      throw new Error('expected a SYMLINK_ESCAPE error');
    } catch (error) {
      expect(error).toBeInstanceOf(AssemblerError);
      expect((error as AssemblerError).code).toBe('SYMLINK_ESCAPE');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses to copy a directory containing symlinks', async () => {
    await service.ensureDir(path.join(root, 'project'));
    await fs.symlink('/etc', path.join(root, 'project', 'etc-link'));
    await expect(
      service.copyDirectory(path.join(root, 'project'), path.join(root, 'copy')),
    ).rejects.toMatchObject({ code: 'SYMLINK_ESCAPE' });
  });

  it('detects case sensitivity of the filesystem', async () => {
    const result = await service.detectCaseSensitivity(root);
    expect(['sensitive', 'insensitive', 'unknown']).toContain(result);
  });
});
