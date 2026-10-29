/**
 * Vocabulary.
 *
 * Data, not control flow. Each rule maps recognised phrases to one normalised
 * fact; the interpreter decides what the fact means for the specification. This
 * keeps extraction testable and makes adding vocabulary a data change.
 *
 * `scope` says which application a fact belongs to:
 *   - `web` / `mobile` / `backend`: app-local (pages, endpoints, persistence)
 *   - `global`: project-wide (design, testing, name)
 */
import type { RequirementCategory } from '@assembler/project-spec';

export type RuleScope = 'web' | 'mobile' | 'backend' | 'ui' | 'global';

export interface LexiconRule {
  readonly id: string;
  readonly phrases: readonly string[];
  readonly category: RequirementCategory;
  readonly value: string;
  readonly scope: RuleScope;
  readonly payload?: Readonly<Record<string, string>>;
}

const page = (
  id: string,
  phrases: readonly string[],
  archetype: string,
  title: string,
  extra: Record<string, string> = {},
): LexiconRule => ({
  id: `page.${id}`,
  phrases,
  category: 'page',
  value: archetype,
  // Pages apply to web routes and native screens; the subject decides which.
  scope: 'ui',
  payload: { archetype, title, ...extra },
});

export const APPLICATION_RULES: readonly LexiconRule[] = [
  {
    id: 'app.web.react',
    phrases: [
      'react website',
      'react web app',
      'react web application',
      'react app',
      'react site',
      'react frontend',
      'react front-end',
      'react spa',
      'web app',
      'web application',
      'website',
      'frontend',
      'front-end',
      'single page app',
    ],
    category: 'project.kind',
    value: 'web',
    scope: 'web',
    payload: { framework: 'react', buildSystem: 'vite', language: 'typescript' },
  },
  {
    id: 'app.web.unsupported-framework',
    phrases: ['next.js', 'nextjs', 'nuxt', 'svelte', 'vue', 'angular', 'remix', 'astro', 'gatsby'],
    category: 'framework',
    value: 'unsupported-web-framework',
    scope: 'web',
    payload: { note: 'Only React (Vite) web applications have verified templates.' },
  },
  {
    id: 'app.mobile.react-native',
    phrases: [
      'react native app',
      'react native application',
      'react native',
      'android app',
      'android application',
      'mobile app',
      'mobile application',
      'android apk',
      'apk',
      'native app',
    ],
    category: 'project.kind',
    value: 'mobile',
    scope: 'mobile',
    payload: { framework: 'react-native', buildSystem: 'react-native-cli', language: 'typescript' },
  },
  {
    id: 'app.mobile.expo',
    phrases: ['expo app', 'expo'],
    category: 'framework',
    value: 'expo',
    scope: 'mobile',
    payload: { note: 'Expo is not part of the verified React Native workflow.' },
  },
  {
    id: 'app.backend.generic',
    phrases: [
      'backend',
      'back-end',
      'back end',
      'api server',
      'rest api',
      'rest server',
      'http api',
      'server api',
      'separate backend',
      'separate api',
    ],
    category: 'project.kind',
    value: 'backend',
    scope: 'backend',
  },
  {
    id: 'app.backend.fastapi',
    phrases: ['fastapi', 'fast api', 'python backend', 'python api', 'python server'],
    category: 'framework',
    value: 'fastapi',
    scope: 'backend',
    payload: { language: 'python', buildSystem: 'uvicorn' },
  },
  {
    id: 'app.backend.node',
    phrases: ['node backend', 'node.js backend', 'node api', 'node.js api', 'express', 'expressjs', 'nestjs', 'nest.js'],
    category: 'framework',
    value: 'node-typescript',
    scope: 'backend',
    payload: { language: 'typescript', buildSystem: 'tsc' },
  },
];

export const PAGE_RULES: readonly LexiconRule[] = [
  page('login', ['login page', 'login screen', 'log in page', 'sign in page', 'signin page', 'login'], 'login', 'Sign in'),
  page('register', ['register page', 'registration page', 'sign up page', 'signup page', 'registration', 'register'], 'register', 'Create account'),
  page('dashboard', ['dashboard', 'admin panel', 'control panel'], 'dashboard', 'Dashboard'),
  page('settings', ['settings page', 'settings screen', 'settings', 'preferences page'], 'settings', 'Settings'),
  page('profile', ['profile page', 'profile screen', 'account page', 'profile'], 'profile', 'Profile'),
  page('landing', ['landing page', 'home page', 'homepage', 'marketing page', 'home screen'], 'landing', 'Home'),
  page('list', ['list page', 'table page', 'records page', 'users page'], 'list', 'Records'),
  page('detail', ['detail page', 'details page', 'detail screen', 'details screen'], 'detail', 'Details'),
];

