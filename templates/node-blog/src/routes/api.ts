import type { ContentRepository } from '../services/content.js';
import type { Router } from '../router/router.js';
import { sendJson } from '../lib/http.js';

export interface ApiRouteDependencies {
  readonly content: ContentRepository;
}

/**
 * Read-only JSON API.
 *
 * It exposes exactly what the site itself uses, with the same 200/404 contract
 * as the HTML routes. There are no write endpoints, so there is nothing to
 * authenticate and nothing to validate a request body for.
 */
export function registerApiRoutes(router: Router, dependencies: ApiRouteDependencies): void {
  const { content } = dependencies;

  router.get(
    '/api/health',
    (context) => {
      const stats = content.stats();
      sendJson(context.req, context.res, {
        status: 'ok',
        posts: stats.posts,
        categories: stats.categories,
        tags: stats.tags,
      });
    },
    'api-health',
  );

  router.get(
    '/api/posts',
    (context) => {
      sendJson(context.req, context.res, {
        posts: content.all().map((post) => content.summary(post)),
      });
    },
    'api-posts',
  );

  router.get(
    '/api/posts/:slug',
    (context) => {
      const post = content.bySlug(context.params['slug'] ?? '');
      if (post === undefined) {
        sendJson(
          context.req,
          context.res,
          { error: 'not_found', message: 'No post exists with that slug.' },
          404,
        );
        return;
      }
      sendJson(context.req, context.res, {
        post: {
          ...content.summary(post),
          blocks: post.blocks,
        },
      });
    },
    'api-post-detail',
  );
}
