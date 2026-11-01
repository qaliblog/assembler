/**
 * Request intent classification.
 *
 * Fixed cue patterns, a fixed priority order and the matched text kept as
 * evidence. This answers *what kind of work* the request asks for; it does not
 * decide how to implement it. Requirements, provenance and unsupported
 * capabilities remain the specification interpreter's job.
 */
import { normalizeText } from './normalize.js';

export type Intent =
  | 'StartupProject'
  | 'UpdateProject'
  | 'EditProject'
  | 'DebugProject'
  | 'AnalyzeProject'
  | 'UpgradeProject'
  | 'MigrateProject'
  | 'TestProject'
  | 'BuildProject'
  | 'DeployProject'
  | 'EnvironmentSetup'
  | 'Documentation'
  | 'Research'
  | 'DesignImprovement'
  | 'PerformanceOptimization'
  | 'SecurityAudit';

/**
 * Resolution order when several intents match. Structural work (changing an
 * existing project) outranks creating one, and creating one outranks the
 * verification intents that come along with it.
 */
export const INTENT_PRIORITY: readonly Intent[] = [
  // "Improve performance" and "fix a vulnerability" are specific work, not a
  // generic update, so those intents resolve first.
  'SecurityAudit',
  'PerformanceOptimization',
  'UpdateProject',
  'EditProject',
  'DebugProject',
  'MigrateProject',
  'UpgradeProject',
  'AnalyzeProject',
  'StartupProject',
  'DeployProject',
  'EnvironmentSetup',
  'Documentation',
  'Research',
  'DesignImprovement',
  'TestProject',
  'BuildProject',
];

interface IntentRule {
  readonly intent: Intent;
  readonly patterns: readonly RegExp[];
}

const RULES: readonly IntentRule[] = [
  {
    intent: 'UpdateProject',
    patterns: [
      /\b(?:add|extend|enhance|improve|update|modify|change)\b/,
      /\b(?:redesign|restyle|refresh)\b/,
    ],
  },
  {
    intent: 'EditProject',
    patterns: [
      /\b(?:edit|rename|refactor|remove|delete|replace|move|extract|split)\b/,
    ],
  },
  {
    intent: 'DebugProject',
    patterns: [
      /\b(?:fix|debug|broken|bug|bugs|error|errors|failure|failures|crash|crashes)\b/,
      /\b(?:failing|not working|doesn['’]t work|isn['’]t working|regression)\b/,
    ],
  },
  {
    intent: 'MigrateProject',
    patterns: [
      /\bmigrate\b/,
      /\b(?:port|convert)\b.*\b(?:typescript|javascript|react|vue|python|framework|vite|next)\b/,
    ],
  },
  {
    intent: 'UpgradeProject',
    patterns: [
      /\b(?:upgrade|bump)\b/,
      /\b(?:update|refresh)\b.*\b(?:dependenc(?:y|ies)|packages?|versions?)\b/,
      /\b(?:latest|newer) versions?\b/,
      /\boutdated\b/,
    ],
  },
  {
    intent: 'AnalyzeProject',
    patterns: [
      /\b(?:analy[sz]e|inspect|review|assess|explain|audit)\b/,
      /\b(?:what does|how does|where is)\b/,
    ],
  },
  {
    intent: 'SecurityAudit',
    patterns: [
      /\b(?:security|vulnerabilit(?:y|ies)|secrets?|cve|xss|csrf|injection)\b/,
      /\b(?:audit)\b.*\b(?:security|access)\b/,
    ],
  },
  {
    intent: 'PerformanceOptimization',
    patterns: [
      /\b(?:performance|faster|slow|latency|bundle size|memory usage)\b/,
      /\boptimi[sz]e\b/,
    ],
  },
  {
    intent: 'StartupProject',
    patterns: [
      /\b(?:create|generate|scaffold|bootstrap|start)\b/,
      /\b(?:build|make)\s+(?:me\s+)?(?:a|an|the|my|this|new)\b/,
      /\bnew\s+(?:project|app|application|site|website|blog|api|backend)\b/,
    ],
  },
  {
    intent: 'DeployProject',
    patterns: [/\b(?:deploy|deployment|publish|release|ship)\b/, /\bproduction\b/],
  },
  {
    intent: 'EnvironmentSetup',
    patterns: [
      /\b(?:install|set ?up|configure|environment|toolchain|sdk)\b/,
      /\bmissing (?:tool|dependency|package)\b/,
    ],
  },
  {
    intent: 'Documentation',
    patterns: [/\b(?:document|documentation|readme|docs?)\b/],
  },
  {
    intent: 'Research',
    patterns: [/\b(?:research|compare|recommend|evaluate|which .* best)\b/],
  },
  {
    intent: 'DesignImprovement',
    patterns: [
      /\b(?:design|beautiful|modern|polished|elegant|responsive|typography|layout|theme|visual|ui|ux)\b/,
      /\b(?:look|feel)\b/,
    ],
  },
  {
    intent: 'TestProject',
    patterns: [
      /\b(?:tests?|testing|coverage|vitest|jest|pytest|playwright|cypress)\b/,
    ],
  },
  {
    intent: 'BuildProject',
    patterns: [/\b(?:build|compile|bundle|package)\b/],
  },
];

