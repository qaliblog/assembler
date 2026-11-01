import type { Author, Post } from '../domain/post.js';

/**
 * Editorial content for the generated publication.
 *
 * The repository is plain TypeScript on purpose: content is typed, reviewed in
 * version control and needs no database to start. Replace the entries below, or
 * move them behind the ContentRepository interface, without touching routing.
 */
const MIRA: Author = {
  name: 'Mira Ellison',
  role: 'Editor in chief',
  bio: 'Mira writes about typography, restraint and the long life of a good page. She edited print magazines before moving to the web.',
};

const TOBIAS: Author = {
  name: 'Tobias Fenn',
  role: 'Engineering lead',
  bio: 'Tobias builds small servers and large content systems. He cares about routing that can be explained on a whiteboard.',
};

const PRIYA: Author = {
  name: 'Priya Raman',
  role: 'Design director',
  bio: 'Priya works on editorial layout, interaction detail and the everyday accessibility of reading on a screen.',
};

export const POSTS: readonly Post[] = [
  {
    slug: 'designing-a-quiet-design-system',
    title: 'Designing a quiet design system',
    excerpt:
      'A design system earns its keep by disappearing. Notes on typography, spacing and the discipline of removing one more ornament.',
    category: 'Design',
    tags: ['design-systems', 'typography', 'craft'],
    author: MIRA,
    publishedAt: '2026-10-18',
    featured: true,
    blocks: [
      {
        type: 'paragraph',
        text: 'The best design system I have used was almost invisible. It gave us a type scale, three spacing steps and one accent colour, then got out of the way. Nobody praised it. Everybody shipped faster.',
      },
      {
        type: 'heading',
        text: 'Start with the reading column',
      },
      {
        type: 'paragraph',
        text: 'Most interface decisions become obvious once the reading column is fixed. A measure between 62 and 72 characters keeps long prose comfortable without turning the page into a corridor. Headings can then step outside the column deliberately, instead of accidentally.',
      },
      {
        type: 'quote',
        text: 'A system is not the set of things you added. It is the set of things you agreed not to add.',
        attribution: 'Internal design review, 2024',
      },
      {
        type: 'paragraph',
        text: 'Spacing is the cheapest signal of quality. Pick a base unit, use it everywhere, and allow exactly one exception for optical alignment. When two margins disagree by four pixels, the reader cannot name the problem, but they feel it.',
      },
      {
        type: 'heading',
        text: 'Ornament has a budget',
      },
      {
        type: 'paragraph',
        text: 'Gradients, shadows, blurs and borders all compete for the same attention. Give each component one expressive move and let everything else stay plain. A card with a strong border does not also need a heavy shadow. A hero does not need three competing typefaces.',
      },
      {
        type: 'code',
        language: 'css',
        text: '.card {\n  border: 1px solid var(--color-border);\n  border-radius: var(--radius-md);\n  background: var(--color-surface);\n}',
      },
      {
        type: 'paragraph',
        text: 'The test is not whether a screen looks impressive in isolation. It is whether a reader can move from the home page to an article, to a related article, without noticing the machinery. Quiet is a feature.',
      },
    ],
  },
  {
    slug: 'routing-without-a-framework',
    title: 'Routing without a framework',
    excerpt:
      'A short, correct router is a few hundred lines. Here is the shape we use: a canonical path, a route table and an explicit answer for every unknown URL.',
    category: 'Engineering',
    tags: ['node-js', 'routing', 'architecture'],
    author: TOBIAS,
    publishedAt: '2026-10-09',
    featured: false,
    blocks: [
      {
        type: 'paragraph',
        text: 'Routing failures rarely come from missing features. They come from ambiguity: two patterns that match the same request, a trailing slash that silently changes the match, a known path answering 404 because the method was not handled.',
      },
      {
        type: 'heading',
        text: 'Canonicalise before matching',
      },
      {
        type: 'paragraph',
        text: 'Decide what a path looks like before you compare it to anything. We collapse duplicate slashes, remove a trailing slash and redirect the non-canonical form with a permanent status. The router then only ever sees one spelling of a URL.',
      },
      {
        type: 'code',
        language: 'ts',
        text: 'const canonical = pathname\n  .replace(/\\/{2,}/g, "/")\n  .replace(/(.)\\/$/, "$1");',
      },
      {
        type: 'heading',
        text: 'A table, not a chain of conditions',
      },
      {
        type: 'paragraph',
        text: 'Register routes in one place and let the router own matching. Static segments are compared literally; parameterised segments capture exactly one segment. Register the specific routes first so `/posts/new` never becomes a post with the slug `new`.',
      },
      {
        type: 'paragraph',
        text: 'When the path exists but the method does not, answer 405 with an Allow header. A 404 tells the client the resource is gone, which is a different and much more expensive lie.',
      },
      {
        type: 'quote',
        text: 'Every route needs three answers: success, not found, and wrong method. Most broken blogs are missing the third.',
      },
      {
        type: 'paragraph',
        text: 'Finally, test links, not just routes. A route suite can pass while the navigation points at `/post/slug` and the router only knows `/posts/:slug`. Crawl the rendered pages and fetch every internal href.',
      },
    ],
  },
  {
    slug: 'the-editorial-grid-revisited',
    title: 'The editorial grid, revisited',
    excerpt:
      'Print grids assumed a fixed page. The web does not. A practical look at asymmetric layouts that survive a narrow screen.',
    category: 'Design',
    tags: ['layout', 'typography'],
    author: PRIYA,
    publishedAt: '2026-09-27',
    featured: false,
    blocks: [
      {
        type: 'paragraph',
        text: 'An editorial grid is a promise about rhythm. The reader should feel where a section begins before reading its heading. On the web we can keep the rhythm without pretending the page has a fixed width.',
      },
      {
        type: 'heading',
        text: 'One column for reading, two for context',
      },
      {
        type: 'paragraph',
        text: 'Articles read best in a single column. Supporting material — a pull quote, a note on the author, a related piece — can sit beside it when there is room and move below it when there is not. The reading column never changes width mid-article.',
      },
      {
        type: 'heading',
        text: 'Break the grid on purpose',
      },
      {
        type: 'paragraph',
        text: 'A featured story can start at the edge of the page and cross the reading column. That only reads as intentional if it happens once per screen. If every card is offset, the grid is merely broken.',
      },
      {
        type: 'quote',
        text: 'Asymmetry is a accent, not a layout.',
      },
      {
        type: 'paragraph',
        text: 'Narrow screens are not a degraded version of the page. They are the primary reading experience for most people. Test the grid at 360 pixels first, then widen it until the extra space earns its place.',
      },
    ],
  },
  {
    slug: 'measure-what-the-reader-feels',
    title: 'Measure what the reader feels',
    excerpt:
      'Page views are easy to count and easy to misread. A small set of reader-centred measures that survived contact with reality.',
    category: 'Product',
    tags: ['metrics', 'product'],
    author: MIRA,
    publishedAt: '2026-09-11',
    featured: false,
    blocks: [
      {
        type: 'paragraph',
        text: 'Every publication has a dashboard. Most of them answer a question nobody asked: how many people arrived, not whether they found what they came for. A useful metric changes a decision.',
      },
      {
        type: 'heading',
        text: 'Three numbers worth keeping',
      },
      {
        type: 'paragraph',
        text: 'First, the share of sessions that reach an article from the home or archive pages. Second, the share of article sessions that reach a second article. Third, the number of search queries that return nothing. All three describe the reader, not the traffic.',
      },
      {
        type: 'quote',
        text: 'If a number never changes what you publish, it is decoration.',
      },
      {
        type: 'paragraph',
        text: 'None of this requires tracking individuals. Aggregate counts, collected on the server, answer the questions above without a consent banner or a third-party script.',
      },
    ],
  },
  {
    slug: 'documentation-that-ages-well',
    title: 'Documentation that ages well',
    excerpt:
      'Write down the decisions, not the clicks. A short guide to documentation that is still true a year after the author leaves.',
    category: 'Craft',
    tags: ['documentation', 'writing'],
    author: TOBIAS,
    publishedAt: '2026-08-30',
    featured: false,
    blocks: [
      {
        type: 'paragraph',
        text: 'Documentation fails in a predictable way. Someone documents the current interface, the interface changes, and the documentation becomes a confident source of wrong answers. The fix is to document invariants and the reasons behind them.',
      },
      {
        type: 'heading',
        text: 'Describe the contract',
      },
      {
        type: 'paragraph',
        text: 'A route table, a schema and a list of error codes are contracts. They are short, versioned and testable. A paragraph describing which buttons to click is not a contract; it is a memory of one afternoon.',
      },
      {
        type: 'code',
        language: 'text',
        text: 'GET /posts/:slug  ->  200 article | 404 not found\nPOST /posts       ->  405 method not allowed (Allow: GET, HEAD)',
      },
      {
        type: 'paragraph',
        text: 'Link to the tests that prove the contract. A reader who trusts the test suite more than the prose is a reader you have served well.',
      },
    ],
  },
  {
    slug: 'shipping-a-small-server',
    title: 'Shipping a small server in a weekend',
    excerpt:
      'No framework, no client bundle, no database. What a Node.js HTTP server can do when the requirements are taken seriously.',
    category: 'Engineering',
    tags: ['node-js', 'performance'],
    author: PRIYA,
    publishedAt: '2026-08-16',
    featured: false,
    blocks: [
      {
        type: 'paragraph',
        text: 'This site is served by a single Node.js process with no runtime dependencies. Content is compiled into the build, pages are rendered on the server, and the only asset is one stylesheet plus a favicon.',
      },
      {
        type: 'heading',
        text: 'What you give up',
      },
      {
        type: 'paragraph',
        text: 'Client-side navigation, instant transitions and a rich editor. For a publication with six articles and no accounts, none of those were on the critical path. Server rendering made the first screen faster and the failure modes simpler.',
      },
      {
        type: 'heading',
        text: 'What you keep',
      },
      {
        type: 'paragraph',
        text: 'Real URLs, working back and forward buttons, pages that render with JavaScript disabled, and a route table small enough to read in one sitting. Performance is mostly the absence of work you never needed to do.',
      },
      {
        type: 'code',
        language: 'bash',
        text: 'npm install\nnpm test\nnpm run build\nnpm start',
      },
      {
        type: 'paragraph',
        text: 'The build runs the route suite before it emits JavaScript. If a link or status code regresses, the deploy never happens. That is the whole trick.',
      },
    ],
  },
];
