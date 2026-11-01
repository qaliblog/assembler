import type { Post } from '../domain/post.js';
import type { TermSummary } from '../services/content.js';
import { classes, escapeHtml } from '../lib/html.js';
import { slugify } from '../lib/slug.js';

/** Date only. UTC is pinned so the rendered page does not depend on the server. */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function categoryLink(category: string, className = 'category'): string {
  return `<a class="${escapeHtml(className)}" href="/categories/${escapeHtml(slugify(category))}">${escapeHtml(category)}</a>`;
}

export function tagLinks(tags: readonly string[]): string {
  if (tags.length === 0) return '';
  const items = tags
    .map(
      (tag) =>
        `<li><a class="tag" href="/tags/${escapeHtml(slugify(tag))}" rel="tag">${escapeHtml(tag)}</a></li>`,
    )
    .join('');
  return `<ul class="tag-list" aria-label="Tags">${items}</ul>`;
}

export function termChips(terms: readonly TermSummary[], basePath: string): string {
  if (terms.length === 0) return '';
  const items = terms
    .map(
      (term) =>
        `<li><a class="chip" href="${escapeHtml(basePath)}/${escapeHtml(term.slug)}">${escapeHtml(term.name)}<span class="chip-count">${term.count}</span></a></li>`,
    )
    .join('');
  return `<ul class="chip-list" aria-label="Browse by term">${items}</ul>`;
}

export interface PostCardOptions {
  readonly readingMinutes: number;
  readonly variant?: 'default' | 'featured' | 'compact';
}

export function postCard(post: Post, options: PostCardOptions): string {
  const variant = options.variant ?? 'default';
  const headingLevel = variant === 'featured' ? 'h2' : 'h3';
  return `<article class="${classes('post-card', `post-card--${variant}`)}">
  <div class="post-card__meta">
    ${categoryLink(post.category)}
    <span aria-hidden="true">·</span>
    <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(formatDate(post.publishedAt))}</time>
  </div>
  <${headingLevel} class="post-card__title">
    <a href="/posts/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a>
  </${headingLevel}>
  <p class="post-card__excerpt">${escapeHtml(post.excerpt)}</p>
  <p class="post-card__byline">
    By ${escapeHtml(post.author.name)}
    <span aria-hidden="true">·</span>
    <span>${options.readingMinutes} min read</span>
  </p>
</article>`;
}

export function postMeta(post: Post, readingMinutes: number): string {
  return `<p class="post-meta">
  <span>By <strong>${escapeHtml(post.author.name)}</strong></span>
  <span aria-hidden="true">·</span>
  <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(formatDate(post.publishedAt))}</time>
  <span aria-hidden="true">·</span>
  <span>${readingMinutes} min read</span>
</p>`;
}

export function sectionIntro(eyebrow: string, title: string, intro: string): string {
  return `<header class="section-intro">
  <p class="eyebrow">${escapeHtml(eyebrow)}</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">${escapeHtml(intro)}</p>
</header>`;
}

export function emptyState(title: string, body: string, action?: { readonly label: string; readonly href: string }): string {
  return `<div class="empty-state">
  <h2>${escapeHtml(title)}</h2>
  <p>${escapeHtml(body)}</p>
  ${action === undefined ? '' : `<a class="button" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`}
</div>`;
}
