/**
 * Planner.
 *
 * Turns a validated specification plus the verified component catalogue, template
 * set and knowledge base into a complete blueprint: every file, its owner, its
 * content, its imports, the dependency manifest, the graph, the test plan and the
 * blockers that prevent assembly. Planning performs no project writes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AssemblerError,
  contentHash,
  normalizeRelativePath,
  sha256,
  toSafeName,
  type Workspace,
} from '@assembler/core';
import {
  findComponent,
  loadCatalog,
  type ComponentManifest,
  type ComponentRecord,
} from '@assembler/component-registry';
import type { EnvironmentScan } from '@assembler/environment-manager';
import {
  describeApplication,
  specHash,
  validateProjectSpec,
  type ApplicationSpec,
  type DataModelSpec,
  type PageSpec,
  type ProjectSpec,
} from '@assembler/project-spec';
import { renderTemplate, readTemplateManifest, renderTemplateSet, type TemplateManifest } from '@assembler/template-engine';
import { computeDesign, type DesignTokens } from './design.js';
import { analyzeGraph, buildGraph, type DependencyGraph, type GraphAnalysis } from './graph.js';
import { withImportAnalysis } from './analysis.js';
import { evaluatePlannedCapabilities } from './capabilities.js';
import { planNodeBlog } from './node-blog.js';
import { ASSEMBLER_VERSION, PLANNER_VERSION } from './version.js';
import { loadKnowledge, type VersionTarget } from './knowledge.js';
import {
  createPlannedFile,
  validateManifest,
  type FileManifest,
  type ManifestFinding,
  type PlannedFile,
  type FileKind,
} from './manifest.js';

export { ASSEMBLER_VERSION, PLANNER_VERSION };

export interface PlanBlocker {
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
}

export interface TargetPlan {
  readonly applicationId: string;
  readonly kind: ApplicationSpec['kind'];
  readonly framework: string;
  readonly buildSystem: string;
  readonly language: string;
  readonly deployment: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly requiredCapabilities: readonly string[];
}

export interface ComponentUsage {
  readonly name: string;
  readonly version: string;
  readonly sourceHash: string;
  readonly files: readonly string[];
  readonly usedBy: readonly string[];
}

export interface ApplicationDependencies {
  readonly applicationId: string;
  readonly manifestFile: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly packageManager: string | null;
}

export interface RoutePlan {
  readonly path: string;
  readonly pageId: string;
  readonly title: string;
  readonly requiresAuth: boolean;
  readonly component: string;
  readonly applicationId: string;
}

export interface CommandPlan {
  readonly kind: 'install' | 'typecheck' | 'test' | 'build';
  readonly args: readonly string[];
  readonly applicationId: string;
}

export interface CapabilityRequirement {
  readonly capability: string;
  readonly status: 'satisfied' | 'unsatisfied' | 'unknown' | 'not-checked';
  readonly reason: string;
}

export interface Blueprint {
  readonly schemaVersion: '1.0';
  readonly plannerVersion: string;
  readonly assemblerVersion: string;
  readonly project: {
    readonly name: string;
    readonly slug: string;
    readonly description: string;
    readonly specHash: string;
    readonly specSchemaVersion: string;
  };
  readonly generatedAt: string;
  readonly targets: readonly TargetPlan[];
  readonly architecture: {
    readonly pattern: string;
    readonly summary: string;
    readonly layers: readonly string[];
  };
  readonly design: {
    readonly style: string;
    readonly theme: string;
    readonly preset: string;
    readonly layout: string;
    readonly palette: readonly string[];
    readonly tokens: DesignTokens;
    readonly accessibility: ProjectSpec['design']['accessibility'];
  };
  readonly files: readonly PlannedFile[];
  readonly components: readonly ComponentUsage[];
  readonly dependencies: readonly ApplicationDependencies[];
  readonly routes: readonly RoutePlan[];
  readonly endpoints: ProjectSpec['applications'][number]['apiEndpoints'];
  readonly models: readonly DataModelSpec[];
  readonly commands: readonly CommandPlan[];
  readonly capabilities: readonly CapabilityRequirement[];
  readonly toolchain: { readonly packageManager: string | null; readonly environmentSignature: string | null };
  readonly knowledge: {
    readonly versionsHash: string;
    readonly designHash: string;
    readonly templateId: string;
    readonly templateVersion: string;
  };
  readonly tests: readonly string[];
  readonly blockers: readonly PlanBlocker[];
  readonly unresolved: readonly string[];
  readonly limitations: readonly string[];
}

export interface PlanResult {
  readonly blueprint: Blueprint;
  readonly manifest: FileManifest;
  readonly findings: readonly ManifestFinding[];
  readonly graph: DependencyGraph;
  readonly analysis: GraphAnalysis;
  readonly blockers: readonly PlanBlocker[];
  readonly ready: boolean;
}

export interface PlanInput {
  readonly workspace: Workspace;
  readonly spec: ProjectSpec;
  readonly environment?: EnvironmentScan;
  readonly catalog?: readonly ComponentRecord[];
  readonly now?: () => Date;
}

const PAGE_TEMPLATES: Readonly<Record<PageSpec['archetype'], { template: string; description: string }>> = {
  landing: { template: 'pages/landing.tsx.tmpl', description: 'Entry point of the application.' },
  login: { template: 'pages/login.tsx.tmpl', description: 'Sign in with an existing account.' },
  register: { template: 'pages/register.tsx.tmpl', description: 'Create a new account.' },
  dashboard: { template: 'pages/dashboard.tsx.tmpl', description: 'Overview of the workspace and its key figures.' },
  settings: { template: 'pages/settings.tsx.tmpl', description: 'Preferences stored for this browser.' },
  profile: { template: 'pages/profile.tsx.tmpl', description: 'Details of the signed-in account.' },
  list: { template: 'pages/list.tsx.tmpl', description: 'Records loaded from the API.' },
  detail: { template: 'pages/detail.tsx.tmpl', description: 'A single record with its fields.' },
  generic: { template: 'pages/generic.tsx.tmpl', description: 'A generated page awaiting business requirements.' },
};

const DEFAULT_ROUTES: Readonly<Record<PageSpec['archetype'], string>> = {
  landing: '/',
  login: '/login',
  register: '/register',
  dashboard: '/dashboard',
  settings: '/settings',
  profile: '/profile',
  list: '/records',
  detail: '/records/:id',
  generic: '/page',
};

function pascalCase(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word !== '');
  const name = words.map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase()).join('');
  return name === '' ? 'Page' : name;
}

function uniqueName(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function routeSortKey(route: string): string {
  return route.includes(':') ? `1:${route}` : `0:${route}`;
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (trimmed === '' || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

interface PagePlan {
  readonly page: PageSpec;
  readonly component: string;
  readonly file: string;
  readonly route: string;
}

function planPages(application: ApplicationSpec): PagePlan[] {
  const used = new Set<string>();
  return application.pages.map((page) => {
    const component = uniqueName(`${pascalCase(page.name)}Page`, used);
    // A `generic` page keeps its own name; known archetypes use their default route.
    const route =
      page.route === undefined
        ? page.archetype === 'generic'
          ? normalizeRoute(`/${page.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
          : DEFAULT_ROUTES[page.archetype]
        : normalizeRoute(page.route);
    return { page, component, file: `src/pages/${component}.tsx`, route };
  });
}

function commandFor(target: VersionTarget, kind: CommandPlan['kind']): readonly string[] {
  return target.commands[kind];
}

function escapeForJsx(value: string): string {
  return value.replace(/'/g, "\\'");
}

export async function planProject(input: PlanInput): Promise<PlanResult> {
  const { workspace, spec } = input;
  const knowledge = await loadKnowledge(workspace.paths.knowledgeDir);
  const validation = validateProjectSpec(spec);
  const blockers: PlanBlocker[] = [];
  const unresolved: string[] = [];
  const limitations: string[] = [];

  for (const error of validation.errors) {
    blockers.push({ code: error.code, message: error.message, hint: `Fix field ${error.field}.` });
  }
  for (const entry of validation.unsupported) {
    blockers.push({
      code: 'UNSUPPORTED_CAPABILITY',
      message: `${entry.description}: ${entry.reason}`,
      ...(entry.alternative === undefined ? {} : { hint: entry.alternative }),
    });
  }
  for (const question of spec.clarifications.filter((entry) => entry.severity === 'blocking')) {
    blockers.push({
      code: 'NEEDS_CLARIFICATION',
      message: question.question,
      hint: 'Update the specification to resolve this before planning.',
    });
  }

  /* --------------------------------------------------------------- targets */
  const targets: TargetPlan[] = [];
  const webApplication = spec.applications.find((application) => application.kind === 'web');
  const unsupportedApplications = spec.applications.filter((application) => application.kind !== 'web');
  for (const application of unsupportedApplications) {
    blockers.push({
      code: 'TARGET_NOT_IMPLEMENTED',
      message: `${application.kind} application "${application.id}" was requested, but only React web assembly is implemented in this milestone.`,
      hint: 'Assemble the web application now and add the other target once its template and verification tests exist.',
    });
    unresolved.push(
      `Target ${application.id} (${application.kind}/${application.framework}) is required by the specification but has no implemented assembler.`,
    );
  }
  if (webApplication === undefined) {
    blockers.push({
      code: 'NO_SUPPORTED_TARGET',
      message: 'The specification contains no supported web application to assemble.',
    });
  }

  // Target selection is by the specification's framework, never by guessing from
  // the request text twice. The Node.js publication has its own planner.
  if (webApplication !== undefined && webApplication.framework === 'node-typescript') {
    return planNodeBlog({
      workspace,
      spec,
      application: webApplication,
      knowledge,
      ...(input.environment === undefined ? {} : { environment: input.environment }),
      blockers,
      unresolved,
      limitations,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  }

  /* ---------------------------------------------------------------- design */
  const computed = computeDesign(spec.design, knowledge.design);
  const tokens = computed.tokens;
  const layoutMode = spec.design.layout === 'dashboard' ? 'sidebar' : 'topbar';

  /* -------------------------------------------------------------- template */
  const templateDir = path.join(workspace.paths.templatesDir, 'react-web');
  let templateManifest: TemplateManifest;
  try {
    templateManifest = await readTemplateManifest(templateDir);
  } catch (error) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: `React web template is not available at ${templateDir}`,
      cause: error,
    });
  }
  const target = knowledge.versions.targets['web'];
  if (target === undefined) {
    throw new AssemblerError({
      code: 'PLAN_INVALID',
      message: 'knowledge/versions.json does not define the "web" target',
    });
  }
  targets.push({
    applicationId: webApplication?.id ?? 'web',
    kind: 'web',
    framework: 'react',
    buildSystem: 'vite',
    language: 'typescript',
    deployment: 'static',
    templateId: templateManifest.id,
    templateVersion: templateManifest.version,
    requiredCapabilities: [...target.toolchain],
  });

  /* ----------------------------------------------------------------- pages */
  const pages = webApplication === undefined ? [] : planPages(webApplication);
  const routes: RoutePlan[] = pages
    .map((entry) => ({
      path: entry.route,
      pageId: entry.page.id,
      title: entry.page.title,
      requiresAuth: entry.page.requiresAuth,
      component: entry.component,
      applicationId: webApplication?.id ?? 'web',
    }))
    .sort((a, b) => (routeSortKey(a.path) < routeSortKey(b.path) ? -1 : 1));

  const needsAuthGuard = routes.some((route) => route.requiresAuth);
  const routeImports = [
    ...pages.sort((a, b) => (a.component < b.component ? -1 : 1)).map(
      (entry) => `import { ${entry.component} } from '../pages/${entry.component}';`,
    ),
    ...(needsAuthGuard ? ["import { RequireAuth } from './AuthProvider';"] : []),
  ].join('\n');

  const routeEntries = routes
    .map((route) => {
      const element = route.requiresAuth
        ? `<RequireAuth><${route.component} /></RequireAuth>`
        : `<${route.component} />`;
      return `  { path: ${JSON.stringify(route.path)}, title: ${JSON.stringify(route.title)}, requiresAuth: ${String(
        route.requiresAuth,
      )}, element: ${element} },`;
    })
    .join('\n');

  const pageImports = pages
    .map((entry) => `import { ${entry.component} } from './${entry.component}';`)
    .join('\n');
  const pageTestCases = routes
    .map(
      (route) =>
        `  it('renders the ${escapeForJsx(route.title)} page', () => {\n    renderPage(<${route.component} />);\n    expect(screen.getByRole('heading', { name: ${JSON.stringify(
          route.title,
        )} })).toBeInTheDocument();\n  });`,
    )
    .join('\n\n');

  const postLoginPath = routes.find((route) => !['/login', '/register'].includes(route.path))?.path ?? '/';

  /* ------------------------------------------------------------ components */
  const catalog = input.catalog ?? (await loadCatalog(workspace.paths.librariesDir));
  const dashboardPage = pages.some((entry) => entry.page.archetype === 'dashboard');
  const componentUsage: ComponentUsage[] = [];
  const componentFiles: Array<{ component: ComponentRecord; manifest: ComponentManifest; source: string; target: string; mode: 'render' | 'copy'; kind: FileKind; content: string }> = [];

  if (dashboardPage) {
    const metricCard = findComponent(catalog, 'metric-card');
    if (metricCard === undefined) {
      blockers.push({
        code: 'COMPONENT_MISSING',
        message: 'The dashboard page requires the verified "metric-card" component, which is not in the library.',
        hint: 'Restore libraries/web/metric-card or remove the dashboard page.',
      });
    } else {
      const files: string[] = [];
      for (const file of metricCard.manifest.files) {
        const content = await fs.readFile(path.join(metricCard.directory, file.source), 'utf8');
        const rendered = file.mode === 'render' ? renderTemplate(content, {}) : content;
        componentFiles.push({
          component: metricCard,
          manifest: metricCard.manifest,
          source: file.source,
          target: file.target,
          mode: file.mode,
          kind: file.kind,
          content: rendered,
        });
        files.push(file.target);
      }
      const tests = await fs.readdir(metricCard.directory).catch(() => []);
      void tests;
      // Component tests are declared separately from the files they ship.
      for (const test of metricCard.manifest.tests) {
        if (files.includes(test.target)) continue;
        const content = await fs.readFile(path.join(metricCard.directory, test.source), 'utf8');
        componentFiles.push({
          component: metricCard,
          manifest: metricCard.manifest,
          source: test.source,
          target: test.target,
          mode: 'copy',
          kind: 'test',
          content,
        });
        files.push(test.target);
      }
      componentUsage.push({
        name: metricCard.manifest.name,
        version: metricCard.manifest.version,
        sourceHash: metricCard.sourceHash,
        files,
        usedBy: ['dashboard'],
      });
    }
  }

  /* ---------------------------------------------------------- dependencies */
  const dependencies: Record<string, string> = { ...(target.dependencies ?? {}) };
  const devDependencies: Record<string, string> = { ...(target.devDependencies ?? {}) };
  for (const usage of componentUsage) {
    const record = findComponent(catalog, usage.name);
    for (const dependency of record?.manifest.dependencies ?? []) {
      if (!/^\d+\.\d+\.\d+$/.test(dependency.range)) {
        limitations.push(
          `Component ${usage.name} declares a non-pinned dependency ${dependency.name}@${dependency.range}; the planner keeps it as-is and the lockfile records the resolved version.`,
        );
      }
      dependencies[dependency.name] = dependency.range;
    }
  }
  const declaredDependencies = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)]);

  const packageManager =
    input.environment?.packageManager?.name ?? null;
  const packageJson = {
    name: spec.slug,
    private: true,
    version: '0.1.0',
    type: 'module',
    description: spec.description === '' ? `${spec.name} — generated by Assembler` : spec.description,
    scripts: {
      dev: 'vite',
      build: 'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit && vite build',
      typecheck: 'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit',
      test: 'vitest run',
      preview: 'vite preview',
    },
    dependencies,
    devDependencies,
  };

  /* ---------------------------------------------------------------- render */
  const baseVariables: Record<string, string | number> = {
    appTitle: spec.name,
    projectName: spec.slug,
    theme: tokens.theme,
    layout: spec.design.layout,
    layoutMode,
    apiBaseUrl: '/api',
    styleName: tokens.styleName,
    kind: webApplication?.kind ?? 'web',
    ...Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, String(value)])),
    routeImports,
    routeEntries: routeEntries,
    packageManager: packageManager ?? 'npm',
    installCommand: `${packageManager ?? 'npm'} install`,
    typecheckCommand: `${packageManager ?? 'npm'} run typecheck`,
    testCommand: `${packageManager ?? 'npm'} run test`,
    buildCommand: `${packageManager ?? 'npm'} run build`,
  };

  // Page files are rendered per-page (and only for pages that were requested).
  const baseManifest: TemplateManifest = {
    ...templateManifest,
    files: templateManifest.files.filter(
      (file) => !file.source.startsWith('pages/') && !file.target.startsWith('src/pages/'),
    ),
  };

  const files: PlannedFile[] = [];
  try {
    const rendered = await renderTemplateSet(templateDir, baseManifest, baseVariables);
    for (const file of rendered) {
      files.push(
        createPlannedFile({
          path: normalizeRelativePath(file.target),
          owner: templateManifest.id,
          kind: file.kind,
          action: 'create',
          applicationId: webApplication?.id ?? 'web',
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

  // Page files come from per-archetype templates with page-specific variables.
  for (const entry of pages) {
    const template = PAGE_TEMPLATES[entry.page.archetype];
    const sourcePath = path.join(templateDir, template.template);
    let content: string;
    try {
      content = await fs.readFile(sourcePath, 'utf8');
    } catch (error) {
      blockers.push({
        code: 'PAGE_TEMPLATE_MISSING',
        message: `Page template for "${entry.page.archetype}" is missing: ${template.template}`,
      });
      void error;
      continue;
    }
    const runnames: Record<string, string | number> = {
      ...baseVariables,
      componentName: entry.component,
      pageTitle: entry.page.title,
      pageDescription: template.description,
      postLoginPath,
      listEndpointLiteral: 'null',
      detailEndpointLiteral: 'null',
    };
    try {
      files.push(
        createPlannedFile({
          path: entry.file,
          owner: `page-${entry.page.id}`,
          kind: 'source',
          action: 'create',
          applicationId: webApplication?.id ?? 'web',
          exports: [entry.component],
          imports: [],
          externalImports: [],
          verified: true,
          provenance: { templateId: templateManifest.id, templateFile: template.template },
          content: renderTemplate(content, runnames),
        }),
      );
    } catch (error) {
      blockers.push({
        code: 'PAGE_RENDER_FAILED',
        message: `Cannot render page "${entry.page.title}": ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // A single generated test file covers every page smoke test.
  const pageTestTemplate = path.join(templateDir, 'pages/page.test.tsx.tmpl');
  try {
    const content = await fs.readFile(pageTestTemplate, 'utf8');
    files.push(
      createPlannedFile({
        path: 'src/pages/Page.test.tsx',
        owner: 'page-tests',
        kind: 'test',
        action: 'create',
        applicationId: webApplication?.id ?? 'web',
        exports: [],
        imports: [],
        externalImports: [],
        verified: true,
        provenance: { templateId: templateManifest.id, templateFile: 'pages/page.test.tsx.tmpl' },
        content: renderTemplate(content, { ...baseVariables, pageImports, pageTestCases }),
      }),
    );
  } catch (error) {
    blockers.push({
      code: 'PAGE_TEST_RENDER_FAILED',
      message: `Cannot render the page test file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  for (const componentFile of componentFiles) {
    files.push(
      createPlannedFile({
        path: normalizeRelativePath(componentFile.target),
        owner: componentFile.manifest.name,
        kind: componentFile.kind,
        action: 'create',
        applicationId: webApplication?.id ?? 'web',
        exports: componentFile.manifest.exports.map((entry) => entry.name),
        imports: [],
        externalImports: [],
        verified: true,
        provenance: {
          component: componentFile.manifest.name,
          componentVersion: componentFile.manifest.version,
          componentHash: componentFile.component.sourceHash,
          templateFile: componentFile.source,
        },
        content: componentFile.content,
      }),
    );
  }

  // Files the planner owns directly, rather than a template.
  const generated: Array<{ path: string; content: string; kind: FileKind; owner: string; exports?: string[] }> = [
    { path: 'package.json', content: `${JSON.stringify(packageJson, null, 2)}\n`, kind: 'config', owner: 'planner:package-manifest' },
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
        applicationId: webApplication?.id ?? 'web',
        exports: file.exports ?? [],
        imports: [],
        externalImports: [],
        verified: true,
        provenance: { generator: file.owner },
        content: file.content,
      }),
    );
  }

  /* ------------------------------------------------------- import analysis */
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

  /* --------------------------------------------------------- capabilities */
  const capabilities = evaluatePlannedCapabilities(
    target.toolchain,
    input.environment,
    blockers,
    limitations,
  );

  const commands: CommandPlan[] = (['install', 'typecheck', 'test', 'build'] as const).map((kind) => ({
    kind,
    args: commandFor(target, kind),
    applicationId: webApplication?.id ?? 'web',
  }));

  limitations.push(
    'Backend, mobile and API-contract assembly are not implemented in this milestone; requests for them are reported as blockers instead of being approximated.',
  );
  if (webApplication !== undefined && webApplication.pages.some((page) => page.archetype === 'list' || page.archetype === 'detail')) {
    limitations.push(
      'List and detail pages render empty/error states because no backend is generated to provide their endpoints.',
    );
  }

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
    targets,
    architecture: {
      pattern: 'component-oriented React application',
      summary:
        'Pages composed from verified components, an explicit route table, an authentication context and a typed API client. Platform-independent logic lives in src/lib; UI never talks to persistence directly.',
      layers: ['pages', 'components', 'hooks', 'lib (api, validation)', 'styles (design tokens)'],
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
    components: componentUsage,
    dependencies: [
      {
        applicationId: webApplication?.id ?? 'web',
        manifestFile: 'package.json',
        dependencies,
        devDependencies,
        packageManager,
      },
    ],
    routes,
    endpoints: webApplication?.apiEndpoints ?? [],
    models: spec.dataModels,
    commands,
    capabilities,
    toolchain: {
      packageManager,
      environmentSignature: input.environment?.signature ?? null,
    },
    knowledge: {
      versionsHash: knowledge.versionsHash,
      designHash: knowledge.designHash,
      templateId: templateManifest.id,
      templateVersion: templateManifest.version,
    },
    tests: [
      `${packageManager ?? 'npm'} run typecheck`,
      `${packageManager ?? 'npm'} run test`,
      `${packageManager ?? 'npm'} run build`,
    ],
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

/** Stable hash of everything that determines generated content. */
export function blueprintFingerprint(blueprint: Blueprint): string {
  return contentHash({
    spec: blueprint.project.specHash,
    knowledge: blueprint.knowledge,
    targets: blueprint.targets,
    files: blueprint.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    components: blueprint.components,
    dependencies: blueprint.dependencies,
    design: blueprint.design.tokens,
  });
}

export function describePlan(blueprint: Blueprint): string[] {
  const lines: string[] = [];
  lines.push(`Project: ${blueprint.project.name} (${blueprint.project.slug})`);
  for (const target of blueprint.targets) {
    lines.push(`Target: ${target.kind} — ${target.framework} (${target.templateId}@${target.templateVersion})`);
  }
  lines.push(
    `Design: ${blueprint.design.style} / ${blueprint.design.theme} / ${blueprint.design.preset} / ${blueprint.design.layout}`,
  );
  lines.push(`Files: ${blueprint.files.length}`);
  if (blueprint.components.length > 0) {
    lines.push(
      `Components: ${blueprint.components.map((component) => `${component.name}@${component.version}`).join(', ')}`,
    );
  }
  if (blueprint.routes.length > 0) {
    lines.push(`Routes: ${blueprint.routes.map((route) => route.path).join(', ')}`);
  }
  if (blueprint.blockers.length > 0) {
    lines.push('Blockers:');
    for (const blocker of blueprint.blockers) lines.push(`  - [${blocker.code}] ${blocker.message}`);
  }
  if (blueprint.limitations.length > 0) {
    lines.push('Limitations:');
    for (const limitation of blueprint.limitations) lines.push(`  - ${limitation}`);
  }
  return lines;
}

export { sha256, toSafeName };
