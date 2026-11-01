import { describe, expect, it } from 'vitest';
import { SPEC_SCHEMA_VERSION, parseProjectSpec, type ProjectSpec } from './schema.js';
import { specHash, validateProjectSpec } from './validation.js';

export function sampleSpec(overrides: Partial<ProjectSpec> = {}): ProjectSpec {
  const base: ProjectSpec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    name: 'Demo Dashboard',
    slug: 'demo-dashboard',
    description: 'A dashboard with a separate backend',
    applications: [
      {
        id: 'web',
        kind: 'web',
        framework: 'react',
        language: 'typescript',
        buildSystem: 'vite',
        deployment: 'static',
        description: 'Web client',
        pages: [
          { id: 'login', name: 'Login', route: '/login', archetype: 'login', title: 'Sign in', requiresAuth: false },
          { id: 'dashboard', name: 'Dashboard', route: '/', archetype: 'dashboard', title: 'Dashboard', requiresAuth: false },
        ],
        apiEndpoints: [],
        auth: { required: false, strategy: 'none' },
        offlineSupport: false,
        stateManagement: 'react-context',
      },
      {
        id: 'api',
        kind: 'backend',
        framework: 'fastapi',
        language: 'python',
        buildSystem: 'uvicorn',
        deployment: 'python-server',
        description: 'Backend API',
        pages: [],
        apiEndpoints: [
          { id: 'metrics', applicationId: 'api', method: 'GET', path: '/api/metrics', operation: 'listMetrics', responseModel: 'Metric', requiresAuth: false, consumedBy: ['dashboard'] },
        ],
        database: { engine: 'sqlite', location: 'app.db' },
        auth: { required: false, strategy: 'none' },
        offlineSupport: false,
        stateManagement: 'none',
      },
    ],
    design: {
      style: 'glassmorphism',
      theme: 'dark',
      preset: 'default',
      palette: ['#0f172a', '#38bdf8'],
      layout: 'dashboard',
      responsive: true,
      accessibility: { semanticHtml: true, keyboardNavigation: true, reducedMotion: true, contrastChecks: true },
    },
    dataModels: [
      {
        id: 'metric',
        name: 'Metric',
        applicationId: 'api',
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'value', type: 'number', required: true },
        ],
      },
    ],
    testing: { unit: true, integration: true, e2e: false, accessibility: false, runners: ['vitest', 'pytest'] },
    constraints: [],
    requirements: [],
    clarifications: [],
    contradictions: [],
    unsupported: [],
    assumptions: [],
    provenance: {
      sourceTextHash: 'a'.repeat(32),
      interpretedAt: '2026-01-01T00:00:00.000Z',
      interpreterVersion: '0.1.0',
      source: 'user-request',
    },
  };
  return { ...base, ...overrides };
}

describe('projectSpecSchema', () => {
  it('accepts a coherent full-stack specification', () => {
    const result = parseProjectSpec(sampleSpec());
    expect('spec' in result).toBe(true);
  });

  it('rejects a specification with an invalid slug or palette', () => {
    const result = parseProjectSpec(sampleSpec({ slug: 'Not A Slug' }));
    expect('issues' in result).toBe(true);
  });

  it('requires at least one application', () => {
    expect('issues' in parseProjectSpec(sampleSpec({ applications: [] }))).toBe(true);
  });
});

describe('validateProjectSpec', () => {
  it('accepts the sample specification', () => {
    const result = validateProjectSpec(sampleSpec());
    expect(result.errors).toEqual([]);
    expect(result.blockingClarifications).toEqual([]);
    expect(result.unsupported).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('reports authentication that has no backend to authenticate against', () => {
    const spec = sampleSpec();
    const web = spec.applications[0];
    if (web === undefined) throw new Error('unreachable');
    web.auth = { required: true, strategy: 'jwt' };
    web.pages[1]!.requiresAuth = true;
    spec.applications = [web];
    const result = validateProjectSpec(spec);
    expect(result.errors.map((error) => error.code)).toContain('SPEC_AUTH_WITHOUT_BACKEND');
    expect(result.blockingClarifications.length).toBeGreaterThan(0);
    expect(result.valid).toBe(false);
  });

  it('marks unsupported capabilities instead of approximating them', () => {
    const spec = sampleSpec();
    spec.applications[0]!.offlineSupport = true;
    spec.testing.e2e = true;
    const result = validateProjectSpec(spec);
    expect(result.unsupported.map((entry) => entry.capability)).toEqual(
      expect.arrayContaining(['web.offline', 'testing.e2e']),
    );
    expect(result.valid).toBe(false);
  });

  it('detects duplicate routes and endpoints', () => {
    const spec = sampleSpec();
    const web = spec.applications[0]!;
    web.pages = [
      { id: 'a', name: 'A', route: '/', archetype: 'landing', title: 'A', requiresAuth: false },
      { id: 'b', name: 'B', route: '/', archetype: 'generic', title: 'B', requiresAuth: false },
    ];
    const api = spec.applications[1]!;
    api.apiEndpoints = [
      api.apiEndpoints[0]!,
      { ...api.apiEndpoints[0]!, id: 'metrics-2' },
    ];
    const result = validateProjectSpec(spec);
    expect(result.errors.map((error) => error.code)).toContain('SPEC_DUPLICATE_ROUTE');
    expect(result.errors.map((error) => error.code)).toContain('SPEC_DUPLICATE_ENDPOINT');
  });

  it('rejects endpoints that reference undefined models', () => {
    const spec = sampleSpec();
    spec.applications[1]!.apiEndpoints[0]!.responseModel = 'Missing';
    const result = validateProjectSpec(spec);
    expect(result.errors.map((error) => error.code)).toContain('SPEC_ENDPOINT_MODEL');
  });

  it('rejects a web application that owns a database', () => {
    const spec = sampleSpec();
    spec.applications[0]!.database = { engine: 'sqlite', location: 'local.db' };
    const result = validateProjectSpec(spec);
    expect(result.unsupported.map((entry) => entry.capability)).toContain('web.database');
  });

  it('rejects framework/language mismatches on a backend', () => {
    const spec = sampleSpec();
    spec.applications[1]!.language = 'typescript';
    const result = validateProjectSpec(spec);
    expect(result.errors.map((error) => error.code)).toContain('SPEC_BACKEND_LANGUAGE');
  });
});

describe('specHash', () => {
  it('is stable and sensitive to content', () => {
    const a = sampleSpec();
    const b = sampleSpec();
    expect(specHash(a)).toBe(specHash(b));
    const changed = sampleSpec({ name: 'Other' });
    expect(specHash(changed)).not.toBe(specHash(a));
  });
});
