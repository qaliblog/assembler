/**
 * Load the facts a modification plan needs, from the project's own recorded
 * metadata. Nothing is inferred from file names alone: the specification and
 * manifest are required, so an arbitrary directory is never treated as an
 * Assembler-generated project.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '@assembler/core';
import { parseProjectSpec, type ProjectSpec } from '@assembler/project-spec';
import ts from 'typescript';
import type {
  ContextLoadResult,
  ExistingRoute,
  GeneratedProjectContext,
  RecordedFile,
  RecordedManifest,
} from './types.js';

const SPEC_FILE = 'assembler.spec.json';
const MANIFEST_FILE = 'assembler.manifest.json';
const ROUTES_FILE = 'src/app/routes.tsx';

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function stringValue(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Read the `path` and `title` of every entry in the generated route table. */
export function extractRoutes(content: string): ExistingRoute[] {
  const source = ts.createSourceFile('routes.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes: ExistingRoute[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'routeEntries' &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        let route: string | null = null;
        let title: string | null = null;
        for (const property of element.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
          const value = stringValue(property.initializer);
          if (property.name.text === 'path') route = value;
          if (property.name.text === 'title') title = value;
        }
        if (route !== null) routes.push({ path: route, title: title ?? route });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return routes;
}

function isRecordedFile(value: unknown): value is RecordedFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['path'] === 'string' &&
    typeof candidate['sha256'] === 'string' &&
    typeof candidate['owner'] === 'string' &&
    typeof candidate['kind'] === 'string'
  );
}

function parseManifest(raw: string): RecordedManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  const files = candidate['files'];
  if (!Array.isArray(files) || !files.every(isRecordedFile)) return null;
  return {
    schemaVersion: typeof candidate['schemaVersion'] === 'string' ? candidate['schemaVersion'] : '1.0',
    ...(typeof candidate['project'] === 'string' ? { project: candidate['project'] } : {}),
    ...(typeof candidate['specHash'] === 'string' ? { specHash: candidate['specHash'] } : {}),
    files,
  };
}

function webApplication(spec: ProjectSpec) {
  return spec.applications.find((application) => application.kind === 'web' && application.framework === 'react') ?? null;
}

export async function loadGeneratedProject(root: string): Promise<ContextLoadResult> {
  const resolvedRoot = path.resolve(root);
  const specFile = path.join(resolvedRoot, SPEC_FILE);
  const manifestFile = path.join(resolvedRoot, MANIFEST_FILE);
  const specContent = await readOptional(specFile);
  const manifestContent = await readOptional(manifestFile);
  if (specContent === null || manifestContent === null) {
    return {
      ok: false,
      code: 'NOT_GENERATED_PROJECT',
      message: `No ${SPEC_FILE} and ${MANIFEST_FILE} were found in ${resolvedRoot}.`,
    };
  }

  let rawSpec: unknown;
  try {
    rawSpec = JSON.parse(specContent);
  } catch {
    return { ok: false, code: 'PROJECT_INVALID', message: `${SPEC_FILE} is not valid JSON.` };
  }
  const parsed = parseProjectSpec(rawSpec);
  if ('issues' in parsed) {
    return {
      ok: false,
      code: 'PROJECT_INVALID',
      message: `${SPEC_FILE} does not match the specification schema: ${parsed.issues.join('; ')}`,
    };
  }
  const spec = parsed.spec;
  if (webApplication(spec) === null) {
    return {
      ok: false,
      code: 'PROJECT_INVALID',
      message: 'This project was generated from a specification with no React web application.',
    };
  }

  const manifest = parseManifest(manifestContent);
  if (manifest === null) {
    return { ok: false, code: 'PROJECT_INVALID', message: `${MANIFEST_FILE} is not a readable file manifest.` };
  }
  const routesEntry = manifest.files.find((file) => file.path === ROUTES_FILE);
  if (routesEntry === undefined) {
    return {
      ok: false,
      code: 'NOT_GENERATED_PROJECT',
      message: `The manifest does not declare ${ROUTES_FILE}; this is not a generated React application.`,
    };
  }
  const routesContent = await readOptional(path.join(resolvedRoot, ROUTES_FILE));
  if (routesContent === null) {
    return {
      ok: false,
      code: 'PROJECT_INVALID',
      message: `${ROUTES_FILE} is missing from the project directory.`,
    };
  }
  if (sha256(routesContent) !== routesEntry.sha256) {
    return {
      ok: false,
      code: 'MODIFICATION_CONFLICT',
      message: `${ROUTES_FILE} has been edited since it was generated. Refusing to patch a file whose provenance is no longer known.`,
    };
  }

  const templateId =
    typeof routesEntry.provenance['templateId'] === 'string' ? routesEntry.provenance['templateId'] : 'unknown';
  if (templateId !== 'react-web-vite') {
    return {
      ok: false,
      code: 'MODIFICATION_UNSUPPORTED',
      message: `The route table was produced by template "${templateId}", and only react-web-vite projects can be modified.`,
    };
  }

  const authPath = path.join(resolvedRoot, 'src/app/AuthProvider.tsx');
  const authContent = await readOptional(authPath);
  return {
    ok: true,
    context: {
      root: resolvedRoot,
      spec,
      specFile,
      specContent,
      manifest,
      manifestFile,
      manifestContent,
      templateId,
      routesFile: path.join(resolvedRoot, ROUTES_FILE),
      routesContent,
      routesSha256: routesEntry.sha256,
      existingRoutes: extractRoutes(routesContent),
      hasAuth: authContent !== null && authContent.includes('export function RequireAuth'),
      hasMetricCard: manifest.files.some((file) => file.path === 'src/components/MetricCard.tsx'),
    },
  };
}
