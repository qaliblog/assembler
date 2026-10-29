/**
 * Explicit, validated configuration.
 *
 * Every tunable value used by the engine lives here (or in a knowledge file),
 * never as a scattered constant. Unknown keys are rejected so that typos in a
 * user config file fail loudly instead of being silently ignored.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { AssemblerError } from './errors.js';

export const CONFIG_FILENAME = 'assembler.config.json';

const packageManagerSchema = z.enum(['pnpm', 'npm', 'yarn']);

export const configSchema = z
  .object({
    /** Directory (relative to the workspace root) holding generated state. */
    dataDir: z.string().min(1).default('.assembler'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    /**
     * Package manager preference for generated Node projects. The environment
     * manager picks the first *healthy* candidate; it never invents one.
     */
    packageManagers: z
      .object({
        preference: z.array(packageManagerSchema).min(1).default(['pnpm', 'npm', 'yarn']),
        installTimeoutMs: z.number().int().positive().default(600_000),
        frozenLockfile: z.boolean().default(false),
        /** When true, never touch the network; missing deps are reported. */
        offline: z.boolean().default(false),
      })
      .default({}),
    process: z
      .object({
        defaultTimeoutMs: z.number().int().positive().default(120_000),
        maxOutputBytes: z.number().int().positive().default(1_000_000),
      })
      .default({}),
    network: z
      .object({
        enabled: z.boolean().default(true),
        timeoutMs: z.number().int().positive().default(20_000),
        maxResponseBytes: z.number().int().positive().default(8_000_000),
        maxRedirects: z.number().int().min(0).max(10).default(3),
      })
      .default({}),
    assembly: z
      .object({
        /**
         * deny     – refuse to write into a non-empty target directory
         * backup   – move the existing directory to `<dataDir>/backups/<id>` first
         * replace  – delete the target directory contents (requires --force)
         */
        overwritePolicy: z.enum(['deny', 'backup', 'replace']).default('deny'),
        /**
         * Where projects are staged before publishing. Empty means the OS temp
         * directory: staging inside another package manager's workspace (or inside
         * the repository itself) makes `pnpm install` think it belongs to that
         * workspace and silently do nothing.
         */
        stagingDir: z.string().default(''),
        /** Run dependency installation during `build`. */
        installDependencies: z.boolean().default(true),
        /** Refuse to publish a project whose validation fails. */
        failOnValidationError: z.boolean().default(true),
      })
      .default({}),
    registry: z
      .object({
        /** Components that have not been verified may never be auto-selected. */
        allowUnverifiedComponents: z.boolean().default(false),
        databaseFile: z.string().default('.assembler/assembler.db'),
      })
      .default({}),
    paths: z
      .object({
        templates: z.string().default('templates'),
        knowledge: z.string().default('knowledge'),
        libraries: z.string().default('libraries'),
      })
      .default({}),
    testing: z
      .object({
        /** Commands are run in order; the first failure stops the sequence. */
        runTestsDuringBuild: z.boolean().default(true),
        runTypecheckDuringBuild: z.boolean().default(true),
      })
      .default({}),
  })
  .strict();

export type AssemblerConfig = z.infer<typeof configSchema>;
export type PackageManagerName = z.infer<typeof packageManagerSchema>;

export interface LoadConfigOptions {
  readonly workspaceRoot: string;
  /** Explicit config path; defaults to `<workspaceRoot>/assembler.config.json`. */
  readonly configPath?: string;
  readonly overrides?: DeepPartialConfig;
  readonly env?: NodeJS.ProcessEnv;
}

export type DeepPartialConfig = {
  [K in keyof AssemblerConfig]?: AssemblerConfig[K] extends object
    ? Partial<AssemblerConfig[K]>
    : AssemblerConfig[K];
};

export interface LoadedConfig {
  readonly config: AssemblerConfig;
  readonly source: string | null;
  readonly workspaceRoot: string;
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    if (
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function loadConfig(options: LoadConfigOptions): LoadedConfig {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? path.join(options.workspaceRoot, CONFIG_FILENAME);
  let fileConfig: Record<string, unknown> = {};
  let source: string | null = null;

  if (existsSync(configPath)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (error) {
      throw new AssemblerError({
        code: 'CONFIG_INVALID',
        message: `Configuration file is not valid JSON: ${configPath}`,
        cause: error,
        hint: 'Fix the JSON syntax or delete the file to use defaults.',
      });
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AssemblerError({
        code: 'CONFIG_INVALID',
        message: `Configuration file must contain a JSON object: ${configPath}`,
      });
    }
    fileConfig = raw as Record<string, unknown>;
    source = configPath;
  }

  const envOverrides: Record<string, unknown> = {};
  if (env.ASSEMBLER_LOG_LEVEL) envOverrides.logLevel = env.ASSEMBLER_LOG_LEVEL;
  if (env.ASSEMBLER_OFFLINE === '1' || env.ASSEMBLER_OFFLINE === 'true') {
    envOverrides.packageManagers = { offline: true };
    envOverrides.network = { enabled: false };
  }

  const merged = deepMerge(
    deepMerge(deepMerge({}, fileConfig), envOverrides),
    (options.overrides ?? {}) as Record<string, unknown>,
  );

  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new AssemblerError({
      code: 'CONFIG_INVALID',
      message: `Configuration is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
      details: { issues: parsed.error.issues, source },
      hint: `Review ${CONFIG_FILENAME}.`,
    });
  }
  return { config: parsed.data, source, workspaceRoot: options.workspaceRoot };
}

/** Absolute path helpers derived from a config + workspace root. */
export interface ResolvedPaths {
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly stagingDir: string;
  readonly templatesDir: string;
  readonly knowledgeDir: string;
  readonly librariesDir: string;
  readonly databaseFile: string;
  readonly backupsDir: string;
}

export function resolvePaths(workspaceRoot: string, config: AssemblerConfig): ResolvedPaths {
  return {
    workspaceRoot,
    dataDir: path.resolve(workspaceRoot, config.dataDir),
    stagingDir:
      config.assembly.stagingDir.trim() === ''
        ? path.join(os.tmpdir(), 'assembler-staging')
        : path.resolve(workspaceRoot, config.assembly.stagingDir),
    templatesDir: path.resolve(workspaceRoot, config.paths.templates),
    knowledgeDir: path.resolve(workspaceRoot, config.paths.knowledge),
    librariesDir: path.resolve(workspaceRoot, config.paths.libraries),
    databaseFile: path.resolve(workspaceRoot, config.registry.databaseFile),
    backupsDir: path.resolve(workspaceRoot, config.dataDir, 'backups'),
  };
}
