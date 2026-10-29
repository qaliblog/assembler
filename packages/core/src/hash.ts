/** Deterministic hashing utilities. */
import { createHash } from 'node:crypto';

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Stable JSON serialisation: object keys are sorted recursively so that the same
 * logical value always produces the same digest, regardless of insertion order.
 */
export function stableStringify(value: unknown, depth = 0): string {
  if (depth > 20) throw new Error('stableStringify: nesting too deep');
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry, depth + 1)).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry, depth + 1)}`);
    return `{${entries.join(',')}}`;
  }
  return 'null';
}

export function contentHash(value: unknown): string {
  return sha256(stableStringify(value));
}