export interface IntentMatch {
  readonly intent: Intent;
  readonly confidence: 'certain' | 'likely';
  readonly evidence: readonly string[];
}

export interface IntentClassification {
  readonly primary: Intent;
  readonly secondary: readonly Intent[];
  readonly intents: readonly IntentMatch[];
  /** True when the request is about code that already exists. */
  readonly requiresExistingProject: boolean;
}

/** "my existing blog", "this project", "our codebase" */
const EXISTING_CUE =
  /\b(?:existing|current|my|our|this|the)\s+(?:app|application|project|site|website|blog|codebase|repo|repository)\b/;

/** A request that starts with a verb operating on something that exists. */
const IMPERATIVE_CHANGE =
  /^(?:add|update|improve|fix|debug|upgrade|migrate|analy[sz]e|inspect|review|refactor|edit|remove|delete|convert|optimi[sz]e|redesign|restyle|extend|enhance|deploy|test|build|document)\b/;

/** Creation cues are only project creation when they name a thing to create. */
const CREATION_OBJECT =
  /\b(?:create|generate|scaffold|bootstrap|start)\b.*\b(?:app|apps|application|project|site|website|blog|api|backend|dashboard|platform|service|tool|portal|portfolio|store|system|publication|magazine|page)\b/;

const EXISTING_INTENTS: ReadonlySet<Intent> = new Set<Intent>([
  'UpdateProject',
  'EditProject',
  'DebugProject',
  'AnalyzeProject',
  'UpgradeProject',
  'MigrateProject',
  'SecurityAudit',
  'PerformanceOptimization',
]);

function matchRule(rule: IntentRule, text: string): string[] {
  const evidence: string[] = [];
  for (const pattern of rule.patterns) {
    const match = pattern.exec(text);
    if (match?.[0] !== undefined) evidence.push(match[0]);
  }
  return evidence;
}

export function classifyIntent(request: string): IntentClassification {
  const text = normalizeText(request);
  const intents: IntentMatch[] = [];

  for (const rule of RULES) {
    const evidence = matchRule(rule, text);
    if (evidence.length === 0) continue;
    intents.push({
      intent: rule.intent,
      confidence: evidence.length > 1 ? 'certain' : 'likely',
      evidence: [...new Set(evidence)],
    });
  }

  const byIntent = new Map(intents.map((entry) => [entry.intent, entry]));
  const ordered = INTENT_PRIORITY.filter((intent) => byIntent.has(intent));
  const existing = EXISTING_CUE.test(text);
  const imperativeChange = IMPERATIVE_CHANGE.test(text) && ordered[0] !== undefined && ordered[0] !== 'StartupProject';
  const creation =
    CREATION_OBJECT.test(text) ||
    /\b(?:build|make)\s+(?:me\s+)?(?:a|an|the|my|new)\b/.test(text) ||
    /\bnew\s+(?:project|app|application|site|website|blog|api|backend)\b/.test(text);

  let primary: Intent;
  if (imperativeChange && ordered[0] !== undefined) {
    primary = ordered[0];
  } else if (creation && byIntent.has('StartupProject')) {
    primary = 'StartupProject';
  } else {
    // "Generate documentation" matches the creation verb but is not a new
    // project; prefer the concrete non-creation intent.
    primary = ordered.find((intent) => intent !== 'StartupProject') ?? ordered[0] ?? 'StartupProject';
  }

  const secondary = ordered.filter((intent) => intent !== primary).slice(0, 5);

  return {
    primary,
    secondary,
    intents,
    requiresExistingProject: EXISTING_INTENTS.has(primary) || existing,
  };
}

/** One-line explanation for terminals and logs. */
export function describeIntent(classification: IntentClassification): string {
  const primary = classification.intents.find((entry) => entry.intent === classification.primary);
  const evidence = primary === undefined ? 'no explicit cue' : primary.evidence.join(', ');
  const secondary =
    classification.secondary.length === 0 ? '' : `; also ${classification.secondary.join(', ')}`;
  return `${classification.primary} (${evidence})${secondary}`;
}
