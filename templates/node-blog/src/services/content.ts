/**
 * Content access.
 *
 * A repository over an immutable list of posts. Everything is computed in
 * memory: no filesystem reads at request time, no cache to invalidate, and the
 * same output for the same input.
 */
import type { Post } from '../domain/post.js';
import { POSTS } from '../content/posts.js';
import { slugify } from '../lib/slug.js';

export interface PostSummary {
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly author: string;
  readonly publishedAt: string;
  readonly readingMinutes: number;
}

export interface TermSummary {
  /** Display name, e.g. "Design". */
  readonly name: string;
  /** URL slug, e.g. "design". */
  readonly slug: string;
  readonly count: number;
}

export interface ContentStats {
  readonly posts: number;
  readonly categories: number;
  readonly tags: number;
}

function comparePosts(a: Post, b: Post): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function words(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches === null ? 0 : matches.length;
}

export class ContentRepository {
  private readonly posts: readonly Post[];
  private readonly bySlugIndex: ReadonlyMap<string, Post>;

  constructor(posts: readonly Post[]) {
    if (posts.length === 0) {
      throw new Error('ContentRepository requires at least one post');
    }
    const seen = new Set<string>();
    for (const post of posts) {
      if (seen.has(post.slug)) throw new Error(`Duplicate post slug: ${post.slug}`);
      seen.add(post.slug);
    }
    this.posts = [...posts].sort(comparePosts);
    this.bySlugIndex = new Map(this.posts.map((post) => [post.slug, post]));
  }

  all(): readonly Post[] {
    return this.posts;
  }

  featured(): Post {
    const featured = this.posts.find((post) => post.featured);
    // The constructor guarantees at least one post, so the fallback is total.
    return featured ?? (this.posts[0] as Post);
  }

  bySlug(slug: string): Post | undefined {
    return this.bySlugIndex.get(slug);
  }

  byCategory(slug: string): readonly Post[] {
    return this.posts.filter((post) => slugify(post.category) === slug);
  }

  byTag(tag: string): readonly Post[] {
    return this.posts.filter((post) => post.tags.some((entry) => slugify(entry) === tag));
  }

  categories(): readonly TermSummary[] {
    return this.terms((post) => [post.category]);
  }

  tags(): readonly TermSummary[] {
    return this.terms((post) => post.tags);
  }

  search(query: string): readonly Post[] {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];
    return this.posts.filter((post) => {
      const haystack = [
        post.title,
        post.excerpt,
        post.category,
        post.author.name,
        ...post.tags,
        ...post.blocks.map((block) => block.text),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  related(post: Post, limit = 3): readonly Post[] {
    const postTags = new Set(post.tags.map((tag) => slugify(tag)));
    const scored = this.posts
      .filter((candidate) => candidate.slug !== post.slug)
      .map((candidate) => {
        const sharedTags = candidate.tags.filter((tag) => postTags.has(slugify(tag))).length;
        const sameCategory = candidate.category === post.category ? 1 : 0;
        return { candidate, score: sameCategory * 2 + sharedTags };
      })
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : comparePosts(a.candidate, b.candidate)));
    return scored.slice(0, limit).map((entry) => entry.candidate);
  }

  readingMinutes(post: Post): number {
    const total = post.blocks.reduce((sum, block) => sum + words(block.text), 0);
    return Math.max(1, Math.round(total / 200));
  }

  summary(post: Post): PostSummary {
    return {
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      category: post.category,
      tags: post.tags,
      author: post.author.name,
      publishedAt: post.publishedAt,
      readingMinutes: this.readingMinutes(post),
    };
  }

  stats(): ContentStats {
    return {
      posts: this.posts.length,
      categories: this.categories().length,
      tags: this.tags().length,
    };
  }

  private terms(select: (post: Post) => readonly string[]): readonly TermSummary[] {
    const counts = new Map<string, TermSummary>();
    for (const post of this.posts) {
      for (const name of select(post)) {
        const slug = slugify(name);
        if (slug === '') continue;
        const existing = counts.get(slug);
        counts.set(slug, {
          name: existing?.name ?? name,
          slug,
          count: (existing?.count ?? 0) + 1,
        });
      }
    }
    return [...counts.values()].sort((a, b) => (a.count !== b.count ? b.count - a.count : a.name.localeCompare(b.name)));
  }
}

export function createContentRepository(): ContentRepository {
  return new ContentRepository(POSTS);
}
