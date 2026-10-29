/**
 * Text normalisation and segmentation.
 *
 * The interpreter works on sentences and clauses rather than the whole string:
 * "a React website with a login page, dark theme, and a separate FastAPI backend
 * that uses SQLite" contains requirements scoped to two different applications.
 * Clause structure is what makes that scoping possible without an LLM.
 */

export interface Clause {
  /** Lower-case, punctuation-normalised text. */
  readonly text: string;
  /** Original text of this clause, trimmed (used as evidence). */
  readonly raw: string;
  readonly sentenceIndex: number;
  readonly clauseIndex: number;
}

export interface Sentence {
  readonly text: string;
  readonly raw: string;
  readonly index: number;
  readonly clauses: readonly Clause[];
}

/** Connectors that start a new clause while keeping the sentence's subject. */
const CLAUSE_BOUNDARY = /\s*(?:,|;|\band\b|\bwith\b|\bplus\b|\balso\b|\bthen\b|\bthat\b|\bwhich\b|\bincluding\b)\s*/gi;

export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, ' - ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function trimClause(text: string): string {
  return text
    .replace(/^[\s\-:]+/, '')
    .replace(/[\s.]+$/, '')
    .trim();
}

export function segment(input: string): Sentence[] {
  const normalized = normalizeText(input);
  // Sentence split: terminal punctuation followed by space or end of input.
  const sentenceTexts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');

  return sentenceTexts.map((sentence, sentenceIndex) => {
    const rawSentence = sentence.replace(/[.!?]+$/, '');
    const pieces = rawSentence.split(CLAUSE_BOUNDARY);
    const clauses: Clause[] = [];
    let offset = 0;
    for (const [clauseIndex, piece] of pieces.entries()) {
      const text = trimClause(piece);
      if (text === '') continue;
      clauses.push({
        text,
        raw: text,
        sentenceIndex,
        clauseIndex,
      });
      offset += piece.length;
    }
    // If splitting produced nothing usable, keep the whole sentence as one clause.
    if (clauses.length === 0) {
      clauses.push({ text: trimClause(rawSentence), raw: trimClause(rawSentence), sentenceIndex, clauseIndex: 0 });
    }
    return { text: rawSentence, raw: rawSentence, index: sentenceIndex, clauses };
  });
}

/** Does the clause contain one of the phrases as a whole word sequence? */
export function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
  return pattern.test(text);
}

export function findPhrases(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => containsPhrase(text, phrase));
}

/** Split a list-like phrase ("a, b and c") into trimmed items. */
export function splitList(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\band\b|\bor\b)\s*/i)
    .map((item) => trimClause(item))
    .filter((item) => item !== '');
}
