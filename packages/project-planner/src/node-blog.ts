/**
 * Node.js publication planner.
 *
 * The target is a server-rendered blog: one process, one route table, typed
 * content and no runtime dependencies. Planning renders the template set,
 * declares every file with provenance, analyses imports and produces the same
 * blueprint shape as the React planner so the assembler stays target-agnostic.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssemblerError, normalizeRelativePath, type Workspace } from '@assembler/core';
import type { EnvironmentScan } from '@assembler/environment-manager';
import { specHash, type ApplicationSpec, type ProjectSpec } from '@assembler/project-spec';
import { readTemplateManifest, renderTemplateSet } from '@assembler/template-engine';
import { withImportAnalysis } from './analysis.js';
import { evaluatePlannedCapabilities } from './capabilities.js';
import { computeDesign } from './design.js';
import { analyzeGraph, buildGraph } from './graph.js';
import type { LoadedKnowledge, VersionTarget } from './knowledge.js';
import { createPlannedFile, validateManifest, type FileManifest, type FileKind, type PlannedFile } from './manifest.js';
import type { Blueprint, CommandPlan, PlanBlocker, PlanResult, RoutePlan, TargetPlan } from './planner.js';
import { ASSEMBLER_VERSION, PLANNER_VERSION } from './version.js';

export const NODE_BLOG_TEMPLATE_ID = 'node-blog';

interface BlogRoute {
  readonly path: string;
  readonly pageId: string;
  readonly title: string;
  readonly component: string;
}

/**
 * The routes the template actually implements. This is a declaration, not a
 * wish: each one is covered by the generated route suite, and the planner fails
 * if the template that should provide it is missing.
 */
export const NODE_BLOG_ROUTES: readonly BlogRoute[] = [
  { path: '/', pageId: 'home', title: 'Home', component: 'HomePage' },
  { path: '/posts', pageId: 'post-archive', title: 'All posts', component: 'PostArchivePage' },
  { path: '/posts/:slug', pageId: 'post-detail', title: 'Article', component: 'PostPage' },
  { path: '/categories', pageId: 'category-index', title: 'Categories', component: 'CategoryIndexPage' },
  { path: '/categories/:category', pageId: 'category-detail', title: 'Category', component: 'CategoryPage' },
  { path: '/tags/:tag', pageId: 'tag-detail', title: 'Tag', component: 'TagPage' },
  { path: '/search', pageId: 'search', title: 'Search', component: 'SearchPage' },
  { path: '/about', pageId: 'about', title: 'About', component: 'AboutPage' },
  { path: '/contact', pageId: 'contact', title: 'Contact', component: 'ContactPage' },
  { path: '/feed.xml', pageId: 'feed', title: 'RSS feed', component: 'Feed' },
  { path: '/api/health', pageId: 'api-health', title: 'Health', component: 'HealthEndpoint' },
  { path: '/api/posts', pageId: 'api-posts', title: 'Posts API', component: 'PostsEndpoint' },
  { path: '/api/posts/:slug', pageId: 'api-post-detail', title: 'Post API', component: 'PostEndpoint' },
];

export interface NodeBlogPlanInput {
  readonly workspace: Workspace;
  readonly spec: ProjectSpec;
  readonly application: ApplicationSpec;
  readonly knowledge: LoadedKnowledge;
  readonly environment?: EnvironmentScan;
  readonly blockers: readonly PlanBlocker[];
  readonly unresolved: readonly string[];
  readonly limitations: readonly string[];
  readonly now?: () => Date;
}

function routeSortKey(route: string): string {
  return route.includes(':') ? `1:${route}` : `0:${route}`;
}

function commandPlan(target: VersionTarget, applicationId: string): CommandPlan[] {
  return (['install', 'typecheck', 'test', 'build'] as const).map((kind) => ({
    kind,
    args: target.commands[kind],
    applicationId,
  }));
}