export const DESIGN_RULES: readonly LexiconRule[] = [
  {
    id: 'design.glassmorphism',
    phrases: ['glassmorphism', 'glass morphism', 'glass effect', 'frosted glass', 'glass card', 'glass cards', 'translucent', 'translucent panels', 'blur effect'],
    category: 'design.style',
    value: 'glassmorphism',
    scope: 'global',
  },
  {
    id: 'design.neumorphism',
    phrases: ['neumorphism', 'neumorphic', 'soft ui'],
    category: 'design.style',
    value: 'neumorphism',
    scope: 'global',
  },
  {
    id: 'design.minimal',
    phrases: ['minimal', 'minimalist', 'clean design', 'simple design'],
    category: 'design.style',
    value: 'minimal',
    scope: 'global',
  },
  {
    id: 'design.material',
    phrases: ['material design', 'material ui', 'material-inspired', 'material inspired'],
    category: 'design.style',
    value: 'material',
    scope: 'global',
  },
  {
    id: 'design.theme.dark',
    phrases: ['dark theme', 'dark mode', 'night mode', 'dark ui', 'dark'],
    category: 'design.theme',
    value: 'dark',
    scope: 'global',
  },
  {
    id: 'design.theme.light',
    phrases: ['light theme', 'light mode', 'light ui', 'light'],
    category: 'design.theme',
    value: 'light',
    scope: 'global',
  },
  {
    id: 'design.theme.system',
    phrases: ['system theme', 'follows the system', 'system preference'],
    category: 'design.theme',
    value: 'system',
    scope: 'global',
  },
  {
    id: 'design.layout.dashboard',
    phrases: ['dashboard layout', 'sidebar layout', 'sidebar navigation', 'sidebar', 'admin layout', 'analytics dashboard'],
    category: 'design.layout',
    value: 'dashboard',
    scope: 'global',
  },
  {
    id: 'design.layout.landing',
    phrases: ['landing layout', 'marketing layout', 'hero section'],
    category: 'design.layout',
    value: 'landing',
    scope: 'global',
  },
  {
    id: 'design.responsive',
    phrases: ['responsive', 'mobile-first', 'mobile first', 'works on mobile', 'adaptive layout'],
    category: 'design.layout',
    value: 'responsive',
    scope: 'global',
  },
];

export const COLOR_RULES: Readonly<Record<string, string>> = {
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  pink: '#ec4899',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  slate: '#64748b',
  gray: '#6b7280',
  grey: '#6b7280',
  white: '#ffffff',
  black: '#000000',
};

export const DATA_RULES: readonly LexiconRule[] = [
  {
    id: 'data.sqlite',
    phrases: ['sqlite', 'sqlite3', 'sqlite database'],
    category: 'database',
    value: 'sqlite',
    scope: 'backend',
  },
  {
    id: 'data.postgres',
    phrases: ['postgres', 'postgresql', 'pg'],
    category: 'database',
    value: 'postgres',
    scope: 'backend',
  },
  {
    id: 'data.mysql',
    phrases: ['mysql', 'mariadb'],
    category: 'database',
    value: 'mysql',
    scope: 'backend',
  },
  {
    id: 'data.mongo',
    phrases: ['mongodb', 'mongo'],
    category: 'database',
    value: 'mongodb',
    scope: 'backend',
  },
  {
    id: 'data.generic',
    phrases: ['database', 'persistence', 'storage layer', 'data store'],
    category: 'database',
    value: 'database',
    scope: 'backend',
  },
];

export const AUTH_RULES: readonly LexiconRule[] = [
  {
    id: 'auth.required',
    phrases: ['authentication', 'auth', 'jwt', 'bearer token', 'protected routes', 'sign in'],
    category: 'auth',
    value: 'required',
    scope: 'global',
  },
  {
    id: 'auth.oauth',
    phrases: ['oauth', 'google sign in', 'google login', 'github login', 'sso', 'saml'],
    category: 'integration',
    value: 'oauth',
    scope: 'global',
  },
  {
    id: 'auth.session',
    phrases: ['session cookies', 'session cookie', 'server sessions'],
    category: 'auth',
    value: 'session',
    scope: 'global',
  },
];

export const STATE_RULES: readonly LexiconRule[] = [
  {
    id: 'state.context',
    phrases: ['state management', 'global state', 'react context', 'shared state'],
    category: 'state-management',
    value: 'react-context',
    scope: 'web',
  },
  {
    id: 'state.redux',
    phrases: ['redux', 'zustand', 'mobx', 'recoil', 'jotai'],
    category: 'state-management',
    value: 'unsupported-library',
    scope: 'web',
    payload: { note: 'No verified integration exists for this state library.' },
  },
];

