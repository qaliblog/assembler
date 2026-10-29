/**
 * Workspace: the composition root for core services.
 *
 * A workspace owns a root directory, validated configuration, a logger, the
 * filesystem service, the process runner and the metadata database. Higher-level
 * packages receive a workspace instead of reaching for globals, which keeps the
 * engine testable and the CLI thin.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, resolvePaths, type AssemblerConfig, type DeepPartialConfig, type ResolvedPaths } from './config.js';
import { openDatabase, type SqlDatabase } from './db/database.js';
import { migrate, type MigrationResult } from './db/migrations.js';
import { FileSystemService } from './fs/fs-service.js';
import { HttpClient } from './http.js';
import { createLogger, type Logger } from './logger.js';
import { ProcessRunner } from './process/process-runner.js';

export interface CreateWorkspaceOptions {
  readonly root: string;
  readonly configPath?: string;
  readonly overrides?: DeepPartialConfig;
  readonly logger?: Logger;
  readonly env?: NodeJS.ProcessEnv;
  /** Skip applying migrations (used by read-only inspection commands). */
  readonly skipMigrate?: boolean;
}

export interface Workspace {
  readonly root: string;
  readonly config: AssemblerConfig;
  readonly paths: ResolvedPaths;
  readonly logger: Logger;
  readonly fs: FileSystemService;
  readonly processes: ProcessRunner;
  readonly http: HttpClient;
  /** Lazily opened; throws DATABASE_ERROR on corruption. */
  database(): SqlDatabase;
  migrate(): MigrationResult;
  close(): void;
}

export function createWorkspace(options: CreateWorkspaceOptions): Workspace {
  const root = path.resolve(options.root);
  const { config } = loadConfig({
    workspaceRoot: root,
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  const scopedLogger = options.logger ?? createLogger({ level: config.logLevel });
  const paths = resolvePaths(root, config);
  const fs = new FileSystemService({ logger: scopedLogger });
  const processes = new ProcessRunner({
    logger: scopedLogger,
    defaultTimeoutMs: config.process.defaultTimeoutMs,
    maxOutputBytes: config.process.maxOutputBytes,
  });
  const http = new HttpClient({
    logger: scopedLogger,
    timeoutMs: config.network.timeoutMs,
    maxBytes: config.network.maxResponseBytes,
    enabled: config.network.enabled,
  });

  let db: SqlDatabase | null = null;

  const database = (): SqlDatabase => {
    if (db !== null) return db;
    if (!existsSync(path.dirname(paths.databaseFile))) {
      mkdirSync(path.dirname(paths.databaseFile), { recursive: true });
    }
    db = openDatabase(paths.databaseFile);
    return db;
  };

  const workspace: Workspace = {
    root,
    config,
    paths,
    logger: scopedLogger,
    fs,
    processes,
    http,
    database,
    migrate(): MigrationResult {
      return migrate(database());
    },
    close(): void {
      db?.close();
      db = null;
    },
  };

  if (options.skipMigrate !== true) {
    try {
      workspace.migrate();
    } catch (error) {
      workspace.close();
      throw error;
    }
  } else {
    // Ensure logging is not silent about a skipped migration.
    scopedLogger.debug('migrations skipped', { databaseFile: paths.databaseFile });
  }

  scopedLogger.debug('workspace ready', { root, databaseFile: paths.databaseFile });
  return workspace;
}
