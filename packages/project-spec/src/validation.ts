/**
 * Semantic validation of a project specification.
 *
 * Schema validation proves the document *shape*; these checks prove it is
 * coherent and buildable with the components, templates and toolchains that
 * actually exist. Unsupported requests are reported as `unsupported` entries
 * rather than being silently dropped or approximated.
 */
import { contentHash } from '@assembler/core';
import type { ApplicationSpec, ProjectSpec, UnsupportedCapability } from './schema.js';
import { unsupportedCapabilitySchema } from './schema.js';

export interface ValidationFinding {
  readonly code: string;
  readonly message: string;
  readonly field: string;
  readonly severity: 'error' | 'warning';
}

export interface SpecValidationResult {
  readonly valid: boolean;
  readonly findings: readonly ValidationFinding[];
  readonly errors: readonly ValidationFinding[];
  readonly warnings: readonly ValidationFinding[];
  readonly blockingClarifications: readonly string[];
  readonly unsupported: readonly UnsupportedCapability[];
}

/**
 * What the engine can actually assemble today. Anything outside this matrix is
 * reported as unsupported, with a reason, before planning starts.
 */
export const SUPPORTED_MATRIX = {
  web: {
    frameworks: ['react'],
    buildSystems: ['vite'],
    languages: ['typescript'],
    deployment: ['static'],
    stateManagement: ['none', 'react-context'],
    offline: false,
    routes: true,
    authUi: true,
  },
  mobile: {
    frameworks: ['react-native'],
    buildSystems: ['react-native-cli'],
    languages: ['typescript'],
    deployment: ['android-apk'],
    platforms: ['android'],
    offline: false,
  },
  backend: {
    frameworks: ['node-typescript', 'fastapi'],
    buildSystems: ['tsc', 'uvicorn'],
    languages: { 'node-typescript': 'typescript', fastapi: 'python' },
    databases: ['sqlite'],
    auth: ['jwt', 'none'],
    deployment: ['node-server', 'python-server'],
  },
  design: {
    styles: ['glassmorphism', 'neumorphism', 'minimal', 'material', 'default'],
    themes: ['dark', 'light', 'system'],
    layouts: ['dashboard', 'landing', 'mobile-tabs', 'default'],
  },
  testing: {
    runners: ['vitest', 'pytest'],
    e2e: false,
    accessibilityAutomated: false,
  },
} as const;

export function specHash(spec: ProjectSpec): string {
  return contentHash(spec);
}

export function describeApplication(application: ApplicationSpec): string {
  const pages = application.pages.map((page) => page.name).join(', ');
  const endpoints = application.apiEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ');
  return `${application.kind} (${application.framework})${pages === '' ? '' : ` pages: ${pages}`}${
    endpoints === '' ? '' : ` endpoints: ${endpoints}`
  }`;
}

