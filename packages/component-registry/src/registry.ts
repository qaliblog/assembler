/**
 * Registry index.
 *
 * SQLite stores searchable metadata, compatibility rules and verification history;
 * the component's files stay in the libraries directory. Any mutation that would
 * make metadata lie (hash mismatch, failed verification) downgrades the lifecycle
 * instead of silently keeping a "verified" badge.
 */
import path from 'node:path';
import {
  AssemblerError,
  contentHash,
  fromJsonColumn,
  nowIso,
  toJsonColumn,
  type Workspace,
} from '@assembler/core';
import { loadCatalog } from './catalog.js';
import type {
  ComponentLifecycle,
  ComponentManifest,
  ComponentRecord,
  VerificationLevel,
} from './manifest.js';
import { verifyComponentStructure, type VerificationReport } from './verification.js';

export interface RegistryRecord {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly category: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly license: string;
  readonly provenance: string;
  readonly lifecycle: ComponentLifecycle;
  readonly framework: string;
  readonly platforms: readonly string[];
  readonly exports: readonly string[];
  readonly dependencies: readonly string[];
  readonly capabilities: readonly string[];
  readonly tags: readonly string[];
  readonly verificationLevel: VerificationLevel;
  readonly verifiedAt: string | null;
  readonly deprecatedBy: string | null;
  readonly updatedAt: string;
}

interface RegistryRow {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  source_path: string;
  source_hash: string;
  license: string;
  provenance: string;
  lifecycle: string;
  framework: string;
  platforms: string;
  exports: string;
  dependencies: string;
  capabilities: string;
  tags: string;
  verified_at: string | null;
  verification_level: string;
  deprecated_by: string | null;
  updated_at: string;
}

function toRecord(row: RegistryRow): RegistryRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    category: row.category,
    description: row.description,
    sourcePath: row.source_path,
    sourceHash: row.source_hash,
    license: row.license,
    provenance: row.provenance,
    lifecycle: row.lifecycle as ComponentLifecycle,
    framework: row.framework,
    platforms: fromJsonColumn<string[]>(row.platforms, []),
    exports: fromJsonColumn<string[]>(row.exports, []),
    dependencies: fromJsonColumn<string[]>(row.dependencies, []),
    capabilities: fromJsonColumn<string[]>(row.capabilities, []),
    tags: fromJsonColumn<string[]>(row.tags, []),
    verificationLevel: row.verification_level as VerificationLevel,
    verifiedAt: row.verified_at,
    deprecatedBy: row.deprecated_by,
    updatedAt: row.updated_at,
  };
}

export interface SyncResult {
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly total: number;
}

export class ComponentRegistry {
  private readonly workspace: Workspace;
  private readonly librariesDir: string;

  constructor(workspace: Workspace, librariesDir: string) {
    this.workspace = workspace;
    this.librariesDir = librariesDir;
  }

  /** Index every manifest on disk into SQLite (idempotent). */
  async sync(): Promise<SyncResult> {
    const catalog = await loadCatalog(this.librariesDir, { includeUnverified: true });
    const db = this.workspace.database();
    let added = 0;
    let updated = 0;
    let unchanged = 0;

    db.transaction(() => {
      for (const record of catalog) {
        const id = `${record.manifest.name}@${record.manifest.version}`;
        const existing = db.get<RegistryRow>('SELECT * FROM registry_components WHERE id = ?', [id]);
        const timestamp = nowIso();
        if (existing === undefined) {
          this.insertRecord(id, record, timestamp);
          added += 1;
        } else if (existing.source_hash !== record.sourceHash) {
          this.updateRecord(id, record, timestamp);
          updated += 1;
        } else {
          unchanged += 1;
        }
      }
    });

    return { added, updated, unchanged, total: catalog.length };
  }

