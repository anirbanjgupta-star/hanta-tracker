import { sections, unresolvedConcerns, type ArtifactKind } from '@relay/core';

// Thin wrapper over @relay/core's own section parser, not a second
// implementation of it — a fix to fenced-code-block handling or heading
// parsing there must not have to be made twice.
export function extractSection(body: string, title: string): string | null {
  const content = sections(body).get(title.toLowerCase());
  return content === undefined ? null : content.trim();
}

// "Open items" means something different per artifact kind: intent.md has a
// literal "Open questions" section; spec.md's equivalent is its unresolved
// "Flagged concerns" checklist; plan.md has no analogous concept.
export function openItemsFor(kind: ArtifactKind, body: string): string | null {
  if (kind === 'intent') {
    return extractSection(body, 'open questions') || null;
  }
  if (kind === 'spec') {
    const unresolved = unresolvedConcerns(body);
    return unresolved.length > 0 ? unresolved.map((c) => `- ${c}`).join('\n') : null;
  }
  return null;
}
