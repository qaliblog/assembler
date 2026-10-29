/**
 * Path validation that runs before any filesystem operation.
 *
 * Generated and user-supplied paths are treated as untrusted. These helpers are
 * pure (no I/O) so they can be unit-tested exhaustively; the filesystem service
 * additionally performs realpath checks for symlink escapes.
 */
import path from 'node:path';
import { AssemblerError } from '../errors.js';

const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export interface PathValidationOptions {
  /** Reject absolute paths. Defaults to true: manifest paths are workspace-relative. */
  readonly allowAbsolute?: boolean;
  /** Maximum path length in characters. Defaults to 240. */
  readonly maxLength?: number;
}

/**
 * Validate and normalise a workspace-relative path to POSIX form.
 * Throws PATH_ESCAPE / PATH_INVALID for anything that could escape the workspace.
 */
export function normalizeRelativePath(input: string, options: PathValidationOptions = {}): string {
  const allowAbsolute = options.allowAbsolute ?? false;
  const maxLength = options.maxLength ?? 240;

  if (typeof input !== 'string' || input.trim() === '') {
    throw new AssemblerError({ code: 'PATH_INVALID', message: 'Path must be a non-empty string' });
  }
  if (input.includes('\0')) {
    throw new AssemblerError({ code: 'PATH_INVALID', message: `Path contains a NUL byte: ${input}` });
  }
  if (/[\r\n]/.test(input)) {
    throw new AssemblerError({ code: 'PATH_INVALID', message: 'Path contains a newline' });
  }
  const unified = input.replace(/\\/g, '/');

  if (!allowAbsolute) {
    if (unified.startsWith('/')) {
      throw new AssemblerError({
        code: 'PATH_ESCAPE',
        message: `Absolute path is not allowed: ${input}`,
        hint: 'Project files must be referenced relative to the project root.',
      });
    }
    if (/^[A-Za-z]:/.test(unified)) {
      throw new AssemblerError({
        code: 'PATH_ESCAPE',
        message: `Drive-letter path is not allowed: ${input}`,
      });
    }
  }

  const absolute = unified.startsWith('/');
  const segments: string[] = [];
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new AssemblerError({
          code: 'PATH_ESCAPE',
          message: `Path escapes its root: ${input}`,
          hint: 'Remove the ".." segment that leaves the project root.',
        });
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    throw new AssemblerError({ code: 'PATH_INVALID', message: 'Path resolves to the root itself' });
  }

  for (const segment of segments) {
    const lower = segment.toLowerCase().replace(/\.[^.]*$/, '');
    if (WINDOWS_RESERVED.has(lower)) {
      throw new AssemblerError({
        code: 'PATH_INVALID',
        message: `Path uses a Windows-reserved name: ${segment}`,
      });
    }
    if (/[<>:"|?*]/.test(segment)) {
      throw new AssemblerError({
        code: 'PATH_INVALID',
        message: `Path segment contains characters invalid on Windows: ${segment}`,
      });
    }
    if (/[. ]$/.test(segment)) {
      throw new AssemblerError({
        code: 'PATH_INVALID',
        message: `Path segment may not end with a dot or space: ${segment}`,
      });
    }
  }

  const normalized = `${absolute ? '/' : ''}${segments.join('/')}`;
  if (normalized.length > maxLength) {
    throw new AssemblerError({
      code: 'PATH_INVALID',
      message: `Path exceeds the maximum length of ${maxLength}: ${normalized}`,
    });
  }
  return normalized;
}

/** True when `child` is the same as, or inside, `parent` (lexical check). */
export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Resolve a relative path against a root and assert containment. */
export function resolveWithin(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath, { allowAbsolute: false });
  const absolute = path.resolve(root, normalized);
  if (!isWithin(root, absolute)) {
    throw new AssemblerError({
      code: 'PATH_ESCAPE',
      message: `Resolved path escapes the root: ${relativePath}`,
      details: { root, absolute },
    });
  }
  return absolute;
}

/**
 * Detect colliding paths on case-insensitive filesystems (e.g. two entries that
 * differ only by case). Used when validating a manifest.
 */
export function findCaseCollisions(paths: readonly string[]): Array<[string, string]> {
  const seen = new Map<string, string>();
  const collisions: Array<[string, string]> = [];
  for (const entry of paths) {
    const key = entry.toLowerCase();
    const existing = seen.get(key);
    if (existing !== undefined && existing !== entry) collisions.push([existing, entry]);
    else seen.set(key, entry);
  }
  return collisions;
}

/** Convert a project name into a safe, deterministic directory/package name. */
export function toSafeName(input: string): string {
  const cleaned = input
    .normalize('NFKD')
    // Strip combining marks so "Ü" becomes "u" rather than "u-".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-._]+/, '')
    .replace(/[-._]+$/, '')
    .toLowerCase();
  return cleaned === '' ? 'project' : cleaned.slice(0, 100);
}
