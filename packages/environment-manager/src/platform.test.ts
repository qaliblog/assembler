import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion, satisfies, versionMatchesRange } from './version.js';
import { normalizeArch, normalizeOs } from './platform.js';

describe('parseVersion', () => {
  it('extracts versions from real tool output', () => {
    expect(parseVersion('v18.19.1')?.major).toBe(18);
    expect(parseVersion('Python 3.12.3')?.minor).toBe(12);
    expect(parseVersion('openjdk version "17.0.20" 2026-07-21')?.patch).toBe(20);
    expect(parseVersion('npm 9.2.0')?.raw).toBe('9.2.0');
    expect(parseVersion('no numbers here')).toBeNull();
  });

  it('requires at least major.minor for tool output', () => {
    // A tool that only prints a bare major leaves its version undetermined.
    expect(parseVersion('node 20')).toBeNull();
    const parsed = parseVersion('node 20.1');
    expect(parsed?.major).toBe(20);
    expect(parsed?.minor).toBe(1);
    expect(parsed?.patch).toBe(0);
  });
});

describe('satisfies', () => {
  it('evaluates comparison constraints', () => {
    const version = parseVersion('18.19.1');
    expect(version).not.toBeNull();
    if (version === null) return;
    expect(satisfies(version, '>=18.18.0')).toBe(true);
    expect(satisfies(version, '>=20')).toBe(false);
    expect(satisfies(version, '>=18 <21')).toBe(true);
    expect(satisfies(version, '>=18 <19')).toBe(true);
    expect(satisfies(version, '<18')).toBe(false);
  });

  it('evaluates caret and tilde ranges', () => {
    const version = parseVersion('5.4.11');
    if (version === null) throw new Error('unreachable');
    expect(satisfies(version, '^5.4.0')).toBe(true);
    expect(satisfies(version, '^6.0.0')).toBe(false);
    expect(satisfies(version, '~5.4.2')).toBe(true);
    expect(satisfies(version, '~5.3.0')).toBe(false);
  });

  it('returns null for an unparseable expression instead of guessing', () => {
    const version = parseVersion('1.2.3');
    if (version === null) throw new Error('unreachable');
    expect(satisfies(version, 'not-a-range')).toBeNull();
    expect(satisfies(version, '')).toBeNull();
  });
});

describe('versionMatchesRange', () => {
  it('supports wildcard and comparison ranges', () => {
    expect(versionMatchesRange('18.19.1', '18.x')).toBe(true);
    expect(versionMatchesRange('20.1.0', '18.x')).toBe(false);
    expect(versionMatchesRange('17.0.20', '>=17 <22')).toBe(true);
    expect(versionMatchesRange('9.2.0', '*')).toBe(true);
    expect(versionMatchesRange('9.2.0', '18.x')).toBe(false);
  });
});

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    const a = parseVersion('1.2.3');
    const b = parseVersion('1.3.0');
    if (a === null || b === null) throw new Error('unreachable');
    expect(compareVersions(a, b)).toBeLessThan(0);
    expect(compareVersions(b, a)).toBeGreaterThan(0);
    expect(compareVersions(a, a)).toBe(0);
  });
});

describe('platform normalisation', () => {
  it('normalises OS and architecture names', () => {
    expect(normalizeOs('linux')).toBe('linux');
    expect(normalizeOs('win32')).toBe('win32');
    expect(normalizeOs('aix')).toBe('other');
    expect(normalizeArch('arm64')).toBe('arm64');
    expect(normalizeArch('x64')).toBe('x64');
    expect(normalizeArch('mips')).toBe('other');
  });
});
