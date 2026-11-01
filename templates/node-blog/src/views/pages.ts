import type { ContentRepository } from '../services/content.js';
import { escapeHtml } from '../lib/html.js';
import { renderLayout, type SiteConfig } from './layout.js';

export function renderAbout(site: SiteConfig, content: ContentRepository, contactEmail: string): string {
  const authors = [...new Map(content.all().map((post) => [post.author.name, post.author])).values()];
  const authorCards = authors
    .map(
      (author) => `<article class="author-card">
  <div class="author-box__avatar" aria-hidden="true">${escapeHtml(author.name.slice(0, 1))}</div>
  <div>
    <h3>${escapeHtml(author.name)}</h3>
    <p class="author-box__role">${escapeHtml(author.role)}</p>
    <p>${escapeHtml(author.bio)}</p>
  </div>
</article>`,
    )
    .join('');

  const body = `<div class="shell shell--narrow">
  <header class="section-intro">
    <p class="eyebrow">About</p>
    <h1>Slow software, carefully written.</h1>
    <p class="lede">${escapeHtml(site.description)}</p>
  </header>

  <div class="prose prose--page">
    <p>${escapeHtml(site.title)} is an independent publication about the craft of building software: interface design, server architecture, documentation and the small decisions that decide whether a product feels considered.</p>
    <h2>What we publish</h2>
    <p>Long-form essays and practical field notes. We prefer one substantial piece to five thin ones, and we revise articles in public rather than publishing corrections quietly.</p>
    <h2>How it is built</h2>
    <p>This site is a server-rendered Node.js application with no runtime dependencies and no third-party scripts. Articles live in version control as typed content, which keeps the archive portable and the page fast.</p>
    <h2>Editorial standards</h2>
    <p>Every claim about a tool or a technique is something we have run ourselves. Code samples are executed before publication. If an article becomes wrong, it is updated with a dated note rather than deleted.</p>
  </div>

  <section class="team" aria-labelledby="team-title">
    <div class="section-heading">
      <p class="eyebrow">The desk</p>
      <h2 id="team-title">Who writes here</h2>
    </div>
    <div class="author-grid">${authorCards}</div>
  </section>

  <p class="back-link"><a href="mailto:${escapeHtml(contactEmail)}">Write to the editors</a> · <a href="/feed.xml">Subscribe by RSS</a></p>
</div>`;

  return renderLayout(site, {
    title: 'About',
    description: `About ${site.title}: what we publish and how it is built.`,
    path: '/about',
    body,
    active: 'about',
  });
}

export function renderContact(site: SiteConfig, contactEmail: string): string {
  const body = `<div class="shell shell--narrow">
  <header class="section-intro">
    <p class="eyebrow">Contact</p>
    <h1>Say something useful.</h1>
    <p class="lede">Corrections, pitches and thoughtful disagreements are all welcome. We read everything and reply to most of it.</p>
  </header>

  <div class="contact-grid">
    <section class="contact-card" aria-labelledby="contact-editorial">
      <h2 id="contact-editorial">Editorial</h2>
      <p>Corrections, pitches and responses to a published piece.</p>
      <a class="button" href="mailto:${escapeHtml(contactEmail)}?subject=Editorial">${escapeHtml(contactEmail)}</a>
    </section>
    <section class="contact-card" aria-labelledby="contact-response">
      <h2 id="contact-response">What to expect</h2>
      <p>We answer within a week. A pitch should say what the piece argues, who it is for and why now. No attachments, please.</p>
      <p class="muted">This generated site has no contact form and no analytics. Change the address in <code>src/config.ts</code> before publishing.</p>
    </section>
  </div>
</div>`;

  return renderLayout(site, {
    title: 'Contact',
    description: `Contact the editors of ${site.title}.`,
    path: '/contact',
    body,
    active: 'contact',
  });
}
