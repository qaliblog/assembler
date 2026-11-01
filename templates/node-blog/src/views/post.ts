import type { Post, PostBlock } from '../domain/post.js';
import type { ContentRepository } from '../services/content.js';
import { escapeHtml } from '../lib/html.js';
import { slugify } from '../lib/slug.js';
import { categoryLink, formatDate, postCard, postMeta, tagLinks } from './components.js';
import { renderLayout, type SiteConfig } from './layout.js';

function renderBlock(block: PostBlock): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'heading':
      return `<h2>${escapeHtml(block.text)}</h2>`;
    case 'quote':
      return `<figure class="pull-quote">
  <blockquote><p>${escapeHtml(block.text)}</p></blockquote>
  ${block.attribution === undefined ? '' : `<figcaption>— ${escapeHtml(block.attribution)}</figcaption>`}
</figure>`;
    case 'code':
      return `<pre class="code-block"><code class="language-${escapeHtml(block.language)}">${escapeHtml(block.text)}</code></pre>`;
    default: {
      const unhandled: never = block;
      throw new Error(`Unhandled content block: ${JSON.stringify(unhandled)}`);
    }
  }
}

export function renderPost(site: SiteConfig, content: ContentRepository, post: Post): string {
  const readingMinutes = content.readingMinutes(post);
  const related = content.related(post, 3);

  const body = `<div class="shell">
  <div class="reading-progress" aria-hidden="true"><span></span></div>
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    <ol>
      <li><a href="/">Home</a></li>
      <li><a href="/posts">Posts</a></li>
      <li><a href="/categories/${escapeHtml(slugify(post.category))}">${escapeHtml(post.category)}</a></li>
      <li aria-current="page">${escapeHtml(post.title)}</li>
    </ol>
  </nav>

  <article class="article">
    <header class="article__header">
      ${categoryLink(post.category, 'category category--large')}
      <h1>${escapeHtml(post.title)}</h1>
      <p class="article__excerpt">${escapeHtml(post.excerpt)}</p>
      ${postMeta(post, readingMinutes)}
    </header>

    <div class="article__body prose">
      ${post.blocks.map(renderBlock).join('\n      ')}
    </div>

    <footer class="article__footer">
      ${tagLinks(post.tags)}
      <aside class="author-box" aria-label="About the author">
        <div class="author-box__avatar" aria-hidden="true">${escapeHtml(post.author.name.slice(0, 1))}</div>
        <div>
          <p class="author-box__name">${escapeHtml(post.author.name)}</p>
          <p class="author-box__role">${escapeHtml(post.author.role)}</p>
          <p>${escapeHtml(post.author.bio)}</p>
        </div>
      </aside>
    </footer>
  </article>

  ${
    related.length === 0
      ? ''
      : `<section class="related" aria-labelledby="related-title">
    <div class="section-heading section-heading--row">
      <div>
        <p class="eyebrow">Keep reading</p>
        <h2 id="related-title">Related articles</h2>
      </div>
      <a class="text-link" href="/posts">All posts</a>
    </div>
    <div class="post-grid">
      ${related.map((entry) => postCard(entry, { readingMinutes: content.readingMinutes(entry) })).join('')}
    </div>
  </section>`
  }

  <p class="back-link"><a href="/posts">← Back to all posts</a></p>
</div>`;

  return renderLayout(site, {
    title: post.title,
    description: post.excerpt,
    path: `/posts/${post.slug}`,
    body,
    active: 'posts',
    bodyClass: 'page-article',
  });
}

export function renderCategories(
  site: SiteConfig,
  content: ContentRepository,
): string {
  const categories = content.categories();
  const items = categories
    .map((category) => {
      const posts = content.byCategory(category.slug);
      return `<article class="category-card">
  <h2><a href="/categories/${escapeHtml(category.slug)}">${escapeHtml(category.name)}</a></h2>
  <p>${category.count} ${category.count === 1 ? 'article' : 'articles'}</p>
  <p class="category-card__latest">Latest: ${escapeHtml(posts[0]?.title ?? '')} · ${escapeHtml(
    formatDate(posts[0]?.publishedAt ?? ''),
  )}</p>
</article>`;
    })
    .join('');

  const body = `<div class="shell">
  <header class="section-intro">
    <p class="eyebrow">Browse</p>
    <h1>Categories</h1>
    <p class="lede">Every article belongs to one category. Tags cut across them.</p>
  </header>
  <div class="category-grid">${items}</div>
</div>`;

  return renderLayout(site, {
    title: 'Categories',
    description: 'Browse articles by category.',
    path: '/categories',
    body,
    active: 'categories',
  });
}
