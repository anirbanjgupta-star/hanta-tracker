import { runStatus, appendEvent, buildApprovalContext, loadRelayConfig, loadWorkItem } from '@relay/cli/lib';

export interface RequestGateResult {
  recorded: boolean;
  gate: string;
}

export function requestGate(cwd: string, idOverride?: string): RequestGateResult {
  const status = runStatus(cwd, idOverride);
  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(status.id, config.defaultLane, cwd);
  const ctx = buildApprovalContext(cwd, config.lanes[item.lane]);

  appendEvent(status.id, {
    ts: new Date().toISOString(),
    type: 'gate_requested',
    gate: status.stage,
    identity: ctx.author,
  }, cwd);

  return { recorded: true, gate: status.stage };
}