export async function planNodeBlog(input: NodeBlogPlanInput): Promise<PlanResult> {
  const { workspace, spec, application, knowledge, environment } = input;
  const blockers: PlanBlocker[] = [...input.blockers];
  const limitations: string[] = [...input.limitations];
  const unresolved: string[] = [...input.unresolved];

  const templateDir = path.join(workspace.paths.templatesDir, NODE_BLOG_TEMPLATE_ID);
  let templateManifest;
  try {
    templateManifest = await readTemplateManifest(templateDir);
  } catch (error) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: `Node.js blog template is not available at ${templateDir}`,
      cause: error,
    });
  }

  const target = knowledge.versions.targets['node-blog'];
  if (target === undefined) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: 'knowledge/versions.json does not define the "node-blog" target',
    });
  }

  const computed = computeDesign(spec.design, knowledge.design);
  const tokens = computed.tokens;
  const packageManager = environment?.packageManager?.name ?? null;
  const pm = packageManager ?? 'npm';

  const dependencies = { ...(target.dependencies ?? {}) };
  const devDependencies = { ...(target.devDependencies ?? {}) };
  const declaredDependencies = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)]);

  const siteDescription = `${spec.name} is an independent publication about software craft, interface design and the engineering details that make a product feel considered.`;
  const tagline = 'Essays on software craft, interface design and the engineering details that matter.';
  const contactEmail = `editor@${spec.slug}.example`;

  const packageJson = {
    name: spec.slug,
    private: true,
    version: '0.1.0',
    type: 'module',
    description: siteDescription,
    engines: { node: target.nodeRange ?? '>=18.18.0' },
    scripts: {
      dev: 'node --watch dist/server.js',
      start: 'node dist/server.js',
      typecheck: 'tsc -p tsconfig.json',
      test: 'vitest run',
      build: 'tsc -p tsconfig.build.json',
    },
    dependencies,
    devDependencies,
  };

  const variables: Record<string, string | number> = {
    appTitle: spec.name,
    projectName: spec.slug,
    tagline,
    siteDescription,
    contactEmail,
    theme: tokens.theme,
    styleName: tokens.styleName,
    ...Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, String(value)])),
    installCommand: `${pm} install`,
    typecheckCommand: `${pm} run typecheck`,
    testCommand: `${pm} test`,
    buildCommand: `${pm} run build`,
    startCommand: `${pm} start`,
  };

  const files: PlannedFile[] = [];
  try {
    const rendered = await renderTemplateSet(templateDir, templateManifest, variables);
    for (const file of rendered) {
      files.push(
        createPlannedFile({
          path: normalizeRelativePath(file.target),
          owner: templateManifest.id,
          kind: file.kind,
          action: 'create',
          applicationId: application.id,
          exports: [],
          imports: [],
          externalImports: [],
          verified: true,
          provenance: { templateId: templateManifest.id, templateFile: file.source },
          content: file.content,
        }),
      );
    }
  } catch (error) {
    blockers.push({
      code: 'TEMPLATE_RENDER_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Files the planner owns rather than the template.
  const generated: Array<{ path: string; content: string; kind: FileKind; owner: string }> = [
    {
      path: 'package.json',
      content: `${JSON.stringify(packageJson, null, 2)}\n`,
      kind: 'config',
      owner: 'planner:package-manifest',
    },
    {
      path: '.gitignore',
      content: ['node_modules/', 'dist/', 'coverage/', '*.tsbuildinfo', '.DS_Store', ''].join('\n'),
      kind: 'config',
      owner: 'planner:gitignore',
    },
    {
      path: 'assembler.spec.json',
      content: `${JSON.stringify(spec, null, 2)}\n`,
      kind: 'documentation',
      owner: 'planner:specification',
    },
  ];
  for (const file of generated) {
    files.push(
      createPlannedFile({
        path: file.path,
        owner: file.owner,
        kind: file.kind,
        action: 'create',
        applicationId: application.id,
        exports: [],
        imports: [],
        externalImports: [],
        verified: true,
        provenance: { generator: file.owner },
        content: file.content,
      }),
    );
  }

  const withImports = withImportAnalysis(files, declaredDependencies, blockers);
  const manifest: FileManifest = {
    schemaVersion: '1.0',
    files: withImports.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  const findings = validateManifest(manifest);
  for (const finding of findings) {
    if (finding.severity === 'error') blockers.push({ code: finding.code, message: finding.message });
  }

  const graph = buildGraph(manifest);
  const analysis = analyzeGraph(graph);
  for (const cycle of analysis.cycles) {
    blockers.push({
      code: 'DEPENDENCY_CYCLE',
      message: `Generated files form an import cycle: ${cycle.join(', ')}`,
    });
  }

  const capabilities = evaluatePlannedCapabilities(target.toolchain, environment, blockers, limitations);
  const commands = commandPlan(target, application.id);

  const routes: RoutePlan[] = NODE_BLOG_ROUTES.map((route) => ({
    path: route.path,
    pageId: route.pageId,
    title: route.title,
    requiresAuth: false,
    component: route.component,
    applicationId: application.id,
  })).sort((a, b) => (routeSortKey(a.path) < routeSortKey(b.path) ? -1 : 1));

  const targetPlan: TargetPlan = {
    applicationId: application.id,
    kind: 'web',
    framework: 'node-typescript',
    buildSystem: 'tsc',
    language: 'typescript',
    deployment: 'node-server',
    templateId: templateManifest.id,
    templateVersion: templateManifest.version,
    requiredCapabilities: [...target.toolchain],
  };

  if (spec.applications.some((candidate) => candidate.kind !== 'web')) {
    // The caller already added TARGET_NOT_IMPLEMENTED for the other application;
    // this note keeps the blog plan itself honest about what it covers.
    unresolved.push('The Node.js publication plan covers the web application only.');
  }

  limitations.push(
    'The publication has no accounts, admin panel, database or contact form. Requests for those are reported as unsupported instead of being stubbed.',
    'Articles are typed content in src/content/posts.ts; editing them is a reviewed code change, not a CMS operation.',
    'Every page is rendered on the server. There is no client-side router and no JavaScript bundle to test.',
    'Accessibility is built into the semantic markup and stylesheet, but no automated accessibility audit is generated.',
  );

  const blueprint: Blueprint = {
    schemaVersion: '1.0',
    plannerVersion: PLANNER_VERSION,
    assemblerVersion: ASSEMBLER_VERSION,
    project: {
      name: spec.name,
      slug: spec.slug,
      description: spec.description,
      specHash: specHash(spec),
      specSchemaVersion: spec.schemaVersion,
    },
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    targets: [targetPlan],
    architecture: {
      pattern: 'server-rendered Node.js publication',
      summary:
        'One HTTP process with an explicit route table, controllers, a content service, typed view composition and middleware for security, logging and errors. Every page is a real URL rendered on the server; no client-side router exists.',
      layers: ['router', 'controllers (routes)', 'services', 'views', 'content', 'middleware', 'lib'],
    },
    design: {
      style: spec.design.style,
      theme: tokens.theme,
      preset: tokens.presetName,
      layout: spec.design.layout,
      palette: computed.palette,
      tokens,
      accessibility: spec.design.accessibility,
    },
    files: manifest.files,
    components: [],
    dependencies: [
      {
        applicationId: application.id,
        manifestFile: 'package.json',
        dependencies,
        devDependencies,
        packageManager,
      },
    ],
    routes,
    endpoints: [],
    models: spec.dataModels,
    commands,
    capabilities,
    toolchain: {
      packageManager,
      environmentSignature: environment?.signature ?? null,
    },
    knowledge: {
      versionsHash: knowledge.versionsHash,
      designHash: knowledge.designHash,
      templateId: templateManifest.id,
      templateVersion: templateManifest.version,
    },
    tests: [`${pm} run typecheck`, `${pm} test`, `${pm} run build`],
    blockers,
    unresolved,
    limitations,
  };

  return {
    blueprint,
    manifest,
    findings,
    graph,
    analysis,
    blockers,
    ready: blockers.length === 0,
  };
}
