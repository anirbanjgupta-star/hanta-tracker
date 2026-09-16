import { hashContent, KIND_FOR_GATE, type Approval, type Stage } from '@relay/core';
import { loadWorkItem, appendApproval, loadEvents } from '../relay-dir.js';
import { loadRelayConfig, buildApprovalContext } from '../context.js';
import { LegacyJsonAdapter } from '../adapters/legacy-json.js';

const VERDICT_FOR_ACTION = {
  approve: 'approved',
  reject: 'rejected',
  override: 'override',
} as const;

export type GateAction = keyof typeof VERDICT_FOR_ACTION;

// appendApproval runs before the first `await`, so a caller that does not
// await runGate still gets a durable ledger write — it just won't observe
// the legacy-adapter push, which happens after.
export async function runGate(
  id: string,
  gate: Stage,
  action: GateAction,
  reason: string | undefined,
  cwd: string
): Promise<Approval> {
  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(id, config.defaultLane, cwd);
  const ctx = buildApprovalContext(cwd, config.lanes[item.lane]);

  const kind = KIND_FOR_GATE[gate];
  if (!kind) throw new Error(`${gate} is not a gate with an artifact of its own`);
  const artifact = item.artifacts[kind];
  if (!artifact) throw new Error(`${kind}.md does not exist yet for ${id}`);

  // The recorded role is the audit trail's answer to "in what capacity did
  // this identity approve?" — an identity can hold several roles (the
  // default roles.yml gives one person product-owner, tech-lead AND
  // engineer), so record whichever held role actually satisfies this gate's
  // requirement, not just whatever happens to be listed first.
  const heldRoles = ctx.roles[ctx.author] ?? [];
  const requiredRoles = ctx.lane.gateRoles[gate] ?? [];
  const role = heldRoles.find((r) => requiredRoles.includes(r)) ?? heldRoles[0] ?? 'unspecified';
  const approval: Approval = {
    ts: new Date().toISOString(),
    itemId: id,
    gate,
    artifact: `${kind}.md`,
    hash: hashContent(artifact.raw),
    identity: ctx.author,
    role,
    verdict: VERDICT_FOR_ACTION[action],
    ...(reason ? { reason } : {}),
  };

  const requestEvents = loadEvents(id, cwd)
    .filter((e) => e.type === 'gate_requested' && e.gate === gate)
    .sort((a, b) => Date.parse(String(a.ts)) - Date.parse(String(b.ts)));
  const lastRequest = requestEvents.at(-1);
  if (lastRequest) {
    approval.latencyS = (Date.parse(approval.ts) - Date.parse(String(lastRequest.ts))) / 1000;
  }

  appendApproval(id, approval, cwd);

  if (action === 'approve' && config.sourceOfTruth === 'legacy' && artifact.externalRef) {
    await new LegacyJsonAdapter(cwd).push(item, artifact);
  }

  return approval;
}
