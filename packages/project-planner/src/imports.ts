/**
 * Import/export analysis using the TypeScript compiler API.
 *
 * Regular expressions are not used to understand source code here: the same parser
 * that typechecks the generated project extracts module specifiers, so a file that
 * parses is analysed accurately and a file that does not parse is reported.
 */
import ts from 'typescript';
import path from 'node:path';
import { AssemblerError } from '@assembler/core';

export interface ImportAnalysis {
  readonly relativeImports: readonly string[];
  readonly externalImports: readonly string[];
  readonly exports: readonly string[];
  readonly parseErrors: readonly string[];
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.ts')) return ts.ScriptKind.TS;
  if (fileName.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.Unknown;
}

export function analyzeModule(fileName: string, content: string): ImportAnalysis {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.ES2022,
    true,
    scriptKindFor(fileName),
  );
  const relative: string[] = [];
  const external: string[] = [];
  const exports: string[] = [];

  const classify = (specifier: string): void => {
    if (specifier.startsWith('.')) relative.push(specifier);
    else external.push(specifier);
  };

  const collectNamed = (node: ts.ImportClause): void => {
    if (node.name !== undefined) exports.push('default');
  };
  void collectNamed;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      classify(statement.moduleSpecifier.text);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
        classify(statement.moduleSpecifier.text);
      }
      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) exports.push(element.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      exports.push('default');
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exports.push(declaration.name.text);
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name !== undefined
      ) {
        exports.push(statement.name.text);
      }
      if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
        exports.push('default');
      }
    }
  }

  const parseErrors = (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return {
    relativeImports: [...new Set(relative)].sort(),
    externalImports: [...new Set(external)].sort(),
    exports: [...new Set(exports)].sort(),
    parseErrors: parseErrors.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    ),
  };
}

const RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '.css', '.json', '/index.ts', '/index.tsx'];

/**
 * Resolve a relative import against the set of declared project paths.
 *
 * Node's ESM resolution requires a `.js` extension in source that compiles from
 * `.ts`, so `./router.js` must resolve to `src/router/router.ts`; the generated
 * Node.js target depends on that.
 */
export function resolveRelativeImport(
  fromPath: string,
  specifier: string,
  projectFiles: ReadonlySet<string>,
): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const bases = [base];
  if (/\.(?:js|mjs|cjs)$/.test(base)) {
    const withoutExtension = base.replace(/\.(?:js|mjs|cjs)$/, '');
    bases.push(`${withoutExtension}.ts`, `${withoutExtension}.tsx`);
  }
  for (const candidateBase of bases) {
    for (const suffix of RESOLUTION_SUFFIXES) {
      const candidate = `${candidateBase}${suffix}`;
      if (projectFiles.has(candidate)) return candidate;
      if (suffix === '' && projectFiles.has(`${candidate}/index.ts`)) return `${candidate}/index.ts`;
      if (suffix === '' && projectFiles.has(`${candidate}/index.tsx`)) return `${candidate}/index.tsx`;
    }
  }
  return null;
}

export interface ImportValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export function resolveAllImports(
  files: ReadonlyArray<{ path: string; content: string }>,
  dependencyNames: ReadonlySet<string>,
): { issues: ImportValidationIssue[]; resolved: Map<string, ImportAnalysis> } {
  const projectFiles = new Set(files.map((file) => file.path));
  const issues: ImportValidationIssue[] = [];
  const resolved = new Map<string, ImportAnalysis>();

  for (const file of files) {
    if (!file.path.endsWith('.ts') && !file.path.endsWith('.tsx')) continue;
    const analysis = analyzeModule(file.path, file.content);
    resolved.set(file.path, analysis);
    for (const parseError of analysis.parseErrors) {
      issues.push({ code: 'IMPORT_PARSE_ERROR', message: parseError, path: file.path });
    }
    for (const specifier of analysis.relativeImports) {
      if (resolveRelativeImport(file.path, specifier, projectFiles) === null) {
        issues.push({
          code: 'IMPORT_UNRESOLVED',
          message: `Cannot resolve "${specifier}" from this file`,
          path: file.path,
        });
      }
    }
    for (const specifier of analysis.externalImports) {
      if (specifier.startsWith('node:') || specifier === 'bun:test') continue;
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] ?? specifier);
      if (packageName === '' || packageName.startsWith('.')) continue;
      if (!dependencyNames.has(packageName)) {
        issues.push({
          code: 'IMPORT_UNDECLARED_DEPENDENCY',
          message: `Package "${packageName}" is imported but not declared in the dependency manifest`,
          path: file.path,
        });
      }
    }
  }

  // External imports that are only used as types do not need a runtime dependency
  // check, but every package must still be declared for the typecheck to pass.
  return { issues, resolved };
}

export function assertAnalyzable(fileName: string, content: string): ImportAnalysis {
  const analysis = analyzeModule(fileName, content);
  if (analysis.parseErrors.length > 0) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: `Generated file does not parse: ${fileName}`,
      details: { errors: analysis.parseErrors },
    });
  }
  return analysis;
}