  private insertRecord(id: string, record: ComponentRecord, timestamp: string): void {
    const db = this.workspace.database();
    const manifest = record.manifest;
    db.run(
      `INSERT INTO registry_components
        (id, name, category, description, version, source_path, source_hash, license, provenance,
         lifecycle, framework, platforms, exports, dependencies, capabilities, tags,
         created_at, updated_at, verified_at, verification_level, deprecated_by, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        manifest.name,
        manifest.category,
        manifest.description,
        manifest.version,
        record.relativePath,
        record.sourceHash,
        manifest.license,
        manifest.provenance,
        manifest.lifecycle,
        manifest.framework,
        toJsonColumn(manifest.platforms),
        toJsonColumn(manifest.exports.map((entry) => entry.name)),
        toJsonColumn(manifest.dependencies.map((entry) => `${entry.name}@${entry.range}`)),
        toJsonColumn(manifest.capabilities),
        toJsonColumn(manifest.tags),
        timestamp,
        timestamp,
        manifest.verification.verifiedAt ?? null,
        manifest.verification.level,
        null,
        toJsonColumn({ compatibility: manifest.compatibility, verification: manifest.verification, design: manifest.design ?? null }),
      ],
    );
    this.upsertSearch(id, manifest);
  }

  private updateRecord(id: string, record: ComponentRecord, timestamp: string): void {
    const db = this.workspace.database();
    const manifest = record.manifest;
    // Source changes invalidate a previous verification: never keep "verified".
    const lifecycle: ComponentLifecycle =
      manifest.lifecycle === 'deprecated' || manifest.lifecycle === 'rejected' ? manifest.lifecycle : 'candidate';
    db.run(
      `UPDATE registry_components
       SET source_hash = ?, lifecycle = ?, updated_at = ?, verification_level = ?, verified_at = NULL, metadata = ?
       WHERE id = ?`,
      [
        record.sourceHash,
        lifecycle,
        timestamp,
        'none',
        toJsonColumn({ compatibility: manifest.compatibility, verification: manifest.verification, design: manifest.design ?? null }),
        id,
      ],
    );
    this.upsertSearch(id, manifest);
  }

  private upsertSearch(id: string, manifest: ComponentManifest): void {
    const db = this.workspace.database();
    db.run('DELETE FROM registry_components_fts WHERE id = ?', [id]);
    db.run(
      `INSERT INTO registry_components_fts (id, name, description, tags, category) VALUES (?, ?, ?, ?, ?)`,
      [id, manifest.name, manifest.description, manifest.tags.join(' '), manifest.category],
    );
  }

  /**
   * Full-text search. The query is tokenised and each token is treated as a
   * prefix, which makes "glass card" match `glass-card` and `glassmorphism`.
   */
  search(query: string, limit = 20): RegistryRecord[] {
    const db = this.workspace.database();
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1);
    if (tokens.length === 0) return this.list(limit);
    const ftsQuery = tokens.map((token) => `"${token}"*`).join(' AND ');
    try {
      const rows = db.all<RegistryRow>(
        `SELECT c.* FROM registry_components_fts f
         JOIN registry_components c ON c.id = f.id
         WHERE registry_components_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
        [ftsQuery, limit],
      );
      return rows.map(toRecord);
    } catch {
      // A malformed FTS expression must not break search entirely.
      return this.list(limit);
    }
  }

  list(limit = 100): RegistryRecord[] {
    const rows = this.workspace.database().all<RegistryRow>(
      'SELECT * FROM registry_components ORDER BY name, version LIMIT ?',
      [limit],
    );
    return rows.map(toRecord);
  }

  inspect(name: string, version?: string): RegistryRecord | null {
    const db = this.workspace.database();
    const row =
      version === undefined
        ? db.get<RegistryRow>(
            'SELECT * FROM registry_components WHERE name = ? ORDER BY version DESC LIMIT 1',
            [name],
          )
        : db.get<RegistryRow>('SELECT * FROM registry_components WHERE name = ? AND version = ?', [name, version]);
    return row === undefined ? null : toRecord(row);
  }

  /** Read the authoritative manifest from disk for an indexed component. */
  async loadRecord(name: string, version?: string): Promise<ComponentRecord | null> {
    const catalog = await loadCatalog(this.librariesDir, { includeUnverified: true });
    return (
      catalog.find(
        (record) =>
          record.manifest.name === name && (version === undefined || record.manifest.version === version),
      ) ?? null
    );
  }

  async verify(name: string, version?: string): Promise<VerificationReport> {
    const record = await this.loadRecord(name, version);
    if (record === null) {
      throw new AssemblerError({
        code: 'REGISTRY_ENTRY_MISSING',
        message: `Component not found in the libraries directory: ${name}${version === undefined ? '' : `@${version}`}`,
      });
    }
    const report = await verifyComponentStructure(record);
    const db = this.workspace.database();
    const id = `${record.manifest.name}@${record.manifest.version}`;
    db.transaction(() => {
      db.run(
        `INSERT INTO registry_verifications
          (id, component_id, version, level, passed, report, environment_signature, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${id}:${report.checkedAt}`,
          id,
          record.manifest.version,
          report.level,
          report.passed ? 1 : 0,
          toJsonColumn(report),
          contentHash({ level: report.level, hash: report.sourceHash }).slice(0, 32),
          report.checkedAt,
        ],
      );
      const current = db.get<{ lifecycle: string }>('SELECT lifecycle FROM registry_components WHERE id = ?', [id]);
      const lifecycle = current?.lifecycle ?? record.manifest.lifecycle;
      const nextLifecycle: ComponentLifecycle =
        lifecycle === 'deprecated' || lifecycle === 'rejected'
          ? (lifecycle as ComponentLifecycle)
          : report.passed
            ? lifecycle === 'verified'
              ? 'verified'
              : 'candidate'
            : 'candidate';
      db.run(
        `UPDATE registry_components
         SET lifecycle = ?, verification_level = ?, verified_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          nextLifecycle,
          report.level,
          report.passed ? report.checkedAt : null,
          nowIso(),
          id,
        ],
      );
    });
    return report;
  }

  deprecate(name: string, version: string | undefined, replacedBy?: string): RegistryRecord {
    const row = this.inspect(name, version);
    if (row === null) {
      throw new AssemblerError({
        code: 'REGISTRY_ENTRY_MISSING',
        message: `Cannot deprecate unknown component: ${name}`,
      });
    }
    this.workspace.database().run(
      `UPDATE registry_components SET lifecycle = 'deprecated', deprecated_by = ?, updated_at = ? WHERE id = ?`,
      [replacedBy ?? null, nowIso(), row.id],
    );
    return this.inspect(name, version) as RegistryRecord;
  }

  history(name: string): Array<{ checkedAt: string; passed: boolean; level: string; findings: number }> {
    const rows = this.workspace.database().all<{
      checked_at: string;
      passed: number;
      level: string;
      report: string;
    }>(
      `SELECT v.checked_at, v.passed, v.level, v.report
       FROM registry_verifications v
       JOIN registry_components c ON c.id = v.component_id
       WHERE c.name = ?
       ORDER BY v.checked_at DESC`,
      [name],
    );
    return rows.map((row) => {
      const report = JSON.parse(row.report) as { findings?: unknown[] };
      return {
        checkedAt: row.checked_at,
        passed: row.passed === 1,
        level: row.level,
        findings: report.findings?.length ?? 0,
      };
    });
  }

  sourcePathFor(record: RegistryRecord): string {
    return path.join(this.librariesDir, record.sourcePath);
  }
}