export const TESTING_RULES: readonly LexiconRule[] = [
  {
    id: 'testing.unit',
    phrases: ['with tests', 'unit tests', 'unit tested', 'test coverage', 'well tested', 'and tests'],
    category: 'testing',
    value: 'unit',
    scope: 'global',
  },
  {
    id: 'testing.integration',
    phrases: ['integration tests', 'integration testing'],
    category: 'testing',
    value: 'integration',
    scope: 'global',
  },
  {
    id: 'testing.e2e',
    phrases: ['end-to-end tests', 'end to end tests', 'e2e tests', 'playwright', 'cypress'],
    category: 'testing',
    value: 'e2e',
    scope: 'global',
  },
  {
    id: 'testing.accessibility',
    phrases: ['accessibility', 'a11y', 'screen reader', 'wcag'],
    category: 'accessibility',
    value: 'required',
    scope: 'global',
  },
];

export const NATIVE_RULES: readonly LexiconRule[] = [
  {
    id: 'native.camera',
    phrases: ['camera', 'take photos', 'photo capture', 'barcode scanner'],
    category: 'native.capability',
    value: 'camera',
    scope: 'mobile',
  },
  {
    id: 'native.geolocation',
    phrases: ['gps', 'geolocation', 'location tracking', 'background location'],
    category: 'native.capability',
    value: 'geolocation',
    scope: 'mobile',
  },
  {
    id: 'native.notifications',
    phrases: ['push notifications', 'push notification', 'local notifications'],
    category: 'native.capability',
    value: 'push-notifications',
    scope: 'mobile',
  },
  {
    id: 'native.bluetooth',
    phrases: ['bluetooth', 'ble'],
    category: 'native.capability',
    value: 'bluetooth',
    scope: 'mobile',
  },
  {
    id: 'native.biometrics',
    phrases: ['biometrics', 'fingerprint', 'face id'],
    category: 'native.capability',
    value: 'biometrics',
    scope: 'mobile',
  },
  {
    id: 'native.contacts',
    phrases: ['contacts', 'address book'],
    category: 'native.capability',
    value: 'contacts',
    scope: 'mobile',
  },
];

export const INTEGRATION_RULES: readonly LexiconRule[] = [
  { id: 'integration.stripe', phrases: ['stripe', 'payments', 'payment processing', 'credit card'], category: 'integration', value: 'payments', scope: 'global' },
  { id: 'integration.email', phrases: ['sendgrid', 'mailgun', 'transactional email', 'send emails', 'email notifications'], category: 'integration', value: 'email', scope: 'global' },
  { id: 'integration.sms', phrases: ['twilio', 'sms', 'text messages'], category: 'integration', value: 'sms', scope: 'global' },
  { id: 'integration.maps', phrases: ['google maps', 'map integration', 'map view'], category: 'integration', value: 'maps', scope: 'global' },
  { id: 'integration.llm', phrases: ['openai', 'gpt', 'llm', 'chatbot', 'ai assistant'], category: 'integration', value: 'llm', scope: 'global' },
];

export const OFFLINE_RULES: readonly LexiconRule[] = [
  {
    id: 'offline.support',
    phrases: ['offline support', 'offline mode', 'works offline', 'offline-first', 'offline first'],
    category: 'offline',
    value: 'required',
    scope: 'global',
  },
];

export const ALL_RULES: readonly LexiconRule[] = [
  ...APPLICATION_RULES,
  ...PAGE_RULES,
  ...DESIGN_RULES,
  ...DATA_RULES,
  ...AUTH_RULES,
  ...STATE_RULES,
  ...TESTING_RULES,
  ...NATIVE_RULES,
  ...INTEGRATION_RULES,
  ...OFFLINE_RULES,
];

/** `users table`, `expense model`, `task entity` */
export const DATA_MODEL_PATTERN_NAME_FIRST = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\s+(?:table|model|entity)\b/g;

/** `model called users`, `crud for tasks`, `tracks expenses` */
export const DATA_MODEL_PATTERN =
  /(?:data models?|models?|entities|entity|tables?|crud for|crud on|manage|tracks?|stores?)\s+(?:called\s+|named\s+|for\s+|of\s+)?([a-z][a-z0-9]*(?:_[a-z0-9]+)*)/g;

/** `an orders page`, `order history screen` — at most two words before the noun. */
export const GENERIC_PAGE_PATTERN =
  /\b([a-z][a-z0-9]*)(?:[ _-]([a-z][a-z0-9]*))?\s+(page|screen)\b/g;

/** Words that must not be treated as a page name. */
export const GENERIC_PAGE_STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'with',
  'and',
  'or',
  'that',
  'which',
  'this',
  'my',
  'our',
  'your',
  'website',
  'web',
  'app',
  'application',
  'site',
  'screen',
  'page',
  'login',
  'sign',
  'signin',
  'signup',
  'register',
  'registration',
  'dashboard',
  'settings',
  'profile',
  'home',
  'landing',
  'list',
  'detail',
  'details',
  'admin',
  'control',
  'separate',
  'new',
  'main',
]);
