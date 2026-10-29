/**
 * Filesystem service.
 *
 * All engine writes go through this service. It provides:
 *  - containment checks (lexical + realpath, so symlinks cannot escape),
 *  - atomic writes (temp file + rename),
 *  - explicit overwrite policy,
 *  - hashes for manifests and provenance,
 *  - case-sensitivity detection for cross-platform manifest validation.
 */
import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssemblerError } from '../errors.js';
import type { Logger } from '../logger.js';
import { isWithin, normalizeRelativePath, resolveWithin } from './path-safety.js';

export type CaseSensitivity = 'sensitive' | 'insensitive' | 'unknown';

export interface WriteOptions {
  /** Defaults to false: existing files are protected. */
  readonly overwrite?: boolean;
  /** File mode; defaults to the process umask (0o644 equivalent). */
  readonly mode?: number;
}

export interface FileDigest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ListOptions {
  /** Directory names to skip entirely (default: node_modules, .git, dist, .assembler). */
  readonly ignoreDirectories?: readonly string[];
  /** Maximum number of files returned; guards against runaway trees. */
  readonly limit?: number;
}

const DEFAULT_IGNORED = ['node_modules', '.git', 'dist', '.assembler', 'coverage', '.pnpm'] as const;

export class FileSystemService {
  private readonly logger?: Logger;

  constructor(options: { logger?: Logger } = {}) {
    this.logger = options.logger;
  }

  /* ------------------------------------------------------------------ reads */

  async exists(absolutePath: string): Promise<boolean> {
    try {
      await fs.lstat(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(absolutePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
    try {
      return await fs.lstat(absolutePath);
    } catch (error) {
      throw new AssemblerError({
        code: 'FILE_MISSING',
        message: `Cannot stat path: ${absolutePath}`,
        cause: error,
      });
    }
  }

  async readText(absolutePath: string): Promise<string> {
    try {
      return await fs.readFile(absolutePath, 'utf8');
    } catch (error) {
      throw new AssemblerError({
        code: 'FS_IO_ERROR',
        message: `Cannot read file: ${absolutePath}`,
        cause: error,
      });
    }
  }

  async readJson<T = unknown>(absolutePath: string): Promise<T> {
    const text = await this.readText(absolutePath);
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new AssemblerError({
        code: 'FS_IO_ERROR',
        message: `File is not valid JSON: ${absolutePath}`,
        cause: error,
      });
    }
  }

  async hashFile(absolutePath: string): Promise<string> {
    const data = await fs.readFile(absolutePath);
    return createHash('sha256').update(data).digest('hex');
  }

  /* ----------------------------------------------------------------- writes */

  async ensureDir(absolutePath: string): Promise<void> {
    await fs.mkdir(absolutePath, { recursive: true });
  }

  /**
   * Write a file atomically. The containing directory is created, the content is
   * written to a temporary sibling and renamed into place, so a crash can never
   * leave a half-written source file.
   */
  async writeFileAtomic(
    absolutePath: string,
    content: string | Uint8Array,
    options: WriteOptions = {},
  ): Promise<FileDigest> {
    const overwrite = options.overwrite ?? false;
    const directory = path.dirname(absolutePath);
    await fs.mkdir(directory, { recursive: true });

    if (!overwrite && (await this.exists(absolutePath))) {
      throw new AssemblerError({
        code: 'FILE_EXISTS',
        message: `Refusing to overwrite existing file: ${absolutePath}`,
        hint: 'Use an explicit overwrite policy or a different destination.',
      });
    }

    const tempPath = path.join(
      directory,
      `.${path.basename(absolutePath)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`,
    );
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    try {
      await fs.writeFile(tempPath, buffer, options.mode === undefined ? undefined : { mode: options.mode });
      await fs.rename(tempPath, absolutePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw new AssemblerError({
        code: 'FS_IO_ERROR',
        message: `Cannot write file: ${absolutePath}`,
        cause: error,
      });
    }
    const digest = {
      path: absolutePath,
      bytes: buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
    this.logger?.debug('file written', { path: absolutePath, bytes: digest.bytes });
    return digest;
  }

  async writeJsonAtomic(
    absolutePath: string,
    value: unknown,
    options: WriteOptions = {},
  ): Promise<FileDigest> {
    return this.writeFileAtomic(absolutePath, `${JSON.stringify(value, null, 2)}\n`, options);
  }

  async remove(absolutePath: string): Promise<void> {
    await fs.rm(absolutePath, { recursive: true, force: true });
  }

  /* -------------------------------------------------------------- traversal */

  /** Recursively list files as POSIX paths relative to `root`, sorted. */
  async listFiles(
    root: string,
    options: ListOptions = {},
  ): Promise<string[]> {
    const ignore = new Set(options.ignoreDirectories ?? DEFAULT_IGNORED);
    const limit = options.limit ?? 100_000;
    const results: string[] = [];

    const walk = async (directory: string): Promise<void> => {
      let entries: Awaited<ReturnType<typeof fs.readdir>>;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        throw new AssemblerError({
          code: 'FS_IO_ERROR',
          message: `Cannot read directory: ${directory}`,
          cause: error,
        });
      }
      const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of sorted) {
        if (entry.isSymbolicLink()) {
          // Symlinks are never followed: they are the primary escape vector.
          continue;
        }
        if (entry.isDirectory()) {
          if (ignore.has(entry.name)) continue;
          await walk(path.join(directory, entry.name));
        } else if (entry.isFile()) {
          const relative = path.relative(root, path.join(directory, entry.name)).split(path.sep).join('/');
          results.push(relative);
          if (results.length > limit) {
            throw new AssemblerError({
              code: 'FS_IO_ERROR',
              message: `Directory contains more than ${limit} files: ${root}`,
            });
          }
        }
      }
    };

    await walk(root);
    return results.sort();
  }

  /**
   * Copy a directory tree without following symlinks. Used to snapshot a project
   * before a risky modification.
   */
  async copyDirectory(source: string, destination: string): Promise<void> {
    await this.ensureDir(destination);
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isSymbolicLink()) {
        throw new AssemblerError({
          code: 'SYMLINK_ESCAPE',
          message: `Refusing to copy symlink: ${from}`,
          hint: 'Replace the symlink with a real file or exclude it.',
        });
      }
      if (entry.isDirectory()) {
        await this.copyDirectory(from, to);
      } else if (entry.isFile()) {
        await fs.copyFile(from, to);
      }
    }
  }

