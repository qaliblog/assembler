/**
 * Existing project analysis.
 *
 * Facts are reported separately from inferences. Imports come from the TypeScript
 * parser; framework detection is an inference backed by explicit evidence
 * (package.json entries, config files, directory layout).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssemblerError, FileSystemService } from '@assembler/core';
import { analyzeModule, resolveRelativeImport } from '@assembler/project-planner';

export interface Fact {
  readonly kind: string;
  readonly subject: string;
  readonly evidence: string;
  readonly confidence: 'certain' | 'likely';
}

export interface ProjectInventory {
  readonly root: string;
  readonly projects: ReadonlyArray<{
    readonly directory: string;
    readonly kind: 'react-web' | 'react-native' | 'node-backend' | 'python-backend' | 'unknown';
    readonly evidence: readonly string[];
  }>;
  readonly packageManifests: ReadonlyArray<{
    readonly path: string;
    readonly name: string | null;
    readonly dependencies: readonly string[];
    readonly devDependencies: readonly string[];
    readonly scripts: readonly string[];
  }>;
  readonly files: number;
  readonly sourceFiles: number;
  readonly testFiles: readonly string[];
  readonly unresolvedImports: ReadonlyArray<{ file: string; specifier: string }>;
  readonly undeclaredImports: ReadonlyArray<{ file: string; package: string }>;
  readonly facts: readonly Fact[];
  readonly limitations: readonly string[];
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectKind(
  directory: string,
  dependencies: ReadonlySet<string>,
  files: readonly string[],
): { kind: ProjectInventory['projects'][number]['kind']; evidence: string[] } {
  const evidence: string[] = [];
  if (dependencies.has('react-native')) {
    evidence.push('package.json lists react-native');
    return { kind: 'react-native', evidence };
  }
  if (dependencies.has('react')) {
    evidence.push('package.json lists react');
    if (dependencies.has('vite')) evidence.push('package.json lists vite');
    return { kind: 'react-web', evidence };
  }
  if (dependencies.has('fastapi') || files.some((file) => file === 'requirements.txt' || file.endsWith('main.py'))) {
    evidence.push('FastAPI/Python project markers found');
    return { kind: 'python-backend', evidence };
  }
  if (files.some((file) => file.startsWith('src/') && file.endsWith('.ts'))) {
    evidence.push('TypeScript sources without react');
    return { kind: 'node-backend', evidence };
  }
  evidence.push(`no recognised manifest in ${directory}`);
  return { kind: 'unknown', evidence };
}

export async function analyzeProject(root: string): Promise<ProjectInventory> {
  const resolvedRoot = path.resolve(root);
  const service = new FileSystemService();
  if (!(await service.isDirectory(resolvedRoot))) {
    throw new AssemblerError({ code: 'FILE_MISSING', message: `Not a directory: ${resolvedRoot}` });
  }
  const files = await service.listFiles(resolvedRoot);
  const packagePaths = files.filter((file) => file === 'package.json' || file.endsWith('/package.json'));
  const packageManifests: ProjectInventory['packageManifests'][number][] = [];
  const projects: Array<ProjectInventory['projects'][number]> = [];

  for (const manifestPath of packagePaths) {
    const data = await readJson(path.join(resolvedRoot, manifestPath));
    if (data === null) continue;
    const dependencies = Object.keys((data['dependencies'] ?? {}) as Record<string, string>);
    const devDependencies = Object.keys((data['devDependencies'] ?? {}) as Record<string, string>);
    const scripts = Object.keys((data['scripts'] ?? {}) as Record<string, string>);
    packageManifests.push({
      path: manifestPath,
      name: typeof data['name'] === 'string' ? data['name'] : null,
      dependencies,
      devDependencies,
      scripts,
    });
    const directory = path.posix.dirname(manifestPath);
    const localFiles = files
      .filter((file) => directory === '.' || file.startsWith(`${directory}/`))
      .map((file) => (directory === '.' ? file : file.slice(directory.length + 1)));
    const { kind, evidence } = detectKind(directory, new Set([...dependencies, ...devDependencies]), localFiles);
    projects.push({ directory: directory === '.' ? '.' : directory, kind, evidence });
  }

  const sourceFiles = files.filter((file) => /\.(ts|tsx|js|jsx|py)$/.test(file));
  const testFiles = files.filter((file) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) || /(^|\/)test_.*\.py$/.test(file));

  const unresolvedImports: Array<{ file: string; specifier: string }> = [];
  const undeclaredImports: Array<{ file: string; package: string }> = [];
  const projectPaths = new Set(files);
  const declaredPackages = new Set(
    packageManifests.flatMap((manifest) => [...manifest.dependencies, ...manifest.devDependencies]),
  );
  const facts: Fact[] = [];

  for (const file of files.filter((entry) => /\.(ts|tsx)$/.test(entry))) {
    const content = await fs.readFile(path.join(resolvedRoot, file), 'utf8');
    const analysis = analyzeModule(file, content);
    facts.push({
      kind: 'module',
      subject: file,
      evidence: `parsed by the TypeScript compiler API (${analysis.exports.length} exports)`,
      confidence: 'certain',
    });
    for (const specifier of analysis.relativeImports) {
      if (resolveRelativeImport(file, specifier, projectPaths) === null) {
        unresolvedImports.push({ file, specifier });
      }
    }
    for (const specifier of analysis.externalImports) {
      if (specifier.startsWith('node:')) continue;
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] ?? specifier);
      if (packageName !== '' && !declaredPackages.has(packageName)) {
        undeclaredImports.push({ file, package: packageName });
      }
    }
  }

  const limitations: string[] = [
    'Only observable repository contents were analysed. Private sources behind a URL cannot be recovered.',
    'Framework detection is inferred from manifests and paths; it is evidence-backed but not authoritative.',
  ];
  if (packageManifests.length === 0) {
    limitations.push('No package.json was found; dependency information is unavailable.');
  }

  return {
    root: resolvedRoot,
    projects,
    packageManifests,
    files: files.length,
    sourceFiles: sourceFiles.length,
    testFiles: testFiles.sort(),
    unresolvedImports,
    undeclaredImports,
    facts,
    limitations,
  };
}

export function summarizeInventory(inventory: ProjectInventory): string[] {
  const lines: string[] = [];
  lines.push(`Project: ${inventory.root}`);
  lines.push(`Files: ${inventory.files} (${inventory.sourceFiles} source, ${inventory.testFiles.length} test)`);
  if (inventory.projects.length === 0) lines.push('Targets: none recognised');
  for (const project of inventory.projects) {
    lines.push(`Target: ${project.directory} -> ${project.kind} (${project.evidence.join('; ')})`);
  }
  for (const manifest of inventory.packageManifests) {
    lines.push(
      `Manifest ${manifest.path}: ${manifest.dependencies.length} dependencies, ${manifest.devDependencies.length} dev dependencies`,
    );
  }
  if (inventory.testFiles.length > 0) {
    lines.push(`Tests: ${inventory.testFiles.slice(0, 8).join(', ')}${inventory.testFiles.length > 8 ? ', …' : ''}`);
  }
  if (inventory.unresolvedImports.length > 0) {
    lines.push(`Unresolved imports: ${inventory.unresolvedImports.length}`);
    for (const entry of inventory.unresolvedImports.slice(0, 5)) {
      lines.push(`  - ${entry.file} -> ${entry.specifier}`);
    }
  }
  if (inventory.undeclaredImports.length > 0) {
    lines.push(`Undeclared packages: ${inventory.undeclaredImports.length}`);
    for (const entry of inventory.undeclaredImports.slice(0, 5)) {
      lines.push(`  - ${entry.file} imports ${entry.package}`);
    }
  }
  for (const limitation of inventory.limitations) lines.push(`Limitation: ${limitation}`);
  return lines;
}
