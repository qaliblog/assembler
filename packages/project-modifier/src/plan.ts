/**
 * Modification planning.
 *
 * The supported change is intentionally narrow: add one page to an
 * Assembler-generated React project. Narrow is not the same as vague — the plan
 * names every file, the task dependencies, the acceptance criteria and the
 * cases it refuses (design rewrites, diagnostics, auth, databases), so a user is
 * never told that an unsupported request was applied partially.
 */
import { renderPage } from './page.js';
import type {
  GeneratedProjectContext,
  ModifierBlocker,
  ModificationChange,
  ModificationPlan,
  ModificationTask,
  PlannedPage,
} from './types.js';

interface PageNoun {
  readonly id: string;
  readonly title: string;
  readonly archetype: PlannedPage['archetype'];
  readonly words: readonly string[];
  readonly description: string;
}

const NOUNS: readonly PageNoun[] = [
  {
    id: 'admin',
    title: 'Admin',
    archetype: 'dashboard',
    words: ['admin', 'administration'],
    description: 'Operational overview for administrators. Values are sample data until a data source is connected.',
  },
  {
    id: 'analytics',
    title: 'Analytics',
    archetype: 'dashboard',
    words: ['analytics', 'insights'],
    description: 'Usage and trend overview. Values are sample data until an analytics source is connected.',
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    archetype: 'dashboard',
    words: ['dashboard', 'overview'],
    description: 'Summary of the workspace. Values are sample data until a data source is connected.',
  },
  {
    id: 'reports',
    title: 'Reports',
    archetype: 'list',
    words: ['reports', 'reporting'],
    description: 'Generated reports and their current review status. Rows are sample data.',
  },
  {
    id: 'users',
    title: 'Users',
    archetype: 'list',
    words: ['users', 'user', 'people', 'team', 'members'],
    description: 'People with access to this workspace. Rows are sample data until a user source is connected.',
  },
  {
    id: 'records',
    title: 'Records',
    archetype: 'list',
    words: ['records', 'record'],
    description: 'Records managed by this application. Rows are sample data until a data source is connected.',
  },
  {
    id: 'orders',
    title: 'Orders',
    archetype: 'list',
    words: ['orders', 'order'],
    description: 'Orders and their fulfilment state. Rows are sample data until an order source is connected.',
  },
  {
    id: 'invoices',
    title: 'Invoices',
    archetype: 'list',
    words: ['invoices', 'invoice', 'billing'],
    description: 'Invoices and their payment state. Rows are sample data until a billing source is connected.',
  },
  {
    id: 'inventory',
    title: 'Inventory',
    archetype: 'list',
    words: ['inventory', 'stock', 'products'],
    description: 'Stock levels and product state. Rows are sample data until an inventory source is connected.',
  },
  {
    id: 'projects',
    title: 'Projects',
    archetype: 'list',
    words: ['projects', 'project'],
    description: 'Projects and their owners. Rows are sample data until a project source is connected.',
  },
  {
    id: 'tasks',
    title: 'Tasks',
    archetype: 'list',
    words: ['tasks', 'task', 'todos'],
    description: 'Work items and their status. Rows are sample data until a task source is connected.',
  },
  {
    id: 'messages',
    title: 'Messages',
    archetype: 'list',
    words: ['messages', 'inbox', 'notifications'],
    description: 'Messages that need attention. Rows are sample data until a message source is connected.',
  },
  {
    id: 'gallery',
    title: 'Gallery',
    archetype: 'list',
    words: ['gallery', 'photos', 'media'],
    description: 'Media in this workspace. Rows are sample data until a media source is connected.',
  },
  {
    id: 'settings',
    title: 'Settings',
    archetype: 'settings',
    words: ['settings', 'preferences', 'configuration'],
    description: 'Workspace preferences. Controls are illustrative until settings storage is connected.',
  },
  {
    id: 'profile',
    title: 'Profile',
    archetype: 'profile',
    words: ['profile', 'account'],
    description: 'Account details for the signed-in user. Values are sample data until a user source is connected.',
  },
  {
    id: 'search',
    title: 'Search',
    archetype: 'generic',
    words: ['search'],
    description: 'Search across the application. The query pipeline is not connected yet.',
  },
  {
    id: 'about',
    title: 'About',
    archetype: 'generic',
    words: ['about'],
    description: 'Information about the application and the people behind it.',
  },
  {
    id: 'contact',
    title: 'Contact',
    archetype: 'generic',
    words: ['contact', 'support'],
    description: 'How to reach the team. Submission handling is not connected yet.',
  },
];

const SENSITIVE: ReadonlySet<string> = new Set([
  'admin',
  'analytics',
  'dashboard',
  'reports',
  'users',
  'records',
  'orders',
  'invoices',
  'inventory',
  'projects',
  'tasks',
  'messages',
  'settings',
  'profile',
]);

