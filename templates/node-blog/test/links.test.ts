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

const first = POSTS[0]!;

/** Every page a reader can reach from the navigation. */
const PAGES = [
  '/',
  '/posts',
  `/posts/${first.slug}`,
  '/categories',
  `/categories/${slugify(first.category)}`,
  `/tags/${slugify(first.tags[0] ?? 'design')}`,
  '/search?q=design',
  '/search',
  '/about',
  '/contact',
];

function internalLinks(html: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/\shref="([^"]+)"/g)) {
    const href = match[1];
    if (href === undefined) continue;
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    links.add(href);
  }
  return [...links].sort();
}

describe('internal navigation', () => {
  it('renders links on every page and they all resolve', async () => {
    const seen = new Set<string>();

    for (const page of PAGES) {
      const response = await get(server, page);
      expect(response.status, page).toBe(200);
      const html = await response.text();
      const links = internalLinks(html);
      expect(links.length, `${page} should contain navigation links`).toBeGreaterThan(5);
      for (const link of links) seen.add(link);
    }

    expect(seen.size).toBeGreaterThan(10);

    for (const link of [...seen].sort()) {
      const response = await get(server, link);
      // Legacy redirects are allowed as long as the destination resolves.
      const final =
        response.status >= 300 && response.status < 400
          ? await fetch(`${server.baseUrl}${link}`, { redirect: 'follow' })
          : response;
      expect(final.status, `link ${link}`).toBe(200);
    }
  });

  it('links to every post and category from the archive', async () => {
    const response = await get(server, '/posts');
    const html = await response.text();
    for (const post of POSTS) {
      expect(html).toContain(`href="/posts/${post.slug}"`);
    }

    const categories = await get(server, '/categories');
    const categoryHtml = await categories.text();
    for (const category of new Set(POSTS.map((post) => post.category))) {
      expect(categoryHtml).toContain(`href="/categories/${slugify(category)}"`);
    }
  });

  it('never emits an empty or undefined link', async () => {
    for (const page of PAGES) {
      const html = await (await get(server, page)).text();
      expect(html).not.toContain('href=""');
      expect(html).not.toContain('href="undefined"');
      expect(html).not.toContain('/undefined');
    }
  });
});
