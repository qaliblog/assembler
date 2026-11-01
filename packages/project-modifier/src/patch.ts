/**
 * Route-table patch.
 *
 * The TypeScript parser locates the import block and the `routeEntries` array;
 * the edit itself is a small, bounded text replacement. This is deliberately not
 * a regular expression over the file: comments, strings and unrelated arrays
 * cannot be confused with the route table.
 */
import ts from 'typescript';

export interface RoutePatchInput {
  readonly content: string;
  readonly route: string;
  readonly title: string;
  readonly componentName: string;
  readonly requiresAuth: boolean;
}

export interface RoutePatchResult {
  readonly content: string;
  readonly importLines: readonly string[];
  readonly entryLine: string;
}

export class RoutePatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutePatchError';
  }
}

function namedImportsFrom(source: ts.SourceFile, moduleSuffix: string): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier) || !specifier.text.endsWith(moduleSuffix)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.namedBindings === undefined) continue;
    if (ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) names.add(element.name.text);
    }
  }
  return names;
}

function indentationFor(content: string, source: ts.SourceFile, array: ts.ArrayLiteralExpression): string {
  const first = array.elements[0];
  if (first === undefined) return '  ';
  const lineStart = content.lastIndexOf('\n', first.getStart(source)) + 1;
  const prefix = content.slice(lineStart, first.getStart(source));
  return /^\s*$/.test(prefix) ? prefix : '  ';
}

function findRouteArray(source: ts.SourceFile): ts.ArrayLiteralExpression | null {
  let found: ts.ArrayLiteralExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (
      found === null &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'routeEntries' &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function patchRouteTable(input: RoutePatchInput): RoutePatchResult {
  const source = ts.createSourceFile('routes.tsx', input.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const array = findRouteArray(source);
  if (array === null) {
    throw new RoutePatchError('The route table has no `routeEntries` array; refusing to patch it.');
  }
  if (namedImportsFrom(source, `/${input.componentName}`).has(input.componentName)) {
    throw new RoutePatchError(`The route table already imports ${input.componentName}.`);
  }

  const imports = source.statements.filter(ts.isImportDeclaration);
  const lastImport = imports[imports.length - 1];
  const importLines: string[] = [`import { ${input.componentName} } from '../pages/${input.componentName}';`];
  if (input.requiresAuth && !namedImportsFrom(source, '/AuthProvider').has('RequireAuth')) {
    importLines.push("import { RequireAuth } from './AuthProvider';");
  }

  const element = input.requiresAuth
    ? `<RequireAuth><${input.componentName} /></RequireAuth>`
    : `<${input.componentName} />`;
  const entryLine = `{ path: ${JSON.stringify(input.route)}, title: ${JSON.stringify(
    input.title,
  )}, requiresAuth: ${String(input.requiresAuth)}, element: ${element} }`;

  const indent = indentationFor(input.content, source, array);
  const existingEntries = array.elements.map((elementNode) =>
    input.content.slice(elementNode.getStart(source), elementNode.getEnd()),
  );
  const rebuilt = `[\n${[...existingEntries, entryLine].map((entry) => `${indent}${entry},`).join('\n')}\n]`;

  // The array comes after the imports, so replacing it leaves the import
  // insertion point valid.
  let next = input.content.slice(0, array.getStart(source)) + rebuilt + input.content.slice(array.getEnd());
  const importPosition = lastImport === undefined ? 0 : lastImport.getEnd();
  next = `${next.slice(0, importPosition)}\n${importLines.join('\n')}${next.slice(importPosition)}`;

  // A failed patch must never be written: parse the result and require exactly
  // one more import and one more route entry.
  const check = ts.createSourceFile('routes.tsx', next, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const checkArray = findRouteArray(check);
  if (checkArray === null || checkArray.elements.length !== array.elements.length + 1) {
    throw new RoutePatchError('The patched route table did not gain exactly one entry.');
  }
  if (!next.includes(`import { ${input.componentName} } from '../pages/${input.componentName}';`)) {
    throw new RoutePatchError('The patched route table is missing the page import.');
  }
  return { content: next, importLines, entryLine };
}
