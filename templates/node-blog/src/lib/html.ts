/**
 * HTML helpers.
 *
 * Every dynamic value in a view goes through `escapeHtml` or `escapeAttribute`.
 * Nothing in the generated blog marks a string as trusted HTML: views compose
 * structure, content stays data.
 */
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** XML uses the same five entities as HTML; named separately for feed code. */
export const escapeXml = escapeHtml;

export function escapeAttribute(value: string | number): string {
  return escapeHtml(value);
}

/** Join class names, dropping falsey entries. */
export function classes(...values: ReadonlyArray<string | false | null | undefined>): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ');
}

/** Render a definition list from label/value pairs, skipping missing values. */
export function metaList(entries: ReadonlyArray<readonly [string, string | null]>): string {
  const items = entries
    .filter((entry): entry is readonly [string, string] => entry[1] !== null && entry[1] !== '')
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');
  return items === '' ? '' : `<dl class="meta-list">${items}</dl>`;
}
