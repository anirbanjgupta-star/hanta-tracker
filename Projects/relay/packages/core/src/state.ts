import { hashContent } from './hash.js';
import { validApproval, type ApprovalContext } from './ledger.js';
import type { ArtifactKind, Stage, WorkItem } from './types.js';

// Every kind is always approved at the same gate and always advances to the
// same next stage — the playbook's stage order is fixed. What varies per lane
// is which kinds are required at all (SPEC §7.6): express requires only
// `plan`, so its chain is a single link straight to `done`.
export const GATE_FOR_KIND: Record<ArtifactKind, Stage> = {
  intent: 'plan',
  spec: 'design',
  plan: 'build',
};
const NEXT_STAGE: Record<ArtifactKind, Stage> = {
  intent: 'design',
  spec: 'build',
  plan: 'done',
};

export function deriveStage(item: WorkItem, ctx: ApprovalContext): Stage {
  let stage: Stage = 'intake';

  const chain = ctx.lane.requires.map((kind) => ({
    gate: GATE_FOR_KIND[kind],
    kind,
    next: NEXT_STAGE[kind],
  }));

  for (const link of chain) {
    const artifact = item.artifacts[link.kind];
    if (!artifact) return stage;

    stage = link.gate;

    const result = validApproval(
      item.approvals,
      link.gate,
      hashContent(artifact.raw),
      ctx
    );
    if (!result.passed) return stage;

    stage = link.next;
  }

  return stage;
}