  /* ------------------------------------------------------- path containment */

  /**
   * Assert that `absolutePath` is inside `root`, resolving symlinks in the
   * deepest existing ancestor. Throws PATH_ESCAPE or SYMLINK_ESCAPE.
   */
  async assertContained(root: string, absolutePath: string): Promise<void> {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(absolutePath);
    if (!isWithin(resolvedRoot, resolvedTarget)) {
      throw new AssemblerError({
        code: 'PATH_ESCAPE',
        message: `Path escapes the workspace: ${absolutePath}`,
        details: { root: resolvedRoot },
      });
    }

    let realRoot: string;
    try {
      realRoot = await fs.realpath(resolvedRoot);
    } catch {
      realRoot = resolvedRoot;
    }

    // Walk up to the nearest existing ancestor, then realpath it.
    let probe = resolvedTarget;
    for (let i = 0; i < 40; i += 1) {
      if (await this.exists(probe)) break;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    let realProbe: string;
    try {
      realProbe = await fs.realpath(probe);
    } catch {
      realProbe = probe;
    }
    if (!isWithin(realRoot, realProbe)) {
      throw new AssemblerError({
        code: 'SYMLINK_ESCAPE',
        message: `Symbolic link resolves outside the workspace: ${absolutePath}`,
        details: { realRoot, realProbe },
      });
    }
  }

  /** Resolve a manifest-relative path inside `root`, then verify containment. */
  async resolveSafe(root: string, relativePath: string): Promise<string> {
    const absolute = resolveWithin(root, relativePath);
    await this.assertContained(root, absolute);
    return absolute;
  }

  /* ------------------------------------------------------------ misc helpers */

  async isDirectory(absolutePath: string): Promise<boolean> {
    try {
      const stats = await fs.lstat(absolutePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async isFile(absolutePath: string): Promise<boolean> {
    try {
      const stats = await fs.lstat(absolutePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  async isEmptyDirectory(absolutePath: string): Promise<boolean> {
    if (!(await this.isDirectory(absolutePath))) return true;
    const entries = await fs.readdir(absolutePath);
    return entries.length === 0;
  }

  async createTempDir(prefix: string, baseDirectory?: string): Promise<string> {
    const base = baseDirectory ?? (await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'assembler-')));
    await this.ensureDir(base);
    const directory = path.join(base, `${prefix}-${randomBytes(6).toString('hex')}`);
    await this.ensureDir(directory);
    return directory;
  }

  async canWrite(absolutePath: string): Promise<boolean> {
    try {
      await fs.access(absolutePath, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Probe whether the filesystem is case-insensitive. Important because manifests
   * validated on Linux must not silently break on macOS/Windows.
   */
  async detectCaseSensitivity(directory: string): Promise<CaseSensitivity> {
    const probeName = `.assembler-case-probe-${randomBytes(6).toString('hex')}`;
    const probe = path.join(directory, probeName);
    try {
      await this.ensureDir(directory);
      await fs.writeFile(probe, 'probe');
      const upper = path.join(directory, probeName.toUpperCase());
      const exists = await this.exists(upper);
      await fs.rm(probe, { force: true });
      return exists ? 'insensitive' : 'sensitive';
    } catch {
      await fs.rm(probe, { force: true }).catch(() => undefined);
      return 'unknown';
    }
  }

  /** Validate a relative path without touching the filesystem. */
  validatePath(relativePath: string): string {
    return normalizeRelativePath(relativePath);
  }
}
