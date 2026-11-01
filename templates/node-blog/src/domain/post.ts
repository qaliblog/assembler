/**
 * Content model.
 *
 * Content is data with a deliberately small vocabulary of blocks. Views render
 * blocks; they never parse Markdown or trust a string as HTML. Adding a block
 * type is a change here, a renderer case and a test — not a string convention.
 */
export type PostBlock =
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'quote'; readonly text: string; readonly attribution?: string }
  | { readonly type: 'code'; readonly language: string; readonly text: string };

export interface Author {
  readonly name: string;
  readonly role: string;
  readonly bio: string;
}

export interface Post {
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly author: Author;
  /** ISO date (YYYY-MM-DD). Rendering formats it, sorting uses the string. */
  readonly publishedAt: string;
  readonly featured: boolean;
  readonly blocks: readonly PostBlock[];
}
