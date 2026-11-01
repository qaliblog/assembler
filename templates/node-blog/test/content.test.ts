import { describe, expect, it } from 'vitest';
import { POSTS } from '../src/content/posts.js';
import { ContentRepository } from '../src/services/content.js';
import { slugify } from '../src/lib/slug.js';

const repository = new ContentRepository(POSTS);

describe('content repository', () => {
  it('sorts posts newest first and rejects empty or duplicate content', () => {
    const dates = repository.all().map((post) => post.publishedAt);
    expect([...dates].sort().reverse()).toEqual(dates);

    expect(() => new ContentRepository([])).toThrow(/at least one post/);
    expect(() => new ContentRepository([POSTS[0]!, POSTS[0]!])).toThrow(/Duplicate post slug/);
  });

  it('has exactly one featured post', () => {
    expect(repository.all().filter((post) => post.featured)).toHaveLength(1);
    expect(repository.featured().featured).toBe(true);
  });

  it('finds posts by slug', () => {
    const post = repository.all()[0]!;
    expect(repository.bySlug(post.slug)?.title).toBe(post.title);
    expect(repository.bySlug('no-such-post')).toBeUndefined();
  });

  it('builds category and tag listings with counts', () => {
    const categories = repository.categories();
    expect(categories.length).toBeGreaterThan(1);
    const total = categories.reduce((sum, category) => sum + category.count, 0);
    expect(total).toBe(repository.all().length);

    const tags = repository.tags();
    expect(tags.every((tag) => tag.slug === slugify(tag.name))).toBe(true);
    expect(tags.every((tag) => tag.count >= 1)).toBe(true);
  });

  it('searches titles, text and tags case-insensitively', () => {
    const byTitle = repository.search('ROUTING');
    expect(byTitle.length).toBeGreaterThan(0);
    expect(byTitle.every((post) => JSON.stringify(post).toLowerCase().includes('routing'))).toBe(true);
    expect(repository.search('   ')).toEqual([]);
    expect(repository.search('zzzz-not-a-word')).toEqual([]);
  });

  it('suggests related posts without repeating the current one', () => {
    const post = repository.featured();
    const related = repository.related(post, 3);
    expect(related).toHaveLength(3);
    expect(related.some((entry) => entry.slug === post.slug)).toBe(false);
  });

  it('estimates reading time deterministically', () => {
    for (const post of repository.all()) {
      const minutes = repository.readingMinutes(post);
      expect(Number.isInteger(minutes)).toBe(true);
      expect(minutes).toBeGreaterThanOrEqual(1);
    }
  });

  it('summarises the archive for the API', () => {
    const stats = repository.stats();
    expect(stats.posts).toBe(POSTS.length);
    const summary = repository.summary(POSTS[0]!);
    expect(summary.slug).toBe(POSTS[0]!.slug);
    expect(summary.readingMinutes).toBeGreaterThanOrEqual(1);
  });
});
