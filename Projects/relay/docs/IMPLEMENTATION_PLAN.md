# Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Relay — a tool-agnostic runtime for the AI-native SDLC, where markdown artifacts in a repo are the database, approvals are signatures over content hashes, and a live mission-control dashboard shows the pipeline.

**Architecture:** TypeScript monorepo. `@relay/core` holds all judgment as pure functions (no I/O) and is the only place gate decisions are made. `@relay/cli` and `@relay/daemon` are transports over it; `@relay/dashboard` is a view fed by a WebSocket; `@relay/mcp` is the universal coding-tool integration with per-tool adapters layered on top.

**Tech Stack:** TypeScript 5, Node 20+, npm workspaces, Vitest, Zod, Fastify, `ws`, React 18 + Vite, `@modelcontextprotocol/sdk`, `chokidar`, `simple-git`.

---

## Phase 0 — Read this before touching anything

- [ ] **Read `Projects/relay/docs/SPEC.md` in full.** It is the approved design, 18 sections, and it is detailed enough that you should not need to invent behaviour. Where this plan and the spec disagree, the spec wins — and say so rather than silently picking.
- [ ] **Read `Projects/relay/PROJECT.md`** for the five gotchas that matter most.
- [ ] **Run `/karpathy-guidelines`** per the workspace operating manual at `/Users/aj/Desktop/Claude/CLAUDE.md`.
- [ ] Confirm you are in `/Users/aj/Desktop/Claude/Projects/relay`.

### Four invariants that must never be weakened

These are the design. Breaking any of them produces a tool that looks right and is worthless.

1. **State is derived, never stored.** The `stage:` field in artifact frontmatter is written for human readability and must be ignored by every code path that decides anything.
2. **An approval is a signature over a content hash.** Editing an artifact after approval must void that approval automatically. There is no "re-validate" step — validity is recomputed on every read.
3. **`@relay/core` is pure.** No filesystem, no network, no git. It takes strings and objects, returns objects. This is what makes the gate logic testable, and it is where the correctness lives.
4. **Local hooks are ergonomics; CI is enforcement.** Never present a pre-edit hook as a guarantee.

### Which model to run this with

- **Phase 1 (`@relay/core`): use Opus.** It is pure logic with subtle invariants — hash invalidation, approval validity, lane rules, state derivation — and everything else depends on it being right. A subtle bug here is invisible until the acceptance test, and possibly past it.
- **Phases 2–5: Sonnet is fine.** Wiring a CLI, a Fastify daemon, an MCP server, and a React dashboard against types that already exist is well-specified work, and the spec removes most ambiguity.
- **Phase 6 (acceptance): start on Sonnet, escalate to Opus if a failure resists two attempts** — and stop at three per the workspace three-strikes rule.

Separately: when Relay's own headless paths need a model (`relay adopt`, the Stage 6 intent writer), default to `claude-opus-5` via the official `@anthropic-ai/sdk`, with the key read from the environment and never from the repo.

---

## File structure

```
Projects/relay/
  package.json                 # npm workspaces root
  tsconfig.base.json
  vitest.config.ts
  packages/
    core/
      src/types.ts             # every shared type; no logic
      src/hash.ts              # content hashing
      src/artifact.ts          # frontmatter + body parsing
      src/schema.ts            # Zod schemas + lint
      src/ledger.ts            # approval records: parse, validate
      src/config.ts            # lanes, roles, source-of-truth policy
      src/gate.ts              # the gate contract
      src/state.ts             # stage derivation
      src/drift.ts             # plan-to-diff comparison
      src/index.ts             # public surface
      test/*.test.ts
    cli/                       # Phase 2
    mcp/                       # Phase 3
    daemon/                    # Phase 4
    dashboard/                 # Phase 5
```

One responsibility per file. `gate.ts` must not parse markdown; `artifact.ts` must not decide anything.

---

# Phase 1 — `@relay/core`

Everything downstream depends on this. Build it test-first.

