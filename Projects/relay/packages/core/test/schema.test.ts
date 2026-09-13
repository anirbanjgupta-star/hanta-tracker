import { describe, it, expect } from 'vitest';
import { lintArtifact, unresolvedConcerns } from '../src/schema.js';
import { parseArtifact } from '../src/artifact.js';

function make(body: string): string {
  return `---\nid: 001-x\nlane: standard\n---\n\n${body}`;
}

const COMPLETE_INTENT = make(
  `## Problem\nAdmins share a password.\n\n` +
  `## Proposed outcome\nEach admin signs in individually.\n\n` +
  `## Affected users and systems\nAdmin console, auth service.\n\n` +
  `## Constraints\nMust not break existing sessions.\n\n` +
  `## Open questions\nNone.\n`
);

describe('lintArtifact', () => {
  it('passes a complete intent', () => {
    const r = lintArtifact(parseArtifact(COMPLETE_INTENT, 'intent'));
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it('fails when a required section is missing', () => {
    const r = lintArtifact(parseArtifact(make('## Problem\nx\n'), 'intent'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/Proposed outcome/i);
  });

  it('fails on placeholder text', () => {
    const withTbd = COMPLETE_INTENT.replace('None.', 'TBD');
    const r = lintArtifact(parseArtifact(withTbd, 'intent'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/placeholder/i);
  });

  it('fails on an empty section', () => {
    const empty = COMPLETE_INTENT.replace('None.', '');
    const r = lintArtifact(parseArtifact(empty, 'intent'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/empty/i);
  });

  it('fails when lane is not a recognised value', () => {
    const raw = COMPLETE_INTENT.replace('lane: standard', 'lane: bogus');
    const r = lintArtifact(parseArtifact(raw, 'intent'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/lane/i);
  });

  it('fails when a spec has no upstream', () => {
    const raw = make('## Requirements\nx\n\n## Design\nx\n\n## Flagged concerns\nNone.\n');
    const r = lintArtifact(parseArtifact(raw, 'spec'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/upstream/i);
  });

  it('fails when upstream is not a well-formed hash', () => {
    const raw = make('## Requirements\nx\n\n## Design\nx\n\n## Flagged concerns\nNone.\n')
      .replace('lane: standard', 'lane: standard\nupstream: not-a-hash');
    const r = lintArtifact(parseArtifact(raw, 'spec'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/upstream/i);
  });

  it('passes a spec with a well-formed upstream hash', () => {
    const raw = make('## Requirements\nx\n\n## Design\nx\n\n## Flagged concerns\nNone.\n')
      .replace('lane: standard', `lane: standard\nupstream: sha256:${'a'.repeat(64)}`);
    const r = lintArtifact(parseArtifact(raw, 'spec'));
    expect(r.ok).toBe(true);
  });

  it('allows an intent with no upstream at all', () => {
    const r = lintArtifact(parseArtifact(COMPLETE_INTENT, 'intent'));
    expect(r.ok).toBe(true);
  });

  it('fails when a standard-lane plan has no upstream', () => {
    const raw = make(
      '## Files that change\nx\n\n## Work order\nx\n\n## Tests that prove completion\nx\n'
    );
    const r = lintArtifact(parseArtifact(raw, 'plan'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/upstream/i);
  });

  it('allows an express-lane plan with no upstream — it is the lane\'s only required artifact', () => {
    const raw = make(
      '## Files that change\nx\n\n## Work order\nx\n\n## Tests that prove completion\nx\n'
    ).replace('lane: standard', 'lane: express');
    const r = lintArtifact(parseArtifact(raw, 'plan'));
    expect(r.ok).toBe(true);
  });
});

describe('unresolvedConcerns', () => {
  it('returns concerns marked open', () => {
    const body =
      '## Flagged concerns\n\n' +
      '- [ ] Auth service has no rate limiting on this path\n' +
      '- [x] Session tokens stored in localStorage — resolved: moved to httpOnly cookie\n';
    expect(unresolvedConcerns(body)).toEqual([
      'Auth service has no rate limiting on this path',
    ]);
  });

  it('returns an empty list when every concern is resolved', () => {
    const body =
      '## Flagged concerns\n\n' +
      '- [x] Minor perf regression — accepted risk: below the SLA threshold\n';
    expect(unresolvedConcerns(body)).toEqual([]);
  });

  it('returns an empty list when there is no Flagged concerns section', () => {
    expect(unresolvedConcerns('## Requirements\nx\n')).toEqual([]);
  });
});
