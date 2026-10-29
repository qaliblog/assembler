/**
 * Version handling without an external dependency.
 *
 * Supports the subset Assembler needs: extract a version from arbitrary tool
 * output, compare numeric dotted versions, and test against constraints of the
 * form `>=18.18.0`, `<21`, `^5.4.0`, `~5.4.2`, `5.4.11`, or a space-separated
 * conjunction (`>=18 <21`).
 */

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
  readonly raw: string;
}

const VERSION_PATTERN = /(\d+)\.(\d+)(?:\.(\d+))?(?:[-+]([0-9A-Za-z.-]+))?/;

export function parseVersion(output: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(output);
  if (match === null) return null;
  const [, major, minor, patch, prerelease] = match;
  if (major === undefined || minor === undefined) return null;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: patch === undefined ? 0 : Number(patch),
    prerelease: prerelease ?? null,
    raw: match[0],
  };
}

export function formatVersion(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return 0;
}

export type ConstraintOperator = '>=' | '<=' | '>' | '<' | '=' | '^' | '~';

export interface VersionConstraint {
  readonly operator: ConstraintOperator;
  readonly version: ParsedVersion;
}

/** Parse a constraint term such as `>=18.18.0` (minor/patch optional). */
export function parseConstraint(term: string): VersionConstraint | null {
  const trimmed = term.trim();
  if (trimmed === '') return null;
  const match = /^(>=|<=|>|<|=|\^|~)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+]([0-9A-Za-z.-]+))?$/.exec(trimmed);
  if (match === null) return null;
  const operator = (match[1] ?? '=') as ConstraintOperator;
  const major = Number(match[2]);
  const minor = match[3] === undefined ? 0 : Number(match[3]);
  const patch = match[4] === undefined ? 0 : Number(match[4]);
  return {
    operator,
    version: {
      major,
      minor,
      patch,
      prerelease: match[5] ?? null,
      raw: [major, minor, patch].join('.'),
    },
  };
}

/**
 * Evaluate a constraint expression against a version.
 * Returns null when the expression itself is invalid, so callers can report an
 * "unknown" rather than a false "satisfied".
 */
export function satisfies(version: ParsedVersion, expression: string): boolean | null {
  const terms = expression
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term !== '');
  if (terms.length === 0) return null;
  for (const term of terms) {
    const constraint = parseConstraint(term);
    if (constraint === null) return null;
    if (!evaluate(version, constraint)) return false;
  }
  return true;
}

function evaluate(version: ParsedVersion, constraint: VersionConstraint): boolean {
  const comparison = compareVersions(version, constraint.version);
  switch (constraint.operator) {
    case '>=':
      return comparison >= 0;
    case '<=':
      return comparison <= 0;
    case '>':
      return comparison > 0;
    case '<':
      return comparison < 0;
    case '=':
      return comparison === 0;
    case '^': {
      // Compatible within the left-most non-zero component.
      if (comparison < 0) return false;
      if (constraint.version.major > 0) return version.major === constraint.version.major;
      if (constraint.version.minor > 0) {
        return version.major === 0 && version.minor === constraint.version.minor;
      }
      return version.major === 0 && version.minor === 0 && version.patch === constraint.version.patch;
    }
    case '~': {
      if (comparison < 0) return false;
      return version.major === constraint.version.major && version.minor === constraint.version.minor;
    }
  }
}

/** Range form used by the compatibility knowledge files: `"20.x"`, `">=18 <21"`. */
export function versionMatchesRange(version: string, range: string): boolean | null {
  const parsed = parseVersion(version);
  if (parsed === null) return null;
  const normalized = range.trim();
  if (normalized === '*' || normalized === '' || normalized.toLowerCase() === 'any') return true;
  const wildcard = /^(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?$/.exec(normalized);
  if (wildcard !== null) {
    const major = Number(wildcard[1]);
    if (major !== parsed.major) return false;
    if (wildcard[2] !== undefined && wildcard[2] !== 'x' && Number(wildcard[2]) !== parsed.minor) return false;
    if (wildcard[3] !== undefined && wildcard[3] !== 'x' && Number(wildcard[3]) !== parsed.patch) return false;
    return true;
  }
  return satisfies(parsed, normalized);
}
