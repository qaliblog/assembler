/**
 * Extraction: text -> typed facts.
 *
 * Scoping rule: an application mention establishes the subject for following
 * clauses in the same sentence (and for the next sentence, like discourse does).
 * A later explicit mention switches the subject. Facts that belong to another
 * application kind are re-scoped only when that kind is mentioned in the clause.
 */
import type { RequirementCategory, UnsupportedCapability } from '@assembler/project-spec';
import {
  ALL_RULES,
  COLOR_RULES,
  DATA_MODEL_PATTERN,
  DATA_MODEL_PATTERN_NAME_FIRST,
  GENERIC_PAGE_PATTERN,
  GENERIC_PAGE_STOP_WORDS,
  type LexiconRule,
  type RuleScope,
} from './lexicon.js';
import { findPhrases, segment, type Clause } from './normalize.js';

export type AppKind = 'web' | 'mobile' | 'backend';

export interface ExtractedFact {
  readonly ruleId: string;
  readonly category: RequirementCategory;
  readonly value: string;
  readonly scope: RuleScope;
  readonly payload: Readonly<Record<string, string>>;
  readonly evidence: string;
  /** Application the fact was assigned to, or null when it is project-global. */
  readonly application: AppKind | null;
  readonly sentenceIndex: number;
  readonly clauseIndex: number;
}

export interface AppMention {
  readonly kind: AppKind;
  readonly evidence: string;
  readonly sentenceIndex: number;
  readonly clauseIndex: number;
}

export interface DataModelRequest {
  readonly name: string;
  readonly evidence: string;
}

export interface ExtractionResult {
  readonly facts: readonly ExtractedFact[];
  readonly appMentions: readonly AppMention[];
  readonly dataModels: readonly DataModelRequest[];
  readonly genericPages: readonly Readonly<{ name: string; evidence: string }>[];
  readonly colors: readonly Readonly<{ value: string; evidence: string }>[];
  readonly projectName: Readonly<{ value: string; evidence: string; explicit: boolean }> | null;
  readonly unsupported: readonly UnsupportedCapability[];
  /** Clauses that produced no fact; surfaced as a transparency note. */
  readonly unmatchedClauses: readonly string[];
  readonly sentenceCount: number;
}

const STOP_MODEL_NAMES = new Set([
  'a',
  'an',
  'the',
  'my',
  'this',
  'that',
  'data',
  'model',
  'models',
  'table',
  'tables',
  'entity',
  'entities',
  'record',
  'records',
  'item',
  'items',
  'it',
  'them',
]);

const KNOWN_PAGE_WORDS = GENERIC_PAGE_STOP_WORDS;

const UNSUPPORTED_FRAMEWORK_NAMES: Readonly<Record<string, string>> = {
  'app.web.unsupported-framework': 'web framework',
};

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter((part) => part !== '')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function kindForRule(rule: LexiconRule): AppKind | null {
  if (rule.category === 'project.kind' && (rule.value === 'web' || rule.value === 'mobile' || rule.value === 'backend')) {
    return rule.value;
  }
  if (rule.category === 'framework') {
    if (rule.id.includes('mobile') || rule.value === 'expo') return 'mobile';
    if (rule.id.includes('backend')) return 'backend';
    if (rule.id.includes('web')) return 'web';
  }
  if (rule.scope === 'web' || rule.scope === 'mobile' || rule.scope === 'backend') return rule.scope;
  return null;
}

/** Only application and framework mentions establish the subject of a clause. */
function isSubjectRule(rule: LexiconRule): boolean {
  return rule.category === 'project.kind' || rule.category === 'framework';
}

