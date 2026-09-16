import type { WorkItem, Stage } from './types.js';

export interface FlowMetrics {
  gateLatencyS: Partial<Record<Stage, { count: number; avgS: number }>>;
  stageCycleTimeS: Partial<Record<Stage, { count: number; avgS: number }>>;
  overrideCount: number;
  firstPassRate: number;
}

// The gate a cycle-time interval ENDS at, and the gate it started counting
// from — "time spent in Design" is the delta between the plan gate clearing
// (Design begins) and the design gate clearing (Design ends, Build begins).
const CYCLE_FROM: Partial<Record<Stage, Stage>> = { design: 'plan', build: 'design' };

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// The one 'approved' verdict that actually cleared a gate is whichever
// approval record for that gate has the latest timestamp AND verdict
// 'approved' — a rejection can sit anywhere in the history before it and
// must not be mistaken for the clearance itself.
function latestApprovalByGate(item: WorkItem): Partial<Record<Stage, { ts: string }>> {
  const result: Partial<Record<Stage, { ts: string }>> = {};
  for (const a of item.approvals) {
    if (a.verdict !== 'approved') continue;
    const existing = result[a.gate];
    if (!existing || Date.parse(a.ts) > Date.parse(existing.ts)) {
      result[a.gate] = { ts: a.ts };
    }
  }
  return result;
}

export function computeMetrics(items: WorkItem[]): FlowMetrics {
  const latencyByGate: Partial<Record<Stage, number[]>> = {};
  const cycleByGate: Partial<Record<Stage, number[]>> = {};
  let overrideCount = 0;
  let firstPassCount = 0;
  let approvedGateCount = 0;

  for (const item of items) {
    for (const a of item.approvals) {
      if (a.verdict === 'override') overrideCount++;
      if (a.latencyS !== undefined) {
        (latencyByGate[a.gate] ??= []).push(a.latencyS);
      }
    }

    const cleared = latestApprovalByGate(item);
    for (const [gate, from] of Object.entries(CYCLE_FROM) as [Stage, Stage][]) {
      const end = cleared[gate];
      const start = cleared[from];
      if (end && start) {
        (cycleByGate[gate] ??= []).push((Date.parse(end.ts) - Date.parse(start.ts)) / 1000);
      }
    }

    for (const [gate, latest] of Object.entries(cleared) as [Stage, { ts: string }][]) {
      approvedGateCount++;
      const gateApprovals = item.approvals.filter((a) => a.gate === gate);
      const rejectedBefore = gateApprovals.some(
        (a) => a.verdict === 'rejected' && Date.parse(a.ts) < Date.parse(latest.ts)
      );
      if (!rejectedBefore) firstPassCount++;
    }
  }

  const gateLatencyS: FlowMetrics['gateLatencyS'] = {};
  for (const [gate, values] of Object.entries(latencyByGate) as [Stage, number[]][]) {
    gateLatencyS[gate] = { count: values.length, avgS: average(values) };
  }

  const stageCycleTimeS: FlowMetrics['stageCycleTimeS'] = {};
  for (const [gate, values] of Object.entries(cycleByGate) as [Stage, number[]][]) {
    stageCycleTimeS[gate] = { count: values.length, avgS: average(values) };
  }

  return {
    gateLatencyS,
    stageCycleTimeS,
    overrideCount,
    firstPassRate: firstPassCount / approvedGateCount,
  };
}
