/**
 * SQLite storage.
 *
 * SQLite is used for *metadata only*: component records, environment inventory,
 * documentation index, project/assembly history, diagnostics and repair cases.
 * Source files, templates and project trees always live on the filesystem.
 *
 * The driver is `node-sqlite3-wasm`: real SQLite (with FTS5 and JSON1), no native
 * compilation, identical behaviour on Linux/macOS/Windows and on architectures
 * without prebuilt binaries. It is hidden behind `SqlDatabase` so a different
 * driver can be substituted without touching callers.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { AssemblerError } from '../errors.js';

// node-sqlite3-wasm is published as CommonJS; loading it through createRequire
// keeps the ESM build working unchanged on Node 18.
const require = createRequire(import.meta.url);
const sqliteWasm = require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm');
type WasmDatabase = InstanceType<typeof sqliteWasm.Database>;

export type SqlValue = string | number | bigint | Uint8Array | null | boolean;

export interface SqlDatabase {
  readonly file: string;
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): { changes: number };
  get<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
  close(): void;
}

function normalizeParams(params: readonly SqlValue[] | undefined): Array<string | number | bigint | Uint8Array | null> {
  if (params === undefined) return [];
  return params.map((value) => {
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

class WasmSqlDatabase implements SqlDatabase {
  readonly file: string;
  private readonly db: WasmDatabase;

  constructor(file: string, options: { readOnly?: boolean } = {}) {
    this.file = file;
    if (file !== ':memory:') {
      mkdirSync(path.dirname(file), { recursive: true });
    }
    try {
      this.db = new sqliteWasm.Database(file, { fileMustExist: options.readOnly === true });
    } catch (error) {
      throw new AssemblerError({
        code: 'DATABASE_ERROR',
        message: `Cannot open SQLite database: ${file}`,
        cause: error,
        hint: 'The database file may be corrupted. Delete it to rebuild metadata; source files are not affected.',
      });
    }
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  exec(sql: string): void {
    try {
      this.db.exec(sql);
    } catch (error) {
      throw new AssemblerError({
        code: 'DATABASE_ERROR',
        message: `SQL execution failed: ${firstLine(sql)}`,
        details: { sql: firstLine(sql) },
        cause: error,
      });
    }
  }

  run(sql: string, params?: readonly SqlValue[]): { changes: number } {
    try {
      const result = this.db.run(sql, normalizeParams(params));
      return { changes: result.changes };
    } catch (error) {
      throw new AssemblerError({
        code: 'DATABASE_ERROR',
        message: `SQL statement failed: ${firstLine(sql)}`,
        details: { sql: firstLine(sql) },
        cause: error,
      });
    }
  }

  get<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): T | undefined {
    try {
      const row = this.db.get(sql, normalizeParams(params));
      return row === null ? undefined : (row as T);
    } catch (error) {
      throw new AssemblerError({
        code: 'DATABASE_ERROR',
        message: `SQL query failed: ${firstLine(sql)}`,
        details: { sql: firstLine(sql) },
        cause: error,
      });
    }
  }

  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): T[] {
    try {
      return this.db.all(sql, normalizeParams(params)) as T[];
    } catch (error) {
      throw new AssemblerError({
        code: 'DATABASE_ERROR',
        message: `SQL query failed: ${firstLine(sql)}`,
        details: { sql: firstLine(sql) },
        cause: error,
      });
    }
  }

  transaction<T>(fn: () => T): T {
    this.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.exec('ROLLBACK');
      } catch {
        // The transaction may already be rolled back by SQLite.
      }
      throw error;
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Closing an already-closed database is not an error worth surfacing.
    }
  }
}

function firstLine(sql: string): string {
  return sql.trim().split('\n')[0]?.slice(0, 200) ?? '';
}

export function openDatabase(file: string, options: { readOnly?: boolean } = {}): SqlDatabase {
  return new WasmSqlDatabase(file, options);
}

/** Run `PRAGMA integrity_check` and fail with a clear message on corruption. */
export function checkIntegrity(db: SqlDatabase): { ok: boolean; detail: string } {
  const rows = db.all<{ integrity_check: string }>('PRAGMA integrity_check');
  const detail = rows.map((row) => row.integrity_check).join('; ');
  return { ok: detail === 'ok', detail };
}

/** Convenience helpers used by repositories to keep JSON columns readable. */
export function toJsonColumn(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJsonColumn<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
