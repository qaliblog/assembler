/**
 * Interpretation: facts -> validated ProjectSpec.
 *
 * Rules:
 *  - an explicit requirement is never downgraded to an assumption;
 *  - a missing non-critical value becomes a documented default;
 *  - a value the engine infers from other requirements becomes `derived`;
 *  - a missing architecture-critical value becomes a blocking clarification;
 *  - a request that no verified component can satisfy becomes `unsupported`.
 */
import { sha256, toSafeName } from '@assembler/core';
import {
  SPEC_SCHEMA_VERSION,
  parseProjectSpec,
  validateProjectSpec,
  type ApiEndpointSpec,
  type ApplicationSpec,
  type Clarification,
  type Contradiction,
  type DataModelSpec,
  type PageSpec,
  type ProjectSpec,
  type RequirementLedgerEntry,
  type UnsupportedCapability,
} from '@assembler/project-spec';
import { extractFacts, factsFor, type AppKind, type ExtractionResult, type ExtractedFact } from './extract.js';
import { classifyIntent, type IntentClassification } from './intent.js';

export const INTERPRETER_VERSION = '0.1.0';

export interface InterpretationOutcome {
  readonly status: 'ready' | 'needs-clarification' | 'unsupported';
  readonly spec: ProjectSpec | null;
  readonly clarifications: readonly Clarification[];
  readonly contradictions: readonly Contradiction[];
  readonly unsupported: readonly UnsupportedCapability[];
  readonly ledger: readonly RequirementLedgerEntry[];
  readonly notes: readonly string[];
  readonly extraction: ExtractionResult;
  /** What kind of work the request asks for; advisory, with evidence. */
  readonly intents: IntentClassification;
}

const DEFAULT_PALETTES: Readonly<Record<string, readonly string[]>> = {
  editorial: ['#0d0f14', '#e2b457', '#f3d08a'],
  glassmorphism: ['#0b1120', '#6366f1', '#38bdf8'],
  neumorphism: ['#e0e5ec', '#a3b1c6'],
  minimal: ['#ffffff', '#111827'],
  material: ['#6200ee', '#03dac6'],
  default: ['#0f172a', '#3b82f6'],
};

const RESERVED_MODEL_ENDPOINTS: ReadonlyArray<{ method: ApiEndpointSpec['method']; suffix: string; operation: string }> = [
  { method: 'GET', suffix: '', operation: 'list' },
  { method: 'POST', suffix: '', operation: 'create' },
  { method: 'GET', suffix: '/{item_id}', operation: 'get' },
];