function unsupportedFromFact(rule: LexiconRule, evidence: string): UnsupportedCapability | null {
  const base = (capability: string, description: string, reason: string, alternative?: string): UnsupportedCapability => ({
    id: `unsupported-${capability}`,
    capability,
    description,
    reason,
    ...(alternative === undefined ? {} : { alternative }),
  });

  if (rule.id === 'app.web.unsupported-framework') {
    return base(
      'web.framework',
      `A ${rule.value} web application`,
      `${UNSUPPORTED_FRAMEWORK_NAMES[rule.id] ?? 'This framework'} has no verified template in the registry.`,
      'Request a React + Vite application instead.',
    );
  }
  if (rule.id === 'app.mobile.expo') {
    return base(
      'mobile.expo',
      'An Expo-based mobile application',
      'Only the bare React Native workflow targeting Android is verified.',
      'Use plain React Native with the Android toolchain.',
    );
  }
  if (rule.category === 'database' && !['sqlite', 'database'].includes(rule.value)) {
    return base(
      `database.${rule.value}`,
      `A ${rule.value} database`,
      'Only SQLite has a verified repository, migration and test setup.',
      'Use SQLite, or add the database through a plugin.',
    );
  }
  if (rule.id === 'state.redux') {
    return base(
      'web.state-management',
      'A dedicated state-management library',
      'No verified integration exists for Redux/Zustand/MobX; React context is available.',
      'Use React context, which the verified template supports.',
    );
  }
  if (rule.category === 'native.capability') {
    return base(
      `native.${rule.value}`,
      `Native device capability: ${rule.value}`,
      'No verified React Native native-module integration (with Android permission and build verification) exists yet.',
      'Install a community module manually after generation and re-verify the Android build.',
    );
  }
  if (rule.category === 'integration' && rule.value !== 'required') {
    return base(
      `integration.${rule.value}`,
      `External integration: ${rule.value}`,
      'No verified client or SDK adapter exists for this service, so the integration would be unimplemented.',
      'Add the SDK manually, or provide a plugin that verifies it.',
    );
  }
  if (rule.id === 'auth.oauth' || rule.id === 'auth.session') {
    return base(
      `auth.${rule.value}`,
      `Authentication strategy: ${rule.value}`,
      'Only JWT bearer authentication has a verified implementation.',
      'Use JWT bearer auth.',
    );
  }
  void evidence;
  return null;
}

export function extractFacts(input: string): ExtractionResult {
  const sentences = segment(input);
  const facts: ExtractedFact[] = [];
  const appMentions: AppMention[] = [];
  const unsupported = new Map<string, UnsupportedCapability>();
  const unmatchedClauses: string[] = [];

  let currentKind: AppKind | null = null;

  const pushUnsupported = (entry: UnsupportedCapability | null): void => {
    if (entry !== null) unsupported.set(entry.capability, entry);
  };

  for (const sentence of sentences) {
    for (const clause of sentence.clauses) {
      const matchedRules: LexiconRule[] = ALL_RULES.filter((rule) => findPhrases(clause.text, rule.phrases).length > 0);
      const mentionsInClause = matchedRules
        .filter(isSubjectRule)
        .map((rule) => ({ rule, kind: kindForRule(rule) }))
        .filter((entry): entry is { rule: LexiconRule; kind: AppKind } => entry.kind !== null);

      if (mentionsInClause.length > 0) {
        // The last explicit mention in a clause becomes the subject.
        const mention = mentionsInClause[mentionsInClause.length - 1];
        if (mention !== undefined) {
          currentKind = mention.kind;
          appMentions.push({
            kind: mention.kind,
            evidence: clause.raw,
            sentenceIndex: clause.sentenceIndex,
            clauseIndex: clause.clauseIndex,
          });
        }
      }

      let producedFact = false;
      for (const rule of matchedRules) {
        producedFact = true;
        const ruleKind = kindForRule(rule);
        let application: AppKind | null = null;
        if (rule.scope === 'global') {
          application = null;
        } else if (rule.scope === 'ui') {
          // UI requirements attach to whichever UI application is the subject.
          application =
            currentKind === 'web' || currentKind === 'mobile'
              ? currentKind
              : mentionsInClause.find((entry) => entry.kind === 'web' || entry.kind === 'mobile')?.kind ?? 'web';
        } else if (ruleKind !== null) {
          const clauseMentionsKind = mentionsInClause.some((entry) => entry.kind === ruleKind);
          application = clauseMentionsKind ? ruleKind : (currentKind ?? ruleKind);
          // A fact that belongs to a different application than the current
          // subject is kept only when that application was mentioned here.
          if (application !== ruleKind && !clauseMentionsKind) {
            continue;
          }
        }

        facts.push({
          ruleId: rule.id,
          category: rule.category,
          value: rule.value,
          scope: rule.scope,
          payload: rule.payload ?? {},
          evidence: clause.raw,
          application,
          sentenceIndex: clause.sentenceIndex,
          clauseIndex: clause.clauseIndex,
        });
        pushUnsupported(unsupportedFromFact(rule, clause.raw));
      }
      if (!producedFact && clause.text.split(' ').length > 2) {
        unmatchedClauses.push(clause.text);
      }
    }
  }

  /* ------------------------------------------------------- data models */
  const dataModels: DataModelRequest[] = [];
  const seenModels = new Set<string>();
  const lowerInput = input.toLowerCase();
  const modelMatches = [
    ...lowerInput.matchAll(DATA_MODEL_PATTERN),
    ...lowerInput.matchAll(DATA_MODEL_PATTERN_NAME_FIRST),
  ];
  for (const match of modelMatches) {
    const raw = match[1];
    if (raw === undefined) continue;
    const singular = raw.endsWith('ies') ? `${raw.slice(0, -3)}y` : raw.endsWith('s') ? raw.slice(0, -1) : raw;
    if (STOP_MODEL_NAMES.has(singular) || singular.length < 3) continue;
    if (seenModels.has(singular)) continue;
    seenModels.add(singular);
    dataModels.push({ name: titleCase(singular), evidence: match[0].trim() });
  }

  /* ------------------------------------------------------ generic pages */
  const genericPages: Array<{ name: string; evidence: string }> = [];
  const seenPages = new Set<string>();
  for (const match of input.toLowerCase().matchAll(GENERIC_PAGE_PATTERN)) {
    const raw = match[0].trim();
    // "users list page" is the list archetype, not a bespoke page named "users".
    if (/\b(list|table|records?) (page|screen)\b/.test(raw)) continue;
    const words = [match[1], match[2]]
      .filter((word): word is string => word !== undefined && word !== '')
      .filter((word) => !KNOWN_PAGE_WORDS.has(word));
    if (words.length === 0) continue;
    const name = words.join(' ');
    if (seenPages.has(name)) continue;
    seenPages.add(name);
    genericPages.push({ name: titleCase(name), evidence: raw });
  }

  /* ------------------------------------------------------------ colors */
  const colors: Array<{ value: string; evidence: string }> = [];
  const seenColors = new Set<string>();
  for (const [name, hex] of Object.entries(COLOR_RULES)) {
    if (findPhrases(input.toLowerCase(), [name]).length > 0 && !seenColors.has(hex)) {
      seenColors.add(hex);
      colors.push({ value: hex, evidence: name });
    }
  }
  for (const match of input.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = match[0].toLowerCase();
    if (!seenColors.has(hex)) {
      seenColors.add(hex);
      colors.push({ value: hex, evidence: match[0] });
    }
  }

  return {
    facts,
    appMentions,
    dataModels,
    genericPages,
    colors,
    projectName: extractProjectName(input),
    unsupported: [...unsupported.values()],
    unmatchedClauses,
    sentenceCount: sentences.length,
  };
}

