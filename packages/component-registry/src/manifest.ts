/**
 * Component manifest.
 *
 * A component is a directory with `component.json` plus its template files. The
 * manifest declares where each file may be placed, what it exports, which
 * frameworks and platforms it supports, and how it was verified. The engine never
 * picks a destination path itself: placement comes from the manifest.
 */
import path from 'node:path';
import { AssemblerError, sha256 } from '@assembler/core';
import { z } from 'zod';

export const componentLifecycleSchema = z.enum(['draft', 'candidate', 'verified', 'deprecated', 'rejected']);
export type ComponentLifecycle = z.infer<typeof componentLifecycleSchema>;

export const verificationLevelSchema = z.enum(['none', 'structural', 'tested']);
export type VerificationLevel = z.infer<typeof verificationLevelSchema>;

export const componentFileSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  mode: z.enum(['render', 'copy']).default('render'),
  kind: z.enum(['source', 'config', 'test', 'style', 'asset', 'documentation']).default('source'),
});

export const componentManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  category: z.enum(['ui', 'layout', 'design-tokens', 'service', 'data-access', 'test-util']),
  description: z.string().min(1),
  license: z.string().min(1),
  provenance: z.enum(['internal', 'adapted-documentation', 'third-party']),
  framework: z.enum(['react', 'react-native', 'node-typescript', 'fastapi', 'any']),
  platforms: z.array(z.enum(['web', 'mobile', 'backend'])).min(1),
  compatibility: z
    .array(
      z.object({
        framework: z.string().min(1),
        range: z.string().min(1),
        platform: z.enum(['web', 'mobile', 'backend']),
      }),
    )
    .default([]),
  exports: z.array(z.object({ name: z.string().min(1), from: z.string().min(1) })).default([]),
  files: z.array(componentFileSchema).min(1),
  tests: z.array(z.object({ source: z.string().min(1), target: z.string().min(1) })).default([]),
  dependencies: z.array(z.object({ name: z.string().min(1), range: z.string().min(1) })).default([]),
  capabilities: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  lifecycle: componentLifecycleSchema.default('draft'),
  verification: z
    .object({
      level: verificationLevelSchema.default('none'),
      method: z.string().default(''),
      verifiedAt: z.string().optional(),
      notes: z.string().default(''),
    })
    .default({}),
  design: z
    .object({
      styles: z.array(z.string()).default([]),
      themes: z.array(z.string()).default([]),
    })
    .optional(),
});

export type ComponentManifest = z.infer<typeof componentManifestSchema>;
export type ComponentFile = z.infer<typeof componentFileSchema>;

export interface ComponentRecord {
  readonly directory: string;
  readonly relativePath: string;
  readonly manifest: ComponentManifest;
  readonly sourceHash: string;
}

/** Validate a manifest object and return a typed value or a list of problems. */
export function parseComponentManifest(raw: unknown): { manifest: ComponentManifest } | { problems: string[] } {
  const parsed = componentManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }
  return { manifest: parsed.data };
}

export function componentId(manifest: ComponentManifest): string {
  return `${manifest.name}@${manifest.version}`;
}

/** Hash of the manifest plus every declared file, so changes are detectable. */
export async function hashComponentDirectory(
  directory: string,
  manifest: ComponentManifest,
  readFile: (file: string) => Promise<string>,
): Promise<string> {
  const parts: Array<[string, string]> = [];
  for (const file of manifest.files) {
    parts.push([file.source, await readFile(path.join(directory, file.source))]);
  }
  for (const test of manifest.tests) {
    parts.push([test.source, await readFile(path.join(directory, test.source))]);
  }
  parts.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256(`${JSON.stringify(manifest)}\n${parts.map(([name, content]) => `${name}\u0000${content}`).join('\n')}`);
}

export function assertSafeTarget(target: string): void {
  if (target.startsWith('/') || target.includes('..') || /^[a-zA-Z]:/.test(target)) {
    throw new AssemblerError({
      code: 'PATH_ESCAPE',
      message: `Component target path must stay inside the project: ${target}`,
    });
  }
}
