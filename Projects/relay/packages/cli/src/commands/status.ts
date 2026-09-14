import { deriveStage, evaluateGate, KIND_FOR_GATE, type Stage } from '@relay/core';
import { loadWorkItem } from '../relay-dir.js';
import { resolveCurrentItemId } from '../current-item.js';
import { loadRelayConfig, buildApprovalContext } from '../context.js';

export interface StatusResult {
  id: string;
  lane: string;
  stage: Stage;
  blockedBy: string[];
}

export function runStatus(cwd: string, idOverride?: string): StatusResult {
  const id = idOverride ?? resolveCurrentItemId(cwd);
  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(id, config.defaultLane, cwd);
  const ctx = buildApprovalContext(cwd, config.lanes[item.lane]);

  // Two different checks, deliberately: deriveStage walks the artifact chain
  // to find the current stage (authority only); evaluateGate then explains
  // why that stage is blocked (completeness + chain integrity + stage
  // checks + authority). Do not collapse this into one evaluateGate call —
  // deriveStage's cheaper, chain-only logic is what the dashboard's
  // pipeline-lane placement will also use.
  //
  // evaluateGate only runs once this stage's own artifact actually exists.
  // Arriving at a stage means the PREVIOUS gate was just approved — the
  // artifact this stage owns (e.g. spec.md, on arrival at 'design') hasn't
  // been drafted yet, and evaluateGate's completeness check would otherwise
  // report "does not exist yet" as if something were wrong. That's not a
  // blocker, it's just day one of the stage — 'intake'/'done' have no gate
  // of their own and hit this same "nothing to evaluate yet" path via
  // KIND_FOR_GATE[stage] being undefined.
  const stage = deriveStage(item, ctx);
  const kind = KIND_FOR_GATE[stage];
  const blockedBy = kind && item.artifacts[kind] ? evaluateGate(item, stage, ctx).reasons : [];

  return { id, lane: item.lane, stage, blockedBy };
}