function pluralize(word: string): string {
  if (word.endsWith('s')) return word;
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

/** Routes that the server-rendered publication actually serves. */
const NODE_BLOG_PAGE_ROUTES: Readonly<Record<string, string>> = {
  landing: '/',
  list: '/posts',
  detail: '/posts/:slug',
};

function routeFor(archetype: string, name: string): string {
  switch (archetype) {
    case 'landing':
      return '/';
    case 'login':
      return '/login';
    case 'register':
      return '/register';
    case 'dashboard':
      return '/dashboard';
    case 'settings':
      return '/settings';
    case 'profile':
      return '/profile';
    case 'list':
      return '/records';
    case 'detail':
      return '/records/:id';
    default:
      return `/${kebab(name)}`;
  }
}

class LedgerBuilder {
  private readonly entries: RequirementLedgerEntry[] = [];

  requested(fact: ExtractedFact, applicationId: string | null): void {
    this.entries.push({
      id: `req-${this.entries.length + 1}-${fact.ruleId}`,
      category: fact.category,
      value: fact.value,
      status: 'requested',
      ...(applicationId === null ? {} : { applicationId }),
      evidence: fact.evidence,
      rule: fact.ruleId,
      confidence: 'certain',
    });
  }

  add(
    category: RequirementLedgerEntry['category'],
    value: string,
    status: RequirementLedgerEntry['status'],
    rule: string,
    options: { applicationId?: string; evidence?: string; notes?: string } = {},
  ): void {
    this.entries.push({
      id: `req-${this.entries.length + 1}-${rule}`,
      category,
      value,
      status,
      ...(options.applicationId === undefined ? {} : { applicationId: options.applicationId }),
      evidence: options.evidence ?? '',
      rule,
      confidence: status === 'assumption' ? 'likely' : 'certain',
      ...(options.notes === undefined ? {} : { notes: options.notes }),
    });
  }

  all(): RequirementLedgerEntry[] {
    return [...this.entries];
  }
}

function applicationIdFor(kind: AppKind): string {
  return kind === 'backend' ? 'api' : kind;
}

function buildPages(
  facts: readonly ExtractedFact[],
  extraction: ExtractionResult,
  kind: AppKind,
  appId: string,
  ledger: LedgerBuilder,
  attachGenericPages: boolean,
): PageSpec[] {
  const pages: PageSpec[] = [];
  const seenArch = new Set<string>();

  for (const fact of facts) {
    if (fact.category !== 'page') continue;
    const archetype = fact.payload['archetype'] ?? 'generic';
    if (seenArch.has(archetype)) continue;
    seenArch.add(archetype);
    const title = fact.payload['title'] ?? 'Page';
    pages.push({
      id: kebab(title) || archetype,
      name: title,
      ...(kind === 'web' ? { route: routeFor(archetype, title) } : {}),
      archetype: archetype as PageSpec['archetype'],
      title,
      requiresAuth: archetype === 'dashboard' || archetype === 'settings' || archetype === 'profile',
    });
    ledger.requested(fact, appId);
  }

  for (const generic of attachGenericPages ? extraction.genericPages : []) {
    const id = kebab(generic.name);
    if (id === '' || pages.some((page) => page.id === id)) continue;
    pages.push({
      id,
      name: generic.name,
      ...(kind === 'web' ? { route: `/${id}` } : {}),
      archetype: 'generic',
      title: generic.name,
      requiresAuth: false,
    });
    ledger.add('page', generic.name, 'requested', 'page.generic', {
      applicationId: appId,
      evidence: generic.evidence,
    });
  }

  if (pages.length === 0) {
    pages.push({
      id: 'home',
      name: kind === 'mobile' ? 'Home' : 'Home',
      ...(kind === 'web' ? { route: '/' } : {}),
      archetype: 'landing',
      title: 'Home',
      requiresAuth: false,
    });
    ledger.add('page', 'home', 'default', 'page.default-home', {
      applicationId: appId,
      notes: 'No pages were requested; a single landing screen is generated.',
    });
  }
  return pages;
}

function buildEndpoints(
  models: readonly DataModelSpec[],
  appId: string,
  authRequired: boolean,
  ledger: LedgerBuilder,
): ApiEndpointSpec[] {
  const endpoints: ApiEndpointSpec[] = [
    {
      id: 'health',
      applicationId: appId,
      method: 'GET',
      path: '/api/health',
      operation: 'health',
      requiresAuth: false,
      consumedBy: [],
    },
  ];
  ledger.add('api.endpoint', 'GET /api/health', 'derived', 'endpoint.health', {
    applicationId: appId,
    notes: 'Every backend exposes a health endpoint so the build can be smoke-tested.',
  });

  for (const model of models) {
    const resource = kebab(pluralize(model.name));
    for (const reserved of RESERVED_MODEL_ENDPOINTS) {
      const path = `/api/${resource}${reserved.suffix}`;
      if (endpoints.some((endpoint) => endpoint.method === reserved.method && endpoint.path === path)) continue;
      endpoints.push({
        id: `${reserved.operation}-${resource}`,
        applicationId: appId,
        method: reserved.method,
        path,
        operation: `${reserved.operation}${model.name}`,
        ...(reserved.operation === 'create' ? { requestModel: model.name } : {}),
        ...(reserved.method === 'GET' ? { responseModel: model.name } : {}),
        requiresAuth: authRequired,
        consumedBy: [],
      });
      ledger.add('api.endpoint', `${reserved.method} ${path}`, 'derived', 'endpoint.crud', {
        applicationId: appId,
        notes: `Derived from the ${model.name} data model.`,
      });
    }
  }
  return endpoints;
}

function buildModels(
  extraction: ExtractionResult,
  appId: string,
  ledger: LedgerBuilder,
): DataModelSpec[] {
  return extraction.dataModels.map((request, index) => {
    const name = request.name.replace(/[^A-Za-z0-9]/g, '');
    const model: DataModelSpec = {
      id: `model-${index + 1}-${kebab(name)}`,
      name,
      applicationId: appId,
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'created_at', type: 'datetime', required: true },
      ],
      table: pluralize(kebab(name)).replace(/-/g, '_'),
    };
    ledger.add('data-model', name, 'requested', 'data-model.explicit', { evidence: request.evidence, applicationId: appId });
    ledger.add('data-model', `${name}.fields`, 'derived', 'data-model.default-fields', {
      applicationId: appId,
      notes: 'No fields were specified, so id/name/created_at are used and can be edited in the generated schema.',
    });
    return model;
  });
}

