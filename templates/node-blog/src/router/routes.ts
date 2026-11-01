import type { ContentRepository } from '../services/content.js';
import type { SiteConfig } from '../views/layout.js';
import type { Router } from './router.js';
import { registerApiRoutes } from '../routes/api.js';
import { registerPageRoutes } from '../routes/pages.js';

export interface RouteDependencies {
  readonly site: SiteConfig;
  readonly content: ContentRepository;
  readonly contactEmail: string;
}

/**
 * There is exactly one place where routes are registered. If a URL should exist,
 * it is visible here; if it is not here, it returns 404 by design.
 */
export function registerRoutes(router: Router, dependencies: RouteDependencies): void {
  registerPageRoutes(router, dependencies);
  registerApiRoutes(router, { content: dependencies.content });
}
