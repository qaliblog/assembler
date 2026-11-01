import type { Post } from '../domain/post.js';
import type { ContentRepository } from '../services/content.js';
import { escapeHtml } from '../lib/html.js';
import { emptyState, postCard, sectionIntro, termChips } from './components.js';
import { renderLayout, type NavigationSection, type SiteConfig } from './layout.js';

export interface ArchiveInput {
  readonly eyebrow: string;
  readonly title: string;
  readonly intro: string;
  readonly path: string;
  readonly posts: readonly Post[];
  readonly active: NavigationSection;
  /** Shown when the archive is empty and there is no search query. */
  readonly emptyMessage: string;
  readonly searchQuery?: string;
}

export interface SearchInput {
  readonly query: string;
  readonly posts: readonly Post[];
}

function grid(posts: readonly Post[], content: ContentRepository): string {
  return `<div class="post-grid">
    ${posts.map((post) => postCard(post, { readingMinutes: content.readingMinutes(post) })).join('')}
  </div>`;
}

export function renderArchive(
  site: SiteConfig,
  content: ContentRepository,
  input: ArchiveInput,
): string {
  const count = input.posts.length;
  const list =
    count === 0
      ? emptyState(
          'Nothing here yet',
          input.emptyMessage,
          { label: 'Browse all posts', href: '/posts' },
        )
      : grid(input.posts, content);

  const body = `<div class="shell">
  ${sectionIntro(input.eyebrow, input.title, input.intro)}
  <p class="result-count" role="status">${count} ${count === 1 ? 'article' : 'articles'}</p>
  ${list}
  <section class="taxonomy" aria-labelledby="archive-categories">
    <div class="section-heading section-heading--row">
      <div>
        <p class="eyebrow">Keep exploring</p>
        <h2 id="archive-categories">Categories</h2>
      </div>
      <a class="text-link" href="/categories">All categories</a>
    </div>
    ${termChips(content.categories(), '/categories')}
  </section>
</div>`;

  return renderLayout(site, {
    title: input.title,
    description: input.intro,
    path: input.path,
    body,
    active: input.active,
  });
}

export function renderSearch(site: SiteConfig, content: ContentRepository, input: SearchInput): string {
  const trimmed = input.query.trim();
  const hasQuery = trimmed !== '';
  const count = input.posts.length;
  const escapedQuery = escapeHtml(trimmed);

  const results = hasQuery
    ? count === 0
      ? emptyState(
          'No matches',
          `Nothing matched “${trimmed}”. Try a broader term, or browse the archive.`,
          { label: 'Browse all posts', href: '/posts' },
        )
      : grid(input.posts, content)
    : `<div class="search-prompt">
        <p class="lede">Search across titles, excerpts, categories, tags and article text.</p>
        ${termChips(content.tags(), '/tags')}
      </div>`;

  const body = `<div class="shell">
  <header class="section-intro">
    <p class="eyebrow">Search</p>
    <h1>Find an article</h1>
    <form class="search-form" action="/search" method="get" role="search">
      <label for="search-page-input">Search the archive</label>
      <div class="search-form__row">
        <input id="search-page-input" type="search" name="q" value="${escapedQuery}" autocomplete="off" autofocus>
        <button class="button" type="submit">Search</button>
      </div>
    </form>
  </header>
  ${
    hasQuery
      ? `<p class="result-count" role="status">${count} ${count === 1 ? 'result' : 'results'} for “${escapedQuery}”</p>`
      : ''
  }
  ${results}
</div>`;

  return renderLayout(site, {
    title: hasQuery ? `Search: ${trimmed}` : 'Search',
    description: 'Search every article in the publication.',
    path: hasQuery ? `/search?q=${encodeURIComponent(trimmed)}` : '/search',
    body,
    active: null,
  });
}
