import { describe, it, expect } from 'vitest';
import { deriveStage } from '../src/state.js';
import { hashContent } from '../src/hash.js';
import type { Approval, LaneRule, RoleMap, WorkItem } from '../src/types.js';

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

function artifact(kind: 'intent' | 'spec' | 'plan', raw: string) {
  return {
    kind, itemId: '001-x', lane: 'standard' as const, upstream: null,
    policies: [], externalRef: null, origin: 'authored' as const,
    body: raw, raw,
  };
}

function approval(gate: Approval['gate'], hash: string): Approval {
  return {
    ts: '2026-09-11T10:00:00Z', itemId: '001-x', gate, artifact: `${gate}.md`,
    hash, identity: 'po@example.com', role: 'product-owner', verdict: 'approved',
  };
}

const ctx = { roles: ROLES, lane: STANDARD, author: 'eng@example.com' };

describe('deriveStage', () => {
  it('is intake when nothing exists', () => {
    const item: WorkItem = { id: '001-x', lane: 'standard', artifacts: {}, approvals: [] };
    expect(deriveStage(item, ctx)).toBe('intake');
  });

  it('is plan when an unapproved intent exists', () => {
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: artifact('intent', 'i') }, approvals: [],
    };
    expect(deriveStage(item, ctx)).toBe('plan');
  });

  it('is design once the intent is approved', () => {
    const raw = 'i';
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: artifact('intent', raw) },
      approvals: [approval('plan', hashContent(raw))],
    };
    expect(deriveStage(item, ctx)).toBe('design');
  });

  it('FALLS BACK when an approved artifact is then edited', () => {
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: artifact('intent', 'EDITED') },
      approvals: [approval('plan', hashContent('original'))],
    };
    expect(deriveStage(item, ctx)).toBe('plan');
  });

  it('is build once intent and spec are both approved', () => {
    const i = 'i', s = 's';
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: artifact('intent', i), spec: artifact('spec', s) },
      approvals: [approval('plan', hashContent(i)), approval('design', hashContent(s))],
    };
    expect(deriveStage(item, ctx)).toBe('build');
  });

  it('ignores any stage written into the artifact', () => {
    const raw = '---\nid: 001-x\nstage: build\n---\nbody';
    const item: WorkItem = {
      id: '001-x', lane: 'standard',
      artifacts: { intent: artifact('intent', raw) }, approvals: [],
    };
    expect(deriveStage(item, ctx)).toBe('plan');
  });

  describe('express lane (F2 — chain built from LaneRule.requires)', () => {
    const expressCtx = { roles: ROLES, lane: EXPRESS, author: 'eng@example.com' };

    it('is intake when no plan.md exists yet', () => {
      const item: WorkItem = { id: '001-x', lane: 'express', artifacts: {}, approvals: [] };
      expect(deriveStage(item, expressCtx)).toBe('intake');
    });

    it('is build (awaiting the plan gate) once an unapproved plan.md exists', () => {
      const item: WorkItem = {
        id: '001-x', lane: 'express',
        artifacts: { plan: artifact('plan', 'p') }, approvals: [],
      };
      expect(deriveStage(item, expressCtx)).toBe('build');
    });

    it('is done once plan.md is approved at the build gate, skipping intent and spec', () => {
      const raw = 'p';
      const item: WorkItem = {
        id: '001-x', lane: 'express',
        artifacts: { plan: artifact('plan', raw) },
        approvals: [approval('build', hashContent(raw))],
      };
      expect(deriveStage(item, expressCtx)).toBe('done');
    });
  });
});