export function validateProjectSpec(spec: ProjectSpec): SpecValidationResult {
  const findings: ValidationFinding[] = [];
  const unsupported: UnsupportedCapability[] = [];
  const blockingClarifications: string[] = [];
  const add = (
    code: string,
    field: string,
    message: string,
    severity: ValidationFinding['severity'] = 'error',
  ): void => {
    findings.push({ code, field, message, severity });
  };
  const addUnsupported = (
    capability: string,
    description: string,
    reason: string,
    alternative?: string,
  ): void => {
    const parsed = unsupportedCapabilitySchema.safeParse({
      id: `unsupported-${capability}`,
      capability,
      description,
      reason,
      ...(alternative === undefined ? {} : { alternative }),
    });
    if (parsed.success) unsupported.push(parsed.data);
  };

  /* ------------------------------------------------------------- identity */
  if (spec.applications.length === 0) {
    add('SPEC_NO_APPLICATION', 'applications', 'The specification requests no applications.');
  }
  if (spec.name.trim() === '') add('SPEC_NO_NAME', 'name', 'The project has no name.');

  const applicationIds = new Set<string>();
  for (const application of spec.applications) {
    if (applicationIds.has(application.id)) {
      add('SPEC_DUPLICATE_APPLICATION', `applications.${application.id}`, `Duplicate application id "${application.id}".`);
    }
    applicationIds.add(application.id);

    /* --------------------------------------------------- kind / framework */
    if (application.kind === 'web') {
      const supported = SUPPORTED_MATRIX.web;
      if (!supported.frameworks.includes(application.framework as 'react')) {
        addUnsupported(
          `web:${application.framework}`,
          `A ${application.framework} web application`,
          'No verified web template exists for this framework.',
          'Only React + Vite web applications are currently supported.',
        );
      }
      if (!supported.buildSystems.includes(application.buildSystem as 'vite')) {
        addUnsupported(
          `web.build:${application.buildSystem}`,
          `Web build system ${application.buildSystem}`,
          'No verified build configuration exists for this build system.',
        );
      }
      if (application.language !== 'typescript') {
        addUnsupported('web.language', `Web language ${application.language}`, 'Only TypeScript is supported for web.');
      }
      if (application.database !== undefined) {
        addUnsupported(
          'web.database',
          'A database inside the web application',
          'Client applications must not embed a database; persistence belongs in a backend.',
          'Add a separate backend application and call it over HTTP.',
        );
      }
      if (application.offlineSupport) {
        addUnsupported(
          'web.offline',
          'Offline support for the web application',
          'No verified service-worker component exists, so offline behaviour cannot be delivered or tested.',
        );
      }
      if (!supported.stateManagement.includes(application.stateManagement as 'none')) {
        addUnsupported(
          `web.state:${application.stateManagement}`,
          `State management "${application.stateManagement}"`,
          'No verified integration exists for this state library.',
        );
      }
      if (application.auth?.required === true) {
        const backend = spec.applications.find(
          (candidate) => candidate.kind === 'backend' && candidate.auth?.strategy === 'jwt',
        );
        if (backend === undefined) {
          add(
            'SPEC_AUTH_WITHOUT_BACKEND',
            `applications.${application.id}.auth`,
            'The web application requires authentication but no backend with JWT auth is specified.',
          );
          blockingClarifications.push(
            `How should "${spec.name}" authenticate? Add a backend with JWT auth, or remove the auth requirement.`,
          );
        }
      }
    }

    if (application.kind === 'mobile') {
      if (application.framework !== 'react-native') {
        addUnsupported(
          `mobile:${application.framework}`,
          `A ${application.framework} mobile application`,
          'Only React Native (bare workflow, Android target) has a verified template.',
        );
      }
      if (application.language !== 'typescript') {
        addUnsupported('mobile.language', 'Non-TypeScript mobile application', 'Only TypeScript is supported.');
      }
      if (application.buildSystem !== 'react-native-cli') {
        addUnsupported(
          `mobile.build:${application.buildSystem}`,
          `Mobile build system ${application.buildSystem}`,
          'Only the React Native CLI / Gradle workflow is verified for Android.',
        );
      }
      if (application.deployment !== 'android-apk') {
        add('SPEC_MOBILE_DEPLOYMENT', `applications.${application.id}.deployment`, 'The mobile target must deploy an Android APK.');
      }
      if (application.database !== undefined) {
        addUnsupported(
          'mobile.database',
          'A database inside the mobile application',
          'Local persistence components for React Native have not been verified.',
        );
      }
      if (application.offlineSupport) {
        addUnsupported(
          'mobile.offline',
          'Offline support for the mobile application',
          'No verified local-persistence component exists yet.',
        );
      }
      const webOnly = ['react-dom', 'vite', 'dom-storage'];
      if (webOnly.some((name) => application.stateManagement === (name as never))) {
        add('SPEC_WEB_API_IN_MOBILE', `applications.${application.id}`, 'A browser-only API was selected for a native app.');
      }
    }

    if (application.kind === 'backend') {
      const supported = SUPPORTED_MATRIX.backend;
      if (!supported.frameworks.includes(application.framework as 'node-typescript')) {
        addUnsupported(
          `backend:${application.framework}`,
          `A ${application.framework} backend`,
          'No verified backend template exists for this framework.',
        );
      }
      const expectedLanguage =
        supported.languages[application.framework as 'node-typescript' | 'fastapi'] ?? null;
      if (expectedLanguage !== null && application.language !== expectedLanguage) {
        add(
          'SPEC_BACKEND_LANGUAGE',
          `applications.${application.id}.language`,
          `Framework ${application.framework} requires ${expectedLanguage}, but ${application.language} was requested.`,
        );
      }
      const expectedBuild = application.framework === 'fastapi' ? 'uvicorn' : 'tsc';
      if (application.buildSystem !== expectedBuild) {
        add(
          'SPEC_BACKEND_BUILD',
          `applications.${application.id}.buildSystem`,
          `Framework ${application.framework} requires build system ${expectedBuild}.`,
        );
      }
      if (application.pages.length > 0) {
        add('SPEC_BACKEND_PAGES', `applications.${application.id}.pages`, 'A backend application cannot own UI pages.');
      }
      if (application.database !== undefined && !supported.databases.includes(application.database.engine)) {
        addUnsupported(
          `backend.database:${application.database.engine}`,
          `Database ${application.database.engine}`,
          'Only SQLite has a verified repository template.',
        );
      }
      if (application.auth !== undefined && !supported.auth.includes(application.auth.strategy as 'jwt')) {
        addUnsupported(
          `backend.auth:${application.auth.strategy}`,
          `Auth strategy ${application.auth.strategy}`,
          'Only JWT bearer auth has a verified implementation.',
        );
      }
    }

    /* ------------------------------------------------------------ pages */
    const routes = new Set<string>();
    const pageIds = new Set<string>();
    for (const page of application.pages) {
      if (pageIds.has(page.id)) {
        add('SPEC_DUPLICATE_PAGE', `applications.${application.id}.pages.${page.id}`, `Duplicate page id "${page.id}".`);
      }
      pageIds.add(page.id);
      if (page.route !== undefined) {
        const key = page.route.toLowerCase();
        if (routes.has(key)) {
          add(
            'SPEC_DUPLICATE_ROUTE',
            `applications.${application.id}.pages.${page.id}.route`,
            `Duplicate route "${page.route}".`,
          );
        }
        routes.add(key);
        if (!page.route.startsWith('/')) {
          add(
            'SPEC_ROUTE_FORM',
            `applications.${application.id}.pages.${page.id}.route`,
            `Route "${page.route}" must start with "/".`,
          );
        }
      }
      if (page.requiresAuth && application.kind === 'web' && application.auth?.required !== true) {
        add(
          'SPEC_PAGE_AUTH_WITHOUT_AUTH',
          `applications.${application.id}.pages.${page.id}`,
          `Page "${page.name}" requires authentication but the application does not declare auth.`,
          'warning',
        );
      }
    }

    /* -------------------------------------------------------- endpoints */
    const endpointKeys = new Set<string>();
    for (const endpoint of application.apiEndpoints) {
      const key = `${endpoint.method} ${endpoint.path.toLowerCase()}`;
      if (endpointKeys.has(key)) {
        add(
          'SPEC_DUPLICATE_ENDPOINT',
          `applications.${application.id}.apiEndpoints.${endpoint.id}`,
          `Duplicate endpoint ${key}.`,
        );
      }
      endpointKeys.add(key);
      if (application.kind !== 'backend') {
        add(
          'SPEC_ENDPOINT_ON_CLIENT',
          `applications.${application.id}.apiEndpoints`,
          'API endpoints may only be declared on backend applications.',
        );
      }
      if (endpoint.requiresAuth && application.auth?.strategy !== 'jwt') {
        add(
          'SPEC_ENDPOINT_AUTH',
          `applications.${application.id}.apiEndpoints.${endpoint.id}`,
          'An endpoint requires auth but the backend does not enable JWT auth.',
        );
      }
    }
  }

  /* ---------------------------------------------------------- data models */
  const modelNames = new Set(spec.dataModels.map((model) => model.name.toLowerCase()));
  for (const model of spec.dataModels) {
    if (!applicationIds.has(model.applicationId)) {
      add(
        'SPEC_MODEL_APP',
        `dataModels.${model.id}`,
        `Data model "${model.name}" references unknown application "${model.applicationId}".`,
      );
    }
    if (model.fields.length === 0) {
      add('SPEC_MODEL_FIELDS', `dataModels.${model.id}`, `Data model "${model.name}" has no fields.`);
    }
    const fieldNames = new Set<string>();
    for (const field of model.fields) {
      if (fieldNames.has(field.name)) {
        add('SPEC_MODEL_DUPLICATE_FIELD', `dataModels.${model.id}.${field.name}`, 'Duplicate field name.');
      }
      fieldNames.add(field.name);
    }
  }
  for (const application of spec.applications) {
    for (const endpoint of application.apiEndpoints) {
      if (endpoint.requestModel !== undefined && !modelNames.has(endpoint.requestModel.toLowerCase())) {
        add(
          'SPEC_ENDPOINT_MODEL',
          `applications.${application.id}.apiEndpoints.${endpoint.id}`,
          `Endpoint ${endpoint.method} ${endpoint.path} references undefined request model "${endpoint.requestModel}".`,
        );
      }
      if (endpoint.responseModel !== undefined && !modelNames.has(endpoint.responseModel.toLowerCase())) {
        add(
          'SPEC_ENDPOINT_MODEL',
          `applications.${application.id}.apiEndpoints.${endpoint.id}`,
          `Endpoint ${endpoint.method} ${endpoint.path} references undefined response model "${endpoint.responseModel}".`,
        );
      }
    }
  }

  /* --------------------------------------------------------------- design */
  if (!(SUPPORTED_MATRIX.design.styles as readonly string[]).includes(spec.design.style)) {
    addUnsupported(
      `design:${spec.design.style}`,
      `Design style ${spec.design.style}`,
      'No verified design token set exists for this style.',
    );
  }
  if (spec.testing.e2e) {
    addUnsupported(
      'testing.e2e',
      'End-to-end browser tests',
      'Playwright is not part of the verified test toolchain yet, so an e2e suite would be claimed but never executed.',
    );
  }
  if (spec.testing.accessibility) {
    addUnsupported(
      'testing.accessibility',
      'Automated accessibility testing',
      'No accessible-name or axe-style assertions are generated yet; accessibility is built in but not automatically tested.',
    );
  }

  /* ---------------------------------------------------------- consistency */
  const webApplications = spec.applications.filter((application) => application.kind === 'web');
  const backendApplications = spec.applications.filter((application) => application.kind === 'backend');
  if (webApplications.length > 1) {
    addUnsupported(
      'web.multiple',
      'Multiple web applications in one project',
      'Only one web application per project is supported by the current planner.',
    );
  }
  if (backendApplications.length > 1) {
    addUnsupported(
      'backend.multiple',
      'Multiple backend applications in one project',
      'Only one backend application per project is supported by the current planner.',
    );
  }

  const seenAssumptionFields = new Set<string>();
  for (const assumption of spec.assumptions) {
    if (seenAssumptionFields.has(assumption.field)) {
      add('SPEC_DUPLICATE_ASSUMPTION', `assumptions.${assumption.id}`, 'Two assumptions target the same field.', 'warning');
    }
    seenAssumptionFields.add(assumption.field);
  }

  const errors = findings.filter((finding) => finding.severity === 'error');
  for (const contradiction of spec.contradictions) {
    blockingClarifications.push(contradiction.description);
  }
  return {
    valid: errors.length === 0 && blockingClarifications.length === 0 && unsupported.length === 0,
    findings,
    errors,
    warnings: findings.filter((finding) => finding.severity === 'warning'),
    blockingClarifications,
    unsupported,
  };
}
