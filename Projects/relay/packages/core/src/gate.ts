import { hashContent } from './hash.js';
import { lintArtifact, unresolvedConcerns } from './schema.js';
import { validApproval, type ApprovalContext } from './ledger.js';
import { GATE_FOR_KIND } from './state.js';
import type { ArtifactKind, GateResult, Stage, WorkItem } from './types.js';

// Derived from GATE_FOR_KIND rather than hand-duplicated — it's the same
// bijection read the other way, and a second hardcoded copy is exactly how
// the two maps would quietly drift if a kind or gate ever changed.
export const KIND_FOR_GATE = Object.fromEntries(
  Object.entries(GATE_FOR_KIND).map(([kind, gate]) => [gate, kind])
) as Partial<Record<Stage, ArtifactKind>>;

export interface GateChecks {
  /** Build gate only: did the tests named in plan.md run and pass? Core
   *  cannot execute tests itself, so the caller (the CLI, in CI or locally)
   *  supplies the evidence. Defaults to false — no evidence, no pass. */
  testsRan?: boolean;
}

function chainReasons(item: WorkItem, kind: ArtifactKind, ctx: ApprovalContext): string[] {
  const idx = ctx.lane.requires.indexOf(kind);
  if (idx <= 0) return []; // first required artifact in this lane has nothing upstream to check

  const priorKind = ctx.lane.requires[idx - 1];
  const priorArtifact = item.artifacts[priorKind];
  const artifact = item.artifacts[kind]!;

  if (!priorArtifact) {
    return [`${kind}.md exists but its upstream ${priorKind}.md does not`];
  }

  const priorHash = hashContent(priorArtifact.raw);
  const priorApproval = validApproval(item.approvals, GATE_FOR_KIND[priorKind], priorHash, ctx);
  if (!priorApproval.passed) {
    return [`upstream ${priorKind} is not currently approved: ${priorApproval.reasons.join('; ')}`];
  }

  if (artifact.upstream !== priorHash) {
    return [
      `upstream does not match the current ${priorKind} (frontmatter names ${artifact.upstream ?? 'nothing'}, current is ${priorHash})`,
    ];
  }

  return [];
}

export function evaluateGate(
  item: WorkItem,
  gate: Stage,
  ctx: ApprovalContext,
  checks: GateChecks = {}
): GateResult {
  const kind = KIND_FOR_GATE[gate];
  if (!kind) {
    return { gate, passed: false, reasons: [`${gate} is not a gate with an artifact of its own`] };
  }

  const artifact = item.artifacts[kind];
  if (!artifact) {
    return { gate, passed: false, reasons: [`${kind}.md does not exist yet`] };
  }

  const reasons: string[] = [];

  // Condition 1 — completeness (frontmatter + body sections)
  reasons.push(...lintArtifact(artifact).problems);

  // Condition 1b — chain integrity (upstream names the currently-approved prior artifact)
  reasons.push(...chainReasons(item, kind, ctx));

  // Condition 2 — stage-specific checks
  if (gate === 'design') {
    const unresolved = unresolvedConcerns(artifact.body);
    if (unresolved.length > 0) {
      reasons.push(`Flagged concerns without a resolution: ${unresolved.join('; ')}`);
    }
  }
  if (gate === 'build' && !checks.testsRan) {
    reasons.push('Tests named in plan.md have not been confirmed to run and pass');
  }

  // Condition 3 — authority (a valid, current, correctly-roled approval).
  // validApproval's `reasons` is an info channel, not strictly a failure
  // list — a passing override carries an explanatory message ("Passed by
  // recorded override: ...") alongside passed:true. Only fold its reasons
  // in when authority itself failed, so a valid override doesn't get
  // flipped to passed:false by reasons.length === 0 below.
  const currentHash = hashContent(artifact.raw);
  const authority = validApproval(item.approvals, gate, currentHash, ctx);
  if (!authority.passed) {
    reasons.push(...authority.reasons);
  }

  return { gate, passed: reasons.length === 0, reasons };
}
