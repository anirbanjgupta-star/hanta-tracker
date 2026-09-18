import { describe, it, expect } from 'vitest';
import { evaluateGate } from '../src/gate.js';
import { hashContent } from '../src/hash.js';
import type { Approval, Artifact, LaneRule, RoleMap, WorkItem } from '../src/types.js';

const ROLES: RoleMap = {
  'po@example.com': ['product-owner'],
  'eng@example.com': ['engineer'],
};

const STANDARD: LaneRule = {
  requires: ['intent', 'spec', 'plan'],
  gateRoles: { plan: ['product-owner'], design: ['product-owner'], build: ['engineer'] },
  allowSelfApproval: true,
  driftIsFatal: false,
};

const EXPRESS: LaneRule = {
  requires: ['plan'],
  gateRoles: {},
  allowSelfApproval: true,
  driftIsFatal: false,
};

function intent(raw: string): Artifact {
  return {
    kind: 'intent', itemId: '001-x', lane: 'standard', upstream: null,
    policies: [], externalRef: null, origin: 'authored', body: raw, raw,
  };
}

function spec(raw: string, upstream: string | null): Artifact {
  return {
    kind: 'spec', itemId: '001-x', lane: 'standard', upstream,
    policies: [], externalRef: null, origin: 'authored', body: raw, raw,
  };
}

function plan(raw: string, upstream: string | null, lane: 'standard' | 'express' = 'standard'): Artifact {
  return {
    kind: 'plan', itemId: '001-x', lane, upstream,
    policies: [], externalRef: null, origin: 'authored', body: raw, raw,
  };
}

function approval(over: Partial<Approval>): Approval {
  return {
    ts: '2026-09-11T10:00:00Z', itemId: '001-x', gate: 'design', artifact: 'spec.md',
    hash: 'sha256:X', identity: 'po@example.com', role: 'product-owner', verdict: 'approved',
    ...over,
  };
}

const SPEC_BODY = '## Requirements\nr\n\n## Design\nd\n\n## Flagged concerns\n- [x] none — accepted risk: n/a\n';
const PLAN_BODY = '## Files that change\n`a.ts`\n\n## Work order\n1.\n\n## Tests that prove completion\n`a.test.ts`\n';

describe('evaluateGate — design gate', () => {
  const ctx = { roles: ROLES, lane: STANDARD, author: 'eng@example.com' };

  it('passes when lint, chain integrity, concerns and authority all hold', () => {
    const intentArtifact = intent('i');
    const intentHash = hashContent('i');
    const specArtifact = spec(SPEC_BODY, intentHash);
    const specHash = hashContent(SPEC_BODY);
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: intentArtifact, spec: specArtifact },
      approvals: [
        approval({ gate: 'plan', hash: intentHash }),
        approval({ gate: 'design', hash: specHash }),
      ],
    };
    const r = evaluateGate(item, 'design', ctx);
    expect(r.passed).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('fails and reports lint problems when a required section is missing', () => {
    const intentArtifact = intent('i');
    const intentHash = hashContent('i');
    const badSpec = '## Requirements\nr\n';
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: intentArtifact, spec: spec(badSpec, intentHash) },
      approvals: [approval({ gate: 'plan', hash: intentHash }), approval({ gate: 'design', hash: hashContent(badSpec) })],
    };
    const r = evaluateGate(item, 'design', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/Design/);
  });

  it('fails when upstream does not match the current intent (chain integrity)', () => {
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: intent('i'), spec: spec(SPEC_BODY, 'sha256:' + 'f'.repeat(64)) },
      approvals: [approval({ gate: 'plan', hash: hashContent('i') }), approval({ gate: 'design', hash: hashContent(SPEC_BODY) })],
    };
    const r = evaluateGate(item, 'design', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/upstream does not match/i);
  });

  it('fails when the upstream intent is not itself approved', () => {
    const intentHash = hashContent('i');
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: intent('i'), spec: spec(SPEC_BODY, intentHash) },
      approvals: [approval({ gate: 'design', hash: hashContent(SPEC_BODY) })], // no 'plan' gate approval
    };
    const r = evaluateGate(item, 'design', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/not currently approved/i);
  });

  it('fails on an unresolved flagged concern even with a valid approval', () => {
    const intentHash = hashContent('i');
    const openConcern = SPEC_BODY.replace('- [x] none — accepted risk: n/a', '- [ ] unresolved thing');
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: intent('i'), spec: spec(openConcern, intentHash) },
      approvals: [approval({ gate: 'plan', hash: intentHash }), approval({ gate: 'design', hash: hashContent(openConcern) })],
    };
    const r = evaluateGate(item, 'design', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/unresolved thing/);
  });

  it('accumulates reasons from more than one failing condition at once', () => {
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: intent('i'), spec: spec('## Requirements\nr\n', 'sha256:' + 'f'.repeat(64)) },
      approvals: [],
    };
    const r = evaluateGate(item, 'design', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(1);
  });
});

