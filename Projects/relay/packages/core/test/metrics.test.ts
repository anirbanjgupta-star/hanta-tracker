import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../src/metrics.js';
import type { WorkItem, Approval } from '../src/types.js';

function approval(overrides: Partial<Approval>): Approval {
  return {
    ts: '2026-09-16T10:00:00Z', itemId: '001-x', gate: 'plan', artifact: 'intent.md',
    hash: 'h', identity: 'eng@example.com', role: 'product-owner', verdict: 'approved',
    ...overrides,
  };
}

function item(id: string, approvals: Approval[]): WorkItem {
  return { id, lane: 'standard', artifacts: {}, approvals };
}

describe('computeMetrics', () => {
  it('reports zero/empty metrics for no items', () => {
    const m = computeMetrics([]);
    expect(m.overrideCount).toBe(0);
    expect(m.gateLatencyS).toEqual({});
    expect(m.stageCycleTimeS).toEqual({});
  });

  it('averages gate latency across items that recorded it, ignoring items that did not', () => {
    const items = [
      item('001-x', [approval({ gate: 'plan', latencyS: 10 })]),
      item('002-y', [approval({ gate: 'plan', latencyS: 30 })]),
      item('003-z', [approval({ gate: 'plan' })]), // no latencyS — no matching request was ever made
    ];
    const m = computeMetrics(items);
    expect(m.gateLatencyS.plan).toEqual({ count: 2, avgS: 20 });
  });

  it('computes stage cycle time as the delta between consecutive gate approvals', () => {
    const items = [item('001-x', [
      approval({ gate: 'plan', ts: '2026-09-16T10:00:00Z', verdict: 'approved' }),
      approval({ gate: 'design', ts: '2026-09-16T10:01:40Z', verdict: 'approved' }), // +100s
      approval({ gate: 'build', ts: '2026-09-16T10:03:20Z', verdict: 'approved' }),  // +100s
    ])];
    const m = computeMetrics(items);
    expect(m.stageCycleTimeS.design).toEqual({ count: 1, avgS: 100 });
    expect(m.stageCycleTimeS.build).toEqual({ count: 1, avgS: 100 });
  });

  it('uses only the latest approved verdict per gate for cycle-time math, ignoring a rejected attempt', () => {
    const items = [item('001-x', [
      approval({ gate: 'plan', ts: '2026-09-16T10:00:00Z', verdict: 'approved' }),
      approval({ gate: 'design', ts: '2026-09-16T10:00:30Z', verdict: 'rejected', reason: 'no' }),
      approval({ gate: 'design', ts: '2026-09-16T10:02:00Z', verdict: 'approved' }), // the real clearance, +120s from plan
    ])];
    const m = computeMetrics(items);
    expect(m.stageCycleTimeS.design).toEqual({ count: 1, avgS: 120 });
  });

  it('counts overrides across all items and gates', () => {
    const items = [
      item('001-x', [approval({ gate: 'plan', verdict: 'override', reason: 'urgent' })]),
      item('002-y', [approval({ gate: 'design', verdict: 'approved' })]),
    ];
    expect(computeMetrics(items).overrideCount).toBe(1);
  });

  it('computes first-pass rate — a gate approved with no prior rejection counts as first-pass', () => {
    const items = [
      item('001-x', [approval({ gate: 'plan', verdict: 'approved' })]), // first-pass
      item('002-y', [
        approval({ gate: 'plan', ts: '2026-09-16T10:00:00Z', verdict: 'rejected', reason: 'no' }),
        approval({ gate: 'plan', ts: '2026-09-16T10:01:00Z', verdict: 'approved' }), // not first-pass
      ]),
    ];
    expect(computeMetrics(items).firstPassRate).toBe(0.5);
  });

  it('reports NaN first-pass rate when no gate has ever been approved', () => {
    const items = [item('001-x', [approval({ gate: 'plan', verdict: 'rejected', reason: 'no' })])];
    expect(computeMetrics(items).firstPassRate).toBeNaN();
  });
});
