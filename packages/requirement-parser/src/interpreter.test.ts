import { describe, expect, it } from 'vitest';
import { interpretRequirement } from './interpreter.js';

const EXAMPLE =
  'Create a glassmorphism React website with a login page, dashboard, dark theme, and a separate FastAPI backend. The backend should use SQLite.';

function interpret(text: string) {
  return interpretRequirement(text, { source: 'test', interpretedAt: '2026-01-01T00:00:00.000Z' });
}

describe('the reference example', () => {
  const result = interpret(EXAMPLE);

  it('produces a specification without clarification', () => {
    expect(result.status).toBe('ready');
    expect(result.spec).not.toBeNull();
    expect(result.clarifications).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  it('scopes the backend to the FastAPI application', () => {
    const spec = result.spec;
    if (spec === null) throw new Error('expected a spec');
    const kinds = spec.applications.map((application) => application.kind);
    expect(kinds).toEqual(['web', 'backend']);
    const backend = spec.applications.find((application) => application.kind === 'backend');
    expect(backend?.framework).toBe('fastapi');
    expect(backend?.language).toBe('python');
    expect(backend?.buildSystem).toBe('uvicorn');
    expect(backend?.database?.engine).toBe('sqlite');
    expect(backend?.deployment).toBe('python-server');
  });

  it('extracts design and page requirements', () => {
    const spec = result.spec;
    if (spec === null) throw new Error('expected a spec');
    expect(spec.design.style).toBe('glassmorphism');
    expect(spec.design.theme).toBe('dark');
    expect(spec.design.layout).toBe('dashboard');
    const web = spec.applications.find((application) => application.kind === 'web');
    const archetypes = web?.pages.map((page) => page.archetype).sort();
    expect(archetypes).toEqual(['dashboard', 'login']);
  });

  it('derives JWT authentication because a login page and a backend exist', () => {
    const spec = result.spec;
    if (spec === null) throw new Error('expected a spec');
    expect(spec.applications.find((application) => application.kind === 'web')?.auth?.required).toBe(true);
    expect(spec.applications.find((application) => application.kind === 'backend')?.auth?.strategy).toBe('jwt');
  });

  it('records provenance for every requirement', () => {
    const statuses = new Set(result.ledger.map((entry) => entry.status));
    expect(statuses.has('requested')).toBe(true);
    expect(statuses.has('default')).toBe(true);
    const styleEntry = result.ledger.find((entry) => entry.category === 'design.style');
    expect(styleEntry?.status).toBe('requested');
    expect(styleEntry?.evidence).toContain('glassmorphism');
  });

  it('is deterministic for identical input', () => {
    const again = interpret(EXAMPLE);
    expect(JSON.stringify(again.spec)).toBe(JSON.stringify(result.spec));
  });
});

describe('single-target requests', () => {
  it('creates a web-only dashboard with a default styling', () => {
    const result = interpret('Create a React dashboard');
    expect(result.status).toBe('ready');
    const spec = result.spec;
    if (spec === null) throw new Error('expected a spec');
    expect(spec.applications).toHaveLength(1);
    expect(spec.applications[0]?.pages.map((page) => page.archetype)).toContain('dashboard');
    expect(spec.design.layout).toBe('dashboard');
    expect(spec.design.style).toBe('default');
    expect(spec.testing.runners).toEqual(['vitest']);
  });

  it('creates a mobile application and reports unsupported native capabilities', () => {
    const result = interpret('Build a React Native Android app with a login screen and camera access');
    expect(result.status).toBe('unsupported');
    expect(result.unsupported.map((entry) => entry.capability)).toContain('native.camera');
    const spec = result.spec;
    if (spec === null) throw new Error('expected a spec');
    const mobile = spec.applications[0];
    expect(mobile?.kind).toBe('mobile');
    expect(mobile?.deployment).toBe('android-apk');
    expect(mobile?.pages.some((page) => page.title === 'Sign in')).toBe(true);
  });

  it('creates a backend with derived CRUD endpoints for declared models', () => {
    const result = interpret('Create a Node backend with a users table');
    expect(result.spec).not.toBeNull();
    const spec = result.spec;
    if (spec === null) throw new Error('expected a spec');
    const backend = spec.applications[0];
    expect(backend?.framework).toBe('node-typescript');
    expect(backend?.database?.engine).toBe('sqlite');
    expect(spec.dataModels.map((model) => model.name)).toContain('User');
    const paths = backend?.apiEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`) ?? [];
    expect(paths).toContain('GET /api/health');
    expect(paths).toContain('GET /api/users');
    expect(paths).toContain('POST /api/users');
  });

  it('reports unsupported frameworks instead of silently substituting one', () => {
    const result = interpret('Create a Vue website');
    expect(result.status).toBe('unsupported');
    expect(result.unsupported.some((entry) => entry.capability === 'web.framework')).toBe(true);
  });
});

describe('clarification and contradiction detection', () => {
  it('asks what to build when nothing is recognisable', () => {
    const result = interpret('Make me something nice');
    expect(result.status).toBe('needs-clarification');
    expect(result.spec).toBeNull();
    expect(result.clarifications[0]?.severity).toBe('blocking');
  });

  it('asks how to authenticate when a login page has no backend', () => {
    const result = interpret('Create a React website with a login page');
    expect(result.status).toBe('needs-clarification');
    expect(result.clarifications.some((entry) => entry.field === 'applications.web.auth')).toBe(true);
  });

  it('detects conflicting themes', () => {
    const result = interpret('Create a React website with a dark theme and a light theme');
    expect(result.status).toBe('needs-clarification');
    expect(result.contradictions[0]?.fields).toContain('design.theme');
  });

  it('detects conflicting backend frameworks', () => {
    const result = interpret('Create a Node.js API and a FastAPI backend');
    expect(result.status).toBe('needs-clarification');
    expect(result.contradictions.some((entry) => entry.id === 'contradiction-backend-framework')).toBe(true);
  });

  it('asks where data should live when models are requested without a backend', () => {
    const result = interpret('Create a React website that manages a users table');
    expect(result.status).toBe('needs-clarification');
    expect(result.clarifications.some((entry) => entry.id === 'clarify-data-model-backend')).toBe(true);
  });

  it('marks e2e testing as unsupported rather than generating an unrun suite', () => {
    const result = interpret('Create a React dashboard with end-to-end tests');
    expect(result.status).toBe('unsupported');
    expect(result.unsupported.map((entry) => entry.capability)).toContain('testing.e2e');
  });
});

describe('extraction transparency', () => {
  it('reports clauses that were not understood', () => {
    const result = interpret(
      'Create a React dashboard with a login page, a separate FastAPI backend, and make the interactions feel magical',
    );
    expect(result.notes.join(' ')).toContain('did not map to any requirement');
  });
});
