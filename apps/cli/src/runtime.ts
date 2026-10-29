/**
 * Runtime resolution for the CLI.
 *
 * Two locations must never be confused:
 *
 * - the **assets root** (templates, knowledge, component libraries) belongs to the
 *   Assembler installation, so it is resolved relative to this module;
 * - the **project workspace** belongs to the user and defaults to `process.cwd()`.
 *
 * Resolving assets from the current directory is only a fallback for running from
 * a source checkout; it can never silently become the output location.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssemblerError, createWorkspace, type Workspace } from '@assembler/core';

/** Directory of the running module (`apps/cli/src` in tests, `dist` when built). */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

async function isAssetsRoot(directory: string): Promise<boolean> {
  try {
    await fs.access(path.join(directory, 'templates', 'react-web', 'template.json'));
    return true;
  } catch {
    return false;
  }
}

/** Walk upwards from each starting directory looking for an Assembler assets root. */
export async function findAssetsRoot(
  startDirectories: readonly string[],
  maxDepth = 6,
): Promise<string | null> {
  for (const start of startDirectories) {
    let directory = path.resolve(start);
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      if (await isAssetsRoot(directory)) return directory;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return null;
}

/**
 * Resolve the assets root: an explicit `--root` wins, then the installation this
 * module lives in, then (for source checkouts) the current directory.
 */
export async function resolveAssetsRoot(
  explicit: string | undefined,
  cwd: string,
  installationDir: string = moduleDir,
): Promise<string> {
  if (explicit !== undefined) {
    const resolved = path.resolve(cwd, explicit);
    if (!(await isAssetsRoot(resolved))) {
      throw new AssemblerError({
        code: 'FILE_MISSING',
        message: `Not an Assembler assets root: ${resolved}`,
        hint: 'The directory must contain templates/react-web/template.json.',
      });
    }
    return resolved;
  }
  const installed = await findAssetsRoot([installationDir]);
  if (installed !== null) return installed;
  const fromCwd = await findAssetsRoot([cwd]);
  if (fromCwd !== null) return fromCwd;
  throw new AssemblerError({
    code: 'PATH_INVALID',
    message: 'Cannot locate the Assembler assets (templates, knowledge, libraries).',
    hint: 'Run `assembler` from an installed package, or pass --root <assembler checkout>.',
    details: { installationDir, cwd },
  });
}

export interface OpenWorkspaceOptions {
  readonly assetsRoot: string;
  readonly projectDir: string;
  readonly json: boolean;
  readonly skipMigrate?: boolean;
}

/**
 * Open the workspace for a user project. Templates, knowledge and libraries come
 * from the installation; state (database, staging, backups) lives inside the
 * project directory itself.
 */
export async function openProjectWorkspace(options: OpenWorkspaceOptions): Promise<Workspace> {
  const projectDir = path.resolve(options.projectDir);
  await fs.mkdir(projectDir, { recursive: true });
  return createWorkspace({
    root: projectDir,
    overrides: {
      logLevel: options.json ? 'error' : 'warn',
      paths: {
        templates: path.join(options.assetsRoot, 'templates'),
        knowledge: path.join(options.assetsRoot, 'knowledge'),
        libraries: path.join(options.assetsRoot, 'libraries'),
      },
    },
    ...(options.skipMigrate === true ? { skipMigrate: true } : {}),
  });
}
