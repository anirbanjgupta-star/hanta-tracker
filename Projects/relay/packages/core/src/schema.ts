import type { Artifact, ArtifactKind } from './types.js';

export interface LintResult {
  ok: boolean;
  problems: string[];
}

const REQUIRED_SECTIONS: Record<ArtifactKind, string[]> = {
  intent: [
    'Problem',
    'Proposed outcome',
    'Affected users and systems',
    'Constraints',
    'Open questions',
  ],
  spec: ['Requirements', 'Design', 'Flagged concerns'],
  plan: ['Files that change', 'Work order', 'Tests that prove completion'],
};

const PLACEHOLDERS = /\b(TBD|TODO|FIXME|XXX)\b/;

const VALID_LANES = ['express', 'standard', 'governed'];
const HASH = /^sha256:[0-9a-f]{64}$/;

function frontmatterProblems(artifact: Artifact): string[] {
  const problems: string[] = [];

  if (!VALID_LANES.includes(artifact.lane)) {
    problems.push(`frontmatter lane is not a recognised lane: ${artifact.lane}`);
  }

  // Every kind requires an upstream link except the one kind that can be a
  // lane's very first required artifact with nothing to descend from: a
  // plan.md in the express lane (SPEC §7.6 — "Express | plan.md only").
  // Standard/governed plans follow spec, so they still require it.
  const upstreamRequired =
    artifact.kind === 'spec' || (artifact.kind === 'plan' && artifact.lane !== 'express');
  if (upstreamRequired && !artifact.upstream) {
    problems.push('frontmatter is missing required field: upstream');
  } else if (artifact.upstream && !HASH.test(artifact.upstream)) {
    problems.push(`frontmatter upstream is not a well-formed hash: ${artifact.upstream}`);
  }

  return problems;
}

export function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = body.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const title = (newline === -1 ? part : part.slice(0, newline)).trim();
    const content = newline === -1 ? '' : part.slice(newline + 1);
    out.set(title.toLowerCase(), content);
  }
  return out;
}

export function lintArtifact(artifact: Artifact): LintResult {
  const problems: string[] = frontmatterProblems(artifact);
  const found = sections(artifact.body);

  for (const required of REQUIRED_SECTIONS[artifact.kind]) {
    const content = found.get(required.toLowerCase());
    if (content === undefined) {
      problems.push(`Missing required section: ${required}`);
      continue;
    }
    if (content.trim().length === 0) {
      problems.push(`Section is empty: ${required}`);
      continue;
    }
    if (PLACEHOLDERS.test(content)) {
      problems.push(`Section contains placeholder text: ${required}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

export function unresolvedConcerns(specBody: string): string[] {
  const found = sections(specBody);
  const content = found.get('flagged concerns') ?? '';
  // Convention: "- [ ]" is open, "- [x] ... — resolved:/accepted risk:" is closed.
  return [...content.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1].trim());
}
