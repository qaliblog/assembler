import type { ContentRepository } from '../services/content.js';
import { escapeHtml } from '../lib/html.js';
import { postCard, termChips } from './components.js';
import { renderLayout, type SiteConfig } from './layout.js';

export function renderHome(site: SiteConfig, content: ContentRepository): string {
  const featured = content.featured();
  const latest = content.all().filter((post) => post.slug !== featured.slug).slice(0, 6);
  const categories = content.categories();

  const body = `<div class="shell">
  <section class="hero" aria-labelledby="hero-title">
    <p class="eyebrow">Independent publication · Est. 2026</p>
    <h1 id="hero-title">Notes on building software that people can actually use.</h1>
    <p class="hero__lede">${escapeHtml(site.description)}</p>
    <div class="hero__actions">
      <a class="button" href="/posts">Read all posts</a>
      <a class="button button--ghost" href="/about">About the publication</a>
    </div>
  </section>

  <section class="featured" aria-labelledby="featured-title">
    <div class="section-heading">
      <p class="eyebrow">Featured</p>
      <h2 id="featured-title">This week's long read</h2>
    </div>
    ${postCard(featured, { readingMinutes: content.readingMinutes(featured), variant: 'featured' })}
  </section>

  <section class="latest" aria-labelledby="latest-title">
    <div class="section-heading section-heading--row">
      <div>
        <p class="eyebrow">Latest</p>
        <h2 id="latest-title">Fresh from the desk</h2>
      </div>
      <a class="text-link" href="/posts">View the archive</a>
    </div>
    <div class="post-grid">
      ${latest
        .map((post) => postCard(post, { readingMinutes: content.readingMinutes(post) }))
        .join('')}
    </div>
  </section>

  <section class="taxonomy" aria-labelledby="categories-title">
    <div class="section-heading section-heading--row">
      <div>
        <p class="eyebrow">Browse</p>
        <h2 id="categories-title">By category</h2>
      </div>
      <a class="text-link" href="/categories">All categories</a>
    </div>
    ${termChips(categories, '/categories')}
  </section>

  <section class="newsletter" aria-labelledby="newsletter-title">
    <div>
      <h2 id="newsletter-title">Read at your own pace</h2>
      <p>One considered piece at a time. No feed algorithm, no notification badge, no growth loop.</p>
    </div>
    <a class="button" href="/feed.xml">Subscribe by RSS</a>
  </section>
</div>`;

  return renderLayout(site, {
    title: '',
    description: site.description,
    path: '/',
    body,
    active: 'home',
  });
}
