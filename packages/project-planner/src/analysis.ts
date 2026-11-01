/**
 * Import analysis for a planned file set.
 *
 * Shared by every target planner so a generated project is rejected for the same
 * reasons regardless of framework: a relative import that points at nothing, an
 * external package that is not declared, or a file that does not parse.
 */
import { analyzeModule, resolveRelativeImport } from './imports.js';
import type { PlannedFile } from './manifest.js';
import type { PlanBlocker } from './planner.js';

export function withImportAnalysis(
  files: readonly PlannedFile[],
  declaredDependencies: ReadonlySet<string>,
  blockers: PlanBlocker[],
): PlannedFile[] {
  const projectPaths = new Set(files.map((file) => file.path));
  const withImports: PlannedFile[] = [];

  for (const file of files) {
    if (!file.path.endsWith('.ts') && !file.path.endsWith('.tsx')) {
      withImports.push(file);
      continue;
    }
    const analysis = analyzeModule(file.path, file.content);
    for (const parseError of analysis.parseErrors) {
      blockers.push({ code: 'GENERATED_PARSE_ERROR', message: `${file.path}: ${parseError}` });
    }
    const resolvedImports: string[] = [];
    for (const specifier of analysis.relativeImports) {
      const resolved = resolveRelativeImport(file.path, specifier, projectPaths);
      if (resolved === null) {
        blockers.push({
          code: 'IMPORT_UNRESOLVED',
          message: `${file.path} imports "${specifier}", which is not in the file manifest`,
        });
        continue;
      }
      resolvedImports.push(resolved);
    }
    for (const specifier of analysis.externalImports) {
      if (specifier.startsWith('node:')) continue;
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] ?? specifier);
      if (packageName === '' || declaredDependencies.has(packageName)) continue;
      blockers.push({
        code: 'IMPORT_UNDECLARED_DEPENDENCY',
        message: `${file.path} imports "${packageName}", which is missing from package.json`,
      });
    }
    withImports.push({
      ...file,
      imports: [...new Set(resolvedImports)].sort(),
      externalImports: analysis.externalImports,
      exports: analysis.exports.length > 0 ? analysis.exports : file.exports,
    });
  }

  return withImports;
}
