import type {
  Approval,
  GateResult,
  LaneRule,
  RoleMap,
  Stage,
} from './types.js';

export interface ApprovalContext {
  roles: RoleMap;
  lane: LaneRule;
  author: string;
}

// Records are ordered by real time, never by string order: two valid ISO-8601
// timestamps with different UTC offsets sort wrongly as strings, which would let
// an earlier record win as "latest" and flip a gate. Hand-edited ledgers are a
// supported door (SPEC 10), so this is reachable, not theoretical.
function epoch(ts: string): number {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) {
    throw new Error(`Approval record has an unparseable timestamp: ${ts}`);
  }
  return ms;
}

export function parseLedger(text: string): Approval[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Approval);
}

export function serialiseApproval(a: Approval): string {
  return JSON.stringify(a);
}

export function validApproval(
  approvals: Approval[],
  gate: Stage,
  currentHash: string,
  ctx: ApprovalContext
): GateResult {
  // Every record is validated, not just the ones a comparator happens to visit:
  // .sort() never calls the comparator on a single-element array.
  const forGate = approvals
    .filter((a) => a.gate === gate)
    .map((a) => ({ record: a, at: epoch(a.ts) }))
    .sort((x, y) => x.at - y.at)
    .map((x) => x.record);

  const latest = forGate[forGate.length - 1];
  if (!latest) {
    return { gate, passed: false, reasons: ['No approval recorded'] };
  }

  if (latest.verdict === 'rejected') {
    return { gate, passed: false, reasons: ['Last verdict was a rejection'] };
  }

  if (latest.hash !== currentHash) {
    return {
      gate,
      passed: false,
      reasons: [
        `Artifact changed since approval (approved ${latest.hash}, current ${currentHash})`,
      ],
    };
  }

  if (latest.verdict === 'override') {
    if (!latest.reason || latest.reason.trim().length === 0) {
      return { gate, passed: false, reasons: ['Override recorded with no reason'] };
    }
    return {
      gate,
      passed: true,
      reasons: [`Passed by recorded override: ${latest.reason}`],
    };
  }

  const required = ctx.lane.gateRoles[gate] ?? [];
  const held = ctx.roles[latest.identity] ?? [];
  if (required.length > 0 && !required.some((r) => held.includes(r))) {
    return {
      gate,
      passed: false,
      reasons: [
        `${latest.identity} does not hold a required role (${required.join(', ')})`,
      ],
    };
  }

  if (!ctx.lane.allowSelfApproval && latest.identity === ctx.author) {
    return {
      gate,
      passed: false,
      reasons: ['Self-approval is not permitted in this lane'],
    };
  }

  return { gate, passed: true, reasons: [] };
}
