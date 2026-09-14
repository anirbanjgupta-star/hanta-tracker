import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent, type ArtifactKind, type Stage } from '@relay/core';
import { loadWorkItem, itemDir } from '../relay-dir.js';
import { loadRelayConfig } from '../context.js';
import { openItemsFor } from '../sections.js';

export type HandoverTarget = 'design' | 'build';

// Scoped to v1's two real handoff points. `intake` has no upstream artifact
// to freeze yet, and `done` is terminal with nothing owed next — neither
// receives a handover.
//
// "Open items inherited" (Part 3) means something different per upstream
// kind: intent.md has a literal "## Open questions" section, but spec.md's
// equivalent is its "Flagged concerns" checklist, not a heading of that
// name — so open items are resolved via the shared per-kind openItemsFor
// helper rather than one function naively assuming every artifact shares
// intent's section names.
const TARGETS: Record<
  HandoverTarget,
  { upstreamKind: ArtifactKind; owedKind: ArtifactKind; owedGate: Stage }
> = {
  design: { upstreamKind: 'intent', owedKind: 'spec', owedGate: 'design' },
  build: { upstreamKind: 'spec', owedKind: 'plan', owedGate: 'build' },
};

export function runHandover(id: string, toStage: HandoverTarget, cwd: string): string {
  const target = TARGETS[toStage];
  if (!target) throw new Error(`No handover bundle is defined for stage: ${toStage}`);

  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(id, config.defaultLane, cwd);
  const artifact = item.artifacts[target.upstreamKind];
  if (!artifact) throw new Error(`${target.upstreamKind}.md does not exist yet for ${id}`);

  const openItems = openItemsFor(target.upstreamKind, artifact.body) ?? 'None recorded.';
  const policies = artifact.policies.length > 0 ? artifact.policies.join(', ') : 'none declared';

  // Part 2 is deliberately left for a human/skill to fill in, not
  // auto-generated: nothing in Artifact's shape captures "what was decided
  // and rejected in conversation" — there is no field to pull it from.
  const bundle = `# Handover — ${id} → ${toStage}

## 1. Frozen upstream artifact

\`${target.upstreamKind}.md\`, content-hashed: \`${hashContent(artifact.raw)}\`

\`\`\`markdown
${artifact.raw}
\`\`\`

## 2. Decisions made and alternatives rejected

_Fill in before sending: what was decided in conversation while drafting ${target.upstreamKind}.md, and what alternatives were considered and rejected. This cannot be reconstructed from the file alone._

## 3. Open questions inherited

${openItems}

## 4. Applicable policies

${policies}

## 5. What this stage owes

Produce \`${target.owedKind}.md\`, complete per \`relay lint\`, and win an approval at the \`${target.owedGate}\` gate.
`;

  const dir = join(itemDir(id, cwd), 'handover');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${toStage}.md`);
  writeFileSync(path, bundle);
  return path;
}