const NAME_STOP_WORDS = new Set([
  'with',
  'that',
  'which',
  'using',
  'for',
  'and',
  'called',
  'named',
  'the',
  'a',
  'an',
]);

export function extractProjectName(input: string): ExtractionResult['projectName'] {
  const quoted = /(?:called|named|title[ds]?)\s*["']([^"']{2,60})["']/i.exec(input);
  if (quoted?.[1] !== undefined) {
    return { value: quoted[1].trim(), evidence: quoted[0], explicit: true };
  }
  const colonForm = /(?:project|app|application|website)\s+(?:name\s*)?[:=]\s*["']?([a-z0-9][a-z0-9 _.-]{1,50})/i.exec(input);
  if (colonForm?.[1] !== undefined) {
    const candidate = colonForm[1].replace(/[.]$/, '').trim();
    if (candidate !== '') return { value: candidate, evidence: colonForm[0], explicit: true };
  }
  // A name ends at the next clause connector: "called Demo Dashboard with a login page".
  const called =
    /(?:called|named)\s+([a-z0-9][a-z0-9 _-]{1,60}?)(?=\s+(?:with|that|which|using|including|and|plus|containing)\b|[,.;]|$)/i.exec(
      input,
    );
  if (called?.[1] !== undefined) {
    const words = called[1]
      .trim()
      .split(/\s+/)
      .filter((word) => word !== '')
      .slice(0, 6)
      .filter((word) => !NAME_STOP_WORDS.has(word.toLowerCase()));
    if (words.length > 0) {
      return { value: titleCase(words.join(' ')), evidence: called[0], explicit: true };
    }
  }
  const appForm = /(?:build|create|make|generate)\s+(?:me\s+)?(?:an?|the)\s+([a-z0-9][a-z0-9 _-]{1,40}?)\s+(?:app|application|website|site|api|backend)/i.exec(
    input,
  );
  if (appForm?.[1] !== undefined) {
    return { value: titleCase(appForm[1].trim()), evidence: appForm[0], explicit: false };
  }
  return null;
}

export function factsFor(result: ExtractionResult, application: AppKind | null, category?: RequirementCategory): ExtractedFact[] {
  return result.facts.filter(
    (fact) => fact.application === application && (category === undefined || fact.category === category),
  );
}

export function firstFact(result: ExtractionResult, category: RequirementCategory): ExtractedFact | undefined {
  return result.facts.find((fact) => fact.category === category);
}

export function uniqueValues(facts: readonly ExtractedFact[]): string[] {
  return [...new Set(facts.map((fact) => fact.value))];
}

export function clauseText(clause: Clause): string {
  return clause.raw;
}
