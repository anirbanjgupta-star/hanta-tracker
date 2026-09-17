import { describe, it, expect } from 'vitest';
import { parseArtifact } from '../src/artifact.js';

const SAMPLE = `---
id: 047-sso-for-admin
lane: governed
stage: design
upstream: sha256:abc123
policies: [security-baseline]
---

# Problem

Admins share one password.
`;

describe('parseArtifact', () => {
  it('reads frontmatter into typed fields', () => {
    const a = parseArtifact(SAMPLE, 'spec');
    expect(a.itemId).toBe('047-sso-for-admin');
    expect(a.lane).toBe('governed');
    expect(a.upstream).toBe('sha256:abc123');
    expect(a.policies).toEqual(['security-baseline']);
  });

  it('keeps the raw text byte-exact for hashing', () => {
    expect(parseArtifact(SAMPLE, 'spec').raw).toBe(SAMPLE);
  });

  it('IGNORES the stage field — state is derived, never stored', () => {
    const a = parseArtifact(SAMPLE, 'spec') as unknown as Record<string, unknown>;
    expect(a.stage).toBeUndefined();
  });

  it('defaults origin to authored and externalRef to null', () => {
    const a = parseArtifact(SAMPLE, 'spec');
    expect(a.origin).toBe('authored');
    expect(a.externalRef).toBeNull();
  });

  it('parses origin: stage6-detector distinctly from adopted and authored', () => {
    const raw = '---\nid: 001-x\nlane: standard\norigin: stage6-detector\n---\n\n## Problem\np\n';
    const artifact = parseArtifact(raw, 'intent');
    expect(artifact.origin).toBe('stage6-detector');
  });

  it('throws when frontmatter is missing', () => {
    expect(() => parseArtifact('# no frontmatter', 'intent')).toThrow(
      /frontmatter/i
    );
  });
});
