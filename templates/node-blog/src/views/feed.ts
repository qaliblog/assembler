import type { ContentRepository } from '../services/content.js';
import { escapeXml } from '../lib/html.js';

export interface FeedInput {
  readonly origin: string;
  readonly title: string;
  readonly description: string;
}

function rfc822(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
}

/** RSS 2.0. Links are absolute because feed readers have no page context. */
export function renderFeed(content: ContentRepository, input: FeedInput): string {
  const origin = input.origin.replace(/\/+$/, '');
  const items = content
    .all()
    .map(
      (post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(`${origin}/posts/${post.slug}`)}</link>
      <guid isPermaLink="true">${escapeXml(`${origin}/posts/${post.slug}`)}</guid>
      <pubDate>${rfc822(post.publishedAt)}</pubDate>
      <category>${escapeXml(post.category)}</category>
      <description>${escapeXml(post.excerpt)}</description>
    </item>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(input.title)}</title>
    <link>${escapeXml(origin)}/</link>
    <description>${escapeXml(input.description)}</description>
    <language>en</language>
    <lastBuildDate>${rfc822(content.all()[0]?.publishedAt ?? '1970-01-01')}</lastBuildDate>
    <atom:link href="${escapeXml(`${origin}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}
