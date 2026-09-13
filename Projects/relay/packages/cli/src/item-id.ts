import { listItemIds } from './relay-dir.js';

// ASCII-only by design: non-alphanumeric characters (including non-ASCII
// letters) collapse to a dash rather than being transliterated. A
// punctuation-only or entirely non-ASCII title yields an empty slug, so the
// id is just its zero-padded counter (e.g. "001-") — degenerate but valid.
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function allocateItemId(title: string, cwd: string): string {
  const ids = listItemIds(cwd);
  const maxCounter = ids.reduce((max, id) => {
    const n = parseInt(id.split('-')[0] ?? '', 10);
    return Number.isNaN(n) ? max : Math.max(max, n);
  }, 0);
  const counter = String(maxCounter + 1).padStart(3, '0');
  return `${counter}-${slugify(title)}`;
}
