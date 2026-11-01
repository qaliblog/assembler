import { escapeAttribute, escapeHtml } from '../lib/html.js';

export type NavigationSection = 'home' | 'posts' | 'categories' | 'about' | 'contact' | null;

export interface LayoutInput {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly body: string;
  readonly active: NavigationSection;
  readonly bodyClass?: string;
}

export interface SiteConfig {
  readonly title: string;
  readonly tagline: string;
  readonly description: string;
}

/**
 * The shell every page shares. It owns the document head, the skip link, the
 * header, the footer and nothing else; page structure stays in its own view.
 */
export function renderLayout(site: SiteConfig, input: LayoutInput): string {
  const pageTitle = input.title === '' ? site.title : `${input.title} — ${site.title}`;
  const nav = (label: string, href: string, section: Exclude<NavigationSection, null>): string =>
    `<li><a href="${href}"${input.active === section ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a></li>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeAttribute(input.description)}">
  <meta name="theme-color" content="#080b18">
  <meta property="og:site_name" content="${escapeAttribute(site.title)}">
  <meta property="og:title" content="${escapeAttribute(pageTitle)}">
  <meta property="og:description" content="${escapeAttribute(input.description)}">
  <meta property="og:type" content="${input.active === 'posts' ? 'article' : 'website'}">
  <link rel="canonical" href="${escapeAttribute(input.path)}">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/site.css">
  <link rel="alternate" type="application/rss+xml" title="${escapeAttribute(site.title)}" href="/feed.xml">
</head>
<body class="${escapeAttribute(input.bodyClass ?? '')}">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header">
    <div class="shell site-header__inner">
      <a class="wordmark" href="/" aria-label="${escapeAttribute(site.title)} — home">
        <span class="wordmark__mark" aria-hidden="true">A</span>
        <span class="wordmark__text">${escapeHtml(site.title)}</span>
      </a>
      <nav class="site-nav" aria-label="Primary">
        <ul>
          ${nav('Home', '/', 'home')}
          ${nav('Posts', '/posts', 'posts')}
          ${nav('Categories', '/categories', 'categories')}
          ${nav('About', '/about', 'about')}
          ${nav('Contact', '/contact', 'contact')}
        </ul>
      </nav>
      <form class="header-search" action="/search" method="get" role="search">
        <label class="visually-hidden" for="header-search-input">Search articles</label>
        <input id="header-search-input" type="search" name="q" placeholder="Search" autocomplete="off">
        <button type="submit">Search</button>
      </form>
    </div>
  </header>
  <main id="main-content" class="site-main">
${input.body}
  </main>
  <footer class="site-footer">
    <div class="shell site-footer__inner">
      <div>
        <p class="site-footer__brand">${escapeHtml(site.title)}</p>
        <p class="site-footer__note">${escapeHtml(site.tagline)}</p>
      </div>
      <nav aria-label="Footer">
        <ul class="footer-links">
          <li><a href="/posts">All posts</a></li>
          <li><a href="/categories">Categories</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
          <li><a href="/feed.xml">RSS</a></li>
        </ul>
      </nav>
      <p class="site-footer__colophon">Served by Node.js. No trackers, no third-party scripts.</p>
    </div>
  </footer>
</body>
</html>
`;
}
