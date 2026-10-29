import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type SqlDatabase } from './database.js';
import { MIGRATIONS, currentVersion, migrate } from './migrations.js';

let db: SqlDatabase;
let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'assembler-db-test-'));
  db = openDatabase(path.join(directory, 'test.db'));
});

afterEach(async () => {
  db.close();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('migrations', () => {
  it('applies every migration and records versions', () => {
    const result = migrate(db);
    expect(result.version).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.version);
    expect(result.applied).toHaveLength(MIGRATIONS.length);
    expect(currentVersion(db)).toBe(result.version);

    const tables = db
      .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .map((row) => row.name);
    expect(tables).toContain('registry_components');
    expect(tables).toContain('environment_tools');
    expect(tables).toContain('diagnostics');
  });

  it('is idempotent', () => {
    migrate(db);
    const second = migrate(db);
    expect(second.applied).toHaveLength(0);
  });

  it('persists data and supports FTS5 search', () => {
    migrate(db);
    db.run(
      `INSERT INTO registry_components
        (id, name, category, description, version, source_path, source_hash, license, provenance,
         lifecycle, framework, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'cmp_1',
        'glass-card',
        'ui',
        'A translucent glassmorphism card',
        '1.0.0',
        'libraries/web/glass-card',
        'hash',
        'MIT',
        'internal',
        'verified',
        'react',
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    db.run(`INSERT INTO registry_components_fts (id, name, description, tags, category) VALUES (?, ?, ?, ?, ?)`, [
      'cmp_1',
      'glass-card',
      'A translucent glassmorphism card',
      'glass card blur',
      'ui',
    ]);
    const rows = db.all<{ id: string }>(
      `SELECT id FROM registry_components_fts WHERE registry_components_fts MATCH ? ORDER BY rank`,
      ['glassmorphism'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('cmp_1');
  });

  it('rolls back a failed transaction', () => {
    migrate(db);
    expect(() =>
      db.transaction(() => {
        db.run(
          `INSERT INTO projects (id, name, slug, spec_version, spec_hash, spec_json, assembler_version, created_at)
           VALUES ('p1','n','s','1.0','h','{}','0.1.0','now')`,
        );
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.all('SELECT * FROM projects')).toHaveLength(0);
  });

  it('surfaces corruption instead of silently continuing', async () => {
    const file = path.join(directory, 'corrupt.db');
    await fs.writeFile(file, 'this is not a sqlite database');
    let caught: unknown;
    try {
      const corrupted = openDatabase(file);
      corrupted.all('SELECT * FROM sqlite_master');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe('DATABASE_ERROR');
  });
});
