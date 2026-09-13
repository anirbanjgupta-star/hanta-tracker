import { parse as parseYaml } from 'yaml';
import type { Artifact, ArtifactKind, Lane } from './types.js';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseArtifact(raw: string, kind: ArtifactKind): Artifact {
  const match = raw.match(FRONTMATTER);
  if (!match) throw new Error('Artifact is missing YAML frontmatter');

  const fm = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  const body = raw.slice(match[0].length);

  if (typeof fm.id !== 'string' || fm.id.length === 0) {
    throw new Error('Artifact frontmatter is missing `id`');
  }

  return {
    kind,
    itemId: fm.id,
    lane: (fm.lane as Lane) ?? 'standard',
    upstream: typeof fm.upstream === 'string' ? fm.upstream : null,
    policies: Array.isArray(fm.policies) ? (fm.policies as string[]) : [],
    externalRef:
      typeof fm.external_ref === 'string' ? fm.external_ref : null,
    origin: fm.origin === 'adopted' ? 'adopted' : 'authored',
    body,
    raw,
  };
}