export function interpretRequirement(
  text: string,
  options: { source?: 'user-request' | 'fixture' | 'test'; interpretedAt?: string } = {},
): InterpretationOutcome {
  const extraction = extractFacts(text);
  const ledger = new LedgerBuilder();
  const notes: string[] = [];
  const clarifications: Clarification[] = [];
  const contradictions: Contradiction[] = [];

  const kinds: AppKind[] = ['web', 'mobile', 'backend'];
  const requestedKinds = new Set<AppKind>();
  for (const mention of extraction.appMentions) requestedKinds.add(mention.kind);
  for (const kind of kinds) {
    const facts = factsFor(extraction, kind);
    if (facts.length > 0) requestedKinds.add(kind);
  }

  if (requestedKinds.size === 0) {
    if (extraction.genericPages.length > 0) {
      requestedKinds.add('web');
      notes.push('No application kind was stated; pages imply a web application (assumption).');
    } else {
      clarifications.push({
        id: 'clarify-project-kind',
        question:
          'Which application should be assembled: a React web app, a React Native Android app, or a separate backend?',
        field: 'applications',
        severity: 'blocking',
        options: ['React web application', 'React Native Android application', 'Separate backend'],
        context: 'No recognisable project kind, framework or page was found in the request.',
      });
      return {
        status: 'needs-clarification',
        spec: null,
        clarifications,
        contradictions,
        unsupported: [...extraction.unsupported],
        ledger: ledger.all(),
        notes,
        extraction,
        intents: classifyIntent(text),
      };
    }
  }

  /* ------------------------------------------------------ applications */
  const applications: ApplicationSpec[] = [];
  // Set while the web application is built; the design default below uses it.
  let serverRenderedWeb = false;
  // Generic page mentions ("an orders page") attach to the first UI target.
  const firstUiKind: AppKind | null = requestedKinds.has('web')
    ? 'web'
    : requestedKinds.has('mobile')
      ? 'mobile'
      : null;

  if (requestedKinds.has('web')) {
    const webFacts = factsFor(extraction, 'web');
    const frameworkFacts = webFacts.filter((fact) => fact.category === 'framework');
    const appId = applicationIdFor('web');

    // "Create a professional blog using Node.js" can be split by the clause
    // segmenter, so the language and the publication type are also combined here.
    const nodeWebFact = webFacts.find(
      (fact) => fact.category === 'framework' && fact.value === 'node-typescript',
    );
    const nodeBlogInferred =
      nodeWebFact === undefined &&
      requestedKinds.size === 1 &&
      requestedKinds.has('web') &&
      /\bnode(?:\.js|js)?\b|\bexpress\b/i.test(text) &&
      /\b(blog|weblog|publication|magazine|journal)\b/i.test(text) &&
      !/\breact\b/i.test(text) &&
      !webFacts.some((fact) => fact.category === 'framework' && fact.value === 'unsupported-web-framework');
    const serverBlog = nodeWebFact !== undefined || nodeBlogInferred;
    serverRenderedWeb = serverBlog;
    const framework = serverBlog ? 'node-typescript' : 'react';
    const buildSystem = serverBlog ? 'tsc' : 'vite';

    for (const fact of webFacts) {
      if (fact.category === 'framework' || fact.category === 'project.kind') ledger.requested(fact, appId);
    }
    const declaredFrameworks = [
      ...new Set(
        frameworkFacts
          .filter((fact) => fact.value !== 'node-typescript')
          .map((fact) => fact.value),
      ),
    ];
    if (declaredFrameworks.length > 0) {
      notes.push(
        `The request names ${declaredFrameworks.join(', ')}; only React (Vite) and server-rendered Node.js web targets are verified, so the plan reports the gap.`,
      );
    }

    const requestedPages = buildPages(webFacts, extraction, 'web', appId, ledger, firstUiKind === 'web');
    const pages = serverBlog
      ? requestedPages.map((page) => {
          const route = NODE_BLOG_PAGE_ROUTES[page.archetype];
          if (route === undefined || page.route === undefined) return page;
          // The generic list archetype is named for its React route ("/records");
          // in a publication the same requirement is the post archive.
          return page.archetype === 'list'
            ? { ...page, id: 'posts', name: 'Posts', title: 'Posts', route }
            : { ...page, route };
        })
      : requestedPages;

    applications.push({
      id: appId,
      kind: 'web',
      framework,
      language: 'typescript',
      buildSystem,
      deployment: serverBlog ? 'node-server' : 'static',
      description: serverBlog
        ? 'Server-rendered Node.js publication with a layered router, typed content and no runtime dependencies.'
        : 'React single-page application built with Vite.',
      pages,
      apiEndpoints: [],
      auth: { required: false, strategy: 'none' },
      offlineSupport: false,
      stateManagement: 'none',
    });
    if (frameworkFacts.length === 0) {
      ledger.add('framework', 'react', 'default', 'framework.web-default', {
        applicationId: appId,
        notes: 'React is the only verified interactive web framework.',
      });
    } else if (serverBlog && nodeWebFact === undefined) {
      ledger.add('framework', 'node-typescript', 'derived', 'framework.node-blog-inferred', {
        applicationId: appId,
        notes: 'A Node.js publication was recognised from the request even though the clause split separated the terms.',
      });
    }
    ledger.add('build-system', buildSystem, 'default', serverBlog ? 'build.node-blog' : 'build.web-default', {
      applicationId: appId,
    });
    ledger.add('platform', serverBlog ? 'node-server' : 'browser', 'default', serverBlog ? 'platform.node-server' : 'platform.web', {
      applicationId: appId,
    });
    if (serverBlog) {
      ledger.add('deployment', 'node-server', 'derived', 'deployment.node-blog', {
        applicationId: appId,
        notes: 'The publication is served by a Node.js process; it is not a static export.',
      });
    }
  }

  if (requestedKinds.has('mobile')) {
    const mobileFacts = factsFor(extraction, 'mobile');
    const appId = applicationIdFor('mobile');
    for (const fact of mobileFacts) {
      if (fact.category === 'framework' || fact.category === 'project.kind') ledger.requested(fact, appId);
    }
    const pages = buildPages(mobileFacts, extraction, 'mobile', appId, ledger, firstUiKind === 'mobile').map((page) => ({
      ...page,
      route: undefined,
    }));
    applications.push({
      id: appId,
      kind: 'mobile',
      framework: 'react-native',
      language: 'typescript',
      buildSystem: 'react-native-cli',
      deployment: 'android-apk',
      description: 'React Native application targeting Android.',
      pages,
      apiEndpoints: [],
      auth: { required: false, strategy: 'none' },
      offlineSupport: false,
      stateManagement: 'none',
    });
    ledger.add('framework', 'react-native', 'default', 'framework.mobile-default', {
      applicationId: appId,
      notes: 'Bare React Native with the Android Gradle toolchain is the only verified mobile target.',
    });
    ledger.add('platform', 'android', 'default', 'platform.mobile', { applicationId: appId });
  }

  const backendFacts = factsFor(extraction, 'backend');
  // Data models are built exactly once so ledger ids stay stable.
  const dataModels = requestedKinds.has('backend') ? buildModels(extraction, 'api', ledger) : [];
  if (requestedKinds.has('backend')) {
    const appId = applicationIdFor('backend');
    const frameworkFacts = backendFacts.filter((fact) => fact.category === 'framework' && fact.value !== 'unsupported-web-framework');
    const distinctFrameworks = [...new Set(frameworkFacts.map((fact) => fact.value))];
    if (distinctFrameworks.length > 1) {
      contradictions.push({
        id: 'contradiction-backend-framework',
        description: `The request names multiple backend frameworks: ${distinctFrameworks.join(', ')}.`,
        fields: ['applications.api.framework'],
        values: distinctFrameworks,
      });
    }
    const framework = distinctFrameworks[0] === 'fastapi' ? 'fastapi' : 'node-typescript';
    for (const fact of backendFacts) {
      if (fact.category === 'project.kind' || fact.category === 'framework') ledger.requested(fact, appId);
    }
    if (frameworkFacts.length === 0) {
      ledger.add('framework', framework, 'default', 'framework.backend-default', {
        applicationId: appId,
        notes: 'No backend framework was named; a dependency-free Node.js + TypeScript API is used.',
      });
    }

    const databaseFacts = factsFor(extraction, 'backend', 'database');
    const databaseValues = [...new Set(databaseFacts.map((fact) => fact.value))];
    const sqliteFact = databaseFacts.find((fact) => fact.value === 'sqlite');
    if (sqliteFact !== undefined) ledger.requested(sqliteFact, appId);

    if (dataModels.length > 0 && sqliteFact === undefined) {
      ledger.add('database', 'sqlite', 'assumption', 'database.default-sqlite', {
        applicationId: appId,
        notes: 'Data models were requested without a database engine; SQLite is assumed.',
      });
    }

    const authFacts = extraction.facts.filter((fact) => fact.category === 'auth' || fact.ruleId === 'auth.required');
    const authRequired = authFacts.length > 0;
    for (const fact of authFacts) ledger.requested(fact, appId);

    const endpoints = buildEndpoints(dataModels, appId, authRequired, ledger);

    applications.push({
      id: appId,
      kind: 'backend',
      framework,
      language: framework === 'fastapi' ? 'python' : 'typescript',
      buildSystem: framework === 'fastapi' ? 'uvicorn' : 'tsc',
      deployment: framework === 'fastapi' ? 'python-server' : 'node-server',
      description:
        framework === 'fastapi'
          ? 'FastAPI backend with typed request/response models and SQLite persistence.'
          : 'Node.js + TypeScript backend with typed request/response models and SQLite persistence.',
      pages: [],
      apiEndpoints: endpoints,
      ...(sqliteFact === undefined && dataModels.length === 0
        ? {}
        : { database: { engine: 'sqlite' as const, location: 'data/app.db' } }),
      auth: authRequired ? { required: true, strategy: 'jwt' } : { required: false, strategy: 'none' },
      offlineSupport: false,
      stateManagement: 'none',
    });
    if (authRequired) {
      ledger.add('auth', 'jwt', 'derived', 'auth.jwt-derived', {
        applicationId: appId,
        notes: 'Authentication was requested; JWT bearer auth is the only verified strategy.',
      });
    }
    ledger.add('deployment', framework === 'fastapi' ? 'python-server' : 'node-server', 'derived', 'deployment.backend', {
      applicationId: appId,
    });
  }

  if (extraction.dataModels.length > 0 && !requestedKinds.has('backend')) {
    const backendNotRequested: UnsupportedCapability = {
      id: 'unsupported-data-model-without-backend',
      capability: 'data-model.persistence',
      description: `Data models were requested (${extraction.dataModels.map((model) => model.name).join(', ')}) but no backend exists.`,
      reason: 'A web or mobile client cannot persist a database; persistence requires a backend application.',
      alternative: 'Add a separate backend application that owns the data models.',
    };
    clarifications.push({
      id: 'clarify-data-model-backend',
      question:
        'Where should the requested data models live? Add a backend application, or remove the persistence requirement.',
      field: 'dataModels',
      severity: 'blocking',
      options: ['Add a backend', 'Remove persistence'],
      context: backendNotRequested.description,
    });
  }

  /* ------------------------------------------------------- authentication */
  const webApp = applications.find((application) => application.kind === 'web');
  const backendApp = applications.find((application) => application.kind === 'backend');
  const authRequested = extraction.facts.some((fact) => fact.category === 'auth' || fact.ruleId === 'auth.required');
  const loginPage = webApp?.pages.some((page) => page.archetype === 'login') === true;

  if ((authRequested || loginPage) && webApp !== undefined) {
    if (webApp.framework === 'node-typescript') {
      // Never silently drop the requirement: it is represented in the spec so
      // validation reports it as unsupported with a reason and an alternative.
      webApp.auth = { required: true, strategy: 'jwt' };
      ledger.add('auth', 'required', 'requested', 'auth.server-blog', {
        applicationId: webApp.id,
        notes:
          'Authentication was requested, but the Node.js publication target has no accounts or sessions; planning reports it as unsupported.',
      });
    } else if (backendApp === undefined) {
      const message =
        'A login page was requested but there is no backend to authenticate against. Authentication cannot be implemented client-side.';
      if (!clarifications.some((entry) => entry.field === 'applications.web.auth')) {
        clarifications.push({
          id: 'clarify-auth-backend',
          question:
            'Authentication needs a backend. Add a separate backend with JWT auth, or drop the login flow?',
          field: 'applications.web.auth',
          severity: 'blocking',
          options: ['Add a backend with JWT auth', 'Drop authentication'],
        });
      }
      notes.push(message);
    } else {
      webApp.auth = { required: true, strategy: 'jwt' };
      if (backendApp.auth?.strategy !== 'jwt') {
        backendApp.auth = { required: true, strategy: 'jwt' };
      }
      for (const page of webApp.pages) {
        if (page.archetype === 'login' || page.archetype === 'register') page.requiresAuth = false;
        else if (page.archetype === 'dashboard' || page.archetype === 'settings' || page.archetype === 'profile') {
          page.requiresAuth = true;
        }
      }
      webApp.stateManagement = 'react-context';
      ledger.add('auth', 'jwt', 'derived', 'auth.derived-from-login', {
        applicationId: webApp.id,
        notes: 'A login page plus a backend implies JWT authentication.',
      });
      ledger.add('state-management', 'react-context', 'derived', 'state.derived-from-auth', {
        applicationId: webApp.id,
        notes: 'Auth state needs a context provider; no external state library is used.',
      });
    }
  }

  /* ------------------------------------------------------ design system */
  const styleFacts = extraction.facts.filter((fact) => fact.category === 'design.style');
  const themeFacts = extraction.facts.filter((fact) => fact.category === 'design.theme');
  const presetFacts = extraction.facts.filter((fact) => fact.category === 'design.preset');
  const layoutFacts = extraction.facts.filter((fact) => fact.category === 'design.layout');
  const layoutValues = [...new Set(layoutFacts.map((fact) => fact.value))];
  const styles = [...new Set(styleFacts.map((fact) => fact.value))];
  const themes = [...new Set(themeFacts.map((fact) => fact.value).filter((value) => value !== 'system'))];
  const presets = [...new Set(presetFacts.map((fact) => fact.value))];

  if (styles.length > 1) {
    contradictions.push({
      id: 'contradiction-design-style',
      description: `Two conflicting design styles were requested: ${styles.join(' and ')}.`,
      fields: ['design.style'],
      values: styles,
    });
  }
  if (themes.length > 1) {
    contradictions.push({
      id: 'contradiction-design-theme',
      description: `Two conflicting themes were requested: ${themes.join(' and ')}.`,
      fields: ['design.theme'],
      values: themes,
    });
  }
  if (presets.length > 1) {
    contradictions.push({
      id: 'contradiction-design-preset',
      description: `Two conflicting colour presets were requested: ${presets.join(' and ')}.`,
      fields: ['design.preset'],
      values: presets,
    });
  }
  // Every contradiction blocks planning until the user resolves it, exactly once.
  for (const contradiction of contradictions) {
    if (clarifications.some((entry) => entry.field === contradiction.fields[0])) continue;
    clarifications.push({
      id: `clarify-${contradiction.id}`,
      question: contradiction.description,
      field: contradiction.fields[0] ?? 'design',
      severity: 'blocking',
      options: contradiction.values,
    });
  }

  for (const fact of styleFacts) ledger.requested(fact, null);
  for (const fact of themeFacts) ledger.requested(fact, null);
  for (const fact of presetFacts) ledger.requested(fact, null);
  for (const fact of layoutFacts) ledger.requested(fact, null);
  for (const color of extraction.colors) {
    ledger.add('design.color', color.value, 'requested', 'design.color', { evidence: color.evidence });
  }

  // A publication defaults to the editorial token set; other web apps keep the
  // neutral default. This is a documented default, not an inference about intent.
  const defaultStyle = serverRenderedWeb ? 'editorial' : 'default';
  const style = (styles[0] ?? defaultStyle) as ProjectSpec['design']['style'];
  const theme = (themes[0] ?? 'dark') as ProjectSpec['design']['theme'];
  const preset = presets[0] ?? 'default';
  if (presets.length === 0) {
    ledger.add('design.preset', preset, 'default', 'design.preset-default', {
      notes: 'No named colour preset was described; the style palette is used.',
    });
  }
  if (styles.length === 0) {
    ledger.add('design.style', style, 'default', 'design.style-default', {
      notes: serverRenderedWeb
        ? 'No visual style was described; the editorial publication style is used.'
        : 'No visual style was described.',
    });
  }
  if (themes.length === 0) {
    ledger.add('design.theme', theme, 'default', 'design.theme-default', { notes: 'Default theme is dark.' });
  }

  let layout: ProjectSpec['design']['layout'] = 'default';
  if (layoutValues.includes('dashboard') || webApp?.pages.some((page) => page.archetype === 'dashboard') === true) {
    layout = 'dashboard';
    ledger.add('design.layout', 'dashboard', webApp?.pages.some((page) => page.archetype === 'dashboard') ? 'derived' : 'requested', 'design.layout-from-dashboard');
  } else if (layoutValues.includes('landing') || webApp !== undefined) {
    layout = 'landing';
    ledger.add('design.layout', 'landing', layoutValues.includes('landing') ? 'requested' : 'default', 'design.layout-default');
  } else if (applications.some((application) => application.kind === 'mobile')) {
    layout = 'mobile-tabs';
    ledger.add('design.layout', 'mobile-tabs', 'default', 'design.layout-mobile');
  }

  // A named preset owns the palette: leaving the list empty lets the design
  // engine resolve it for the requested theme instead of freezing the style's
  // default colours into the specification. Explicit colours always win.
  const palette =
    extraction.colors.length > 0
      ? extraction.colors.map((color) => color.value)
      : presets.length > 0
        ? []
        : [...(DEFAULT_PALETTES[style] ?? DEFAULT_PALETTES['default'] ?? [])];
  if (extraction.colors.length === 0) {
    if (presets.length > 0) {
      ledger.add('design.color', preset, 'derived', 'design.palette-from-preset', {
        notes: `Palette resolved from the ${preset} preset for the ${theme} theme.`,
      });
    } else {
      ledger.add('design.color', palette.join(','), 'default', 'design.palette-default', {
        notes: `Palette derived from the ${style} token set.`,
      });
    }
  }

  /* ----------------------------------------------------------- testing */
  const testingFacts = extraction.facts.filter((fact) => fact.category === 'testing' || fact.category === 'accessibility');
  for (const fact of testingFacts) ledger.requested(fact, null);
  const testingValues = new Set(testingFacts.map((fact) => fact.value));
  const backendApplication = applications.find((application) => application.kind === 'backend');
  const runners = [
    ...(applications.some((application) => application.language === 'typescript') ? ['vitest'] : []),
    ...(applications.some((application) => application.language === 'python') ? ['pytest'] : []),
  ];
  if (runners.length === 0) runners.push('vitest');
  if (testingValues.size === 0) {
    ledger.add('testing', 'unit', 'default', 'testing.default-unit', {
      notes: 'Every generated application includes unit tests.',
    });
  }
  if (backendApplication !== undefined && !testingValues.has('integration')) {
    ledger.add('testing', 'integration', 'derived', 'testing.backend-integration', {
      applicationId: backendApplication.id,
      notes: 'Backend route tests always exercise the HTTP layer.',
    });
  }
  const testing = {
    unit: true,
    integration: testingValues.has('integration') || backendApplication !== undefined,
    e2e: testingValues.has('e2e'),
    accessibility: testingValues.has('accessibility'),
    runners,
  };

  /* --------------------------------------------------------- identity */
  const nameFact = extraction.projectName;
  const name =
    nameFact?.value ??
    (applications.length === 1
      ? `${
          applications[0]?.framework === 'fastapi'
            ? 'FastAPI'
            : applications[0]?.kind === 'mobile'
              ? 'React Native'
              : applications[0]?.framework === 'node-typescript'
                ? 'Node'
                : 'React'
        } App`
      : 'Full Stack App');
  if (nameFact !== null) {
    ledger.add('project.name', name, 'requested', 'project.name', { evidence: nameFact.evidence });
  } else {
    ledger.add('project.name', name, 'default', 'project.name-default', {
      notes: 'No project name was given; the name is derived from the requested targets.',
    });
  }

  if (extraction.unmatchedClauses.length > 0) {
    notes.push(
      `These clauses did not map to any requirement and were not used: ${extraction.unmatchedClauses
        .map((clause) => `"${clause}"`)
        .join('; ')}`,
    );
  }

  const spec: ProjectSpec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    name,
    slug: toSafeName(name),
    description: text.trim(),
    applications,
    design: {
      style,
      theme,
      preset,
      palette: [...new Set(palette.map((color) => color.toLowerCase()))],
      layout,
      responsive: true,
      accessibility: { semanticHtml: true, keyboardNavigation: true, reducedMotion: true, contrastChecks: true },
    },
    dataModels,
    testing,
    constraints: [],
    requirements: ledger.all(),
    clarifications,
    contradictions,
    unsupported: [...extraction.unsupported],
    assumptions: [],
    provenance: {
      sourceTextHash: sha256(text),
      interpretedAt: options.interpretedAt ?? new Date().toISOString(),
      interpreterVersion: INTERPRETER_VERSION,
      source: options.source ?? 'user-request',
    },
  };

  // Validation adds unsupported capabilities that extraction cannot know about
  // (for example an e2e suite or automated accessibility testing).
  const validation = validateProjectSpec(spec);
  for (const entry of validation.unsupported) {
    if (!spec.unsupported.some((existing) => existing.capability === entry.capability)) {
      spec.unsupported.push(entry);
    }
  }
  for (const question of validation.blockingClarifications) {
    if (!spec.clarifications.some((clarification) => clarification.question === question)) {
      spec.clarifications.push({
        id: `clarify-validation-${spec.clarifications.length + 1}`,
        question,
        field: 'applications',
        severity: 'blocking',
        options: [],
      });
    }
  }

  const parsed = parseProjectSpec(spec);
  if ('issues' in parsed) {
    // A schema failure is an engine bug, not a user error: surface it loudly.
    throw new Error(`Interpreter produced an invalid specification: ${parsed.issues.join('; ')}`);
  }

  const blocking = parsed.spec.clarifications.filter((clarification) => clarification.severity === 'blocking');
  const status: InterpretationOutcome['status'] =
    parsed.spec.unsupported.length > 0 ? 'unsupported' : blocking.length > 0 ? 'needs-clarification' : 'ready';

  const ledgerEntries = parsed.spec.requirements;
  return {
    status,
    spec: parsed.spec,
    clarifications: parsed.spec.clarifications,
    contradictions: parsed.spec.contradictions,
    unsupported: parsed.spec.unsupported,
    ledger: ledgerEntries,
    notes,
    extraction,
    intents: classifyIntent(text),
  };
}
