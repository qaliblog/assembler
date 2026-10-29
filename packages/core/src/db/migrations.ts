/**
 * Versioned metadata schema.
 *
 * Migrations are append-only and applied inside a transaction. The schema stores
 * metadata only; it is never the sole source of truth for files on disk.
 */
import { AssemblerError } from '../errors.js';
import type { SqlDatabase } from './database.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'environment-inventory',
    statements: [
      `CREATE TABLE environment_tools (
         id TEXT PRIMARY KEY,
         tool_id TEXT NOT NULL,
         executable TEXT NOT NULL,
         version TEXT,
         major INTEGER,
         architecture TEXT,
         source TEXT,
         installation_root TEXT,
         status TEXT NOT NULL,
         verified_at TEXT NOT NULL,
         metadata TEXT NOT NULL DEFAULT '{}'
       )`,
      `CREATE UNIQUE INDEX idx_environment_tools_unique ON environment_tools (tool_id, executable)`,
      `CREATE INDEX idx_environment_tools_tool ON environment_tools (tool_id)`,
      `CREATE TABLE environment_capabilities (
         capability TEXT PRIMARY KEY,
         status TEXT NOT NULL,
         reason TEXT NOT NULL,
         evidence TEXT NOT NULL DEFAULT '{}',
         environment_signature TEXT NOT NULL,
         checked_at TEXT NOT NULL
       )`,
      `CREATE TABLE environment_scans (
         id TEXT PRIMARY KEY,
         signature TEXT NOT NULL,
         platform TEXT NOT NULL,
         created_at TEXT NOT NULL,
         payload TEXT NOT NULL
       )`,
      `CREATE INDEX idx_environment_scans_signature ON environment_scans (signature)`,
    ],
  },
  {
    version: 2,
    name: 'component-registry',
    statements: [
      `CREATE TABLE registry_components (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         category TEXT NOT NULL,
         description TEXT NOT NULL,
         version TEXT NOT NULL,
         source_path TEXT NOT NULL,
         source_hash TEXT NOT NULL,
         license TEXT NOT NULL,
         provenance TEXT NOT NULL,
         lifecycle TEXT NOT NULL,
         framework TEXT NOT NULL,
         platforms TEXT NOT NULL DEFAULT '[]',
         exports TEXT NOT NULL DEFAULT '[]',
         dependencies TEXT NOT NULL DEFAULT '[]',
         capabilities TEXT NOT NULL DEFAULT '[]',
         tags TEXT NOT NULL DEFAULT '[]',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         verified_at TEXT,
         verification_level TEXT NOT NULL DEFAULT 'none',
         deprecated_by TEXT,
         metadata TEXT NOT NULL DEFAULT '{}'
       )`,
      `CREATE UNIQUE INDEX idx_registry_components_name_version ON registry_components (name, version)`,
      `CREATE INDEX idx_registry_components_lifecycle ON registry_components (lifecycle)`,
      `CREATE INDEX idx_registry_components_category ON registry_components (category)`,
      `CREATE VIRTUAL TABLE registry_components_fts USING fts5 (
         id UNINDEXED,
         name,
         description,
         tags,
         category UNINDEXED
       )`,
      `CREATE TABLE registry_compatibility (
         id TEXT PRIMARY KEY,
         component_id TEXT NOT NULL REFERENCES registry_components(id) ON DELETE CASCADE,
         framework TEXT NOT NULL,
         framework_range TEXT NOT NULL,
         platform TEXT NOT NULL,
         notes TEXT NOT NULL DEFAULT '',
         UNIQUE (component_id, framework, platform)
       )`,
      `CREATE TABLE registry_verifications (
         id TEXT PRIMARY KEY,
         component_id TEXT NOT NULL REFERENCES registry_components(id) ON DELETE CASCADE,
         version TEXT NOT NULL,
         level TEXT NOT NULL,
         passed INTEGER NOT NULL,
         report TEXT NOT NULL,
         environment_signature TEXT NOT NULL,
         checked_at TEXT NOT NULL
       )`,
      `CREATE INDEX idx_registry_verifications_component ON registry_verifications (component_id)`,
    ],
  },
  {
    version: 3,
    name: 'projects-assemblies',
    statements: [
      `CREATE TABLE projects (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         slug TEXT NOT NULL,
         spec_version TEXT NOT NULL,
         spec_hash TEXT NOT NULL,
         spec_json TEXT NOT NULL,
         assembler_version TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      `CREATE TABLE assemblies (
         id TEXT PRIMARY KEY,
         project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
         status TEXT NOT NULL,
         blueprint_hash TEXT NOT NULL,
         manifest_json TEXT NOT NULL,
         registry_snapshot TEXT NOT NULL,
         environment_signature TEXT NOT NULL,
         target_path TEXT NOT NULL,
         report_json TEXT NOT NULL DEFAULT '{}',
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX idx_assemblies_project ON assemblies (project_id)`,
    ],
  },
  {
    version: 4,
    name: 'diagnostics-and-repairs',
    statements: [
      `CREATE TABLE diagnostics (
         id TEXT PRIMARY KEY,
         assembly_id TEXT,
         project_path TEXT NOT NULL,
         fingerprint TEXT NOT NULL,
         code TEXT NOT NULL,
         category TEXT NOT NULL,
         severity TEXT NOT NULL,
         tool TEXT NOT NULL,
         tool_version TEXT,
         file TEXT,
         line INTEGER,
         column_number INTEGER,
         message TEXT NOT NULL,
         raw TEXT NOT NULL DEFAULT '{}',
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX idx_diagnostics_fingerprint ON diagnostics (fingerprint)`,
      `CREATE TABLE repair_cases (
         id TEXT PRIMARY KEY,
         fingerprint TEXT NOT NULL,
         rule_id TEXT NOT NULL,
         framework TEXT NOT NULL,
         tool_versions TEXT NOT NULL DEFAULT '{}',
         cause TEXT,
         patch_hash TEXT,
         tests_run TEXT NOT NULL DEFAULT '[]',
         outcome TEXT NOT NULL,
         rollback INTEGER NOT NULL DEFAULT 0,
         remaining_diagnostics INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         evidence TEXT NOT NULL DEFAULT '{}'
       )`,
      `CREATE INDEX idx_repair_cases_fingerprint ON repair_cases (fingerprint)`,
    ],
  },
];

export function currentVersion(db: SqlDatabase): number {
  const table = db.get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
  );
  if (table === undefined) return 0;
  const row = db.get<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations');
  return row?.version ?? 0;
}

export interface MigrationResult {
  readonly applied: readonly Migration[];
  readonly version: number;
}

/** Apply all pending migrations. Safe to call repeatedly. */
export function migrate(db: SqlDatabase, migrations: readonly Migration[] = MIGRATIONS): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const appliedVersions = new Set(
    db.all<{ version: number }>('SELECT version FROM schema_migrations').map((row) => row.version),
  );
  const pending = [...migrations].filter((m) => !appliedVersions.has(m.version)).sort((a, b) => a.version - b.version);

  const applied: Migration[] = [];
  for (const migration of pending) {
    try {
      db.transaction(() => {
        for (const statement of migration.statements) db.exec(statement);
        db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
          migration.version,
          migration.name,
          new Date().toISOString(),
        ]);
      });
      applied.push(migration);
    } catch (error) {
      throw new AssemblerError({
        code: 'MIGRATION_FAILED',
        message: `Migration ${migration.version} (${migration.name}) failed`,
        details: { version: migration.version, name: migration.name },
        cause: error,
      });
    }
  }

  const highestKnown = migrations.reduce((max, m) => Math.max(max, m.version), 0);
  const onDisk = currentVersion(db);
  if (onDisk < highestKnown) {
    throw new AssemblerError({
      code: 'MIGRATION_FAILED',
      message: `Database schema is at version ${onDisk}, expected ${highestKnown}`,
    });
  }
  return { applied, version: onDisk };
}
