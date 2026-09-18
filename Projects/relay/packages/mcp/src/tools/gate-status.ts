import { runStatus, loadRelayConfig, buildApprovalContext, loadWorkItem } from '@relay/cli/lib';

export interface GateStatusResult {
  gate: string | null;
  reasons: string[];
  canClear: string[];
}

export function gateStatus(cwd: string, idOverride?: string): GateStatusResult {
  const status = runStatus(cwd, idOverride);
  if (status.blockedBy.length === 0) {
    return { gate: null, reasons: [], canClear: [] };
  }

  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(status.id, config.defaultLane, cwd);
  const ctx = buildApprovalContext(cwd, config.lanes[item.lane]);
  const requiredRoles = ctx.lane.gateRoles[status.stage] ?? [];

  const canClear = requiredRoles.length === 0
    ? Object.keys(ctx.roles)
    : Object.entries(ctx.roles)
        .filter(([, roles]) => roles.some((r) => requiredRoles.includes(r)))
        .map(([identity]) => identity);

  return { gate: status.stage, reasons: status.blockedBy, canClear };
}
