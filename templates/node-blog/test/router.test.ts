import { describe, expect, it } from 'vitest';
import { Router, canonicalizePath, isCanonicalPath } from '../src/router/router.js';

const noop = (): void => undefined;

function routerWithRoutes(): Router {
  return new Router()
    .get('/', noop)
    .get('/posts', noop)
    .get('/posts/:slug', noop)
    .get('/categories', noop)
    .get('/categories/:category', noop)
    .post('/posts', noop);
}

describe('canonical paths', () => {
  it('collapses duplicate slashes and removes a trailing slash', () => {
    expect(canonicalizePath('/posts/')).toBe('/posts');
    expect(canonicalizePath('//posts///')).toBe('/posts');
    expect(canonicalizePath('/a//b/')).toBe('/a/b');
    expect(canonicalizePath('')).toBe('/');
  });

  it('keeps the root intact', () => {
    expect(canonicalizePath('/')).toBe('/');
    expect(isCanonicalPath('/')).toBe(true);
  });

  it('reports non-canonical paths', () => {
    expect(isCanonicalPath('/posts/')).toBe(false);
    expect(isCanonicalPath('/posts')).toBe(true);
  });
});

describe('matching', () => {
  it('matches a static route exactly and does not prefix-match', () => {
    const router = routerWithRoutes();
    const match = router.match('GET', '/posts');
    expect(match.status).toBe('matched');
    if (match.status !== 'matched') return;
    expect(match.route.name).toBe('/posts');
    expect(router.match('GET', '/posts-archive').status).toBe('not-found');
  });

  it('captures one segment per parameter and decodes it', () => {
    const router = routerWithRoutes();
    const match = router.match('GET', '/posts/hello%20world');
    expect(match.status).toBe('matched');
    if (match.status !== 'matched') return;
    expect(match.route.name).toBe('/posts/:slug');
    expect(match.params['slug']).toBe('hello world');
  });

  it('does not let a parameter cross a slash', () => {
    expect(routerWithRoutes().match('GET', '/posts/one/two').status).toBe('not-found');
  });

  it('answers method-not-allowed with the allowed methods', () => {
    const match = routerWithRoutes().match('PUT', '/posts');
    expect(match.status).toBe('method-not-allowed');
    if (match.status !== 'method-not-allowed') return;
    expect(match.allowed).toEqual(['GET', 'HEAD', 'POST']);
  });

  it('routes HEAD to the GET handler', () => {
    const match = routerWithRoutes().match('HEAD', '/posts');
    expect(match.status).toBe('matched');
    if (match.status !== 'matched') return;
    expect(match.route.method).toBe('GET');
  });

  it('reports malformed percent-encoding as a bad request', () => {
    expect(routerWithRoutes().match('GET', '/posts/%E0%A4%A').status).toBe('bad-request');
  });
});

describe('registration safety', () => {
  it('rejects an exact duplicate route', () => {
    const router = new Router().get('/posts', noop);
    expect(() => router.get('/posts', noop)).toThrow(/Conflicting routes/);
  });

  it('rejects two parameter names that match the same requests', () => {
    const router = new Router().get('/posts/:slug', noop);
    expect(() => router.get('/posts/:id', noop)).toThrow(/Conflicting routes/);
  });

  it('allows the same path with a different method', () => {
    const router = new Router().get('/posts', noop);
    expect(() => router.post('/posts', noop)).not.toThrow();
  });

  it('rejects non-canonical or relative patterns', () => {
    const router = new Router();
    expect(() => router.get('posts', noop)).toThrow(/must start with/);
    expect(() => router.get('/posts/', noop)).toThrow(/must be canonical/);
  });
});
