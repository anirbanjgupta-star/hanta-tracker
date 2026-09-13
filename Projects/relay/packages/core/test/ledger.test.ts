import { describe, it, expect } from 'vitest';
import { parseLedger, validApproval } from '../src/ledger.js';
import type { Approval, LaneRule, RoleMap } from '../src/types.js';

const ROLES: RoleMap = {
  'po@example.com': ['product-owner'],
  'eng@example.com': ['engineer'],
  'lead@example.com': ['tech-lead'],
};

const GOVERNED: LaneRule = {
  requires: ['intent', 'spec', 'plan'],
  gateRoles: { design: ['product-owner', 'tech-lead'], build: ['engineer'] },
  allowSelfApproval: false,
  driftIsFatal: true,
};

function approval(over: Partial<Approval> = {}): Approval {
  return {
    ts: '2026-09-11T14:22:31Z',
    itemId: '047-x',
    gate: 'design',
    artifact: 'spec.md',
    hash: 'sha256:AAA',
    identity: 'po@example.com',
    role: 'product-owner',
    verdict: 'approved',
    ...over,
  };
}

describe('parseLedger', () => {
  it('parses JSONL and ignores blank lines', () => {
    const text = `${JSON.stringify(approval())}\n\n${JSON.stringify(
      approval({ gate: 'build' })
    )}\n`;
    expect(parseLedger(text)).toHaveLength(2);
  });

  it('returns an empty list for an empty ledger', () => {
    expect(parseLedger('')).toEqual([]);
  });
});

describe('validApproval', () => {
  const ctx = { roles: ROLES, lane: GOVERNED, author: 'eng@example.com' };

  it('accepts an approval whose hash matches the current artifact', () => {
    const r = validApproval([approval()], 'design', 'sha256:AAA', ctx);
    expect(r.passed).toBe(true);
  });

  it('VOIDS the approval when the artifact changed after approval', () => {
    const r = validApproval([approval()], 'design', 'sha256:BBB', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/changed since approval/i);
  });

  it('rejects an approver who does not hold a required role', () => {
    const r = validApproval(
      [approval({ identity: 'eng@example.com', role: 'engineer' })],
      'design',
      'sha256:AAA',
      ctx
    );
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/role/i);
  });

  it('rejects self-approval when the lane forbids it', () => {
    const r = validApproval(
      [approval({ identity: 'eng@example.com', role: 'engineer', gate: 'build' })],
      'build',
      'sha256:AAA',
      ctx
    );
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/self-approval/i);
  });

  it('allows self-approval when the lane permits it', () => {
    const express: LaneRule = { ...GOVERNED, allowSelfApproval: true };
    const r = validApproval(
      [approval({ identity: 'eng@example.com', role: 'engineer', gate: 'build' })],
      'build',
      'sha256:AAA',
      { ...ctx, lane: express }
    );
    expect(r.passed).toBe(true);
  });

  it('accepts a recorded override and says so', () => {
    const r = validApproval(
      [approval({ verdict: 'override', reason: 'hotfix, incident 42' })],
      'design',
      'sha256:AAA',
      ctx
    );
    expect(r.passed).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/override/i);
  });

  it('rejects an override with no reason', () => {
    const r = validApproval(
      [approval({ verdict: 'override' })],
      'design',
      'sha256:AAA',
      ctx
    );
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/reason/i);
  });

  it('uses only the latest record for a gate', () => {
    const records = [
      approval(),
      approval({ ts: '2026-09-11T15:00:00Z', verdict: 'rejected' }),
    ];
    const r = validApproval(records, 'design', 'sha256:AAA', ctx);
    expect(r.passed).toBe(false);
  });

  it('orders records chronologically, not lexically, across UTC offsets', () => {
    // 11:00+02:00 is 09:00Z — chronologically BEFORE the 10:00Z approval,
    // even though it sorts after it as a string.
    const records = [
      approval({ ts: '2026-09-11T10:00:00Z', verdict: 'approved' }),
      approval({ ts: '2026-09-11T11:00:00+02:00', verdict: 'rejected' }),
    ];
    const r = validApproval(records, 'design', 'sha256:AAA', ctx);
    expect(r.passed).toBe(true);
  });

  it('refuses to guess when a timestamp is unparseable', () => {
    expect(() =>
      validApproval([approval({ ts: 'last tuesday' })], 'design', 'sha256:AAA', ctx)
    ).toThrow(/timestamp/i);
  });

  it('fails when there is no record at all', () => {
    const r = validApproval([], 'design', 'sha256:AAA', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no approval/i);
  });
});
