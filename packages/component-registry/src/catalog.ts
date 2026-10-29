/**
 * Catalogue loading.
 *
 * The filesystem is the source of truth for component source code; SQLite holds
 * the index, verification history and compatibility records. Loading the
 * catalogue never requires a database, which keeps planning usable offline and
 * makes stale metadata harmless.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssemblerError } from '@assembler/core';
import {
  hashComponentDirectory,
  parseComponentManifest,
  type ComponentLifecycle,
  type ComponentManifest,
  type ComponentRecord,
} from './manifest.js';

const MANIFEST_NAME = 'component.json';

async function findManifests(root: string, maxDepth = 4): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === MANIFEST_NAME) {
        found.push(directory);
      }
    }
  };
  await walk(root, 0);
  return found.sort();
}

export interface LoadCatalogOptions {
  /** Include components that are not verified (for inspection and tests). */
  readonly includeUnverified?: boolean;
}

export async function loadCatalog(
  librariesDir: string,
  options: LoadCatalogOptions = {},
): Promise<ComponentRecord[]> {
  const records: ComponentRecord[] = [];
  const directories = await findManifests(librariesDir);
  for (const directory of directories) {
    const manifestPath = path.join(directory, MANIFEST_NAME);
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
    const parsed = parseComponentManifest(raw);
    if ('problems' in parsed) {
      throw new AssemblerError({
        code: 'REGISTRY_ENTRY_INVALID',
        message: `Invalid component manifest: ${manifestPath}`,
        details: { problems: parsed.problems },
      });
    }
    if (!options.includeUnverified && parsed.manifest.lifecycle !== 'verified') continue;
    const sourceHash = await hashComponentDirectory(directory, parsed.manifest, (file) =>
      fs.readFile(file, 'utf8'),
    );
    records.push({
      directory,
      relativePath: path.relative(librariesDir, directory).split(path.sep).join('/'),
      manifest: parsed.manifest,
      sourceHash,
    });
  }
  return records;
}

export interface ComponentQuery {
  readonly category?: ComponentManifest['category'];
  readonly framework?: ComponentManifest['framework'];
  readonly platform?: ComponentManifest['platforms'][number];
  readonly tags?: readonly string[];
  readonly style?: string;
  readonly theme?: string;
  readonly lifecycle?: ComponentLifecycle;
  readonly names?: readonly string[];
}

export function matchesQuery(record: ComponentRecord, query: ComponentQuery): boolean {
  const { manifest } = record;
  if (query.category !== undefined && manifest.category !== query.category) return false;
  if (query.framework !== undefined && manifest.framework !== query.framework && manifest.framework !== 'any') {
    return false;
  }
  if (query.platform !== undefined && !manifest.platforms.includes(query.platform)) return false;
  if (query.lifecycle !== undefined && manifest.lifecycle !== query.lifecycle) return false;
  if (query.names !== undefined && query.names.length > 0 && !query.names.includes(manifest.name)) return false;
  if (query.tags !== undefined && query.tags.length > 0) {
    const wanted = query.tags.map((tag) => tag.toLowerCase());
    const have = new Set(manifest.tags.map((tag) => tag.toLowerCase()));
    if (!wanted.every((tag) => have.has(tag))) return false;
  }
  if (query.style !== undefined) {
    if (manifest.design?.styles === undefined || !manifest.design.styles.includes(query.style)) return false;
  }
  if (query.theme !== undefined) {
    if (manifest.design?.themes === undefined || !manifest.design.themes.includes(query.theme)) return false;
  }
  return true;
}

export function selectComponents(
  records: readonly ComponentRecord[],
  query: ComponentQuery,
): ComponentRecord[] {
  return records
    .filter((record) => record.manifest.lifecycle === 'verified' || query.lifecycle !== undefined)
    .filter((record) => matchesQuery(record, query))
    .sort((a, b) => (a.manifest.name < b.manifest.name ? -1 : a.manifest.name > b.manifest.name ? 1 : 0));
}

export function findComponent(
  records: readonly ComponentRecord[],
  name: string,
): ComponentRecord | undefined {
  return records.find((record) => record.manifest.name === name);
}
