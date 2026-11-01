/**
 * Deterministic templates.
 *
 * Deliberately not a general-purpose template language: no loops, no conditionals,
 * no code execution. A template is text with `{{variable}}` slots; the planner
 * decides every value and which files exist. Identical inputs therefore produce
 * byte-identical output, which is what makes assembly reproducible.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssemblerError, sha256 } from '@assembler/core';

export interface TemplateVariable {
  readonly name: string;
  readonly description: string;
  readonly example?: string;
}

export interface TemplateFileSpec {
  /** Source file, relative to the template directory. */
  readonly source: string;
  /** Target path inside the generated project (POSIX, relative). */
  readonly target: string;
  /** `render` substitutes variables; `copy` copies bytes unchanged. */
  readonly mode: 'render' | 'copy';
  readonly kind: 'source' | 'config' | 'test' | 'style' | 'asset' | 'documentation';
}

export interface TemplateManifest {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly framework: string;
  readonly buildSystem: string;
  readonly variables: readonly TemplateVariable[];
  readonly files: readonly TemplateFileSpec[];
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
/** `{{> snippetName}}` includes a code snippet from the template's `snippets/` directory. */
const SNIPPET_PATTERN = /\{\{>\s*([a-zA-Z0-9_./-]+)\s*\}\}/g;

export function extractVariables(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

export interface RenderOptions {
  /** Fail when a variable in the template has no value. Default: true. */
  readonly strict?: boolean;
  /** Named code snippets that `{{> name}}` includes are replaced with. */
  readonly snippets?: Readonly<Record<string, string>>;
}

/**
 * Expand `{{> snippetName}}` includes. Snippets are ordinary code fragments and
 * may themselves use `{{variable}}` slots or include other snippets; variable
 * substitution happens afterwards, so the output is code rather than a marker.
 */
export function expandSnippets(
  template: string,
  snippets: Readonly<Record<string, string>>,
  depth = 0,
): string {
  if (depth > 5) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: 'Snippet includes are nested more than 5 levels deep',
    });
  }
  return template.replace(SNIPPET_PATTERN, (whole, name: string) => {
    const snippet = snippets[name];
    return snippet === undefined ? whole : expandSnippets(snippet, snippets, depth + 1);
  });
}

/** Slot markers that survived rendering; empty means the template was filled. */
export function findUnfilledSlots(rendered: string): string[] {
  const names = new Set<string>();
  for (const match of rendered.matchAll(VARIABLE_PATTERN)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  for (const match of rendered.matchAll(SNIPPET_PATTERN)) {
    if (match[1] !== undefined) names.add(`> ${match[1]}`);
  }
  return [...names].sort();
}

/** Render one template string. Throws PLAN_INVALID in strict mode on any unfilled slot. */
export function renderTemplate(template: string, variables: Readonly<Record<string, string | number>>, options: RenderOptions = {}): string {
  const strict = options.strict ?? true;
  const expanded = options.snippets === undefined ? template : expandSnippets(template, options.snippets);
  const missing = new Set<string>();
  const output = expanded.replace(VARIABLE_PATTERN, (whole, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      missing.add(name);
      return whole;
    }
    // Values are inserted verbatim; escaping is the caller's responsibility and
    // only ever appropriate inside the language being generated.
    return String(value);
  });
  if (strict && missing.size > 0) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: `Template references undefined variable(s): ${[...missing].sort().join(', ')}`,
      details: { missing: [...missing].sort() },
    });
  }
  if (strict) {
    const unfilled = findUnfilledSlots(output);
    if (unfilled.length > 0) {
      throw new AssemblerError({
        code: 'PLAN_INVALID',
        message: `Template still contains unfilled slot(s): ${unfilled.join(', ')}`,
        details: { unfilled },
      });
    }
  }
  return output;
}

/**
 * Load every file under `snippets/` as a named snippet. `.tmpl` is optional in
 * the name, so `{{> tokens.css}}` matches both `tokens.css` and `tokens.css.tmpl`.
 */
export async function loadSnippets(directory: string): Promise<Record<string, string>> {
  const snippetDir = path.join(directory, 'snippets');
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(snippetDir, { withFileTypes: true });
  } catch {
    return {};
  }
  const snippets: Record<string, string> = {};
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isFile()) continue;
    const raw = await fs.readFile(path.join(snippetDir, entry.name), 'utf8');
    // Drop the file's final newline: the include line already carries one, so
    // snippets compose without accumulating blank lines.
    const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    snippets[entry.name] = text;
    if (entry.name.endsWith('.tmpl')) snippets[entry.name.slice(0, -'.tmpl'.length)] = text;
  }
  return snippets;
}

/** List every variable a template set references, for documentation and tests. */
export async function collectTemplateVariables(directory: string, manifest: TemplateManifest): Promise<string[]> {
  const names = new Set<string>();
  for (const file of manifest.files) {
    if (file.mode !== 'render') continue;
    const text = await fs.readFile(path.join(directory, file.source), 'utf8');
    for (const name of extractVariables(text)) names.add(name);
  }
  return [...names].sort();
}

export async function readTemplateManifest(directory: string): Promise<TemplateManifest> {
  const manifestPath = path.join(directory, 'template.json');
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: `Cannot read template manifest: ${manifestPath}`,
      cause: error,
    });
  }
  const manifest = raw as Partial<TemplateManifest>;
  if (typeof manifest.id !== 'string' || !Array.isArray(manifest.files)) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: `Template manifest is missing "id" or "files": ${manifestPath}`,
    });
  }
  return manifest as TemplateManifest;
}

export interface RenderedFile {
  readonly target: string;
  readonly content: string;
  readonly kind: TemplateFileSpec['kind'];
  readonly sha256: string;
  readonly source: string;
}

/**
 * Render every file in a template set. `overrides` replaces specific targets
 * (used when a registry component supersedes a template file).
 */
export async function renderTemplateSet(
  directory: string,
  manifest: TemplateManifest,
  variables: Readonly<Record<string, string | number>>,
  options: RenderOptions = {},
): Promise<RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  const seen = new Set<string>();
  const snippets = options.snippets ?? (await loadSnippets(directory));
  const renderOptions: RenderOptions = { ...options, snippets };
  for (const file of manifest.files) {
    if (seen.has(file.target)) {
      throw new AssemblerError({
        code: 'PLAN_INVALID',
        message: `Template declares the same target twice: ${file.target}`,
      });
    }
    seen.add(file.target);
    const sourcePath = path.join(directory, file.source);
    let content: string;
    try {
      content = await fs.readFile(sourcePath, 'utf8');
    } catch (error) {
      throw new AssemblerError({
        code: 'PLAN_INVALID',
        message: `Template file is missing: ${sourcePath}`,
        cause: error,
      });
    }
    const output = file.mode === 'render' ? renderTemplate(content, variables, renderOptions) : content;
    rendered.push({
      target: file.target,
      content: output,
      kind: file.kind,
      source: file.source,
      sha256: sha256(output),
    });
  }
  return rendered.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
}

/** Verify a template set without rendering: all files present, no duplicate targets. */
export async function validateTemplateSet(directory: string, manifest: TemplateManifest): Promise<string[]> {
  const problems: string[] = [];
  const targets = new Set<string>();
  for (const file of manifest.files) {
    if (targets.has(file.target)) problems.push(`duplicate target: ${file.target}`);
    targets.add(file.target);
    try {
      await fs.access(path.join(directory, file.source));
    } catch {
      problems.push(`missing source file: ${file.source}`);
    }
  }
  if (manifest.files.length === 0) problems.push('template declares no files');
  return problems;
}
