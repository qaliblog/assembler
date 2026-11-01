import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTS } from '../src/content/posts.js';
import { slugify } from '../src/lib/slug.js';
import { startTestServer, get, type TestServer } from './support.js';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const featured = POSTS.find((post) => post.featured) ?? POSTS[0]!;
const categorySlug = slugify(featured.category);
const tagSlug = slugify(featured.tags[0] ?? 'design');

describe('page routes', () => {
  it('serves the home page with the featured article', async () => {
    const response = await get(server, '/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain(featured.title);
    expect(html).toContain(`href="/posts/${featured.slug}"`);
    expect(html).toContain('<main id="main-content"');
  });

  it('serves the archive with a link to every post', async () => {
    const response = await get(server, '/posts');
    expect(response.status).toBe(200);
    const html = await response.text();
    for (const post of POSTS) {
      expect(html).toContain(`href="/posts/${post.slug}"`);
    }
    expect(html).toContain('All posts');
  });

  it('serves every article detail page', async () => {
    for (const post of POSTS) {
      const response = await get(server, `/posts/${post.slug}`);
      expect(response.status, post.slug).toBe(200);
      const html = await response.text();
      expect(html).toContain(post.title);
      expect(html).toContain(post.author.name);
      expect(html).toContain('/assets/site.css');
    }
  });

  it('returns 404 for an unknown article', async () => {
    const response = await get(server, '/posts/this-post-does-not-exist');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Page not found');
  });

  it('serves the category index and every category', async () => {
    const index = await get(server, '/categories');
    expect(index.status).toBe(200);
    const html = await index.text();
    for (const post of POSTS) {
      expect(html).toContain(`href="/categories/${slugify(post.category)}"`);
    }

    const category = await get(server, `/categories/${categorySlug}`);
    expect(category.status).toBe(200);
    expect(await category.text()).toContain(featured.title);
  });

  it('serves tag pages and 404s unknown tags', async () => {
    const tag = await get(server, `/tags/${tagSlug}`);
    expect(tag.status).toBe(200);
    expect(await tag.text()).toContain('tagged');
    expect((await get(server, '/tags/not-a-tag')).status).toBe(404);
  });

  it('serves about and contact pages', async () => {
    for (const path of ['/about', '/contact']) {
      const response = await get(server, path);
      expect(response.status, path).toBe(200);
      expect(await response.text()).toContain('Skip to content');
    }
  });
});

describe('search', () => {
  it('finds matching articles', async () => {
    const response = await get(server, '/search?q=routing');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('result');
    expect(html).toContain('/posts/routing-without-a-framework');
  });

  it('shows an empty state when nothing matches', async () => {
    const response = await get(server, '/search?q=zzzz-not-a-word');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('No matches');
  });

  it('prompts for a query when none is given', async () => {
    const response = await get(server, '/search');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Search across titles');
  });

  it('escapes the query in the response', async () => {
    const response = await get(server, `/search?q=${encodeURIComponent('<script>alert(1)</script>')}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('json api', () => {
  it('reports health with content counts', async () => {
    const response = await get(server, '/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const payload = (await response.json()) as { status: string; posts: number };
    expect(payload.status).toBe('ok');
    expect(payload.posts).toBe(POSTS.length);
  });

  it('lists every post as a summary', async () => {
    const response = await get(server, '/api/posts');
    const payload = (await response.json()) as { posts: Array<{ slug: string }> };
    expect(payload.posts.map((post) => post.slug).sort()).toEqual(POSTS.map((post) => post.slug).sort());
  });

  it('serves one post and 404s unknown slugs as JSON', async () => {
    const found = await get(server, `/api/posts/${featured.slug}`);
    expect(found.status).toBe(200);
    const payload = (await found.json()) as { post: { slug: string; blocks: unknown[] } };
    expect(payload.post.slug).toBe(featured.slug);
    expect(payload.post.blocks.length).toBeGreaterThan(0);

    const missing = await get(server, '/api/posts/nope');
    expect(missing.status).toBe(404);
    const error = (await missing.json()) as { error: string };
    expect(error.error).toBe('not_found');
  });
});

describe('http semantics', () => {
  it('returns a 404 page for unknown routes', async () => {
    const response = await get(server, '/definitely-not-a-page');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Page not found');
  });

  it('returns 405 with Allow for a known path with the wrong method', async () => {
    const response = await get(server, '/posts', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toContain('GET');
    expect(response.headers.get('allow')).toContain('HEAD');
  });

  it('answers OPTIONS with 204 and Allow', async () => {
    const response = await get(server, '/posts', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('allow')).toContain('GET');
    expect(await response.text()).toBe('');
  });

  it('answers HEAD with the GET headers and no body', async () => {
    const response = await get(server, '/', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toBe('');
  });

  it('redirects non-canonical trailing slashes permanently', async () => {
    const response = await get(server, '/posts/?page=2');
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/posts?page=2');
  });

  it('keeps legacy blog paths working with permanent redirects', async () => {
    const blog = await get(server, '/blog');
    expect(blog.status).toBe(301);
    expect(blog.headers.get('location')).toBe('/posts');

    const post = await get(server, `/blog/${featured.slug}`);
    expect(post.status).toBe(301);
    expect(post.headers.get('location')).toBe(`/posts/${featured.slug}`);

    const category = await get(server, `/category/${categorySlug}`);
    expect(category.status).toBe(301);
    expect(category.headers.get('location')).toBe(`/categories/${categorySlug}`);
  });

  it('rejects malformed url encoding', async () => {
    const response = await get(server, '/posts/%E0%A4%A');
    expect(response.status).toBe(400);
  });

  it('serves static assets with the right content types', async () => {
    const css = await get(server, '/assets/site.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(await css.text()).toContain('--color-primary');

    const icon = await get(server, '/assets/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toContain('image/svg+xml');
  });

  it('serves a valid-looking RSS feed', async () => {
    const response = await get(server, '/feed.xml');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/rss+xml');
    const xml = await response.text();
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml.match(/<item>/g)).toHaveLength(POSTS.length);
  });

  it('applies security headers to every response', async () => {
    const response = await get(server, '/');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
});
