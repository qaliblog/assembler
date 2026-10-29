/**
 * File manifest.
 *
 * Every generated file is declared here with its owner, kind, provenance, hashes
 * and imports. The assembler writes only declared files and afterwards compares
 * the filesystem with the manifest in both directions: missing files and
 * unexpected files are both failures.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AssemblerError,
  findCaseCollisions,
  normalizeRelativePath,
  sha256,
  type FileSystemService,
} from '@assembler/core';

export type FileKind = 'source' | 'config' | 'test' | 'style' | 'asset' | 'documentation';
export type FileAction = 'create';

export interface FileProvenance {
  readonly templateId?: string;
  readonly templateFile?: string;
  readonly component?: string;
  readonly componentVersion?: string;
  readonly componentHash?: string;
  readonly generator?: string;
}

export interface PlannedFile {
  readonly path: string;
  readonly owner: string;
  readonly kind: FileKind;
  readonly action: FileAction;
  readonly applicationId: string;
  readonly exports: readonly string[];
  readonly imports: readonly string[];
  readonly externalImports: readonly string[];
  readonly verified: boolean;
  readonly provenance: FileProvenance;
  readonly sha256: string;
  readonly content: string;
}

export interface FileManifest {
  readonly schemaVersion: '1.0';
  readonly files: readonly PlannedFile[];
}

export interface ManifestFinding {
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly severity: 'error' | 'warning';
}

export function createPlannedFile(input: Omit<PlannedFile, 'sha256'> & { sha256?: string }): PlannedFile {
  return { ...input, sha256: input.sha256 ?? sha256(input.content) };
}

/** Structural validation of the manifest itself (no filesystem access). */
export function validateManifest(manifest: FileManifest): ManifestFinding[] {
  const findings: ManifestFinding[] = [];
  const paths: string[] = [];
  const owners = new Map<string, string>();

  for (const file of manifest.files) {
    let normalized: string;
    try {
      normalized = normalizeRelativePath(file.path);
    } catch (error) {
      findings.push({
        code: 'MANIFEST_PATH_INVALID',
        message: error instanceof AssemblerError ? error.message : String(error),
        path: file.path,
        severity: 'error',
      });
      continue;
    }
    if (normalized !== file.path) {
      findings.push({
        code: 'MANIFEST_PATH_NOT_NORMALIZED',
        message: `Path should be normalized to "${normalized}"`,
        path: file.path,
        severity: 'error',
      });
    }
    paths.push(file.path);
    if (file.owner.trim() === '') {
      findings.push({ code: 'MANIFEST_NO_OWNER', message: 'Every file must have an owner', path: file.path, severity: 'error' });
    }
    // Two owners may not claim the same *new* file; identical paths are rejected below.
    const existingOwner = owners.get(file.path);
    if (existingOwner !== undefined && existingOwner !== file.owner) {
      findings.push({
        code: 'MANIFEST_DUPLICATE_OWNERSHIP',
        message: `Path "${file.path}" is claimed by both "${existingOwner}" and "${file.owner}"`,
        path: file.path,
        severity: 'error',
      });
    }
    owners.set(file.path, file.owner);
    if (sha256(file.content) !== file.sha256) {
      findings.push({
        code: 'MANIFEST_HASH_MISMATCH',
        message: 'Declared hash does not match the file content',
        path: file.path,
        severity: 'error',
      });
    }
  }

  const unique = new Set(paths);
  if (unique.size !== paths.length) {
    const duplicates = paths.filter((entry, index) => paths.indexOf(entry) !== index);
    for (const duplicate of new Set(duplicates)) {
      findings.push({
        code: 'MANIFEST_DUPLICATE_PATH',
        message: 'The same path is declared more than once',
        path: duplicate,
        severity: 'error',
      });
    }
  }

  for (const [a, b] of findCaseCollisions(paths)) {
    findings.push({
      code: 'MANIFEST_CASE_COLLISION',
      message: `Paths differ only by case: "${a}" and "${b}" (invalid on macOS/Windows)`,
      path: b,
      severity: 'error',
    });
  }

  if (manifest.files.length === 0) {
    findings.push({ code: 'MANIFEST_EMPTY', message: 'The manifest declares no files', path: '', severity: 'error' });
  }
  return findings;
}

export interface ManifestReconciliation {
  readonly missing: readonly string[];
  readonly unexpected: readonly string[];
  readonly altered: readonly string[];
  readonly ok: boolean;
}

/**
 * Compare a written project directory against its manifest.
 * `allowedExtra` lists tool-generated paths (node_modules, lockfiles, dist).
 */
export async function reconcileManifest(
  root: string,
  manifest: FileManifest,
  fsService: FileSystemService,
  options: { allowedExtra?: readonly string[]; allowedPatterns?: readonly RegExp[] } = {},
): Promise<ManifestReconciliation> {
  const declared = new Set(manifest.files.map((file) => file.path));
  const actual = await fsService.listFiles(root);
  const allowedExtra = new Set(options.allowedExtra ?? []);
  const patterns = options.allowedPatterns ?? [
    /^node_modules\//,
    /^dist\//,
    /^\.git\//,
    /^\.assembler\//,
    /package-lock\.json$/,
    /pnpm-lock\.yaml$/,
    /yarn\.lock$/,
    /\.tsbuildinfo$/,
    // Metadata the assembler writes about the project itself.
    /^assembler\.(manifest|report)\.json$/,
  ];

  const missing: string[] = [];
  for (const file of manifest.files) {
    try {
      await fs.stat(path.join(root, file.path));
    } catch {
      missing.push(file.path);
    }
  }

  const unexpected: string[] = [];
  for (const entry of actual) {
    if (declared.has(entry) || allowedExtra.has(entry)) continue;
    if (patterns.some((pattern) => pattern.test(entry))) continue;
    unexpected.push(entry);
  }

  const altered: string[] = [];
  for (const file of manifest.files) {
    const absolute = path.join(root, file.path);
    try {
      const onDisk = await fs.readFile(absolute);
      if (sha256(onDisk) !== file.sha256) altered.push(file.path);
    } catch {
      // Missing files are already reported.
    }
  }

  return {
    missing: missing.sort(),
    unexpected: unexpected.sort(),
    altered: altered.sort(),
    ok: missing.length === 0 && unexpected.length === 0 && altered.length === 0,
  };
}

export function manifestSummary(manifest: FileManifest): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const file of manifest.files) {
    summary[file.kind] = (summary[file.kind] ?? 0) + 1;
  }
  return summary;
}
