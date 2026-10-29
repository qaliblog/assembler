import { randomUUID } from 'node:crypto';
import { contentHash } from './hash.js';

/**
 * Deterministic identifier derived from stable content. Preferred wherever an id
 * must be reproducible (manifests, plans, assembly records).
 */
export function deterministicId(prefix: string, ...parts: readonly unknown[]): string {
  return `${prefix}_${contentHash(parts).slice(0, 20)}`;
}

/** Non-reproducible identifier for events (a run, a scan, a patch attempt). */
export function randomId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