/** Requests that would need capabilities the modifier does not have. */
const UNSUPPORTED_EXTRAS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:auth|authentication|login|sign[- ]?in|accounts?|password)\b/, label: 'authentication' },
  { pattern: /\b(?:database|sqlite|postgres|mysql|persistence|schema migration)\b/, label: 'a database' },
  { pattern: /\b(?:api|backend|server|endpoint)\b/, label: 'a backend or API' },
  { pattern: /\b(?:payments?|stripe|checkout)\b/, label: 'payments' },
  { pattern: /\b(?:upload|file storage|s3)\b/, label: 'file storage' },
  { pattern: /\b(?:realtime|websocket|socket)\b/, label: 'realtime transport' },
  { pattern: /\b(?:email|newsletter)\b/, label: 'email delivery' },
];

const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'new',
  'beautiful',
  'modern',
  'polished',
  'responsive',
  'professional',
  'simple',
  'nice',
  'great',
  'clean',
  'minimal',
  'page',
]);

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function uniqueId(base: string, context: GeneratedProjectContext): string {
  const used = new Set(context.existingRoutes.map((route) => route.path.replace(/^\//, '')));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${String(index)}`)) index += 1;
  return `${base}-${String(index)}`;
}

function detectNoun(text: string): PageNoun | null {
  for (const noun of NOUNS) {
    if (noun.words.some((word) => new RegExp(`\\b${word}\\b`).test(text))) return noun;
  }
  return null;
}

/**
 * "Add a page for invoices" names the page *after* the word page. The generic
 * path is deliberately conservative: it only accepts a short noun phrase.
 */
function detectGenericPage(text: string): { title: string; id: string } | null {
  const patterns = [
    /\bpage\s+(?:for|about|called|named)\s+([a-z][a-z0-9 -]{2,40})/,
    /\b(?:add|create|generate)\b[^.]*?\b([a-z][a-z0-9-]{2,24})\s+page\b/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const phrase = match?.[1]?.trim();
    if (phrase === undefined) continue;
    const words = phrase
      .split(/\s+/)
      .filter((word) => !STOP_WORDS.has(word))
      .slice(0, 3);
    const candidate = words.join(' ');
    const id = slugify(candidate);
    if (id !== '' && id !== 'page') return { title: titleCase(candidate), id };
  }
  return null;
}

function blockersFor(context: GeneratedProjectContext, text: string): ModifierBlocker[] {
  const blockers: ModifierBlocker[] = [];
  for (const extra of UNSUPPORTED_EXTRAS) {
    if (extra.pattern.test(text)) {
      blockers.push({
        code: 'MODIFICATION_UNSUPPORTED',
        message: `This request also asks for ${extra.label}, which the modifier cannot implement deterministically yet. Nothing was changed.`,
        hint: 'Ask only for the page, or add that capability to the project manually first.',
      });
    }
  }
  if (context.existingRoutes.length > 0 && /\b(?:fix|repair)\b.*\b(?:rout|navigation|links?)\b/.test(text)) {
    blockers.push({
      code: 'MODIFICATION_UNSUPPORTED',
      message:
        'Routing repair is not implemented as an automatic modification yet. The modifier can add a page, but it will not rewrite routes it did not understand.',
      hint: 'Run `assembler debug` and `assembler test` to collect evidence, then fix the route by hand or generate a fresh project.',
    });
  }
  return blockers;
}

function tasksFor(page: PlannedPage): readonly ModificationTask[] {
  return [
    {
      id: 'inspect',
      name: 'Inspect generated project',
      description: 'Read the specification, manifest, route table and available components.',
      dependsOn: [],
      verification: 'The route table hash matches the manifest record.',
    },
    {
      id: 'create-page',
      name: `Create ${page.componentName}`,
      description: `Write ${page.sourceFile} using the existing layout, components and design tokens.`,
      dependsOn: ['inspect'],
      verification: 'The module exports the component and imports only files that exist.',
    },
    {
      id: 'create-test',
      name: 'Create the page test',
      description: `Write ${page.testFile} covering the heading and generated content.`,
      dependsOn: ['create-page'],
      verification: 'The test renders the page and asserts its heading.',
    },
    {
      id: 'update-routes',
      name: 'Register the route',
      description: `Add ${page.route} to src/app/routes.tsx, preserving every existing entry.`,
      dependsOn: ['create-page'],
      verification: 'The route table parses and contains exactly one additional entry.',
    },
    {
      id: 'update-metadata',
      name: 'Update project metadata',
      description: 'Record the new page in assembler.spec.json and the new hashes in assembler.manifest.json.',
      dependsOn: ['create-page', 'create-test', 'update-routes'],
      verification: 'The manifest reconciliation reports no missing, unexpected or altered file.',
    },
    {
      id: 'verify',
      name: 'Verify the modified project',
      description: 'Run the project typecheck and test script with the detected package manager.',
      dependsOn: ['update-metadata'],
      verification: 'Both commands exit 0; otherwise the modification is rolled back.',
    },
  ];
}

export function planModification(request: string, context: GeneratedProjectContext): ModificationPlan {
  // Lowercase and normalize apostrophes so fixed cue patterns can match without
  // changing the request that is reported back to the user.
  const text = request.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
  const blockers = blockersFor(context, text);
  const noun = detectNoun(text);
  const generic = noun === null ? detectGenericPage(text) : null;

  let page: PlannedPage;
  if (noun !== null || generic !== null) {
    const id = noun === null ? uniqueId(generic?.id ?? 'page', context) : noun.id;
    const title = noun?.title ?? generic?.title ?? 'Page';
    const archetype = noun?.archetype ?? 'generic';
    const componentName = `${id
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')}Page`;
    const description =
      noun?.description ?? `A generated ${title.toLowerCase()} page. Sample content is clearly labelled.`;
    const requiresAuth = SENSITIVE.has(noun?.id ?? '') && context.hasAuth;
    const rendered = renderPage({ id, title, route: `/${id}`, componentName, description, requiresAuth, archetype });
    page = {
      id,
      title,
      route: `/${id}`,
      componentName,
      description,
      requiresAuth,
      archetype,
      sourceFile: `src/pages/${componentName}.tsx`,
      testFile: `src/pages/${componentName}.test.tsx`,
      styleFile: `src/pages/${componentName}.module.css`,
      ...rendered,
    };

    const conflict = context.existingRoutes.find(
      (route) => route.path === page.route || route.title.toLowerCase() === page.title.toLowerCase(),
    );
    if (conflict !== undefined) {
      blockers.push({
        code: 'PAGE_EXISTS',
        message: `The route ${conflict.path} (${conflict.title}) already exists, so adding ${page.title} would create a duplicate.`,
        hint: 'Name the page differently (for example "admin overview") or edit the existing page in a later request.',
      });
    }
    if (
      context.manifest.files.some(
        (file) => file.path === page.sourceFile || file.path === page.testFile || file.path === page.styleFile,
      )
    ) {
      blockers.push({
        code: 'PAGE_EXISTS',
        message: `${page.sourceFile} is already declared in the project manifest.`,
        hint: 'Choose a different page name.',
      });
    }
  } else {
    page = {
      id: 'unresolved',
      title: 'Unresolved',
      route: '/unresolved',
      componentName: 'UnresolvedPage',
      description: '',
      requiresAuth: false,
      archetype: 'generic',
      sourceFile: '',
      testFile: '',
      styleFile: '',
      source: '',
      test: '',
      style: '',
    };
    blockers.push({
      code: 'MODIFICATION_UNSUPPORTED',
      message:
        'This request does not name a page the modifier can add. The current modifier supports adding one page (for example "add an admin dashboard", "add a users page").',
      hint: 'Ask for a page by name, or use /analyze and /debug for a read-only inspection.',
    });
  }

  const changes: ModificationChange[] = [
    { path: page.sourceFile, action: 'create', kind: 'source', description: `The ${page.title} page component.` },
    { path: page.testFile, action: 'create', kind: 'test', description: `A render test for ${page.title}.` },
    { path: page.styleFile, action: 'create', kind: 'style', description: `Layout and table styling based on existing tokens.` },
    {
      path: 'src/app/routes.tsx',
      action: 'modify',
      kind: 'source',
      description: `Register ${page.route} and import ${page.componentName}.`,
    },
    {
      path: 'assembler.spec.json',
      action: 'modify',
      kind: 'metadata',
      description: 'Record the page in the project specification.',
    },
    {
      path: 'assembler.manifest.json',
      action: 'modify',
      kind: 'metadata',
      description: 'Record the new files and hashes.',
    },
  ];

  const authNote =
    SENSITIVE.has(page.id) && !context.hasAuth
      ? 'The project has no authentication provider, so the new route is public.'
      : null;

  return {
    request: request.trim(),
    kind: 'add-page',
    summary: `Add the ${page.title} page at ${page.route} and register it in the navigation.`,
    rationale:
      'Adds three files and edits only the generated route table. Existing pages, configuration and user files are not regenerated or overwritten, and the page reuses the project’s current tokens and components.',
    project: {
      name: context.spec.name,
      slug: context.spec.slug,
      templateId: context.templateId,
      routeCount: context.existingRoutes.length,
    },
    page,
    changes,
    tasks: tasksFor(page),
    risks: [
      'The page contains clearly labelled sample data; it does not connect to a backend.',
      'The route table is patched by the TypeScript parser, not regenerated from a template.',
      'A failed typecheck or test run restores every touched file from the backup.',
    ],
    acceptanceCriteria: [
      `${page.route} resolves to ${page.componentName}.`,
      'The route table still contains every route that existed before the change.',
      'The new page is reachable from the generated navigation.',
      'The project typecheck and test script exit 0.',
      'assembler.manifest.json reconciles with the files on disk.',
    ],
    blockers,
    notes: authNote === null ? [] : [authNote],
    baseRoutesSha256: context.routesSha256,
  };
}
