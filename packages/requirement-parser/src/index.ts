export { containsPhrase, findPhrases, normalizeText, segment, splitList, type Clause, type Sentence } from './normalize.js';
export {
  ALL_RULES,
  APPLICATION_RULES,
  AUTH_RULES,
  COLOR_RULES,
  DATA_RULES,
  DESIGN_RULES,
  DESIGN_PRESET_RULES,
  INTEGRATION_RULES,
  NATIVE_RULES,
  OFFLINE_RULES,
  PAGE_RULES,
  STATE_RULES,
  TESTING_RULES,
  type LexiconRule,
  type RuleScope,
} from './lexicon.js';
export {
  extractFacts,
  extractProjectName,
  factsFor,
  firstFact,
  uniqueValues,
  type AppKind,
  type AppMention,
  type DataModelRequest,
  type ExtractedFact,
  type ExtractionResult,
} from './extract.js';
export { INTERPRETER_VERSION, interpretRequirement, type InterpretationOutcome } from './interpreter.js';
export {
  INTENT_PRIORITY,
  classifyIntent,
  describeIntent,
  type Intent,
  type IntentClassification,
  type IntentMatch,
} from './intent.js';
