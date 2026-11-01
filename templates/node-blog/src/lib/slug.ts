/**
 * Slug rules, shared by categories, tags and the test suite.
 *
 * Content keeps its display name (for example "Design"), while URLs only ever
 * contain these slugs.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
