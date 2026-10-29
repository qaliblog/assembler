import { describe, expect, it } from 'vitest';
import { AssemblerError } from '../errors.js';
import {
  findCaseCollisions,
  isWithin,
  normalizeRelativePath,
  resolveWithin,
  toSafeName,
} from './path-safety.js';

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected the call to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(AssemblerError);
    expect((error as AssemblerError).code).toBe(code);
  }
}

describe('normalizeRelativePath', () => {
  it('normalises separators and redundant segments', () => {
    expect(normalizeRelativePath('src\\\\pages\\\\..\\\\pages\\\\Home.tsx')).toBe('src/pages/Home.tsx');
    expect(normalizeRelativePath('./src/index.ts')).toBe('src/index.ts');
  });

  it('rejects traversal, absolute and drive-letter paths', () => {
    expectCode(() => normalizeRelativePath('../etc/passwd'), 'PATH_ESCAPE');
    expectCode(() => normalizeRelativePath('src/../../etc/passwd'), 'PATH_ESCAPE');
    expectCode(() => normalizeRelativePath('/etc/passwd'), 'PATH_ESCAPE');
    expectCode(() => normalizeRelativePath('C:/Windows/system32'), 'PATH_ESCAPE');
    expectCode(() => normalizeRelativePath('\\\\server\\share\\file'), 'PATH_ESCAPE');
  });

  it('rejects NUL bytes, control characters and empty paths', () => {
    expectCode(() => normalizeRelativePath('src/\0evil.ts'), 'PATH_INVALID');
    expectCode(() => normalizeRelativePath('src/ev\nil.ts'), 'PATH_INVALID');
    expectCode(() => normalizeRelativePath(''), 'PATH_INVALID');
    expectCode(() => normalizeRelativePath('   '), 'PATH_INVALID');
    expectCode(() => normalizeRelativePath('.//'), 'PATH_INVALID');
  });

  it('rejects Windows-reserved names and characters', () => {
    expectCode(() => normalizeRelativePath('src/con.ts'), 'PATH_INVALID');
    expectCode(() => normalizeRelativePath('src/aux'), 'PATH_INVALID');
    expectCode(() => normalizeRelativePath('src/foo?.ts'), 'PATH_INVALID');
    expectCode(() => normalizeRelativePath('src/foo.'), 'PATH_INVALID');
  });

  it('enforces a maximum length', () => {
    expectCode(() => normalizeRelativePath(`src/${'a'.repeat(300)}.ts`), 'PATH_INVALID');
    expectCode(() => normalizeRelativePath('src/long.ts', { maxLength: 5 }), 'PATH_INVALID');
  });
});

describe('isWithin / resolveWithin', () => {
  it('detects containment lexically', () => {
    expect(isWithin('/work/project', '/work/project/src/a.ts')).toBe(true);
    expect(isWithin('/work/project', '/work/project-other/a.ts')).toBe(false);
    expect(isWithin('/work/project', '/work')).toBe(false);
  });

  it('throws when a resolved path escapes', () => {
    expect(resolveWithin('/work/project', 'src/a.ts')).toBe('/work/project/src/a.ts');
    expectCode(() => resolveWithin('/work/project', '../escape.ts'), 'PATH_ESCAPE');
  });
});

describe('findCaseCollisions', () => {
  it('reports paths that differ only by case', () => {
    expect(findCaseCollisions(['src/App.tsx', 'src/app.tsx', 'src/other.ts'])).toEqual([
      ['src/App.tsx', 'src/app.tsx'],
    ]);
    expect(findCaseCollisions(['a/b.ts', 'a/c.ts'])).toEqual([]);
  });
});

describe('toSafeName', () => {
  it('produces filesystem- and npm-safe names', () => {
    expect(toSafeName('My Dashboard!')).toBe('my-dashboard');
    expect(toSafeName('  ___  ')).toBe('project');
    expect(toSafeName('Über App')).toBe('uber-app');
  });
});