describe('evaluateGate — override verdict', () => {
  const ctx = { roles: ROLES, lane: STANDARD, author: 'eng@example.com' };

  it('passes on a valid override and does not leak its informational reason into r.reasons', () => {
    const intentArtifact = intent('i');
    const intentHash = hashContent('i');
    const specArtifact = spec(SPEC_BODY, intentHash);
    const specHash = hashContent(SPEC_BODY);
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: intentArtifact, spec: specArtifact },
      approvals: [
        approval({ gate: 'plan', hash: intentHash }),
        approval({ gate: 'design', hash: specHash, verdict: 'override', reason: 'ship it, reviewed offline' }),
      ],
    };
    const r = evaluateGate(item, 'design', ctx);
    expect(r.passed).toBe(true);
    expect(r.reasons.some((reason) => reason.includes('Passed by recorded override'))).toBe(false);
  });
});

describe('evaluateGate — build gate', () => {
  const ctx = { roles: ROLES, lane: STANDARD, author: 'po@example.com' };

  it('fails when testsRan is not confirmed, even if everything else passes', () => {
    const specHash = hashContent(SPEC_BODY);
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { spec: spec(SPEC_BODY, hashContent('i')), plan: plan(PLAN_BODY, specHash) },
      approvals: [approval({ gate: 'design', hash: specHash }), approval({ gate: 'build', hash: hashContent(PLAN_BODY), identity: 'eng@example.com', role: 'engineer' })],
    };
    const r = evaluateGate(item, 'build', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/tests/i);
  });

  it('passes when testsRan is confirmed and everything else holds', () => {
    const specHash = hashContent(SPEC_BODY);
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { spec: spec(SPEC_BODY, hashContent('i')), plan: plan(PLAN_BODY, specHash) },
      approvals: [approval({ gate: 'design', hash: specHash }), approval({ gate: 'build', hash: hashContent(PLAN_BODY), identity: 'eng@example.com', role: 'engineer' })],
    };
    const r = evaluateGate(item, 'build', ctx, { testsRan: true });
    expect(r.passed).toBe(true);
  });
});

describe('evaluateGate — express lane has no chain to check', () => {
  const ctx = { roles: ROLES, lane: EXPRESS, author: 'someone-else@example.com' };

  it('passes an express plan.md with no intent or spec at all', () => {
    const raw = PLAN_BODY;
    const item: WorkItem = {
      id: '001-x', lane: 'express',
      artifacts: { plan: plan(raw, null, 'express') },
      approvals: [approval({ gate: 'build', hash: hashContent(raw), identity: 'someone-else@example.com', role: 'engineer' })],
    };
    const r = evaluateGate(item, 'build', ctx, { testsRan: true });
    expect(r.passed).toBe(true);
  });
});

describe('evaluateGate — missing artifact or unknown gate', () => {
  const ctx = { roles: ROLES, lane: STANDARD, author: 'eng@example.com' };

  it('fails cleanly when the artifact for this gate does not exist yet', () => {
    const item: WorkItem = { id: '001-x', lane: 'standard', artifacts: {}, approvals: [] };
    const r = evaluateGate(item, 'design', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/spec\.md does not exist/);
  });

  it('fails cleanly for a stage with no artifact of its own', () => {
    const item: WorkItem = { id: '001-x', lane: 'standard', artifacts: {}, approvals: [] };
    const r = evaluateGate(item, 'intake', ctx);
    expect(r.passed).toBe(false);
  });
});
