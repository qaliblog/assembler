import type { IncomingMessage } from 'node:http';
import type { ContentRepository } from '../services/content.js';
import type { RouteContext, Router } from '../router/router.js';
import type { SiteConfig } from '../views/layout.js';
import { renderArchive, renderSearch } from '../views/archive.js';
import { renderCategories, renderPost } from '../views/post.js';
import { renderHome } from '../views/home.js';
import { renderAbout, renderContact } from '../views/pages.js';
import { renderNotFound } from '../views/errors.js';
import { renderFeed } from '../views/feed.js';
import { siteCss } from '../views/styles.js';
import { faviconSvg } from '../views/favicon.js';
import { sendCss, sendHtml, sendSvg, sendXml } from '../lib/http.js';
import { slugify } from '../lib/slug.js';

export interface PageRouteDependencies {
  readonly site: SiteConfig;
  readonly content: ContentRepository;
  readonly contactEmail: string;
}

function notFound(context: RouteContext, site: SiteConfig): void {
  sendHtml(context.req, context.res, renderNotFound(site, context.pathname), 404);
}

function originFor(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-proto'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const protocol = (first ?? 'http').split(',')[0]?.trim() ?? 'http';
  const host = req.headers.host ?? 'localhost';
  return `${protocol}://${host}`;
}

/**
 * Page routes.
 *
 * Registration order is readability, not precedence: every pattern is matched
 * whole, so `/posts` can never shadow `/posts/:slug`. Controllers decide between
 * 200 and 404 explicitly; no route silently falls through.
 */
export function registerPageRoutes(router: Router, dependencies: PageRouteDependencies): void {
  const { site, content, contactEmail } = dependencies;

  router.get(
    '/',
    (context) => {
      sendHtml(context.req, context.res, renderHome(site, content));
    },
    'home',
  );

  router.get(
    '/posts',
    (context) => {
      sendHtml(
        context.req,
        context.res,
        renderArchive(site, content, {
          eyebrow: 'Archive',
          title: 'All posts',
          intro: 'Every article, newest first. No infinite scroll, no algorithmic ordering.',
          path: '/posts',
          posts: content.all(),
          active: 'posts',
          emptyMessage: 'The archive is empty. Publish the first article to see it here.',
        }),
      );
    },
    'posts',
  );

  router.get(
    '/posts/:slug',
    (context) => {
      const post = content.bySlug(context.params['slug'] ?? '');
      if (post === undefined) {
        notFound(context, site);
        return;
      }
      sendHtml(context.req, context.res, renderPost(site, content, post));
    },
    'post-detail',
  );

  router.get(
    '/categories',
    (context) => {
      sendHtml(context.req, context.res, renderCategories(site, content));
    },
    'categories',
  );

  router.get(
    '/categories/:category',
    (context) => {
      const slug = context.params['category'] ?? '';
      const posts = content.byCategory(slug);
      const first = posts[0];
      if (first === undefined) {
        notFound(context, site);
        return;
      }
      sendHtml(
        context.req,
        context.res,
        renderArchive(site, content, {
          eyebrow: 'Category',
          title: first.category,
          intro: `Every article filed under ${first.category}.`,
          path: `/categories/${slug}`,
          posts,
          active: 'categories',
          emptyMessage: `No articles have been filed under ${first.category} yet.`,
        }),
      );
    },
    'category-detail',
  );

  router.get(
    '/tags/:tag',
    (context) => {
      const slug = context.params['tag'] ?? '';
      const posts = content.byTag(slug);
      const first = posts[0];
      if (first === undefined) {
        notFound(context, site);
        return;
      }
      const name = first.tags.find((tag) => slugify(tag) === slug) ?? slug;
      sendHtml(
        context.req,
        context.res,
        renderArchive(site, content, {
          eyebrow: 'Tag',
          title: `Articles tagged “${name}”`,
          intro: `All articles that carry the ${name} tag.`,
          path: `/tags/${slug}`,
          posts,
          active: null,
          emptyMessage: `No articles carry the ${name} tag yet.`,
        }),
      );
    },
    'tag-detail',
  );

  router.get(
    '/search',
    (context) => {
      const query = context.query.get('q') ?? '';
      sendHtml(
        context.req,
        context.res,
        renderSearch(site, content, { query, posts: content.search(query) }),
      );
    },
    'search',
  );

  router.get(
    '/about',
    (context) => {
      sendHtml(context.req, context.res, renderAbout(site, content, contactEmail));
    },
    'about',
  );

  router.get(
    '/contact',
    (context) => {
      sendHtml(context.req, context.res, renderContact(site, contactEmail));
    },
    'contact',
  );

  router.get(
    '/feed.xml',
    (context) => {
      sendXml(
        context.req,
        context.res,
        renderFeed(content, {
          origin: originFor(context.req),
          title: site.title,
          description: site.description,
        }),
      );
    },
    'feed',
  );

  router.get(
    '/assets/site.css',
    (context) => {
      sendCss(context.req, context.res, siteCss);
    },
    'asset-css',
  );

  router.get(
    '/assets/favicon.svg',
    (context) => {
      sendSvg(context.req, context.res, faviconSvg);
    },
    'asset-favicon',
  );
}
