/**
 * Knowledge base.
 *
 * Two versioned JSON files under `knowledge/` define what the engine is allowed to
 * emit: pinned dependency versions and design token sets. They are hashed into the
 * blueprint so an assembly can be reproduced exactly.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssemblerError, sha256, stableStringify } from '@assembler/core';

export interface VersionTarget {
  readonly framework: string;
  readonly language?: string;
  readonly nodeRange?: string;
  readonly pythonRange?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly requirements?: Readonly<Record<string, string>>;
  readonly toolchain: readonly string[];
  readonly commands: Readonly<Record<'install' | 'typecheck' | 'test' | 'build', readonly string[]>>;
}

export interface VersionKnowledge {
  readonly schemaVersion: string;
  readonly targets: Readonly<Record<string, VersionTarget>>;
  readonly compatibility: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface ThemeTokens {
  readonly colorBg: string;
  readonly colorBgGradient: string;
  readonly colorText: string;
  readonly colorTextMuted: string;
  readonly colorBorder: string;
  readonly colorDanger: string;
  readonly colorSuccess: string;
  readonly surfaceOpacity: string;
}

export interface DesignPreset {
  readonly label: string;
  /** Palette per colour scheme, so a preset never fights the requested theme. */
  readonly recommendedPalettes: Readonly<Record<string, readonly string[]>>;
}

export interface StyleTokens {
  readonly radiusSm: string;
  readonly radiusMd: string;
  readonly radiusLg: string;
  readonly blur: string;
  readonly shadowSm: string;
  readonly shadowMd: string;
  readonly borderStrength: string;
  readonly surfaceSaturation: string;
  readonly recommendedPalettes: Readonly<Record<string, readonly string[]>>;
}

export interface DesignKnowledge {
  readonly schemaVersion: string;
  readonly themes: Readonly<Record<'dark' | 'light', ThemeTokens>>;
  readonly styles: Readonly<Record<string, StyleTokens>>;
  readonly presets?: Readonly<Record<string, DesignPreset>>;
  readonly spacing: Readonly<Record<string, string>>;
  readonly layout: Readonly<Record<'sidebarWidth' | 'headerHeight' | 'contentMaxWidth', string>>;
  readonly type: {
    readonly fontSans: string;
    /** Display and body serif, used by editorial layouts. */
    readonly fontSerif?: string;
    readonly scale: Readonly<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl', string>>;
  };
  readonly motion: { readonly transition: string };
}

async function readJson<T>(file: string): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (error) {
    throw new AssemblerError({
      code: 'CONFIG_INVALID',
      message: `Knowledge file is missing or invalid: ${file}`,
      cause: error,
      hint: 'Restore the knowledge directory from version control.',
    });
  }
}

export interface LoadedKnowledge {
  readonly versions: VersionKnowledge;
  readonly design: DesignKnowledge;
  readonly versionsHash: string;
  readonly designHash: string;
}

export async function loadKnowledge(knowledgeDir: string): Promise<LoadedKnowledge> {
  const versions = await readJson<VersionKnowledge>(path.join(knowledgeDir, 'versions.json'));
  const design = await readJson<DesignKnowledge>(path.join(knowledgeDir, 'design.json'));
  return {
    versions,
    design,
    versionsHash: sha256(stableStringify(versions)),
    designHash: sha256(stableStringify(design)),
  };
}