### Task 1: Monorepo skeleton

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`

- [ ] **Step 1: Create the workspace root**

```json
{
  "name": "relay",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run",
    "build": "tsc -b packages/core"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^20.16.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "composite": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Create `packages/core/package.json`**

```json
{
  "name": "@relay/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": { "zod": "^3.23.0", "yaml": "^2.5.0" }
}
```

- [ ] **Step 5: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 6: Install and verify**

Run: `npm install && npx vitest run`
Expected: vitest exits reporting "No test files found" — that is success at this stage.

- [ ] **Step 7: Commit**

```bash
git add Projects/relay
git commit -m "relay: monorepo skeleton with vitest"
```

---

### Task 2: Types

**Files:**
- Create: `packages/core/src/types.ts`

No tests — this file has no behaviour. Every later task imports from here.

- [ ] **Step 1: Write `types.ts`**

```ts
export type Lane = 'express' | 'standard' | 'governed';
export type Stage = 'intake' | 'plan' | 'design' | 'build' | 'done';
export type ArtifactKind = 'intent' | 'spec' | 'plan';
export type Verdict = 'approved' | 'rejected' | 'override';

export interface Artifact {
  kind: ArtifactKind;
  itemId: string;
  lane: Lane;
  upstream: string | null;
  policies: string[];
  externalRef: string | null;
  origin: 'authored' | 'adopted';
  body: string;
  raw: string;
}

export interface Approval {
  ts: string;
  itemId: string;
  gate: Stage;
  artifact: string;
  hash: string;
  identity: string;
  role: string;
  verdict: Verdict;
  reason?: string;
  latencyS?: number;
}

export interface RoleMap {
  [identity: string]: string[];
}

export interface LaneRule {
  requires: ArtifactKind[];
  gateRoles: Partial<Record<Stage, string[]>>;
  allowSelfApproval: boolean;
  driftIsFatal: boolean;
}

export interface RelayConfig {
  sourceOfTruth: 'legacy' | 'repo';
  defaultLane: Lane;
  lanes: Record<Lane, LaneRule>;
}

export interface WorkItem {
  id: string;
  lane: Lane;
  artifacts: Partial<Record<ArtifactKind, Artifact>>;
  approvals: Approval[];
}

export interface GateResult {
  gate: Stage;
  passed: boolean;
  reasons: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "relay(core): shared types"
```

---

### Task 3: Content hashing

The mechanic that makes approvals real. Must hash exact bytes.

**Files:**
- Create: `packages/core/src/hash.ts`
- Test: `packages/core/test/hash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { hashContent } from '../src/hash.js';

describe('hashContent', () => {
  it('returns a prefixed sha256 hex digest', () => {
    expect(hashContent('hello')).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('is byte-exact — one changed character changes the hash', () => {
    expect(hashContent('hello')).not.toBe(hashContent('hellO'));
  });

  it('does not normalise trailing whitespace', () => {
    expect(hashContent('a')).not.toBe(hashContent('a '));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/hash.test.ts`
Expected: FAIL — "Failed to resolve import ../src/hash.js"

- [ ] **Step 3: Write the implementation**

```ts
import { createHash } from 'node:crypto';

export function hashContent(raw: string): string {
  return 'sha256:' + createHash('sha256').update(raw, 'utf8').digest('hex');
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run packages/core/test/hash.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hash.ts packages/core/test/hash.test.ts
git commit -m "relay(core): byte-exact content hashing"
```

---

### Task 4: Artifact parsing

**Files:**
- Create: `packages/core/src/artifact.ts`
- Test: `packages/core/test/artifact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseArtifact } from '../src/artifact.js';

const SAMPLE = `---
id: 047-sso-for-admin
lane: governed
stage: design
upstream: sha256:abc123
policies: [security-baseline]
---

# Problem

Admins share one password.
`;

describe('parseArtifact', () => {
  it('reads frontmatter into typed fields', () => {
    const a = parseArtifact(SAMPLE, 'spec');
    expect(a.itemId).toBe('047-sso-for-admin');
    expect(a.lane).toBe('governed');
    expect(a.upstream).toBe('sha256:abc123');
    expect(a.policies).toEqual(['security-baseline']);
  });

  it('keeps the raw text byte-exact for hashing', () => {
    expect(parseArtifact(SAMPLE, 'spec').raw).toBe(SAMPLE);
  });

  it('IGNORES the stage field — state is derived, never stored', () => {
    const a = parseArtifact(SAMPLE, 'spec') as unknown as Record<string, unknown>;
    expect(a.stage).toBeUndefined();
  });

  it('defaults origin to authored and externalRef to null', () => {
    const a = parseArtifact(SAMPLE, 'spec');
    expect(a.origin).toBe('authored');
    expect(a.externalRef).toBeNull();
  });

  it('throws when frontmatter is missing', () => {
    expect(() => parseArtifact('# no frontmatter', 'intent')).toThrow(
      /frontmatter/i
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/artifact.test.ts`
Expected: FAIL — cannot resolve `../src/artifact.js`

- [ ] **Step 3: Write the implementation**

```ts
import { parse as parseYaml } from 'yaml';
import type { Artifact, ArtifactKind, Lane } from './types.js';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseArtifact(raw: string, kind: ArtifactKind): Artifact {
  const match = raw.match(FRONTMATTER);
  if (!match) throw new Error('Artifact is missing YAML frontmatter');

  const fm = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  const body = raw.slice(match[0].length);

  if (typeof fm.id !== 'string' || fm.id.length === 0) {
    throw new Error('Artifact frontmatter is missing `id`');
  }

  return {
    kind,
    itemId: fm.id,
    lane: (fm.lane as Lane) ?? 'standard',
    upstream: typeof fm.upstream === 'string' ? fm.upstream : null,
    policies: Array.isArray(fm.policies) ? (fm.policies as string[]) : [],
    externalRef:
      typeof fm.external_ref === 'string' ? fm.external_ref : null,
    origin: fm.origin === 'adopted' ? 'adopted' : 'authored',
    body,
    raw,
  };
}
```

Note the deliberate omission: `fm.stage` is read by nothing. That is invariant 1.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run packages/core/test/artifact.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/artifact.ts packages/core/test/artifact.test.ts
git commit -m "relay(core): artifact parsing, ignoring the stage field by design"
```

---

### Task 5: Lint — completeness

**Files:**
- Create: `packages/core/src/schema.ts`
- Test: `packages/core/test/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { lintArtifact } from '../src/schema.js';
import { parseArtifact } from '../src/artifact.js';

function make(body: string): string {
  return `---\nid: 001-x\nlane: standard\n---\n\n${body}`;
}

const COMPLETE_INTENT = make(
  `## Problem\nAdmins share a password.\n\n` +
  `## Proposed outcome\nEach admin signs in individually.\n\n` +
  `## Affected users and systems\nAdmin console, auth service.\n\n` +
  `## Constraints\nMust not break existing sessions.\n\n` +
  `## Open questions\nNone.\n`
);

describe('lintArtifact', () => {
  it('passes a complete intent', () => {
    const r = lintArtifact(parseArtifact(COMPLETE_INTENT, 'intent'));
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it('fails when a required section is missing', () => {
    const r = lintArtifact(parseArtifact(make('## Problem\nx\n'), 'intent'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/Proposed outcome/i);
  });

  it('fails on placeholder text', () => {
    const withTbd = COMPLETE_INTENT.replace('None.', 'TBD');
    const r = lintArtifact(parseArtifact(withTbd, 'intent'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/placeholder/i);
  });

  it('fails on an empty section', () => {
    const empty = COMPLETE_INTENT.replace('None.', '');
    const r = lintArtifact(parseArtifact(empty, 'intent'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/empty/i);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/schema.test.ts`
Expected: FAIL — cannot resolve `../src/schema.js`

- [ ] **Step 3: Write the implementation**

```ts
import type { Artifact, ArtifactKind } from './types.js';

export interface LintResult {
  ok: boolean;
  problems: string[];
}

const REQUIRED_SECTIONS: Record<ArtifactKind, string[]> = {
  intent: [
    'Problem',
    'Proposed outcome',
    'Affected users and systems',
    'Constraints',
    'Open questions',
  ],
  spec: ['Requirements', 'Design', 'Flagged concerns'],
  plan: ['Files that change', 'Work order', 'Tests that prove completion'],
};

const PLACEHOLDERS = /\b(TBD|TODO|FIXME|XXX)\b/;

function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = body.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const title = (newline === -1 ? part : part.slice(0, newline)).trim();
    const content = newline === -1 ? '' : part.slice(newline + 1);
    out.set(title.toLowerCase(), content);
  }
  return out;
}

export function lintArtifact(artifact: Artifact): LintResult {
  const problems: string[] = [];
  const found = sections(artifact.body);

  for (const required of REQUIRED_SECTIONS[artifact.kind]) {
    const content = found.get(required.toLowerCase());
    if (content === undefined) {
      problems.push(`Missing required section: ${required}`);
      continue;
    }
    if (content.trim().length === 0) {
      problems.push(`Section is empty: ${required}`);
      continue;
    }
    if (PLACEHOLDERS.test(content)) {
      problems.push(`Section contains placeholder text: ${required}`);
    }
  }

  return { ok: problems.length === 0, problems };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run packages/core/test/schema.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema.ts packages/core/test/schema.test.ts
git commit -m "relay(core): artifact lint — sections, emptiness, placeholders"
```

---

### Task 6: The approval ledger

**This is the most important task in the plan.** The hash-invalidation test is the one that must never be weakened.

**Files:**
- Create: `packages/core/src/ledger.ts`
- Test: `packages/core/test/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
      [approval({ identity: 'eng@example.com', role: 'engineer' })],
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
      [approval({ identity: 'eng@example.com', role: 'engineer' })],
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

  it('fails when there is no record at all', () => {
    const r = validApproval([], 'design', 'sha256:AAA', ctx);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no approval/i);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/ledger.test.ts`
Expected: FAIL — cannot resolve `../src/ledger.js`

- [ ] **Step 3: Write the implementation**

```ts
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
  const forGate = approvals
    .filter((a) => a.gate === gate)
    .sort((a, b) => a.ts.localeCompare(b.ts));

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
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run packages/core/test/ledger.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ledger.ts packages/core/test/ledger.test.ts
git commit -m "relay(core): approval ledger — hash-bound, role-bound, override-aware"
```

---

### Task 7: Stage derivation

**Files:**
- Create: `packages/core/src/state.ts`
- Test: `packages/core/test/state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/state.test.ts`
Expected: FAIL — cannot resolve `../src/state.js`

- [ ] **Step 3: Write the implementation**

```ts
import { hashContent } from './hash.js';
import { validApproval, type ApprovalContext } from './ledger.js';
import type { Stage, WorkItem } from './types.js';

const CHAIN: { gate: Stage; kind: 'intent' | 'spec' | 'plan'; next: Stage }[] = [
  { gate: 'plan', kind: 'intent', next: 'design' },
  { gate: 'design', kind: 'spec', next: 'build' },
  { gate: 'build', kind: 'plan', next: 'done' },
];

export function deriveStage(item: WorkItem, ctx: ApprovalContext): Stage {
  let stage: Stage = 'intake';

  for (const link of CHAIN) {
    const artifact = item.artifacts[link.kind];
    if (!artifact) return stage;

    stage = link.gate;

    const result = validApproval(
      item.approvals,
      link.gate,
      hashContent(artifact.raw),
      ctx
    );
    if (!result.passed) return stage;

    stage = link.next;
  }

  return stage;
}
```

The item walks forward only while each artifact both exists and carries a currently-valid approval. An edit after approval silently drops it back, which is exactly what the fourth test asserts.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run packages/core/test/state.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state.ts packages/core/test/state.test.ts
git commit -m "relay(core): stage derivation from artifacts and live approvals"
```

---

### Task 8: Plan-to-diff drift

**Files:**
- Create: `packages/core/src/drift.ts`
- Test: `packages/core/test/drift.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { declaredFiles, checkDrift } from '../src/drift.js';

const PLAN_BODY = `
## Files that change

- \`server/lib/db.js\` — add git-backed catalog write
- \`server/routes/suits.js\` — call the new writer

## Work order

1. Writer, 2. Route.

## Tests that prove completion

- \`test/db.test.js\`
`;

describe('declaredFiles', () => {
  it('extracts backticked paths from the files section only', () => {
    expect(declaredFiles(PLAN_BODY)).toEqual([
      'server/lib/db.js',
      'server/routes/suits.js',
    ]);
  });
});

describe('checkDrift', () => {
  it('passes when touched files are a subset of declared', () => {
    const r = checkDrift(PLAN_BODY, ['server/lib/db.js'], false);
    expect(r.passed).toBe(true);
  });

  it('warns but passes on undeclared files when drift is not fatal', () => {
    const r = checkDrift(PLAN_BODY, ['server/lib/weather.js'], false);
    expect(r.passed).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/weather\.js/);
  });

  it('fails on undeclared files when drift is fatal', () => {
    const r = checkDrift(PLAN_BODY, ['server/lib/weather.js'], true);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/weather\.js/);
  });

  it('ignores relay artifacts themselves', () => {
    const r = checkDrift(PLAN_BODY, ['.relay/work/001-x/plan.md'], true);
    expect(r.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/core/test/drift.test.ts`
Expected: FAIL — cannot resolve `../src/drift.js`

- [ ] **Step 3: Write the implementation**

```ts
import type { GateResult } from './types.js';

export function declaredFiles(planBody: string): string[] {
  const section = planBody.split(/^##\s+/m).find((s) =>
    s.toLowerCase().startsWith('files that change')
  );
  if (!section) return [];
  return [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

export function checkDrift(
  planBody: string,
  touched: string[],
  fatal: boolean
): GateResult {
  const declared = new Set(declaredFiles(planBody));
  const stray = touched.filter(
    (f) => !declared.has(f) && !f.startsWith('.relay/')
  );

  if (stray.length === 0) return { gate: 'build', passed: true, reasons: [] };

  const reasons = [
    `Files touched but not declared in plan.md: ${stray.join(', ')}`,
  ];
  return { gate: 'build', passed: !fatal, reasons };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run packages/core/test/drift.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/drift.ts packages/core/test/drift.test.ts
git commit -m "relay(core): plan-to-diff drift check, fatal by lane"
```

---

### Task 9: Public surface and full green

**Files:**
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Write `index.ts`**

```ts
export * from './types.js';
export { hashContent } from './hash.js';
export { parseArtifact } from './artifact.js';
export { lintArtifact, type LintResult } from './schema.js';
export {
  parseLedger,
  serialiseApproval,
  validApproval,
  type ApprovalContext,
} from './ledger.js';
export { deriveStage } from './state.js';
export { declaredFiles, checkDrift } from './drift.js';
```

- [ ] **Step 2: Build and run the whole suite**

Run: `npx tsc -b packages/core && npx vitest run`
Expected: build succeeds with no errors; 34 tests pass across 6 files (hash 3, artifact 5, schema 4, ledger 11, state 6, drift 5).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "relay(core): public surface — phase 1 complete, 34 tests green"
```

- [ ] **Step 4: Update PROJECT.md**

Mark `@relay/core` verified with today's date in the Features list, and append a changelog entry naming what was verified (build clean, 34 tests green).

---

# Phases 2–5 — scope, interfaces, and acceptance

These phases are specified to task level rather than to TDD-step level, deliberately. Writing literal test code for the dashboard before `@relay/core`'s types exist on disk would be fiction, and the workspace rule against fake verification applies to plans as much as to claims.

**At the start of each phase, run the `superpowers:writing-plans` skill against that phase's scope below and produce `docs/plans/phase-N-<name>.md` with full TDD steps.** Then execute that. Each phase ends with its acceptance criteria demonstrably met, PROJECT.md updated, and a commit.

---

## Phase 2 — `@relay/cli`

**Depends on:** Phase 1.

**Deliverables**

| Command | Behaviour |
|---|---|
| `relay init` | Create `.relay/` (config, roles, schemas, templates). Detect coding tools present. Install matching adapters. Write the CI workflow if a GitHub remote exists. Add `.relay/CURRENT` to `.gitignore`. Print the tier reached. |
| `relay new "<title>" [--lane]` | Allocate `<counter>-<slug>`, create `.relay/work/<id>/`, scaffold `intent.md` from template, create branch `relay/<id>`. |
| `relay use <id>` | Write `.relay/CURRENT` for flows that do not branch per item. |
| `relay status` | Resolve the current item from branch or `CURRENT`; print derived stage, gate status, and what blocks it. |
| `relay lint [id]` | Run `lintArtifact` over the item's artifacts; non-zero exit on failure. |
| `relay gate <gate> --approve\|--reject\|--override --reason` | Append a signed record to `approvals.jsonl` using the git identity and the artifact's current hash. |
| `relay handover <id> --to <stage>` | Generate the five-part bundle into `handover/<stage>.md`. |
| `relay resume [id]` | Print the resume briefing. |
| `relay verify` | The CI check: run all six checks from SPEC §7.4 and exit non-zero on failure. |
| `relay adopt` | Draft artifacts backwards from an existing diff via the Anthropic SDK; mark `origin: adopted`. |

**Also in this phase — SPEC §12 and §10, which otherwise have no owner:**

- `SourceOfTruthAdapter` interface in `@relay/core` (`pull` / `push` / `link`), with `config.yml` carrying `sourceOfTruth: "legacy" | "repo"` as the conflict policy.
- A **simulated legacy connector** implementing it against a local JSON file, so demos never depend on a reachable Jira or ServiceNow.
- `relay new --from <ref>` ingest, routed through the adapter.

**Key constraint:** the CLI is a transport. Every decision comes from `@relay/core` — no gate logic in this package.

**Acceptance:** on a scratch git repo, `relay init && relay new "test" && relay gate plan --approve && relay status` reports stage `design`. Editing `intent.md` afterwards makes `relay status` report `plan` again with a "changed since approval" reason.

---

## Phase 3 — `@relay/mcp` and `@relay/adapters/claude-code`

**Depends on:** Phase 2.

**MCP tools to expose:**

| Tool | Returns |
|---|---|
| `relay_current_item` | Item id, lane, derived stage |
| `relay_gate_status` | Which gate blocks, why, who can clear it |
| `relay_resume` | The resume briefing as text |
| `relay_request_gate` | Records that the agent believes a gate is ready; does **not** approve |
| `relay_handover` | The bundle for the current stage |

`relay_request_gate` must never write an approval. An agent asking for a gate and an agent passing one are different things, and conflating them destroys the audit trail.

**Claude Code adapter:** a `PreToolUse` hook that blocks `Edit`/`Write` against source paths when the current item has no valid build gate, a `SessionStart` hook that injects the resume briefing, and stage skills that interview for each artifact. Hooks POST events to the daemon endpoint when one is listening, and must degrade silently when none is.

**Acceptance:** in a Claude Code session on a scratch repo, asking the agent to edit a source file before the plan gate is refused by the hook with a message naming the blocking gate; after `relay gate build --approve`, the same edit succeeds.

---

## Phase 4 — `@relay/daemon`

**Depends on:** Phase 3.

**Deliverables:** Fastify server on port **5182**, serving the built dashboard plus:

- `chokidar` watcher on `.relay/**` and a git watcher on `.git/HEAD` and refs
- `POST /events` — the hook receiver
- `GET /api/items` — every item with derived stage and gate status
- `WS /stream` — the event feed
- An in-memory projection rebuilt from disk on every relevant change, never trusted as storage

**Critical:** the daemon holds no authoritative state. If it is killed and restarted, it must reconstruct everything from the repo and reach an identical projection. Add a test that asserts exactly that.

**Acceptance:** with the daemon running, `relay gate design --approve` in another terminal pushes a transition event over the WebSocket within one second, and `curl localhost:5182/api/items` reflects the new stage.

---

## Phase 5 — `@relay/dashboard`

**Depends on:** Phase 4.

React + Vite. Five panels per SPEC §13: incident strip, pipeline lanes with gates rendered between them, live session ticker, "waiting on you" queue with approve and send-back, and the metrics strip. Plus spotlight mode collapsing to one item and back.

**Use the recorded event fixture** (built in Phase 4) to iterate on the UI — real-time interfaces cannot be developed against non-repeatable input. The fixture is a test dependency and must never be reachable from a demo path.

Phase 1 of the workspace's functional-first rule ends here: build it with clean functional design, then announce that the build is verified before any design pass.

**Acceptance:** the three hero beats from SPEC §13 are demonstrable — a gate approval in the browser unblocking a terminal, multiple items showing concurrent agent activity, and an item appearing at the top of the pipeline from the Stage 6 trigger.

---

## Phase 5b — Stage 6 trigger slice

**Depends on:** Phase 4 (it only needs the daemon, not the dashboard).

The thin slice that closes the loop, and the third hero beat. Three pieces:

- A **deterministic detector** — a plain script, no model involved, that evaluates a metric against control bands from a version-controlled config. Western Electric rules; 1σ logs, 2σ diagnoses read-only, 3σ may act.
- An **intent writer** that turns a breach into a valid `intent.md` at the top of the pipeline, via the Anthropic SDK with `claude-opus-5`, key from the environment.
- The **incident strip** binding on the dashboard.

**Critical:** detection must stay deterministic. A model deciding whether a breach occurred would make the whole loop unauditable.

**Acceptance:** forcing a band breach produces a lint-clean `intent.md` in the triage queue with no human in the invocation path, and the card appears in the incident strip within a second.

---

# Phase 6 — Acceptance test on a copy of `outfit-advisor`

**This is the definition of done for v1.** It runs against a **copy**, never the real project.

### Task 6.1: Make the copy

- [x] **Step 1: Create the pilot copy**

```bash
mkdir -p /Users/aj/Desktop/Claude/Projects/relay-pilot
rsync -a --exclude node_modules --exclude .git --exclude 'server/data' \
  /Users/aj/Desktop/Claude/Projects/outfit-advisor/ \
  /Users/aj/Desktop/Claude/Projects/relay-pilot/outfit-advisor/
```

Roughly 29 MB, of which ~10 MB is photos. Excluding `.git` is deliberate — the copy gets fresh history so Relay's branches never touch the real project's.

- [x] **Step 2: Give it its own history and port**

```bash
cd /Users/aj/Desktop/Claude/Projects/relay-pilot/outfit-advisor
git init -q && git add -A && git commit -q -m "pilot: copy of outfit-advisor for the Relay acceptance test"
npm install
node scripts/migrate.js
```

`server/index.js:7` reads `process.env.PORT || 8080`, so run the copy on a free port with `PORT=<port> node server/index.js` and never on 8080 — that is the real project's port.

- [x] **Step 3: Confirm the copy works before Relay touches it**

Run the server, load `outfit-maker.html`, confirm the catalog renders. **Respect the documented gotcha:** start it with `nohup ... & disown` and verify with a *second, separately timed* `lsof -ti:<port>` check, because a plain background job does not reliably survive between agent tool calls. A previous session lost hours to exactly this.

- [x] **Step 4: Do not register this in `apps.js`.** It is ephemeral.

### Task 6.2: The ten acceptance criteria

Each must be demonstrated and the evidence stated, not asserted.

- [x] **1.** `relay init` runs on the copy, detects no existing `.claude/` tooling, installs `.relay/` plus MCP registration and a CI workflow, and honestly reports the tier reached.
- [x] **2.** `relay serve` opens the board on 5182; it is empty and correct.
- [x] **3.** `relay new "persist catalog metadata in git" --lane governed` creates the item and branch, and a card appears on the board.
- [x] **4.** The agent drafts `intent.md` through conversation; the card sits at the Plan gate.
- [x] **5.** Approving in the browser moves it to Design; the spec is drafted with the data-loss concern flagged and resolved.
- [x] **6.** The agent is **blocked** from editing `server/` until the build gate passes, and unblocks the moment it does.
- [x] **7.** The real defect is fixed through the pipeline. The defect, from the project's own PROJECT.md: items added through the UI live only in gitignored `server/data/db.json`, so catalog metadata for anything added after the original migration exists nowhere in git and is lost if `db.json` is re-seeded. The touch points are `server/lib/db.js` (`readDb`/`writeDb`, `DB_PATH`) and the routes that write. Note the project has **no test directory** — the `plan.md` must name the tests it will create, and they must exist and pass.
- [x] **8.** **The crown jewel.** `relay verify` fails on a branch where `spec.md` was edited after approval, with a reason naming the hash mismatch — and passes once re-approved. If this one is faked, the tool is worthless.
- [x] **9.** Kill the daemon, close the session, reopen cold, run `relay resume` — the briefing accurately describes the item, its stage, its blocking gate, and its open questions.
- [x] **10.** The metrics strip shows real numbers derived from the commits just made, with nothing hand-entered.

### Task 6.3: Report and clean up

- [x] **Step 1: Write the result** into `Projects/relay/docs/ACCEPTANCE.md` — each criterion, what was observed, and screenshots for the visual ones. State plainly any criterion that did not pass.
- [x] **Step 2: Confirm the real project is untouched**

```bash
cd /Users/aj/Desktop/Claude && git status --short Projects/outfit-advisor
```

Expected: no output. If there is any, stop and report it — the pilot leaked.

- [x] **Step 3: Ask before deleting** `Projects/relay-pilot/`. Never remove it unprompted.

---

## Definition of done for v1

Per the workspace operating manual, all of these, run without being asked:

1. Verified, with the verification stated explicitly
2. `PROJECT.md` updated — Features list and Changelog
3. Launcher entry added to `/Users/aj/Desktop/Claude/launcher/server/apps.js` for Relay itself on 5182 (not for the pilot copy)
4. Ports checked and conflict-free via `scripts/next-free-port.sh`
5. `start.sh` and `stop.sh` implemented and working — they currently fail on purpose
6. `bash scripts/workspace-lint.sh` passes with zero errors
7. Committed, one commit per green state

## Known open questions

Carried from SPEC §18; none block this plan.

1. Item id scheme when Relay spans multiple repos for one team
2. Whether the policy pack ships as an npm dependency or a git submodule
3. How `relay verify` identifies the work item on providers other than GitHub
4. Whether Stage 4 and 5 machinery is worth building generically
