import { escapeHtml } from '../lib/html.js';
import { renderLayout, type SiteConfig } from './layout.js';

export function renderNotFound(site: SiteConfig, pathname: string): string {
  const body = `<div class="shell shell--narrow">
  <div class="error-page">
    <p class="eyebrow">404</p>
    <h1>Page not found</h1>
    <p class="lede">No page exists at <code>${escapeHtml(pathname)}</code>. The address may have changed, or the link may be incomplete.</p>
    <div class="hero__actions">
      <a class="button" href="/">Go to the home page</a>
      <a class="button button--ghost" href="/posts">Browse all posts</a>
    </div>
    <p class="muted">Looking for something specific? <a href="/search">Search the archive</a>.</p>
  </div>
</div>`;

  return renderLayout(site, {
    title: 'Page not found',
    description: 'The requested page does not exist.',
    path: pathname,
    body,
    active: null,
  });
}

export function renderServerError(site: SiteConfig): string {
  const body = `<div class="shell shell--narrow">
  <div class="error-page">
    <p class="eyebrow">500</p>
    <h1>The page could not be rendered</h1>
    <p class="lede">Something failed on the server. The error has been logged, and no partial page is being sent.</p>
    <div class="hero__actions">
      <a class="button" href="/">Go to the home page</a>
      <a class="button button--ghost" href="/posts">Browse all posts</a>
    </div>
  </div>
</div>`;

  return renderLayout(site, {
    title: 'Server error',
    description: 'The server could not render this page.',
    path: '/',
    body,
    active: null,
  });
}
