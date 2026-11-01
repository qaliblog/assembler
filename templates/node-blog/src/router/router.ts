/**
 * HTTP router.
 *
 * One responsibility: map (method, canonical path) onto a handler. It does not
 * know about content, HTML or the filesystem, which is what makes it testable on
 * its own.
 *
 * Rules that the route regression tests pin down:
 *  - paths are matched whole, never by prefix, so `/posts` cannot swallow
 *    `/posts/anything`;
 *  - parameterised routes capture exactly one segment and are decoded safely;
 *  - a known path with an unsupported method answers 405 with an Allow header,
 *    never 404;
 *  - the canonical form of a path has a single leading slash, no duplicate
 *    slashes and no trailing slash (except the root);
 *  - two routes that would match the same request cannot be registered.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];

export interface RouteContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  /** Method of the request as received (HEAD is routed as GET, then written header-only). */
  readonly method: HttpMethod;
  readonly pathname: string;
  readonly query: URLSearchParams;
  readonly params: Readonly<Record<string, string>>;
}

export type RouteHandler = (context: RouteContext) => Promise<void> | void;

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly name: string;
  readonly handler: RouteHandler;
}

export interface CompiledRoute extends RouteDefinition {
  readonly regex: RegExp;
  readonly parameterNames: readonly string[];
}

export type RouteMatch =
  | { readonly status: 'matched'; readonly route: CompiledRoute; readonly params: Readonly<Record<string, string>> }
  | { readonly status: 'method-not-allowed'; readonly allowed: readonly HttpMethod[] }
  | { readonly status: 'not-found' }
  | { readonly status: 'bad-request' };

const SEGMENT_ESCAPE = /[.*+?^${}()|[\]\\]/g;
const PARAMETER_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Collapse duplicate slashes and drop a trailing slash, keeping the root intact. */
export function canonicalizePath(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, '/');
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
  return trimmed === '' ? '/' : trimmed;
}

export function isCanonicalPath(pathname: string): boolean {
  return pathname === canonicalizePath(pathname);
}

interface CompiledPath {
  readonly regex: RegExp;
  readonly parameterNames: readonly string[];
}

function compilePath(routePath: string): CompiledPath {
  if (!routePath.startsWith('/')) {
    throw new Error(`Route path must start with "/": ${routePath}`);
  }
  if (!isCanonicalPath(routePath)) {
    throw new Error(`Route path must be canonical (no trailing slash): ${routePath}`);
  }
  if (routePath === '/') return { regex: /^\/$/, parameterNames: [] };

  const parameterNames: string[] = [];
  const pattern = routePath
    .split('/')
    .map((segment, index) => {
      if (index === 0) return '';
      if (segment.startsWith(':')) {
        const name = segment.slice(1);
        if (!PARAMETER_NAME.test(name)) throw new Error(`Invalid route parameter ":${name}" in ${routePath}`);
        parameterNames.push(name);
        return '([^/]+)';
      }
      if (segment === '') throw new Error(`Empty path segment in ${routePath}`);
      return segment.replace(SEGMENT_ESCAPE, '\\$&');
    })
    .join('/');

  return { regex: new RegExp(`^${pattern}$`), parameterNames };
}

function routeSignature(route: RouteDefinition): string {
  return `${route.method} ${route.path}`;
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(definition: RouteDefinition): this {
    const compiled = compilePath(definition.path);
    const duplicate = this.routes.find(
      (route) => route.method === definition.method && route.regex.source === compiled.regex.source,
    );
    if (duplicate !== undefined) {
      // Two patterns that match the same requests would make dispatch depend on
      // registration order for reasons nobody can see. Fail at startup instead.
      throw new Error(
        `Conflicting routes: ${routeSignature(duplicate)} and ${routeSignature(definition)}`,
      );
    }
    this.routes.push({ ...definition, ...compiled });
    return this;
  }

  get(path: string, handler: RouteHandler, name: string = path): this {
    return this.add({ method: 'GET', path, handler, name });
  }

  post(path: string, handler: RouteHandler, name: string = path): this {
    return this.add({ method: 'POST', path, handler, name });
  }

  match(method: HttpMethod, pathname: string): RouteMatch {
    const effective = method === 'HEAD' ? 'GET' : method;
    let pathMatched = false;
    const allowed = new Set<HttpMethod>();

    for (const route of this.routes) {
      const result = route.regex.exec(pathname);
      if (result === null) continue;
      pathMatched = true;
      allowed.add(route.method);
      if (route.method !== effective) continue;

      const params: Record<string, string> = {};
      for (const [index, name] of route.parameterNames.entries()) {
        const raw = result[index + 1];
        if (raw === undefined) continue;
        try {
          params[name] = decodeURIComponent(raw);
        } catch {
          // A malformed percent-escape is a bad request, not a missing page.
          return { status: 'bad-request' };
        }
      }
      return { status: 'matched', route, params };
    }

    if (!pathMatched) return { status: 'not-found' };
    if (allowed.has('GET')) allowed.add('HEAD');
    return {
      status: 'method-not-allowed',
      allowed: HTTP_METHODS.filter((candidate) => allowed.has(candidate)),
    };
  }

  /** Registered routes, in registration order. Used by tests and diagnostics. */
  list(): readonly CompiledRoute[] {
    return [...this.routes];
  }
}
