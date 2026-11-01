/**
 * Application pipeline.
 *
 * request -> security headers -> logging -> URL parse -> canonical redirect ->
 * legacy redirect -> router -> controller -> 404 / 405 / 500.
 *
 * The pipeline is a plain function with injectable content and logger, so the
 * regression tests can start it on an ephemeral port without touching global
 * state.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONTACT_EMAIL, SITE } from './config.js';
import { createContentRepository, type ContentRepository } from './services/content.js';
import { createLogger, type Logger } from './lib/logger.js';
import { redirect, sendHtml, sendText } from './lib/http.js';
import { HTTP_METHODS, Router, canonicalizePath, isCanonicalPath, type HttpMethod, type RouteContext } from './router/router.js';
import { registerRoutes } from './router/routes.js';
import { renderNotFound, renderServerError } from './views/errors.js';
import { applySecurityHeaders } from './middleware/security.js';
import { attachRequestLogging } from './middleware/logging.js';
import { handleRequestError } from './middleware/errors.js';
import type { SiteConfig } from './views/layout.js';

export interface AppOptions {
  readonly site?: SiteConfig;
  readonly content?: ContentRepository;
  readonly contactEmail?: string;
  readonly logger?: Logger;
}

/**
 * Old URL shapes kept alive after the route table was reorganised. Every entry
 * answers with a permanent redirect to a canonical route, so historic links and
 * search results keep working.
 */
export function legacyRedirect(pathname: string): string | null {
  if (pathname === '/blog' || pathname === '/articles') return '/posts';
  if (pathname === '/index.html') return '/';
  if (pathname === '/feed' || pathname === '/rss.xml' || pathname === '/rss') return '/feed.xml';

  const blogPost = /^\/blog\/([^/]+)$/.exec(pathname);
  if (blogPost?.[1] !== undefined) return `/posts/${blogPost[1]}`;

  const oldPost = /^\/post\/([^/]+)$/.exec(pathname);
  if (oldPost?.[1] !== undefined) return `/posts/${oldPost[1]}`;

  const oldCategory = /^\/category\/([^/]+)$/.exec(pathname);
  if (oldCategory?.[1] !== undefined) return `/categories/${oldCategory[1]}`;

  const oldTag = /^\/tag\/([^/]+)$/.exec(pathname);
  if (oldTag?.[1] !== undefined) return `/tags/${oldTag[1]}`;

  return null;
}

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

export function createApp(options: AppOptions = {}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const site = options.site ?? SITE;
  const content = options.content ?? createContentRepository();
  const contactEmail = options.contactEmail ?? CONTACT_EMAIL;
  const logger = options.logger ?? createLogger();

  const router = new Router();
  registerRoutes(router, { site, content, contactEmail });

  return async (req, res) => {
    applySecurityHeaders(res);
    attachRequestLogging(req, res, logger);

    try {
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://localhost');
      } catch {
        sendText(req, res, '400 Bad Request\n', 400);
        return;
      }

      const rawMethod = (req.method ?? 'GET').toUpperCase();
      if (!isHttpMethod(rawMethod)) {
        sendText(req, res, '405 Method Not Allowed\n', 405, { headers: { Allow: 'GET, HEAD' } });
        return;
      }

      const pathname = url.pathname;
      if (!isCanonicalPath(pathname)) {
        redirect(req, res, `${canonicalizePath(pathname)}${url.search}`, 308);
        return;
      }

      const legacy = legacyRedirect(pathname);
      if (legacy !== null) {
        redirect(req, res, `${legacy}${url.search}`, 301);
        return;
      }

      const match = router.match(rawMethod, pathname);
      if (match.status === 'matched') {
        const context: RouteContext = {
          req,
          res,
          method: rawMethod,
          pathname,
          query: url.searchParams,
          params: match.params,
        };
        await match.route.handler(context);
        return;
      }

      if (match.status === 'bad-request') {
        sendText(req, res, '400 Bad Request: malformed URL encoding\n', 400);
        return;
      }

      if (match.status === 'method-not-allowed') {
        const allow = match.allowed.join(', ');
        if (rawMethod === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Allow', allow);
          res.end();
          return;
        }
        sendText(req, res, `405 Method Not Allowed\nAllow: ${allow}\n`, 405, { headers: { Allow: allow } });
        return;
      }

      // Unknown path: a real 404 page, not a redirect to the home page.
      sendHtml(req, res, renderNotFound(site, pathname), 404);
    } catch (error) {
      handleRequestError(error, req, res, logger, () => renderServerError(site));
    }
  };
}
