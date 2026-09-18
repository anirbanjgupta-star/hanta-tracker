# Phase 2 — `@relay/cli` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@relay/cli` — the `relay` command surface — plus the two core pieces Phase 1 left unbuilt (`gate.ts` composing SPEC §7.1's three-condition contract, and frontmatter/chain-integrity lint), so a scratch git repo can run the full Plan→Design→Build pipeline end to end with real gate enforcement.

**Architecture:** `@relay/core` gains `gate.ts` (composes lint + stage checks + authority into one verdict) and `config.ts` (lane presets, YAML parsing via zod) — both still pure, no I/O. `@relay/cli` is a thin transport: it does all filesystem/git I/O, then calls into core for every judgment call. No gate logic lives in the CLI package.

**Tech Stack:** TypeScript (NodeNext ESM, strict), vitest, zod (already a core dependency, unused until now), `commander` (new dependency for `@relay/cli`), Node's `node:child_process`/`node:fs` for git and filesystem access, `@anthropic-ai/sdk` for `relay adopt` only.

**Prerequisites already done this session** (see PROJECT.md and `docs/HANDOVER_PHASE2.md` Part 3):
- **F1 resolved** — option (a): `stage:` is written once at scaffold time and never rewritten. No command in this plan ever mutates a committed artifact's frontmatter. The dashboard (Phase 5) shows the derived stage instead.
- **F2 fixed** — `deriveStage` now builds its chain from `ctx.lane.requires` instead of a hardcoded `intent→spec→plan` chain. Commit `8d803d5`, 39 tests green. This plan's `gate.ts` (Task 4) reuses the same `GATE_FOR_KIND` map, exported from `state.ts` in Task 1.

**Flagged discrepancy, resolved below:** SPEC §8 shows a standalone `relay reject <item> --to design --reason`, but `docs/IMPLEMENTATION_PLAN.md`'s Phase 2 deliverables table only lists `relay gate <gate> --approve|--reject|--override --reason`. This plan follows the deliverables table (the authoritative task list) and folds rejection into `relay gate --reject`: rejecting the gate that is currently blocking the item already identifies which stage it falls back to via `deriveStage`, so a separate `--to` flag is redundant. Flagged for Anirban, not silently picked.

---

## File structure

```
packages/core/src/
  state.ts        MODIFY — export GATE_FOR_KIND (Task 1)
  schema.ts        MODIFY — frontmatter lint + unresolvedConcerns() (Tasks 2-3)
  gate.ts          NEW — evaluateGate(), the composed gate contract (Task 4)
  config.ts        NEW — DEFAULT_LANES, parseConfig, parseRoles (Task 5)
  types.ts         MODIFY — ArtifactSeed, ExternalRef, SourceOfTruthAdapter (Task 6)
  index.ts         MODIFY — export the above (Task 7)

packages/cli/
  package.json, tsconfig.json          NEW (Task 8)
  src/relay-dir.ts                     NEW — .relay/ filesystem I/O (Task 9)
  src/git.ts                           NEW — branch/identity/diff (Task 10)
  src/item-id.ts                       NEW — <counter>-<slug> allocation (Task 11)
  src/templates.ts                     NEW — scaffold text (Task 12)
  src/adapters/legacy-json.ts          NEW — simulated SourceOfTruthAdapter (Task 13)
  src/commands/init.ts                 NEW (Task 14)
  src/commands/new.ts                  NEW (Task 15)
  src/commands/use.ts                  NEW (Task 16)
  src/commands/status.ts               NEW (Task 17)
  src/commands/lint.ts                 NEW (Task 18)
  src/commands/gate.ts                 NEW (Task 19)
  src/commands/handover.ts             NEW (Task 20)
  src/commands/resume.ts               NEW (Task 21)
  src/commands/verify.ts               NEW (Task 22)
  src/commands/adopt.ts                NEW (Task 23)
  src/index.ts                         NEW — commander wiring, bin entry (Task 24)
  test/helpers.ts                      NEW — scratch git repo fixture
  test/*.test.ts                       NEW — one per module/command above
```

Each command file exports a plain function (e.g. `export function runInit(cwd: string): InitResult`) that does the real work against a `cwd`; `src/index.ts` is the only file that touches `process.argv`/`process.cwd()`. Tests call the functions directly against a scratch temp dir with a real git repo inside — no mocked filesystem or git, matching how `@relay/core`'s own tests hit real hashing/parsing. This keeps every command fast to test and keeps `index.ts` itself untested (it has no logic to test).

Templates are inline TS string constants (`templates.ts`), not bundled `.md`/`.yml` asset files — avoids configuring `tsc` to copy non-TS files into `dist/` for a five-file demo-scoped tool. `.relay/schemas/*.schema.yml` are still written by `relay init` (the deliverables table asks for them) but are **not read back by `lintArtifact` in v1** — they mirror the hardcoded rules in `schema.ts` for a team to read or eventually fork, and this plan states that plainly rather than pretending they're wired up. Wiring configurable schemas is future work, tracked here, not silently implied.

---

## Task 1: Export `GATE_FOR_KIND` from `state.ts`

**Files:**
- Modify: `packages/core/src/state.ts:5-16`

- [ ] **Step 1: Add `export` to the existing map**

Change:
```ts
const GATE_FOR_KIND: Record<ArtifactKind, Stage> = {
```
to:
```ts
export const GATE_FOR_KIND: Record<ArtifactKind, Stage> = {
```
Leave `NEXT_STAGE` and everything else in the file untouched — `gate.ts` (Task 4) only needs the kind→gate direction.

- [ ] **Step 2: Confirm the build still passes**

Run: `npx tsc -b packages/core`
Expected: exits 0, no output.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/state.ts
git commit -m "relay(core): export GATE_FOR_KIND for reuse in gate.ts"
```

---

## Task 2: Frontmatter completeness lint (F4a)

**Files:**
- Modify: `packages/core/src/schema.ts`
- Test: `packages/core/test/schema.test.ts`

`lintArtifact` currently only checks body sections. SPEC §7.1 condition 1 is "required frontmatter fields **and** body sections". Add: `lane` must be one of the three real lanes (today `parseArtifact` hard-casts any string with no validation), and `upstream` must be present and well-formed for `spec`/`plan` (the chain has nothing to descend from otherwise), optionally well-formed for `intent` (it may be null — Stage 6 can write an `intent.md` with no upstream at all).

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/schema.test.ts`, after the existing `describe('lintArtifact', ...)` tests but before the closing `});`:

```ts
  it('fails when lane is not a recognised value', () => {
    const raw = COMPLETE_INTENT.replace('lane: standard', 'lane: bogus');
    const r = lintArtifact(parseArtifact(raw, 'intent'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/lane/i);
  });

  it('fails when a spec has no upstream', () => {
    const raw = make('## Requirements\nx\n\n## Design\nx\n\n## Flagged concerns\nNone.\n');
    const r = lintArtifact(parseArtifact(raw, 'spec'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/upstream/i);
  });

  it('fails when upstream is not a well-formed hash', () => {
    const raw = make('## Requirements\nx\n\n## Design\nx\n\n## Flagged concerns\nNone.\n')
      .replace('lane: standard', 'lane: standard\nupstream: not-a-hash');
    const r = lintArtifact(parseArtifact(raw, 'spec'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/upstream/i);
  });

  it('passes a spec with a well-formed upstream hash', () => {
    const raw = make('## Requirements\nx\n\n## Design\nx\n\n## Flagged concerns\nNone.\n')
      .replace('lane: standard', `lane: standard\nupstream: sha256:${'a'.repeat(64)}`);
    const r = lintArtifact(parseArtifact(raw, 'spec'));
    expect(r.ok).toBe(true);
  });

  it('allows an intent with no upstream at all', () => {
    const r = lintArtifact(parseArtifact(COMPLETE_INTENT, 'intent'));
    expect(r.ok).toBe(true);
  });
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/core/test/schema.test.ts`
Expected: the `lane`, `no upstream`, and `not a well-formed hash` tests FAIL (current `lintArtifact` never inspects frontmatter at all, so `r.ok` is `true` in all three).

- [ ] **Step 3: Implement**

In `packages/core/src/schema.ts`, add near the top (after the existing imports and `REQUIRED_SECTIONS`/`PLACEHOLDERS` constants):

```ts
const VALID_LANES = ['express', 'standard', 'governed'];
const HASH = /^sha256:[0-9a-f]{64}$/;

function frontmatterProblems(artifact: Artifact): string[] {
  const problems: string[] = [];

  if (!VALID_LANES.includes(artifact.lane)) {
    problems.push(`frontmatter lane is not a recognised lane: ${artifact.lane}`);
  }

  const upstreamRequired = artifact.kind === 'spec' || artifact.kind === 'plan';
  if (upstreamRequired && !artifact.upstream) {
    problems.push('frontmatter is missing required field: upstream');
  } else if (artifact.upstream && !HASH.test(artifact.upstream)) {
    problems.push(`frontmatter upstream is not a well-formed hash: ${artifact.upstream}`);
  }

  return problems;
}
```

Then change `lintArtifact`'s first line from:
```ts
  const problems: string[] = [];
```
to:
```ts
  const problems: string[] = frontmatterProblems(artifact);
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/core/test/schema.test.ts`
Expected: all tests pass, including the 4 pre-existing ones (frontmatter problems are additive, so a complete intent with no upstream still lints clean).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema.ts packages/core/test/schema.test.ts
git commit -m "relay(core): F4a — lint frontmatter (lane, upstream hash format)"
```

---

## Task 3: `unresolvedConcerns()` — the Stage 2 check's data source

**Files:**
- Modify: `packages/core/src/schema.ts`
- Test: `packages/core/test/schema.test.ts`

SPEC §7.1 condition 2 for the design gate: "every flagged concern has a resolution or an explicit accepted-risk entry." This is decided by parsing `spec.md`'s own "Flagged concerns" section, so it can be a pure text function reused by `gate.ts` (Task 4) — no external input needed. Convention (this plan fixes it, since SPEC leaves the literal syntax open): each concern is a markdown checklist item; `- [ ]` is unresolved, `- [x] ... — resolved: ...` or `— accepted risk: ...` is resolved. The template written in Task 12 follows this convention with an inline example.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/schema.test.ts`, right after the `lintArtifact` describe block:

```ts
describe('unresolvedConcerns', () => {
  it('returns concerns marked open', () => {
    const body =
      '## Flagged concerns\n\n' +
      '- [ ] Auth service has no rate limiting on this path\n' +
      '- [x] Session tokens stored in localStorage — resolved: moved to httpOnly cookie\n';
    expect(unresolvedConcerns(body)).toEqual([
      'Auth service has no rate limiting on this path',
    ]);
  });

  it('returns an empty list when every concern is resolved', () => {
    const body =
      '## Flagged concerns\n\n' +
      '- [x] Minor perf regression — accepted risk: below the SLA threshold\n';
    expect(unresolvedConcerns(body)).toEqual([]);
  });

  it('returns an empty list when there is no Flagged concerns section', () => {
    expect(unresolvedConcerns('## Requirements\nx\n')).toEqual([]);
  });
});
```

Add `unresolvedConcerns` to the existing `import { lintArtifact } from '../src/schema.js';` line at the top of the test file, making it `import { lintArtifact, unresolvedConcerns } from '../src/schema.js';`.

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/core/test/schema.test.ts`
Expected: FAIL — `unresolvedConcerns is not a function` (not exported yet).

- [ ] **Step 3: Implement**

The private `sections()` helper in `schema.ts` already splits a body into a `Map<lowercased-title, content>`. Add, after `lintArtifact`:

```ts
export function unresolvedConcerns(specBody: string): string[] {
  const found = sections(specBody);
  const content = found.get('flagged concerns') ?? '';
  return [...content.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1].trim());
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/core/test/schema.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema.ts packages/core/test/schema.test.ts
git commit -m "relay(core): add unresolvedConcerns() for the design-gate check"
```

---

## Task 4: `gate.ts` — compose the three-condition gate contract (F3)

**Files:**
- Create: `packages/core/src/gate.ts`
- Test: `packages/core/test/gate.test.ts`

This is, per the handover, "the single highest-value thing you build" — the one function every caller (CLI, and later daemon/dashboard) asks "is this gate open?" instead of each re-deriving it and drifting apart.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/gate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/core/test/gate.test.ts`
Expected: FAIL — `Cannot find module '../src/gate.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement**

Create `packages/core/src/gate.ts`:

```ts
import { hashContent } from './hash.js';
import { lintArtifact, unresolvedConcerns } from './schema.js';
import { validApproval, type ApprovalContext } from './ledger.js';
import { GATE_FOR_KIND } from './state.js';
import type { ArtifactKind, GateResult, Stage, WorkItem } from './types.js';

const KIND_FOR_GATE: Partial<Record<Stage, ArtifactKind>> = {
  plan: 'intent',
  design: 'spec',
  build: 'plan',
};

export interface GateChecks {
  /** Build gate only: did the tests named in plan.md run and pass? Core
   *  cannot execute tests itself, so the caller (the CLI, in CI or locally)
   *  supplies the evidence. Defaults to false — no evidence, no pass. */
  testsRan?: boolean;
}

function chainReasons(item: WorkItem, kind: ArtifactKind, ctx: ApprovalContext): string[] {
  const idx = ctx.lane.requires.indexOf(kind);
  if (idx <= 0) return []; // first required artifact in this lane has nothing upstream to check

  const priorKind = ctx.lane.requires[idx - 1];
  const priorArtifact = item.artifacts[priorKind];
  const artifact = item.artifacts[kind]!;

  if (!priorArtifact) {
    return [`${kind}.md exists but its upstream ${priorKind}.md does not`];
  }

  const priorHash = hashContent(priorArtifact.raw);
  const priorApproval = validApproval(item.approvals, GATE_FOR_KIND[priorKind], priorHash, ctx);
  if (!priorApproval.passed) {
    return [`upstream ${priorKind} is not currently approved: ${priorApproval.reasons.join('; ')}`];
  }

  if (artifact.upstream !== priorHash) {
    return [
      `upstream does not match the current ${priorKind} (frontmatter names ${artifact.upstream ?? 'nothing'}, current is ${priorHash})`,
    ];
  }

  return [];
}

export function evaluateGate(
  item: WorkItem,
  gate: Stage,
  ctx: ApprovalContext,
  checks: GateChecks = {}
): GateResult {
  const kind = KIND_FOR_GATE[gate];
  if (!kind) {
    return { gate, passed: false, reasons: [`${gate} is not a gate with an artifact of its own`] };
  }

  const artifact = item.artifacts[kind];
  if (!artifact) {
    return { gate, passed: false, reasons: [`${kind}.md does not exist yet`] };
  }

  const reasons: string[] = [];

  // Condition 1 — completeness (frontmatter + body sections)
  reasons.push(...lintArtifact(artifact).problems);

  // Condition 1b — chain integrity (upstream names the currently-approved prior artifact)
  reasons.push(...chainReasons(item, kind, ctx));

  // Condition 2 — stage-specific checks
  if (gate === 'design') {
    const unresolved = unresolvedConcerns(artifact.body);
    if (unresolved.length > 0) {
      reasons.push(`Flagged concerns without a resolution: ${unresolved.join('; ')}`);
    }
  }
  if (gate === 'build' && !checks.testsRan) {
    reasons.push('Tests named in plan.md have not been confirmed to run and pass');
  }

  // Condition 3 — authority (a valid, current, correctly-roled approval)
  const currentHash = hashContent(artifact.raw);
  reasons.push(...validApproval(item.approvals, gate, currentHash, ctx).reasons);

  return { gate, passed: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/core/test/gate.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/gate.ts packages/core/test/gate.test.ts
git commit -m "relay(core): F3 — evaluateGate() composes completeness+checks+authority"
```

---

## Task 5: `config.ts` — lane presets and YAML parsing

**Files:**
- Create: `packages/core/src/config.ts`
- Test: `packages/core/test/config.test.ts`

`zod` has been declared in `packages/core/package.json` since Phase 1 and unused — this is exactly the shape it earns its place on (Part 2 of the handover): parsing `config.yml`/`roles.yml` off disk into typed, validated objects.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseConfig, parseRoles, DEFAULT_LANES, DEFAULT_CONFIG } from '../src/config.js';

const VALID_CONFIG_YAML = `
sourceOfTruth: repo
defaultLane: standard
lanes:
  express:
    requires: [plan]
    gateRoles: {}
    allowSelfApproval: true
    driftIsFatal: false
  standard:
    requires: [intent, spec, plan]
    gateRoles:
      plan: [product-owner]
      design: [product-owner]
      build: [engineer]
    allowSelfApproval: true
    driftIsFatal: false
  governed:
    requires: [intent, spec, plan]
    gateRoles:
      plan: [product-owner]
      design: [product-owner, tech-lead]
      build: [engineer]
    allowSelfApproval: false
    driftIsFatal: true
`;

describe('parseConfig', () => {
  it('parses a valid config.yml', () => {
    const config = parseConfig(VALID_CONFIG_YAML);
    expect(config.sourceOfTruth).toBe('repo');
    expect(config.defaultLane).toBe('standard');
    expect(config.lanes.express.requires).toEqual(['plan']);
    expect(config.lanes.governed.allowSelfApproval).toBe(false);
  });

  it('throws on an invalid sourceOfTruth value', () => {
    const bad = VALID_CONFIG_YAML.replace('sourceOfTruth: repo', 'sourceOfTruth: bogus');
    expect(() => parseConfig(bad)).toThrow();
  });

  it('throws when a required lane is missing', () => {
    const bad = VALID_CONFIG_YAML.replace(/governed:[\s\S]*$/, '');
    expect(() => parseConfig(bad)).toThrow();
  });
});

describe('parseRoles', () => {
  it('parses an identity-to-roles map', () => {
    const roles = parseRoles('po@example.com: [product-owner]\neng@example.com: [engineer]\n');
    expect(roles['po@example.com']).toEqual(['product-owner']);
  });

  it('returns an empty object for an empty file', () => {
    expect(parseRoles('')).toEqual({});
  });
});

describe('DEFAULT_LANES and DEFAULT_CONFIG', () => {
  it('round-trips through parseConfig by construction (sanity: the shape is valid)', () => {
    expect(DEFAULT_CONFIG.lanes).toBe(DEFAULT_LANES);
    expect(DEFAULT_LANES.express.requires).toEqual(['plan']);
    expect(DEFAULT_LANES.standard.requires).toEqual(['intent', 'spec', 'plan']);
    expect(DEFAULT_LANES.governed.driftIsFatal).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/core/test/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 3: Implement**

Create `packages/core/src/config.ts`:

```ts
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Lane, LaneRule, RelayConfig, RoleMap } from './types.js';

const LANE_RULE_SCHEMA = z.object({
  requires: z.array(z.enum(['intent', 'spec', 'plan'])),
  gateRoles: z.record(z.string(), z.array(z.string())).default({}),
  allowSelfApproval: z.boolean(),
  driftIsFatal: z.boolean(),
});

const CONFIG_SCHEMA = z.object({
  sourceOfTruth: z.enum(['legacy', 'repo']),
  defaultLane: z.enum(['express', 'standard', 'governed']),
  lanes: z.object({
    express: LANE_RULE_SCHEMA,
    standard: LANE_RULE_SCHEMA,
    governed: LANE_RULE_SCHEMA,
  }),
});

export function parseConfig(raw: string): RelayConfig {
  return CONFIG_SCHEMA.parse(parseYaml(raw)) as RelayConfig;
}

const ROLES_SCHEMA = z.record(z.string(), z.array(z.string()));

export function parseRoles(raw: string): RoleMap {
  return ROLES_SCHEMA.parse(parseYaml(raw) ?? {});
}

export const DEFAULT_LANES: Record<Lane, LaneRule> = {
  express: {
    requires: ['plan'],
    gateRoles: {},
    allowSelfApproval: true,
    driftIsFatal: false,
  },
  standard: {
    requires: ['intent', 'spec', 'plan'],
    gateRoles: {
      plan: ['product-owner'],
      design: ['product-owner'],
      build: ['engineer'],
    },
    allowSelfApproval: true,
    driftIsFatal: false,
  },
  governed: {
    requires: ['intent', 'spec', 'plan'],
    gateRoles: {
      plan: ['product-owner'],
      design: ['product-owner', 'tech-lead'],
      build: ['engineer'],
    },
    allowSelfApproval: false,
    driftIsFatal: true,
  },
};

export const DEFAULT_CONFIG: RelayConfig = {
  sourceOfTruth: 'repo',
  defaultLane: 'standard',
  lanes: DEFAULT_LANES,
};
```

Note: `parseYaml('')` returns `undefined` in the `yaml` package, so `parseRoles`'s `?? {}` guard is load-bearing for the empty-file test — without it, `z.record(...).parse(undefined)` throws instead of returning `{}`.

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/core/test/config.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts packages/core/test/config.test.ts
git commit -m "relay(core): add config.ts — lane presets and zod-validated YAML parsing"
```

---

## Task 6: `SourceOfTruthAdapter`, `ArtifactSeed`, `ExternalRef` (SPEC §12)

**Files:**
- Modify: `packages/core/src/types.ts`

No test file — this task adds interface/type declarations only, no logic. `tsc -b` is the verification.

- [ ] **Step 1: Add the types**

Append to `packages/core/src/types.ts`:

```ts
export type ExternalRef = string;

export interface ArtifactSeed {
  title: string;
  body: string;
  externalRef: ExternalRef;
}

export interface SourceOfTruthAdapter {
  pull(ref: string): Promise<ArtifactSeed>;
  push(item: WorkItem, artifact: Artifact): Promise<ExternalRef>;
  link(item: WorkItem, sha: string): Promise<void>;
}
```

- [ ] **Step 2: Confirm the build passes**

Run: `npx tsc -b packages/core`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "relay(core): add SourceOfTruthAdapter, ArtifactSeed, ExternalRef (SPEC §12)"
```

---

## Task 7: Export everything new from `index.ts`, full checkpoint

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the new exports**

`packages/core/src/index.ts` currently ends after the `drift.ts` export line. Append:

```ts
export { evaluateGate, type GateChecks } from './gate.js';
export { parseConfig, parseRoles, DEFAULT_LANES, DEFAULT_CONFIG } from './config.js';
export { GATE_FOR_KIND } from './state.js';
export { unresolvedConcerns } from './schema.js';
```

(`types.ts` is already re-exported in full via the existing `export * from './types.js';` line, so `SourceOfTruthAdapter`/`ArtifactSeed`/`ExternalRef` need no separate line.)

- [ ] **Step 2: Full checkpoint — build and test everything**

Run: `npx tsc -b packages/core && npx vitest run`
Expected: `tsc -b` exits 0; vitest reports all files passed. Count should be 39 (Task 1 baseline) + 5 (Task 2) + 3 (Task 3) + 11 (Task 4) + 6 (Task 5) = 64 tests, 8 files.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "relay(core): export gate.ts, config.ts and remaining Phase 2 core additions"
```

`@relay/core` is now feature-complete for Phase 2 — every judgment call the CLI needs (`evaluateGate`, `parseConfig`, `parseRoles`, the lane presets) is built, tested, and pure. Everything from here on is `@relay/cli`: filesystem, git, and command wiring around this core.

---

## Task 8: Scaffold `@relay/cli`

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/.gitkeep` (placeholder so the empty dir is real — deleted the moment Task 9 adds a real file)

No test — this is scaffolding, verified by the build.

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "@relay/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "relay": "./dist/index.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@relay/core": "0.1.0",
    "commander": "^12.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json`**

Mirrors `packages/core/tsconfig.json` exactly, plus a project reference to core:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: npm resolves `@relay/core` to the workspace package and adds `commander` to `packages/cli/node_modules` (or the root, depending on hoisting) and updates `package-lock.json`. No errors.

- [ ] **Step 4: Update the root build script**

Modify `package.json:7` from:
```json
    "build": "tsc -b packages/core"
```
to:
```json
    "build": "tsc -b packages/core packages/cli"
```

- [ ] **Step 5: Confirm the (still-empty) package builds**

Run: `mkdir -p packages/cli/src && echo 'export {};' > packages/cli/src/index.ts && npx tsc -b packages/core packages/cli`
Expected: exits 0. (This placeholder `index.ts` is overwritten for real in Task 24 — it exists here only so Steps 3-5 have something to compile against.)

- [ ] **Step 6: Commit**

```bash
git add packages/cli/package.json packages/cli/tsconfig.json packages/cli/src/index.ts package.json package-lock.json
git commit -m "relay(cli): scaffold @relay/cli package"
```

---

## Task 9: `relay-dir.ts` — `.relay/` filesystem I/O

**Files:**
- Create: `packages/cli/src/relay-dir.ts`
- Test: `packages/cli/test/relay-dir.test.ts`
- Create: `packages/cli/test/helpers.ts` (shared scratch-repo fixture, used by every CLI test file from here on)

This is the one file in the CLI that reads/writes `.relay/`. Every command goes through it rather than calling `fs` directly, so there is exactly one place that knows the on-disk layout.

- [ ] **Step 1: Create the shared test fixture**

Create `packages/cli/test/helpers.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export interface ScratchRepo {
  dir: string;
  cleanup(): void;
}

export function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-cli-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/cli/test/relay-dir.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { writeArtifact, loadWorkItem, appendApproval, listItemIds } from '../src/relay-dir.js';
import { hashContent } from '@relay/core';
import type { Approval } from '@relay/core';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('writeArtifact / loadWorkItem', () => {
  it('round-trips an artifact written to disk', () => {
    repo = makeScratchRepo();
    const raw = '---\nid: 001-x\nlane: standard\n---\n\n## Problem\np\n';
    writeArtifact('001-x', 'intent', raw, repo.dir);

    const item = loadWorkItem('001-x', 'standard', repo.dir);
    expect(item.artifacts.intent?.raw).toBe(raw);
    expect(item.artifacts.spec).toBeUndefined();
    expect(item.approvals).toEqual([]);
  });

  it('falls back to the given default lane when no artifact exists yet', () => {
    repo = makeScratchRepo();
    const item = loadWorkItem('002-y', 'express', repo.dir);
    expect(item.lane).toBe('express');
    expect(item.artifacts).toEqual({});
  });

  it('derives lane from the intent artifact when present', () => {
    repo = makeScratchRepo();
    const raw = '---\nid: 003-z\nlane: governed\n---\n\n## Problem\np\n';
    writeArtifact('003-z', 'intent', raw, repo.dir);
    const item = loadWorkItem('003-z', 'standard', repo.dir);
    expect(item.lane).toBe('governed');
  });
});

describe('appendApproval', () => {
  it('appends a JSONL record readable back by loadWorkItem', () => {
    repo = makeScratchRepo();
    writeArtifact('001-x', 'intent', 'i', repo.dir);
    const approval: Approval = {
      ts: '2026-09-11T10:00:00Z', itemId: '001-x', gate: 'plan', artifact: 'intent.md',
      hash: hashContent('i'), identity: 'po@example.com', role: 'product-owner', verdict: 'approved',
    };
    appendApproval('001-x', approval, repo.dir);
    appendApproval('001-x', { ...approval, ts: '2026-09-11T11:00:00Z' }, repo.dir);

    const item = loadWorkItem('001-x', 'standard', repo.dir);
    expect(item.approvals).toHaveLength(2);
  });
});

describe('listItemIds', () => {
  it('returns an empty list before any item exists', () => {
    repo = makeScratchRepo();
    expect(listItemIds(repo.dir)).toEqual([]);
  });

  it('lists item directories under .relay/work', () => {
    repo = makeScratchRepo();
    writeArtifact('001-a', 'intent', 'a', repo.dir);
    writeArtifact('002-b', 'intent', 'b', repo.dir);
    expect(listItemIds(repo.dir).sort()).toEqual(['001-a', '002-b']);
  });
});
```

- [ ] **Step 3: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/relay-dir.test.ts`
Expected: FAIL — `Cannot find module '../src/relay-dir.js'`.

- [ ] **Step 4: Implement**

Create `packages/cli/src/relay-dir.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseArtifact, parseLedger, serialiseApproval,
  type Artifact, type ArtifactKind, type WorkItem, type Approval, type Lane,
} from '@relay/core';

const KINDS: ArtifactKind[] = ['intent', 'spec', 'plan'];

export function relayRoot(cwd: string): string {
  return join(cwd, '.relay');
}

export function itemDir(id: string, cwd: string): string {
  return join(relayRoot(cwd), 'work', id);
}

export function loadWorkItem(id: string, defaultLane: Lane, cwd: string): WorkItem {
  const dir = itemDir(id, cwd);
  const artifacts: Partial<Record<ArtifactKind, Artifact>> = {};

  for (const kind of KINDS) {
    const path = join(dir, `${kind}.md`);
    if (existsSync(path)) {
      artifacts[kind] = parseArtifact(readFileSync(path, 'utf8'), kind);
    }
  }

  const ledgerPath = join(dir, 'approvals.jsonl');
  const approvals: Approval[] = existsSync(ledgerPath)
    ? parseLedger(readFileSync(ledgerPath, 'utf8'))
    : [];

  const lane = artifacts.intent?.lane ?? artifacts.spec?.lane ?? artifacts.plan?.lane ?? defaultLane;

  return { id, lane, artifacts, approvals };
}

export function writeArtifact(id: string, kind: ArtifactKind, raw: string, cwd: string): void {
  const dir = itemDir(id, cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${kind}.md`), raw);
}

export function appendApproval(id: string, approval: Approval, cwd: string): void {
  const dir = itemDir(id, cwd);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'approvals.jsonl'), serialiseApproval(approval) + '\n');
}

export function listItemIds(cwd: string): string[] {
  const workDir = join(relayRoot(cwd), 'work');
  if (!existsSync(workDir)) return [];
  return readdirSync(workDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function loadConfigText(cwd: string): string | null {
  const path = join(relayRoot(cwd), 'config.yml');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function loadRolesText(cwd: string): string | null {
  const path = join(relayRoot(cwd), 'roles.yml');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
```

`loadConfigText`/`loadRolesText` return raw text rather than parsed objects — parsing (`parseConfig`/`parseRoles`) is a pure core function, so commands call `parseConfig(loadConfigText(cwd)!)` themselves, keeping `relay-dir.ts` as pure I/O with no judgment calls of its own.

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/relay-dir.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/relay-dir.ts packages/cli/test/relay-dir.test.ts packages/cli/test/helpers.ts
git commit -m "relay(cli): add relay-dir.ts — the only file that touches .relay/ on disk"
```

---

## Task 10: `git.ts` — branch, identity, diff

**Files:**
- Create: `packages/cli/src/git.ts`
- Test: `packages/cli/test/git.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/git.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { currentBranch, gitIdentity, itemIdFromBranch, touchedFiles } from '../src/git.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('currentBranch / itemIdFromBranch', () => {
  it('reads the current branch name', () => {
    repo = makeScratchRepo();
    execSync('git checkout -b relay/001-x -q', { cwd: repo.dir });
    expect(currentBranch(repo.dir)).toBe('relay/001-x');
  });

  it('extracts the item id from a relay/<id> branch', () => {
    expect(itemIdFromBranch('relay/047-sso-for-admin')).toBe('047-sso-for-admin');
  });

  it('returns null for a branch with no relay/ prefix', () => {
    expect(itemIdFromBranch('main')).toBeNull();
  });
});

describe('gitIdentity', () => {
  it('reads git config user.email', () => {
    repo = makeScratchRepo();
    expect(gitIdentity(repo.dir)).toBe('eng@example.com');
  });
});

describe('touchedFiles', () => {
  it('lists files changed since a base ref', () => {
    repo = makeScratchRepo();
    execSync('git checkout -b relay/001-x -q', { cwd: repo.dir });
    writeFileSync(join(repo.dir, 'a.ts'), 'x');
    execSync('git add a.ts && git commit -q -m "add a.ts"', { cwd: repo.dir });
    expect(touchedFiles('main', repo.dir)).toEqual(['a.ts']);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/cli/test/git.test.ts`
Expected: FAIL — `Cannot find module '../src/git.js'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/git.ts`:

```ts
import { execSync } from 'node:child_process';

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd }).toString().trim();
}

export function currentBranch(cwd: string): string {
  return git('rev-parse --abbrev-ref HEAD', cwd);
}

export function gitIdentity(cwd: string): string {
  return git('config user.email', cwd);
}

const BRANCH_ITEM = /^relay\/(.+)$/;

export function itemIdFromBranch(branch: string): string | null {
  const m = branch.match(BRANCH_ITEM);
  return m ? m[1] : null;
}

export function touchedFiles(baseRef: string, cwd: string): string[] {
  const out = git(`diff --name-only ${baseRef}...HEAD`, cwd);
  return out.length === 0 ? [] : out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export function headSha(cwd: string): string {
  return git('rev-parse HEAD', cwd);
}

export function remoteIsGitHub(cwd: string): boolean {
  try {
    return git('remote get-url origin', cwd).includes('github.com');
  } catch {
    return false; // no remote at all is not an error condition here
  }
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/cli/test/git.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/git.ts packages/cli/test/git.test.ts
git commit -m "relay(cli): add git.ts — branch, identity and diff helpers"
```

---

## Task 11: `item-id.ts` — `<counter>-<slug>` allocation

**Files:**
- Create: `packages/cli/src/item-id.ts`
- Test: `packages/cli/test/item-id.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/item-id.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { writeArtifact } from '../src/relay-dir.js';
import { allocateItemId } from '../src/item-id.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('allocateItemId', () => {
  it('starts at 001 when no items exist', () => {
    repo = makeScratchRepo();
    expect(allocateItemId('SSO for admin', repo.dir)).toBe('001-sso-for-admin');
  });

  it('slugifies punctuation and lowercases', () => {
    repo = makeScratchRepo();
    expect(allocateItemId('Fix the "Save" button!!', repo.dir)).toBe('001-fix-the-save-button');
  });

  it('increments past the highest existing counter', () => {
    repo = makeScratchRepo();
    writeArtifact('001-a', 'intent', 'a', repo.dir);
    writeArtifact('005-b', 'intent', 'b', repo.dir);
    expect(allocateItemId('next thing', repo.dir)).toBe('006-next-thing');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/cli/test/item-id.test.ts`
Expected: FAIL — `Cannot find module '../src/item-id.js'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/item-id.ts`:

```ts
import { listItemIds } from './relay-dir.js';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function allocateItemId(title: string, cwd: string): string {
  const ids = listItemIds(cwd);
  const maxCounter = ids.reduce((max, id) => {
    const n = parseInt(id.split('-')[0] ?? '', 10);
    return Number.isNaN(n) ? max : Math.max(max, n);
  }, 0);
  const counter = String(maxCounter + 1).padStart(3, '0');
  return `${counter}-${slugify(title)}`;
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/cli/test/item-id.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/item-id.ts packages/cli/test/item-id.test.ts
git commit -m "relay(cli): add item-id.ts — <counter>-<slug> allocation"
```

---

## Task 12: `templates.ts` — scaffold text

**Files:**
- Create: `packages/cli/src/templates.ts`
- Test: `packages/cli/test/templates.test.ts`

Section bodies are left genuinely **empty**, not filled with placeholder prose — `lintArtifact` already reports "Section is empty: X" for an empty section, which is the accurate, honest signal that a freshly scaffolded artifact isn't done. Filling in guidance text there would make a blank scaffold pass lint by accident. Guidance instead lives in one HTML comment above the frontmatter-adjacent body, which markdown renders as invisible but `relay lint`'s section parser never treats as section content.

Also add `yaml`'s `stringify` as an explicit `@relay/cli` dependency (Task 8's `package.json` gains one line) — used here to render `DEFAULT_CONFIG`/roles data into real YAML text, so the scaffolded `config.yml` can never drift out of sync with `DEFAULT_CONFIG` in `@relay/core` the way a hand-typed matching string could.

- [ ] **Step 1: Add the `yaml` dependency**

Modify `packages/cli/package.json`'s `dependencies` (from Task 8) to:
```json
  "dependencies": {
    "@relay/core": "0.1.0",
    "commander": "^12.1.0",
    "yaml": "^2.5.0"
  }
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

Create `packages/cli/test/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseArtifact, lintArtifact, parseConfig, parseRoles, DEFAULT_CONFIG } from '@relay/core';
import {
  intentTemplate, specTemplate, planTemplate,
  defaultConfigYaml, defaultRolesYaml, ciWorkflowYaml,
} from '../src/templates.js';

describe('intentTemplate', () => {
  it('produces frontmatter parseArtifact can read', () => {
    const raw = intentTemplate('001-x', 'standard');
    const artifact = parseArtifact(raw, 'intent');
    expect(artifact.itemId).toBe('001-x');
    expect(artifact.lane).toBe('standard');
  });

  it('lints as incomplete (empty sections), not as malformed', () => {
    const artifact = parseArtifact(intentTemplate('001-x', 'standard'), 'intent');
    const r = lintArtifact(artifact);
    expect(r.ok).toBe(false);
    expect(r.problems.every((p) => p.includes('empty'))).toBe(true);
  });
});

describe('specTemplate / planTemplate', () => {
  it('carries the given upstream hash in frontmatter', () => {
    const hash = 'sha256:' + 'a'.repeat(64);
    const spec = parseArtifact(specTemplate('001-x', 'standard', hash), 'spec');
    expect(spec.upstream).toBe(hash);

    const plan = parseArtifact(planTemplate('001-x', 'standard', hash), 'plan');
    expect(plan.upstream).toBe(hash);
  });
});

describe('defaultConfigYaml / defaultRolesYaml', () => {
  it('produces YAML that parseConfig accepts and matches DEFAULT_CONFIG', () => {
    const config = parseConfig(defaultConfigYaml());
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('produces YAML that parseRoles accepts', () => {
    expect(parseRoles(defaultRolesYaml())).toEqual({
      'you@example.com': ['product-owner', 'tech-lead', 'engineer'],
    });
  });
});

describe('ciWorkflowYaml', () => {
  it('references `relay verify`', () => {
    expect(ciWorkflowYaml()).toMatch(/relay verify/);
  });
});
```

- [ ] **Step 3: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/templates.test.ts`
Expected: FAIL — `Cannot find module '../src/templates.js'`.

- [ ] **Step 4: Implement**

Create `packages/cli/src/templates.ts`:

```ts
import { stringify } from 'yaml';
import { DEFAULT_CONFIG, type Lane } from '@relay/core';

function frontmatter(fields: Record<string, string | null>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

export function intentTemplate(id: string, lane: Lane): string {
  return (
    frontmatter({ id, lane, stage: 'plan' }) +
    '\n<!-- Every ## section below must be filled in before `relay lint` passes. -->\n\n' +
    '## Problem\n\n' +
    '## Proposed outcome\n\n' +
    '## Affected users and systems\n\n' +
    '## Constraints\n\n' +
    '## Open questions\n'
  );
}

export function specTemplate(id: string, lane: Lane, upstream: string): string {
  return (
    frontmatter({ id, lane, stage: 'design', upstream }) +
    '\n<!-- Every ## section below must be filled in before `relay lint` passes.\n' +
    '     Flagged concerns use a checklist: "- [ ] open" or\n' +
    '     "- [x] resolved — resolved: <how>" / "— accepted risk: <why>". -->\n\n' +
    '## Requirements\n\n' +
    '## Design\n\n' +
    '## Flagged concerns\n'
  );
}

export function planTemplate(id: string, lane: Lane, upstream: string | null): string {
  return (
    frontmatter({ id, lane, stage: 'build', upstream }) +
    '\n<!-- Every ## section below must be filled in before `relay lint` passes. -->\n\n' +
    '## Files that change\n\n' +
    '## Work order\n\n' +
    '## Tests that prove completion\n'
  );
}

export function defaultConfigYaml(): string {
  return stringify(DEFAULT_CONFIG);
}

export function defaultRolesYaml(): string {
  return stringify({ 'you@example.com': ['product-owner', 'tech-lead', 'engineer'] });
}

export function ciWorkflowYaml(): string {
  return `name: relay verify
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx relay verify
`;
}
```

Note `specTemplate`/`planTemplate` take `upstream` as a plain string (not pre-formatted `upstream: <value>`) — the `frontmatter()` helper writes the `key: value` line itself, and `null` values are dropped entirely from the frontmatter block (used when `planTemplate` is scaffolded for an express-lane item, which has no upstream at all).

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/templates.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/templates.ts packages/cli/test/templates.test.ts packages/cli/package.json package-lock.json
git commit -m "relay(cli): add templates.ts — scaffold text for artifacts, config and CI"
```

---

## Task 13: `adapters/legacy-json.ts` — simulated `SourceOfTruthAdapter`

**Files:**
- Create: `packages/cli/src/adapters/legacy-json.ts`
- Test: `packages/cli/test/legacy-json.test.ts`

SPEC §12: "Ships with a simulated connector so a demo never depends on someone's sandbox being reachable." Backed by a single JSON file at `.relay/legacy-tickets.json`, an array of fake tickets. `relay init` (Task 14) seeds it with two example tickets so a fresh demo has something to `--from` immediately.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/legacy-json.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { LegacyJsonAdapter } from '../src/adapters/legacy-json.js';
import type { Artifact, WorkItem } from '@relay/core';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

function seed(dir: string, tickets: unknown[]) {
  writeFileSync(join(dir, '.relay-legacy-tickets.json'), JSON.stringify(tickets));
}

describe('LegacyJsonAdapter.pull', () => {
  it('returns an ArtifactSeed for a known ref', async () => {
    repo = makeScratchRepo();
    seed(repo.dir, [{ ref: 'JIRA-1001', title: 'Persist catalog metadata', body: 'Items vanish on reseed.' }]);
    const adapter = new LegacyJsonAdapter(repo.dir);
    const seedResult = await adapter.pull('JIRA-1001');
    expect(seedResult).toEqual({
      title: 'Persist catalog metadata',
      body: 'Items vanish on reseed.',
      externalRef: 'JIRA-1001',
    });
  });

  it('throws for an unknown ref', async () => {
    repo = makeScratchRepo();
    seed(repo.dir, []);
    const adapter = new LegacyJsonAdapter(repo.dir);
    await expect(adapter.pull('NOPE-1')).rejects.toThrow(/NOPE-1/);
  });
});

describe('LegacyJsonAdapter.push / link', () => {
  it('records a push and a link against the same ticket file', async () => {
    repo = makeScratchRepo();
    seed(repo.dir, [{ ref: 'JIRA-1001', title: 't', body: 'b' }]);
    const adapter = new LegacyJsonAdapter(repo.dir);

    const item: WorkItem = { id: '001-x', lane: 'standard', artifacts: {}, approvals: [] };
    const artifact: Artifact = {
      kind: 'spec', itemId: '001-x', lane: 'standard', upstream: null,
      policies: [], externalRef: 'JIRA-1001', origin: 'authored', body: 'b', raw: 'b',
    };

    const ref = await adapter.push(item, artifact);
    expect(ref).toBe('JIRA-1001');
    await adapter.link(item, 'abc123');

    const tickets = JSON.parse(readFileSync(join(repo.dir, '.relay-legacy-tickets.json'), 'utf8'));
    expect(tickets[0].linkedCommit).toBe('abc123');
    expect(tickets[0].relayItem).toBe('001-x');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/cli/test/legacy-json.test.ts`
Expected: FAIL — `Cannot find module '../src/adapters/legacy-json.js'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/adapters/legacy-json.ts`:

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Artifact, ArtifactSeed, ExternalRef, SourceOfTruthAdapter, WorkItem } from '@relay/core';

interface Ticket {
  ref: string;
  title: string;
  body: string;
  relayItem?: string;
  linkedCommit?: string;
}

export class LegacyJsonAdapter implements SourceOfTruthAdapter {
  private readonly path: string;

  constructor(cwd: string) {
    this.path = join(cwd, '.relay-legacy-tickets.json');
  }

  private read(): Ticket[] {
    return existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : [];
  }

  private write(tickets: Ticket[]): void {
    writeFileSync(this.path, JSON.stringify(tickets, null, 2));
  }

  async pull(ref: string): Promise<ArtifactSeed> {
    const ticket = this.read().find((t) => t.ref === ref);
    if (!ticket) throw new Error(`No simulated legacy ticket found for ref: ${ref}`);
    return { title: ticket.title, body: ticket.body, externalRef: ticket.ref };
  }

  async push(item: WorkItem, artifact: Artifact): Promise<ExternalRef> {
    const ref = artifact.externalRef;
    if (!ref) throw new Error(`Artifact for ${item.id} has no externalRef to push against`);
    const tickets = this.read();
    const ticket = tickets.find((t) => t.ref === ref);
    if (ticket) ticket.relayItem = item.id;
    this.write(tickets);
    return ref;
  }

  async link(item: WorkItem, sha: string): Promise<void> {
    const tickets = this.read();
    const ticket = tickets.find((t) => t.relayItem === item.id);
    if (ticket) {
      ticket.linkedCommit = sha;
      this.write(tickets);
    }
  }
}
```

The file is named `.relay-legacy-tickets.json` (dash, not inside `.relay/work/`) so it reads unambiguously as simulator data rather than a real work item, and `relay init` gitignores it alongside `.relay/CURRENT` in Task 14 since it's demo scaffolding, not something a real team would commit.

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/cli/test/legacy-json.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/adapters/legacy-json.ts packages/cli/test/legacy-json.test.ts
git commit -m "relay(cli): add LegacyJsonAdapter — simulated SourceOfTruthAdapter (SPEC §12)"
```

---

## Task 14: `commands/init.ts`

**Files:**
- Create: `packages/cli/src/commands/init.ts`
- Test: `packages/cli/test/init.test.ts`

Scope for Phase 2 (flagged explicitly, not silently narrowed): the deliverables table says `relay init` should "detect coding tools present, install matching adapters." The adapters (`@relay/adapters/claude-code` etc.) don't exist until Phase 3, so this task **detects and reports** which Tier-1 rule files are present and prints the tier honestly reached today (0, optionally 1) — it does not install hooks or skills, since there is nothing yet to install. Tiers 2-4 require `@relay/mcp`, hooks and CI wiring from later phases.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/init.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runInit', () => {
  it('creates the full .relay/ convention', () => {
    repo = makeScratchRepo();
    const result = runInit(repo.dir);

    expect(existsSync(join(repo.dir, '.relay/config.yml'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/roles.yml'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/templates/intent.md'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/templates/spec.md'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/templates/plan.md'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/schemas/intent.schema.yml'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/work'))).toBe(true);
    expect(result.tier).toBe(0);
  });

  it('seeds two example tickets in the simulated legacy connector', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const tickets = JSON.parse(readFileSync(join(repo.dir, '.relay-legacy-tickets.json'), 'utf8'));
    expect(tickets.length).toBe(2);
    expect(tickets[0].ref).toBeTruthy();
  });

  it('adds .relay/CURRENT and the ticket file to .gitignore', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const gitignore = readFileSync(join(repo.dir, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/\.relay\/CURRENT/);
    expect(gitignore).toMatch(/\.relay-legacy-tickets\.json/);
  });

  it('detects a CLAUDE.md rule file and reports tier 1', () => {
    repo = makeScratchRepo();
    writeFileSync(join(repo.dir, 'CLAUDE.md'), '# rules');
    const result = runInit(repo.dir);
    expect(result.tier).toBe(1);
    expect(result.detectedRuleFiles).toContain('CLAUDE.md');
  });

  it('writes a CI workflow only when the remote is on github.com', () => {
    repo = makeScratchRepo();
    execSync('git remote add origin https://github.com/example/repo.git', { cwd: repo.dir });
    runInit(repo.dir);
    expect(existsSync(join(repo.dir, '.github/workflows/relay-verify.yml'))).toBe(true);
  });

  it('skips the CI workflow when there is no GitHub remote', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(existsSync(join(repo.dir, '.github/workflows/relay-verify.yml'))).toBe(false);
  });

  it('refuses to run twice without --force', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(() => runInit(repo.dir)).toThrow(/already initialized/i);
  });

  it('allows re-running with force: true', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(() => runInit(repo.dir, { force: true })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/init.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/init.js'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/commands/init.ts`:

```ts
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  intentTemplate, specTemplate, planTemplate,
  defaultConfigYaml, defaultRolesYaml, ciWorkflowYaml,
} from '../templates.js';
import { remoteIsGitHub } from '../git.js';

export interface InitResult {
  tier: 0 | 1;
  detectedRuleFiles: string[];
  ciWorkflowWritten: boolean;
}

const RULE_FILES = ['CLAUDE.md', '.cursor/rules', 'AGENTS.md'];

const SCHEMA_STUB = (kind: string, sections: string[]) =>
  `# Mirrors the rules hardcoded in @relay/core's schema.ts as of Phase 2.\n` +
  `# Not yet read back by \`relay lint\` — forkable documentation today, live\n` +
  `# configuration in a future phase.\n` +
  `kind: ${kind}\n` +
  `requiredSections:\n${sections.map((s) => `  - "${s}"`).join('\n')}\n`;

function ensureGitignored(cwd: string, entries: string[]): void {
  const path = join(cwd, '.gitignore');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const missing = entries.filter((e) => !existing.includes(e));
  if (missing.length === 0) return;
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(path, prefix + missing.join('\n') + '\n');
}

export function runInit(cwd: string, opts: { force?: boolean } = {}): InitResult {
  const relayDir = join(cwd, '.relay');
  if (existsSync(relayDir) && !opts.force) {
    throw new Error('.relay/ already initialized — pass --force to re-scaffold');
  }

  for (const dir of ['schemas', 'templates', 'work']) {
    mkdirSync(join(relayDir, dir), { recursive: true });
  }

  writeFileSync(join(relayDir, 'config.yml'), defaultConfigYaml());
  writeFileSync(join(relayDir, 'roles.yml'), defaultRolesYaml());

  writeFileSync(join(relayDir, 'templates/intent.md'), intentTemplate('<id>', 'standard'));
  writeFileSync(join(relayDir, 'templates/spec.md'), specTemplate('<id>', 'standard', '<upstream-hash>'));
  writeFileSync(join(relayDir, 'templates/plan.md'), planTemplate('<id>', 'standard', '<upstream-hash>'));

  writeFileSync(join(relayDir, 'schemas/intent.schema.yml'),
    SCHEMA_STUB('intent', ['Problem', 'Proposed outcome', 'Affected users and systems', 'Constraints', 'Open questions']));
  writeFileSync(join(relayDir, 'schemas/spec.schema.yml'),
    SCHEMA_STUB('spec', ['Requirements', 'Design', 'Flagged concerns']));
  writeFileSync(join(relayDir, 'schemas/plan.schema.yml'),
    SCHEMA_STUB('plan', ['Files that change', 'Work order', 'Tests that prove completion']));

  writeFileSync(join(cwd, '.relay-legacy-tickets.json'), JSON.stringify([
    { ref: 'JIRA-1001', title: 'Persist catalog metadata in git', body: 'Items added through the UI live only in gitignored db.json and are lost on reseed.' },
    { ref: 'JIRA-1002', title: 'Fix typo on the checkout button', body: 'Button reads "Chekout".' },
  ], null, 2));

  ensureGitignored(cwd, ['.relay/CURRENT', '.relay-legacy-tickets.json']);

  const detectedRuleFiles = RULE_FILES.filter((f) => existsSync(join(cwd, f)));
  const tier = detectedRuleFiles.length > 0 ? 1 : 0;

  let ciWorkflowWritten = false;
  if (remoteIsGitHub(cwd)) {
    mkdirSync(join(cwd, '.github/workflows'), { recursive: true });
    writeFileSync(join(cwd, '.github/workflows/relay-verify.yml'), ciWorkflowYaml());
    ciWorkflowWritten = true;
  }

  return { tier, detectedRuleFiles, ciWorkflowWritten };
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/init.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/init.ts packages/cli/test/init.test.ts
git commit -m "relay(cli): add relay init — scaffolds .relay/, detects tier, writes CI workflow"
```

---

## Task 15: `commands/new.ts` — including `--from` ingest

**Files:**
- Modify: `packages/cli/src/templates.ts` (additive: `intentTemplate` gains an optional third `externalRef` parameter)
- Create: `packages/cli/src/commands/new.ts`
- Test: `packages/cli/test/new.test.ts`

**Scope note, flagged rather than silently narrowed:** `relay new` scaffolds only the *first* artifact `lane.requires` names (`intent.md` for standard/governed, `plan.md` for express) and creates the branch. There is deliberately no command here to scaffold the *next* artifact once a gate passes — per SPEC §9, that's the conversational stage skill's job (`/relay-spec`, `/relay-plan`), which ships with `@relay/adapters/claude-code` in Phase 3. Until then, direct edit is door 3 of SPEC §10: a human (or an agent, guided by `specTemplate`/`planTemplate` from Task 12) writes the next file by hand. `--from <ref>` only makes sense for a lane whose first artifact is `intent` — express items are explicitly for changes too small to warrant an external ticket in the first place (SPEC §7.6), so `--from` on an express item is a clear user error, not a silent no-op.

- [ ] **Step 1: Extend `intentTemplate`**

In `packages/cli/src/templates.ts`, change the signature and body from:
```ts
export function intentTemplate(id: string, lane: Lane): string {
  return (
    frontmatter({ id, lane, stage: 'plan' }) +
```
to:
```ts
export function intentTemplate(id: string, lane: Lane, externalRef: string | null = null): string {
  return (
    frontmatter({ id, lane, stage: 'plan', external_ref: externalRef }) +
```
(No other line in the function body changes — this is purely additive; Task 14's two-argument calls remain valid since the new parameter defaults to `null`.)

- [ ] **Step 2: Write the failing tests**

Create `packages/cli/test/new.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { loadWorkItem } from '../src/relay-dir.js';
import { currentBranch } from '../src/git.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runNew', () => {
  it('allocates an id, scaffolds intent.md, and creates the branch', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const result = await runNew('SSO for admin', {}, repo.dir);

    expect(result.id).toBe('001-sso-for-admin');
    expect(currentBranch(repo.dir)).toBe('relay/001-sso-for-admin');
    const item = loadWorkItem(result.id, 'standard', repo.dir);
    expect(item.artifacts.intent).toBeDefined();
    expect(item.artifacts.intent?.lane).toBe('standard');
  });

  it('scaffolds plan.md directly for an express-lane item', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const result = await runNew('fix typo', { lane: 'express' }, repo.dir);

    const item = loadWorkItem(result.id, 'express', repo.dir);
    expect(item.artifacts.plan).toBeDefined();
    expect(item.artifacts.intent).toBeUndefined();
  });

  it('rejects --from on an express-lane item', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await expect(runNew('x', { lane: 'express', from: 'JIRA-1001' }, repo.dir))
      .rejects.toThrow(/express/i);
  });

  it('seeds intent.md from the simulated legacy connector with --from', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir); // seeds JIRA-1001 via Task 14
    const result = await runNew('ignored title', { from: 'JIRA-1001' }, repo.dir);

    const item = loadWorkItem(result.id, 'standard', repo.dir);
    expect(item.artifacts.intent?.body).toMatch(/Items added through the UI/);
    expect(item.artifacts.intent?.externalRef).toBe('JIRA-1001');
  });

  it('throws a clear error when config.yml has not been initialized', async () => {
    repo = makeScratchRepo();
    await expect(runNew('x', {}, repo.dir)).rejects.toThrow(/relay init/i);
  });
});
```

- [ ] **Step 3: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/new.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/new.js'`.

- [ ] **Step 4: Implement**

Create `packages/cli/src/commands/new.ts`:

```ts
import { execSync } from 'node:child_process';
import { parseConfig, type Lane } from '@relay/core';
import { loadConfigText, writeArtifact } from '../relay-dir.js';
import { allocateItemId } from '../item-id.js';
import { intentTemplate, planTemplate } from '../templates.js';
import { LegacyJsonAdapter } from '../adapters/legacy-json.js';

export interface NewOptions {
  lane?: Lane;
  from?: string;
}

export interface NewResult {
  id: string;
  lane: Lane;
  branch: string;
}

function withProblemFilled(template: string, body: string): string {
  return template.replace('## Problem\n\n', `## Problem\n\n${body}\n\n`);
}

export async function runNew(title: string, opts: NewOptions, cwd: string): Promise<NewResult> {
  const configText = loadConfigText(cwd);
  if (!configText) throw new Error('No .relay/config.yml found — run `relay init` first');
  const config = parseConfig(configText);

  const lane = opts.lane ?? config.defaultLane;
  const laneRule = config.lanes[lane];
  const firstKind = laneRule.requires[0];

  if (opts.from && firstKind !== 'intent') {
    throw new Error(`--from seeds an intent.md; the ${lane} lane's first required artifact is ${firstKind}, not intent`);
  }

  const id = allocateItemId(title, cwd);
  const branch = `relay/${id}`;

  let raw: string;
  if (firstKind === 'intent') {
    let template = intentTemplate(id, lane, opts.from ?? null);
    if (opts.from) {
      const seed = await new LegacyJsonAdapter(cwd).pull(opts.from);
      template = withProblemFilled(template, seed.body);
    }
    raw = template;
  } else {
    raw = planTemplate(id, lane, null);
  }

  execSync(`git checkout -b ${branch} -q`, { cwd });
  writeArtifact(id, firstKind, raw, cwd);

  return { id, lane, branch };
}
```

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/new.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/templates.ts packages/cli/src/commands/new.ts packages/cli/test/new.test.ts
git commit -m "relay(cli): add relay new — id allocation, branch, --from ingest"
```

---

## Task 16: `commands/use.ts` and shared item/context resolution

**Files:**
- Create: `packages/cli/src/current-item.ts` — resolve/set which item a session is on (SPEC §4.3: branch first, `.relay/CURRENT` fallback)
- Create: `packages/cli/src/context.ts` — shared config/roles/author loading, used by every command from here on
- Create: `packages/cli/src/commands/use.ts`
- Test: `packages/cli/test/current-item.test.ts`
- Test: `packages/cli/test/use.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/current-item.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { resolveCurrentItemId, setCurrentItemId } from '../src/current-item.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('resolveCurrentItemId', () => {
  it('resolves from a relay/<id> branch', () => {
    repo = makeScratchRepo();
    execSync('git checkout -b relay/001-x -q', { cwd: repo.dir });
    expect(resolveCurrentItemId(repo.dir)).toBe('001-x');
  });

  it('falls back to .relay/CURRENT off a non-relay branch', () => {
    repo = makeScratchRepo();
    setCurrentItemId('002-y', repo.dir);
    expect(resolveCurrentItemId(repo.dir)).toBe('002-y');
  });

  it('prefers the branch over a stale CURRENT file', () => {
    repo = makeScratchRepo();
    setCurrentItemId('002-y', repo.dir);
    execSync('git checkout -b relay/001-x -q', { cwd: repo.dir });
    expect(resolveCurrentItemId(repo.dir)).toBe('001-x');
  });

  it('throws with actionable guidance when neither is set', () => {
    repo = makeScratchRepo();
    expect(() => resolveCurrentItemId(repo.dir)).toThrow(/relay use/);
  });
});
```

Create `packages/cli/test/use.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runUse } from '../src/commands/use.js';
import { resolveCurrentItemId } from '../src/current-item.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runUse', () => {
  it('sets .relay/CURRENT to the given id', () => {
    repo = makeScratchRepo();
    runUse('003-z', repo.dir);
    expect(resolveCurrentItemId(repo.dir)).toBe('003-z');
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/current-item.test.ts packages/cli/test/use.test.ts`
Expected: FAIL — both modules missing.

- [ ] **Step 3: Implement**

Create `packages/cli/src/current-item.ts`:

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { currentBranch, itemIdFromBranch } from './git.js';
import { relayRoot } from './relay-dir.js';

export function resolveCurrentItemId(cwd: string): string {
  const fromBranch = itemIdFromBranch(currentBranch(cwd));
  if (fromBranch) return fromBranch;

  const path = join(relayRoot(cwd), 'CURRENT');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();

  throw new Error(
    'No current item: not on a relay/<id> branch and no .relay/CURRENT set. Run `relay use <id>`.'
  );
}

export function setCurrentItemId(id: string, cwd: string): void {
  mkdirSync(relayRoot(cwd), { recursive: true });
  writeFileSync(join(relayRoot(cwd), 'CURRENT'), id);
}
```

Create `packages/cli/src/context.ts`:

```ts
import { parseConfig, parseRoles, type ApprovalContext, type LaneRule, type RelayConfig } from '@relay/core';
import { loadConfigText, loadRolesText } from './relay-dir.js';
import { gitIdentity } from './git.js';

export function loadRelayConfig(cwd: string): RelayConfig {
  const text = loadConfigText(cwd);
  if (!text) throw new Error('No .relay/config.yml found — run `relay init` first');
  return parseConfig(text);
}

export function buildApprovalContext(cwd: string, lane: LaneRule): ApprovalContext {
  const rolesText = loadRolesText(cwd);
  const roles = rolesText ? parseRoles(rolesText) : {};
  return { roles, lane, author: gitIdentity(cwd) };
}
```

Create `packages/cli/src/commands/use.ts`:

```ts
import { setCurrentItemId } from '../current-item.js';

export function runUse(id: string, cwd: string): void {
  setCurrentItemId(id, cwd);
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/current-item.test.ts packages/cli/test/use.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/current-item.ts packages/cli/src/context.ts packages/cli/src/commands/use.ts packages/cli/test/current-item.test.ts packages/cli/test/use.test.ts
git commit -m "relay(cli): add relay use and shared current-item/context resolution"
```

---

## Task 17: `commands/status.ts`

**Files:**
- Create: `packages/cli/src/commands/status.ts`
- Test: `packages/cli/test/status.test.ts`

`status`'s headline `stage` comes from `deriveStage` (authority-only, the same lenient check the dashboard's pipeline lanes will use in Phase 5). `blockedBy` comes from `evaluateGate` on that same stage, which is stricter (lint + chain + stage checks + authority) — so it can report more than a bare "not approved yet" when the current stage is not `done`. That divergence is intentional, not a bug: `deriveStage` answers "where does this sit," `evaluateGate` answers "what, specifically, is wrong."

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/status.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runStatus } from '../src/commands/status.js';
import { runGate } from '../src/commands/gate.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

function fillIntent(dir: string, id: string) {
  const path = join(dir, `.relay/work/${id}/intent.md`);
  const filled = readFileSync(path, 'utf8')
    .replace('## Problem\n\n', '## Problem\n\np\n\n')
    .replace('## Proposed outcome\n\n', '## Proposed outcome\n\no\n\n')
    .replace('## Affected users and systems\n\n', '## Affected users and systems\n\na\n\n')
    .replace('## Constraints\n\n', '## Constraints\n\nc\n\n')
    .replace('## Open questions\n', '## Open questions\nnone\n');
  writeFileSync(path, filled);
}

describe('runStatus', () => {
  it('reports intake before any approval', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    fillIntent(repo.dir, id);
    expect(runStatus(repo.dir, id).stage).toBe('plan');
  });

  it('reports design once the plan gate is approved', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    fillIntent(repo.dir, id);
    runGate(id, 'plan', 'approve', undefined, repo.dir);
    expect(runStatus(repo.dir, id).stage).toBe('design');
  });

  it('falls back to plan with a changed-since-approval reason after intent.md is edited', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    fillIntent(repo.dir, id);
    runGate(id, 'plan', 'approve', undefined, repo.dir);

    const path = join(repo.dir, `.relay/work/${id}/intent.md`);
    writeFileSync(path, readFileSync(path, 'utf8') + '\nedited after approval\n');

    const status = runStatus(repo.dir, id);
    expect(status.stage).toBe('plan');
    expect(status.blockedBy.join(' ')).toMatch(/changed since approval/i);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/status.test.ts`
Expected: FAIL — both `../src/commands/status.js` and `../src/commands/gate.js` are missing (Task 19 builds `gate.ts`; write it now as a forward reference the test needs — see Step 3a below).

- [ ] **Step 3a: Implement `runGate` early (minimal, full version lands in Task 19)**

This test needs `runGate` to exist. Task 19 is the authoritative task for `commands/gate.ts`; to keep this task's tests runnable in isolation under `subagent-driven-development`, either sequence Task 19 immediately before running Step 2 above, or (if executing tasks strictly in order) skip Step 2's `runGate`-dependent assertions until Task 19 lands and revisit them then. **Recommended: reorder execution so Task 19 (`commands/gate.ts`) runs before Task 17's Step 2.** The task list order in this document reflects dependency-free reading order, not required execution order — `subagent-driven-development` should sequence by dependency: 14 → 15 → 16 → 19 → 17 → 18 → 20 → 21 → 22 → 23 → 24.

- [ ] **Step 3: Implement `status.ts`**

Create `packages/cli/src/commands/status.ts`:

```ts
import { deriveStage, evaluateGate, type Stage } from '@relay/core';
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

  const stage = deriveStage(item, ctx);
  const blockedBy = stage === 'done' || stage === 'intake'
    ? []
    : evaluateGate(item, stage, ctx).reasons;

  return { id, lane: item.lane, stage, blockedBy };
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/status.test.ts`
Expected: all pass (once Task 19's `gate.ts` exists per Step 3a).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/status.ts packages/cli/test/status.test.ts
git commit -m "relay(cli): add relay status"
```

---

## Task 18: `commands/lint.ts`

**Files:**
- Create: `packages/cli/src/commands/lint.ts`
- Test: `packages/cli/test/lint.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/lint.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runLint } from '../src/commands/lint.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runLint', () => {
  it('fails on a freshly scaffolded (empty) intent.md', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const result = runLint(repo.dir, id);
    expect(result.ok).toBe(false);
    expect(result.problems[0].artifact).toBe('intent.md');
    expect(result.problems[0].problems.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/cli/test/lint.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/lint.js'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/commands/lint.ts`:

```ts
import { lintArtifact } from '@relay/core';
import { loadWorkItem } from '../relay-dir.js';
import { resolveCurrentItemId } from '../current-item.js';
import { loadRelayConfig } from '../context.js';

export interface LintReport {
  id: string;
  ok: boolean;
  problems: { artifact: string; problems: string[] }[];
}

export function runLint(cwd: string, idOverride?: string): LintReport {
  const id = idOverride ?? resolveCurrentItemId(cwd);
  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(id, config.defaultLane, cwd);

  const problems: { artifact: string; problems: string[] }[] = [];
  for (const [kind, artifact] of Object.entries(item.artifacts)) {
    if (!artifact) continue;
    const result = lintArtifact(artifact);
    if (!result.ok) problems.push({ artifact: `${kind}.md`, problems: result.problems });
  }

  return { id, ok: problems.length === 0, problems };
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/cli/test/lint.test.ts`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/lint.ts packages/cli/test/lint.test.ts
git commit -m "relay(cli): add relay lint"
```

---

## Task 19: `commands/gate.ts`

**Files:**
- Create: `packages/cli/src/commands/gate.ts`
- Test: `packages/cli/test/gate-command.test.ts`

**Execute this task before Task 17** — `status.test.ts` calls `runGate` (see Task 17, Step 3a).

`relay gate <gate> --approve|--reject|--override --reason` appends a signed record; it never decides whether the gate *passes* — `evaluateGate` (core) does that, on the next read. Folding SPEC §8's `relay reject` into `--reject` here (flagged in this plan's header) means there is no separate reject command.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/gate-command.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runGate } from '../src/commands/gate.js';
import { loadWorkItem } from '../src/relay-dir.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

async function makeItem(dir: string): Promise<string> {
  runInit(dir);
  const { id } = await runNew('test', {}, dir);
  return id;
}

describe('runGate', () => {
  it('appends an approved record with the current hash and git identity', async () => {
    repo = makeScratchRepo();
    const id = await makeItem(repo.dir);
    const approval = await runGate(id, 'plan', 'approve', undefined, repo.dir);

    expect(approval.verdict).toBe('approved');
    expect(approval.identity).toBe('eng@example.com');
    const item = loadWorkItem(id, 'standard', repo.dir);
    expect(item.approvals).toHaveLength(1);
  });

  it('assigns the role from roles.yml matching the git identity', async () => {
    repo = makeScratchRepo();
    const id = await makeItem(repo.dir);
    writeFileSync(join(repo.dir, '.relay/roles.yml'), 'eng@example.com: [engineer]\n');

    const approval = await runGate(id, 'plan', 'approve', undefined, repo.dir);
    expect(approval.role).toBe('engineer');
  });

  it('records a rejection with a reason', async () => {
    repo = makeScratchRepo();
    const id = await makeItem(repo.dir);
    const approval = await runGate(id, 'plan', 'reject', 'not ready', repo.dir);
    expect(approval.verdict).toBe('rejected');
    expect(approval.reason).toBe('not ready');
  });

  it('records an override — never blocked, even with no reason', async () => {
    repo = makeScratchRepo();
    const id = await makeItem(repo.dir);
    const approval = await runGate(id, 'plan', 'override', undefined, repo.dir);
    expect(approval.verdict).toBe('override');
    const item = loadWorkItem(id, 'standard', repo.dir);
    expect(item.approvals).toHaveLength(1); // written, even though it won't pass evaluateGate downstream
  });

  it('throws when the gate has no artifact yet', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await expect(runGate('999-nope', 'design', 'approve', undefined, repo.dir))
      .rejects.toThrow(/spec\.md does not exist/);
  });

  it('pushes to the legacy adapter when sourceOfTruth is legacy and the artifact has an externalRef', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const configPath = join(repo.dir, '.relay/config.yml');
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('sourceOfTruth: repo', 'sourceOfTruth: legacy'));

    const { id } = await runNew('x', { from: 'JIRA-1001' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const tickets = JSON.parse(readFileSync(join(repo.dir, '.relay-legacy-tickets.json'), 'utf8'));
    expect(tickets.find((t: { ref: string }) => t.ref === 'JIRA-1001').relayItem).toBe(id);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/gate-command.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/gate.js'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/commands/gate.ts`:

```ts
import { hashContent, type Approval, type ArtifactKind, type Stage } from '@relay/core';
import { loadWorkItem, appendApproval } from '../relay-dir.js';
import { loadRelayConfig, buildApprovalContext } from '../context.js';
import { LegacyJsonAdapter } from '../adapters/legacy-json.js';

const KIND_FOR_GATE: Partial<Record<Stage, ArtifactKind>> = {
  plan: 'intent',
  design: 'spec',
  build: 'plan',
};

const VERDICT_FOR_ACTION = {
  approve: 'approved',
  reject: 'rejected',
  override: 'override',
} as const;

export type GateAction = keyof typeof VERDICT_FOR_ACTION;

// appendApproval runs before the first `await`, so a caller that does not
// await runGate still gets a durable ledger write — it just won't observe
// the legacy-adapter push, which happens after.
export async function runGate(
  id: string,
  gate: Stage,
  action: GateAction,
  reason: string | undefined,
  cwd: string
): Promise<Approval> {
  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(id, config.defaultLane, cwd);
  const ctx = buildApprovalContext(cwd, config.lanes[item.lane]);

  const kind = KIND_FOR_GATE[gate];
  if (!kind) throw new Error(`${gate} is not a gate with an artifact of its own`);
  const artifact = item.artifacts[kind];
  if (!artifact) throw new Error(`${kind}.md does not exist yet for ${id}`);

  const role = ctx.roles[ctx.author]?.[0] ?? 'unspecified';
  const approval: Approval = {
    ts: new Date().toISOString(),
    itemId: id,
    gate,
    artifact: `${kind}.md`,
    hash: hashContent(artifact.raw),
    identity: ctx.author,
    role,
    verdict: VERDICT_FOR_ACTION[action],
    ...(reason ? { reason } : {}),
  };

  appendApproval(id, approval, cwd);

  if (action === 'approve' && config.sourceOfTruth === 'legacy' && artifact.externalRef) {
    await new LegacyJsonAdapter(cwd).push(item, artifact);
  }

  return approval;
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/gate-command.test.ts packages/cli/test/status.test.ts`
Expected: all pass (this also unblocks Task 17's tests, per the Step 3a note there).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/gate.ts packages/cli/test/gate-command.test.ts
git commit -m "relay(cli): add relay gate — approve/reject/override, legacy-adapter push"
```

---

## Task 20: `commands/handover.ts`

**Files:**
- Create: `packages/cli/src/sections.ts` — shared markdown-section extraction (used here and by Task 21)
- Create: `packages/cli/src/commands/handover.ts`
- Test: `packages/cli/test/handover.test.ts`

**Scoped to v1's real handoff points**: `--to design` (bundles the approved `intent.md`) and `--to build` (bundles the approved `spec.md`) — the two stage transitions v1 actually models. `done` is terminal, not a receiving stage.

**Honest about Part 2** — SPEC §8's five parts include "decisions made and alternatives rejected." Nothing in Phase 2's data model captures that (it lives in conversation, not in a file field), so the generated bundle leaves it as an explicit, clearly-labelled prompt for a human or a stage skill (Phase 3) to fill in — not a fabricated summary and not a silent omission.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/handover.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runHandover } from '../src/commands/handover.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runHandover', () => {
  it('writes a five-part bundle to handover/design.md', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    const path = join(repo.dir, `.relay/work/${id}/intent.md`);
    writeFileSync(path, readFileSync(path, 'utf8').replace(
      '## Open questions\n', '## Open questions\nShould this cover mobile too?\n'
    ));

    const written = runHandover(id, 'design', repo.dir);
    expect(existsSync(written)).toBe(true);
    const bundle = readFileSync(written, 'utf8');
    expect(bundle).toMatch(/Frozen upstream artifact/);
    expect(bundle).toMatch(/Decisions made and alternatives rejected/);
    expect(bundle).toMatch(/Should this cover mobile too\?/);
    expect(bundle).toMatch(/Applicable policies/);
    expect(bundle).toMatch(/What this stage owes/);
    expect(bundle).toMatch(/spec\.md/); // design owes a spec.md
  });

  it('throws for an unmodelled --to target', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    // @ts-expect-error deliberately invalid at the type level too
    expect(() => runHandover(id, 'done', repo.dir)).toThrow(/no handover bundle/i);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/handover.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/handover.js'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/sections.ts`:

```ts
export function extractSection(body: string, title: string): string | null {
  const parts = body.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim().toLowerCase();
    if (heading === title.toLowerCase()) {
      return (newline === -1 ? '' : part.slice(newline + 1)).trim();
    }
  }
  return null;
}
```

Create `packages/cli/src/commands/handover.ts`:

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent, type ArtifactKind } from '@relay/core';
import { loadWorkItem, itemDir } from '../relay-dir.js';
import { loadRelayConfig } from '../context.js';
import { extractSection } from '../sections.js';

export type HandoverTarget = 'design' | 'build';

const TARGETS: Record<HandoverTarget, { upstreamKind: ArtifactKind; owedKind: ArtifactKind; owedGate: string }> = {
  design: { upstreamKind: 'intent', owedKind: 'spec', owedGate: 'design' },
  build: { upstreamKind: 'spec', owedKind: 'plan', owedGate: 'build' },
};

export function runHandover(id: string, toStage: HandoverTarget, cwd: string): string {
  const target = TARGETS[toStage];
  if (!target) throw new Error(`No handover bundle is defined for stage: ${toStage}`);

  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(id, config.defaultLane, cwd);
  const artifact = item.artifacts[target.upstreamKind];
  if (!artifact) throw new Error(`${target.upstreamKind}.md does not exist yet for ${id}`);

  const openQuestions = extractSection(artifact.body, 'open questions');
  const policies = artifact.policies.length > 0 ? artifact.policies.join(', ') : 'none declared';

  const bundle = `# Handover — ${id} → ${toStage}

## 1. Frozen upstream artifact

\`${target.upstreamKind}.md\`, content-hashed: \`${hashContent(artifact.raw)}\`

\`\`\`markdown
${artifact.raw}
\`\`\`

## 2. Decisions made and alternatives rejected

_Fill in before sending: what was decided in conversation while drafting ${target.upstreamKind}.md, and what alternatives were considered and rejected. This cannot be reconstructed from the file alone._

## 3. Open questions inherited

${openQuestions || 'None recorded.'}

## 4. Applicable policies

${policies}

## 5. What this stage owes

Produce \`${target.owedKind}.md\`, complete per \`relay lint\`, and win an approval at the \`${target.owedGate}\` gate.
`;

  const dir = join(itemDir(id, cwd), 'handover');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${toStage}.md`);
  writeFileSync(path, bundle);
  return path;
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/handover.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/sections.ts packages/cli/src/commands/handover.ts packages/cli/test/handover.test.ts
git commit -m "relay(cli): add relay handover — SPEC §8's five-part bundle"
```

---

## Task 21: `commands/resume.ts`

**Files:**
- Create: `packages/cli/src/commands/resume.ts`
- Test: `packages/cli/test/resume.test.ts`

SPEC §4.4: "what this item is, which stage, which gate blocks it, what the last session did, which questions remain open, what is next." No session state is stored anywhere (a workspace gotcha), so "what the last session did" comes from `git log` over the item's folder — the one durable record SPEC names as authoritative for this.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/resume.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runResume } from '../src/commands/resume.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runResume', () => {
  it('reports id, stage, blocking reasons, open questions and recent history', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    const path = join(repo.dir, `.relay/work/${id}/intent.md`);
    writeFileSync(path, readFileSync(path, 'utf8').replace(
      '## Open questions\n', '## Open questions\nWho owns rollout?\n'
    ));
    execSync(`git add .relay && git commit -q -m "draft intent for ${id}"`, { cwd: repo.dir });

    const brief = runResume(repo.dir, id);
    expect(brief.id).toBe(id);
    expect(brief.stage).toBe('plan');
    expect(brief.openQuestions).toMatch(/Who owns rollout/);
    expect(brief.recentHistory.join(' ')).toMatch(/draft intent/);
    expect(brief.next).toMatch(/plan/i);
  });

  it('reports "nothing — complete" once the item reaches done', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('x', { lane: 'express' }, repo.dir);
    const path = join(repo.dir, `.relay/work/${id}/plan.md`);
    writeFileSync(path, readFileSync(path, 'utf8')
      .replace('## Files that change\n\n', '## Files that change\n\n`a.ts`\n\n')
      .replace('## Work order\n\n', '## Work order\n\n1.\n\n')
      .replace('## Tests that prove completion\n', '## Tests that prove completion\n`a.test.ts`\n'));

    const { runGate } = await import('../src/commands/gate.js');
    await runGate(id, 'build', 'approve', undefined, repo.dir);

    const brief = runResume(repo.dir, id);
    expect(brief.stage).toBe('done');
    expect(brief.next).toMatch(/nothing/i);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/resume.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/resume.js'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/commands/resume.ts`:

```ts
import { execSync } from 'node:child_process';
import { type Stage } from '@relay/core';
import { loadWorkItem, itemDir } from '../relay-dir.js';
import { loadRelayConfig } from '../context.js';
import { extractSection } from '../sections.js';
import { runStatus } from './status.js';

export interface ResumeBrief {
  id: string;
  stage: Stage;
  blockedBy: string[];
  openQuestions: string;
  recentHistory: string[];
  next: string;
}

function nextStep(stage: Stage, blockedBy: string[]): string {
  if (stage === 'done') return 'Nothing — this item is complete.';
  if (blockedBy.length > 0) {
    return `Resolve: ${blockedBy.join('; ')} — then it can be approved at the ${stage} gate.`;
  }
  return `Awaiting approval at the ${stage} gate.`;
}

export function runResume(cwd: string, idOverride?: string): ResumeBrief {
  const status = runStatus(cwd, idOverride);
  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(status.id, config.defaultLane, cwd);

  const latestArtifact = item.artifacts.plan ?? item.artifacts.spec ?? item.artifacts.intent;
  const openQuestions = latestArtifact ? extractSection(latestArtifact.body, 'open questions') : null;

  let recentHistory: string[] = [];
  try {
    const dir = itemDir(status.id, cwd);
    const out = execSync(`git log --format=%s -n 5 -- ${JSON.stringify(dir)}`, { cwd }).toString().trim();
    recentHistory = out.length === 0 ? [] : out.split('\n');
  } catch {
    recentHistory = [];
  }

  return {
    id: status.id,
    stage: status.stage,
    blockedBy: status.blockedBy,
    openQuestions: openQuestions ?? 'None recorded.',
    recentHistory,
    next: nextStep(status.stage, status.blockedBy),
  };
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/resume.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/resume.ts packages/cli/test/resume.test.ts
git commit -m "relay(cli): add relay resume — briefing from files + git log, no session state"
```

---

## Task 22: `commands/verify.ts` — the CI check (SPEC §7.4)

**Files:**
- Create: `packages/cli/src/commands/verify.ts`
- Test: `packages/cli/test/verify.test.ts`

Maps directly onto SPEC §7.4's six checks: (1) branch names a declared item; (2)+(3)+(4) — required artifacts present, schema-valid, and validly approved — are all three answered per required gate by `evaluateGate` (Task 4), so `verify` does not re-derive any of them itself; (5) drift, via `checkDrift` (Phase 1); (6) overrides need a reason, already enforced inside `validApproval` and therefore inside every `evaluateGate` call. `verify` composes, it does not re-decide.

Whether the named tests actually ran is something no CLI process running `relay verify` can determine about itself — the caller (a CI job) knows whether its own test step passed. `--tests-passed` carries that evidence in explicitly, the same way `GateChecks.testsRan` does in core (Task 4); it is never inferred.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/verify.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent } from '@relay/core';
import { specTemplate, planTemplate } from '../src/templates.js';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runGate } from '../src/commands/gate.js';
import { writeArtifact } from '../src/relay-dir.js';
import { runVerify } from '../src/commands/verify.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

function fillIntent(dir: string, id: string) {
  const path = join(dir, `.relay/work/${id}/intent.md`);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace('## Problem\n\n', '## Problem\n\np\n\n')
    .replace('## Proposed outcome\n\n', '## Proposed outcome\n\no\n\n')
    .replace('## Affected users and systems\n\n', '## Affected users and systems\n\na\n\n')
    .replace('## Constraints\n\n', '## Constraints\n\nc\n\n')
    .replace('## Open questions\n', '## Open questions\nnone\n'));
}

async function driveToBuild(dir: string, id: string, filesDeclared: string): Promise<void> {
  fillIntent(dir, id);
  await runGate(id, 'plan', 'approve', undefined, dir);

  const intentHash = hashContent(readFileSync(join(dir, `.relay/work/${id}/intent.md`), 'utf8'));
  const specRaw = specTemplate(id, 'standard', intentHash)
    .replace('## Requirements\n\n', '## Requirements\n\nr\n\n')
    .replace('## Design\n\n', '## Design\n\nd\n\n')
    .replace('## Flagged concerns\n', '## Flagged concerns\n- [x] none — accepted risk: n/a\n');
  writeArtifact(id, 'spec', specRaw, dir);
  await runGate(id, 'design', 'approve', undefined, dir);

  const specHash = hashContent(specRaw);
  const planRaw = planTemplate(id, 'standard', specHash)
    .replace('## Files that change\n\n', `## Files that change\n\n${filesDeclared}\n\n`)
    .replace('## Work order\n\n', '## Work order\n\n1.\n\n')
    .replace('## Tests that prove completion\n', '## Tests that prove completion\n`a.test.ts`\n');
  writeArtifact(id, 'plan', planRaw, dir);
  await runGate(id, 'build', 'approve', undefined, dir);
}

describe('runVerify', () => {
  it('passes a fully approved item with tests confirmed and no drift', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    await driveToBuild(repo.dir, id, '`a.ts`');
    execSync('git add .relay && git commit -q -m "pipeline"', { cwd: repo.dir });

    const report = runVerify(repo.dir, { testsPassed: true });
    expect(report.passed).toBe(true);
    expect(report.reasons).toEqual([]);
  });

  it('fails when the branch does not declare a work item', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const report = runVerify(repo.dir, {});
    expect(report.passed).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/does not declare a work item/);
  });

  it('fails when the build gate has no approval yet', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    fillIntent(repo.dir, id);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const report = runVerify(repo.dir, { testsPassed: true });
    expect(report.passed).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/\[build\]/);
  });

  it('fails when --tests-passed was not confirmed', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    await driveToBuild(repo.dir, id, '`a.ts`');
    execSync('git add .relay && git commit -q -m "pipeline"', { cwd: repo.dir });

    const report = runVerify(repo.dir, {});
    expect(report.passed).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/tests/i);
  });

  it('fails on undeclared files touched, for the governed (drift-fatal) lane', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', { lane: 'governed' }, repo.dir);
    await driveToBuild(repo.dir, id, '`a.ts`'); // declares only a.ts
    writeFileSync(join(repo.dir, 'stray.ts'), 'x');
    execSync('git add . && git commit -q -m "pipeline plus a stray file"', { cwd: repo.dir });

    const report = runVerify(repo.dir, { testsPassed: true });
    expect(report.passed).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/stray\.ts/);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/verify.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/verify.js'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/commands/verify.ts`:

```ts
import { checkDrift, evaluateGate, GATE_FOR_KIND } from '@relay/core';
import { loadWorkItem } from '../relay-dir.js';
import { loadRelayConfig, buildApprovalContext } from '../context.js';
import { currentBranch, itemIdFromBranch, touchedFiles } from '../git.js';

export interface VerifyOptions {
  base?: string;
  testsPassed?: boolean;
}

export interface VerifyReport {
  id: string | null;
  passed: boolean;
  reasons: string[];
}

export function runVerify(cwd: string, opts: VerifyOptions = {}): VerifyReport {
  const branch = currentBranch(cwd);
  const id = itemIdFromBranch(branch);
  if (!id) {
    return {
      id: null,
      passed: false,
      reasons: [`Branch ${branch} does not declare a work item (expected relay/<id>)`],
    };
  }

  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(id, config.defaultLane, cwd);
  const laneRule = config.lanes[item.lane];
  const ctx = buildApprovalContext(cwd, laneRule);

  const reasons: string[] = [];

  // SPEC §7.4 checks 2, 3, 4 — required artifacts, schema, authority — all
  // answered per required gate by evaluateGate. Check 6 (overrides need a
  // reason) is enforced inside validApproval, reached transitively here.
  for (const kind of laneRule.requires) {
    const gate = GATE_FOR_KIND[kind];
    const result = evaluateGate(item, gate, ctx, { testsRan: opts.testsPassed });
    reasons.push(...result.reasons.map((r) => `[${gate}] ${r}`));
  }

  // SPEC §7.4 check 5 — drift.
  if (item.artifacts.plan) {
    const base = opts.base ?? 'main';
    const drift = checkDrift(item.artifacts.plan.body, touchedFiles(base, cwd), laneRule.driftIsFatal);
    if (!drift.passed) reasons.push(...drift.reasons);
  }

  return { id, passed: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/verify.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/verify.ts packages/cli/test/verify.test.ts
git commit -m "relay(cli): add relay verify — SPEC §7.4's six CI checks, composed not re-decided"
```

---

## Task 23: `commands/adopt.ts`

**Files:**
- Modify: `packages/cli/package.json` (add `@anthropic-ai/sdk` dependency)
- Create: `packages/cli/src/commands/adopt.ts`
- Test: `packages/cli/test/adopt.test.ts`

Per the handover's model assignment: `relay adopt` defaults to `claude-opus-5` via the official `@anthropic-ai/sdk`, key from `process.env.ANTHROPIC_API_KEY` only — never from `config.yml` or any repo file (SPEC §4.5). The model draft is injected via a `draftFn` parameter (default: the real SDK call) so the CLI plumbing — id allocation, frontmatter, `origin: adopted`, and the mechanically-derived file list — is unit-tested without a network call or a real key; the SDK call path itself is verified live, once, manually (see Step 6), never inside the automated suite.

`plan.md`'s "Files that change" section is **not** drafted by the model — it is read straight from `git diff --name-only`, the one part of this that must never hallucinate. Only the narrative sections (problem, requirements, design, work order, etc.) come from the draft.

- [ ] **Step 1: Add the dependency**

Modify `packages/cli/package.json`'s `dependencies` to add one line:
```json
    "@anthropic-ai/sdk": "^0.32.0"
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

Create `packages/cli/test/adopt.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runAdopt, type AdoptedDraft } from '../src/commands/adopt.js';
import { loadWorkItem } from '../src/relay-dir.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

const STUB_DRAFT: AdoptedDraft = {
  title: 'persist catalog metadata',
  intent: {
    problem: 'Items vanish on reseed.',
    proposedOutcome: 'Metadata survives a reseed.',
    affectedUsersAndSystems: 'Catalog service.',
    constraints: 'No schema migration downtime.',
    openQuestions: 'None.',
  },
  spec: { requirements: 'Persist to git.', design: 'Write-through on save.', flaggedConcerns: '- [x] none — accepted risk: n/a' },
  plan: { workOrder: '1. Add writer. 2. Wire routes.', testsThatProveCompletion: '`test/db.test.js`' },
};

describe('runAdopt', () => {
  it('throws when there is no diff against base', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await expect(runAdopt(repo.dir, { draftFn: async () => STUB_DRAFT }))
      .rejects.toThrow(/no diff/i);
  });

  it('drafts intent, spec and plan, marks origin adopted, and reads files-changed from the real diff', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    execSync('git checkout -b relay/adopt-test -q', { cwd: repo.dir });
    writeFileSync(join(repo.dir, 'db.js'), 'module.exports = {};');
    execSync('git add db.js && git commit -q -m "add db writer"', { cwd: repo.dir });

    const result = await runAdopt(repo.dir, { draftFn: async () => STUB_DRAFT });

    const item = loadWorkItem(result.id, 'standard', repo.dir);
    expect(item.artifacts.intent?.origin).toBe('adopted');
    expect(item.artifacts.spec?.origin).toBe('adopted');
    expect(item.artifacts.plan?.origin).toBe('adopted');
    expect(item.artifacts.intent?.body).toMatch(/Items vanish on reseed/);
    expect(item.artifacts.plan?.body).toMatch(/db\.js/);
  });

  it('throws a clear error when no draftFn is given and ANTHROPIC_API_KEY is unset', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    execSync('git checkout -b relay/adopt-test2 -q', { cwd: repo.dir });
    writeFileSync(join(repo.dir, 'x.js'), 'x');
    execSync('git add x.js && git commit -q -m "x"', { cwd: repo.dir });

    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(runAdopt(repo.dir, {})).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});
```

- [ ] **Step 3: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/adopt.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/adopt.js'`.

- [ ] **Step 4: Implement**

Create `packages/cli/src/commands/adopt.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'node:child_process';
import { loadRelayConfig } from '../context.js';
import { allocateItemId } from '../item-id.js';
import { writeArtifact } from '../relay-dir.js';
import { hashContent } from '@relay/core';

export interface AdoptedDraft {
  title: string;
  intent: { problem: string; proposedOutcome: string; affectedUsersAndSystems: string; constraints: string; openQuestions: string };
  spec: { requirements: string; design: string; flaggedConcerns: string };
  plan: { workOrder: string; testsThatProveCompletion: string };
}

export type DraftFn = (diff: string) => Promise<AdoptedDraft>;

async function draftWithClaude(diff: string): Promise<AdoptedDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set — relay adopt needs a key from the environment, never from the repo (SPEC §4.5)'
    );
  }
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content:
        'This diff is already in production. Draft the Relay artifact chain backwards from it: ' +
        'a short kebab-friendly title, and the narrative content for intent.md, spec.md and plan.md ' +
        '(everything except "Files that change", which is derived separately from the diff itself). ' +
        'Respond with ONLY this JSON shape: {"title": string, ' +
        '"intent": {"problem": string, "proposedOutcome": string, "affectedUsersAndSystems": string, "constraints": string, "openQuestions": string}, ' +
        '"spec": {"requirements": string, "design": string, "flaggedConcerns": string}, ' +
        '"plan": {"workOrder": string, "testsThatProveCompletion": string}}.\n\nDiff:\n' + diff,
    }],
  });
  const text = message.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
  return JSON.parse(text) as AdoptedDraft;
}

function frontmatter(id: string, lane: string, stage: string, upstream: string | null): string {
  const upstreamLine = upstream ? `\nupstream: ${upstream}` : '';
  return `---\nid: ${id}\nlane: ${lane}\nstage: ${stage}${upstreamLine}\norigin: adopted\n---\n`;
}

export interface AdoptOptions {
  base?: string;
  draftFn?: DraftFn;
}

export async function runAdopt(cwd: string, opts: AdoptOptions): Promise<{ id: string }> {
  const config = loadRelayConfig(cwd);
  const base = opts.base ?? 'main';
  const diff = execSync(`git diff ${base}...HEAD`, { cwd }).toString();
  if (diff.trim().length === 0) throw new Error(`No diff against ${base} to adopt from`);

  const filesChanged = execSync(`git diff --name-only ${base}...HEAD`, { cwd })
    .toString().trim().split('\n').filter(Boolean);

  const draftFn = opts.draftFn ?? draftWithClaude;
  const draft = await draftFn(diff);

  const id = allocateItemId(draft.title, cwd);
  const lane = config.defaultLane;

  const intentRaw =
    frontmatter(id, lane, 'plan', null) +
    `\n## Problem\n\n${draft.intent.problem}\n\n` +
    `## Proposed outcome\n\n${draft.intent.proposedOutcome}\n\n` +
    `## Affected users and systems\n\n${draft.intent.affectedUsersAndSystems}\n\n` +
    `## Constraints\n\n${draft.intent.constraints}\n\n` +
    `## Open questions\n\n${draft.intent.openQuestions}\n`;
  writeArtifact(id, 'intent', intentRaw, cwd);

  const specRaw =
    frontmatter(id, lane, 'design', hashContent(intentRaw)) +
    `\n## Requirements\n\n${draft.spec.requirements}\n\n` +
    `## Design\n\n${draft.spec.design}\n\n` +
    `## Flagged concerns\n\n${draft.spec.flaggedConcerns}\n`;
  writeArtifact(id, 'spec', specRaw, cwd);

  const filesSection = filesChanged.map((f) => `- \`${f}\``).join('\n');
  const planRaw =
    frontmatter(id, lane, 'build', hashContent(specRaw)) +
    `\n## Files that change\n\n${filesSection}\n\n` +
    `## Work order\n\n${draft.plan.workOrder}\n\n` +
    `## Tests that prove completion\n\n${draft.plan.testsThatProveCompletion}\n`;
  writeArtifact(id, 'plan', planRaw, cwd);

  return { id };
}
```

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run packages/cli/test/adopt.test.ts`
Expected: all pass.

- [ ] **Step 6: Manual, live verification of the real SDK path (not part of the automated suite)**

With `ANTHROPIC_API_KEY` set in the shell (never in a file this plan touches), on a scratch repo with a real diff:
```bash
node dist/index.js adopt
```
Expected: drafts a real `intent.md`/`spec.md`/`plan.md` from the model, all marked `origin: adopted`, and `relay lint <id>` on the result reports real problems only where the draft is genuinely incomplete — not where the plumbing is broken. Record the observed output in the session notes; this step cannot be automated without either a live key in CI or a mocked SDK response standing in for a real model call, and this plan does not pretend either is equivalent to actually exercising the API.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/package.json package-lock.json packages/cli/src/commands/adopt.ts packages/cli/test/adopt.test.ts
git commit -m "relay(cli): add relay adopt — retroactive artifact chain via claude-opus-5"
```

---

## Task 24: `src/index.ts` — commander wiring, the real `bin` entry

**Files:**
- Modify: `packages/cli/src/index.ts` (replaces the `export {};` placeholder from Task 8)
- No new test file — `index.ts` has no logic of its own to test; every command function it calls already has direct tests. Verification here is the manual smoke run in Step 3.

- [ ] **Step 1: Implement**

Replace the full contents of `packages/cli/src/index.ts` with:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import type { Lane, Stage } from '@relay/core';
import { runInit } from './commands/init.js';
import { runNew } from './commands/new.js';
import { runUse } from './commands/use.js';
import { runStatus } from './commands/status.js';
import { runLint } from './commands/lint.js';
import { runGate, type GateAction } from './commands/gate.js';
import { runHandover, type HandoverTarget } from './commands/handover.js';
import { runResume } from './commands/resume.js';
import { runVerify } from './commands/verify.js';
import { runAdopt } from './commands/adopt.js';
import { resolveCurrentItemId } from './current-item.js';

function guarded<T extends unknown[]>(fn: (...args: T) => void | Promise<void>) {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  };
}

const program = new Command();
program.name('relay').description('Relay — the AI-native SDLC runtime');

program.command('init').action(guarded(() => {
  const result = runInit(process.cwd());
  const detected = result.detectedRuleFiles.length > 0 ? ` Detected: ${result.detectedRuleFiles.join(', ')}.` : '';
  console.log(`Tier ${result.tier} reached.${detected}`);
  console.log(result.ciWorkflowWritten ? 'CI workflow written.' : 'No GitHub remote — CI workflow skipped.');
}));

program.command('new')
  .argument('<title>')
  .option('--lane <lane>')
  .option('--from <ref>')
  .action(guarded(async (title: string, opts: { lane?: Lane; from?: string }) => {
    const result = await runNew(title, opts, process.cwd());
    console.log(`Created ${result.id} on branch ${result.branch} (${result.lane} lane).`);
  }));

program.command('use')
  .argument('<id>')
  .action(guarded((id: string) => {
    runUse(id, process.cwd());
    console.log(`Current item set to ${id}.`);
  }));

program.command('status')
  .argument('[id]')
  .action(guarded((id?: string) => {
    const result = runStatus(process.cwd(), id);
    console.log(`${result.id} (${result.lane}) — stage: ${result.stage}`);
    for (const reason of result.blockedBy) console.log(`  - ${reason}`);
  }));

program.command('lint')
  .argument('[id]')
  .action(guarded((id?: string) => {
    const result = runLint(process.cwd(), id);
    if (result.ok) {
      console.log(`${result.id}: lint clean.`);
      return;
    }
    for (const { artifact, problems } of result.problems) {
      console.log(`${artifact}:`);
      for (const p of problems) console.log(`  - ${p}`);
    }
    process.exitCode = 1;
  }));

program.command('gate')
  .argument('<gate>')
  .argument('[id]')
  .option('--approve')
  .option('--reject')
  .option('--override')
  .option('--reason <text>')
  .action(guarded(async (
    gate: Stage,
    id: string | undefined,
    opts: { approve?: boolean; reject?: boolean; override?: boolean; reason?: string }
  ) => {
    const actions = [opts.approve && 'approve', opts.reject && 'reject', opts.override && 'override']
      .filter(Boolean) as GateAction[];
    if (actions.length !== 1) throw new Error('Pass exactly one of --approve, --reject, --override');
    if ((actions[0] === 'reject' || actions[0] === 'override') && !opts.reason) {
      throw new Error(`--reason is required for --${actions[0]}`);
    }
    const itemId = id ?? resolveCurrentItemId(process.cwd());
    const approval = await runGate(itemId, gate, actions[0], opts.reason, process.cwd());
    console.log(`Recorded ${approval.verdict} on ${itemId} at the ${gate} gate.`);
  }));

program.command('handover')
  .argument('<id>')
  .requiredOption('--to <stage>')
  .action(guarded((id: string, opts: { to: HandoverTarget }) => {
    const path = runHandover(id, opts.to, process.cwd());
    console.log(`Handover bundle written to ${path}`);
  }));

program.command('resume')
  .argument('[id]')
  .action(guarded((id?: string) => {
    const brief = runResume(process.cwd(), id);
    console.log(`${brief.id} — stage: ${brief.stage}`);
    if (brief.blockedBy.length > 0) console.log(`Blocked by: ${brief.blockedBy.join('; ')}`);
    console.log(`Open questions: ${brief.openQuestions}`);
    console.log('Recent history:');
    for (const h of brief.recentHistory) console.log(`  - ${h}`);
    console.log(`Next: ${brief.next}`);
  }));

program.command('verify')
  .option('--base <ref>', 'branch to diff against', 'main')
  .option('--tests-passed', 'confirm the tests named in plan.md ran and passed')
  .action(guarded((opts: { base: string; testsPassed?: boolean }) => {
    const report = runVerify(process.cwd(), { base: opts.base, testsPassed: opts.testsPassed });
    if (report.passed) {
      console.log(`${report.id}: verify passed.`);
      return;
    }
    console.log(`${report.id ?? '(no item)'}: verify FAILED`);
    for (const r of report.reasons) console.log(`  - ${r}`);
    process.exitCode = 1;
  }));

program.command('adopt')
  .option('--base <ref>', 'branch to diff against', 'main')
  .action(guarded(async (opts: { base: string }) => {
    const result = await runAdopt(process.cwd(), { base: opts.base });
    console.log(`Adopted as ${result.id} (origin: adopted). Review and \`relay lint\` before approving any gate.`);
  }));

program.parseAsync(process.argv);
```

- [ ] **Step 2: Build and link the binary locally**

```bash
npx tsc -b packages/core packages/cli
npm link --workspace packages/cli
```

- [ ] **Step 3: Manual smoke test — every command at least once**

```bash
cd /tmp && rm -rf relay-smoke && mkdir relay-smoke && cd relay-smoke
git init -q && git config user.email you@example.com && git config user.name You && git commit -q --allow-empty -m init
relay init
relay new "smoke test"
relay status
relay lint
```
Expected: `relay init` prints "Tier 0 reached."; `relay new` prints the created id and branch; `relay status` prints stage `plan`; `relay lint` reports the scaffolded sections as empty and exits 1. This is the plumbing check — Task 25 is the real, scripted acceptance run against the plan's stated acceptance criterion.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "relay(cli): wire commander — every command reachable from the relay binary"
```

---

## Task 25: Demonstrate the Phase 2 acceptance criterion for real

**Files:** none — this task runs the built CLI against a throwaway scratch repo. No code changes.

`docs/IMPLEMENTATION_PLAN.md`'s stated acceptance for Phase 2: *"on a scratch git repo, `relay init && relay new "test" && relay gate plan --approve && relay status` reports stage `design`. Editing `intent.md` afterwards makes `relay status` report `plan` again with a 'changed since approval' reason."* The unit tests in Task 17 already prove this at the function level; this task proves it through the actual built binary, because a passing test suite and a working CLI are not automatically the same claim.

- [ ] **Step 1: Run the literal acceptance sequence**

```bash
cd /tmp && rm -rf relay-acceptance && mkdir relay-acceptance && cd relay-acceptance
git init -q && git config user.email you@example.com && git config user.name You && git commit -q --allow-empty -m init

relay init
relay new "test"
```

Expected: id `001-test` created on branch `relay/001-test`.

- [ ] **Step 2: Fill in the intent so it lints clean, then approve the plan gate**

```bash
sed -i '' 's/## Problem/## Problem\nAdmins share one password./' .relay/work/001-test/intent.md
sed -i '' 's/## Proposed outcome/## Proposed outcome\nEach admin signs in individually./' .relay/work/001-test/intent.md
sed -i '' 's/## Affected users and systems/## Affected users and systems\nAdmin console./' .relay/work/001-test/intent.md
sed -i '' 's/## Constraints/## Constraints\nNone./' .relay/work/001-test/intent.md
sed -i '' 's/## Open questions/## Open questions\nNone./' .relay/work/001-test/intent.md

relay gate plan --approve
relay status
```

Expected: `relay status` prints `001-test (standard) — stage: design`, no `Blocked by:` lines.

- [ ] **Step 3: Edit intent.md after approval and confirm the fallback**

```bash
echo "edited after approval" >> .relay/work/001-test/intent.md
relay status
```

Expected: prints `001-test (standard) — stage: plan` followed by a `Blocked by:` line containing `changed since approval`.

- [ ] **Step 4: Record the result**

Paste the real terminal output from Steps 1-3 into the session notes (or `docs/plans/phase-2-cli.md`'s own execution log, if `executing-plans`/`subagent-driven-development` keeps one) — this plan's self-review step (below) requires it to have actually been run, not merely described.

- [ ] **Step 5: Clean up**

```bash
rm -rf /tmp/relay-acceptance /tmp/relay-smoke
```

---

## Task 26: `PROJECT.md`, full monorepo checkpoint, final commit

**Files:**
- Modify: `Projects/relay/PROJECT.md`

- [ ] **Step 1: Full monorepo build and test**

```bash
npx tsc -b packages/core packages/cli && npx vitest run
```
Expected: `tsc -b` exits 0 for both packages; vitest reports every file across `packages/core/test` and `packages/cli/test` passing. No skipped files, no `.only`.

- [ ] **Step 2: `PROJECT.md` — Features list**

Update the `## Features` section: mark `.relay/` convention, `gate.ts`, frontmatter lint, and `@relay/cli` as done (each with the verified test count from Step 1), and add a line for `SourceOfTruthAdapter` + the simulated legacy connector. Leave `@relay/mcp` onward unchecked — still Phase 3+.

- [ ] **Step 3: `PROJECT.md` — Changelog**

Append a new newest-first entry summarising: F1 resolved as option (a); F2 fixed in `state.ts` (commit `8d803d5`); `gate.ts`/`config.ts`/frontmatter lint built in core; `@relay/cli` built with all ten commands, `SourceOfTruthAdapter` + simulated connector, and the acceptance criterion demonstrated live (Task 25's real output). Note explicitly, per the workspace Definition of Done: **not** registered in `apps.js` yet (no dashboard exists to serve — that's Phase 5), ports unchanged from the 5182 assignment, `start.sh`/`stop.sh` still intentionally fail (nothing to start until the daemon in Phase 4).

- [ ] **Step 4: `PROJECT.md` — Next steps**

Replace the Phase 2 entry in `## Next steps` with a pointer to Phase 3 (`@relay/mcp` + `@relay/adapters/claude-code`), per `docs/IMPLEMENTATION_PLAN.md`'s own sequencing.

- [ ] **Step 5: Commit**

```bash
git add Projects/relay/PROJECT.md
git commit -m "$(cat <<'EOF'
relay: PROJECT.md — Phase 2 (@relay/cli) verified, Phase 3 is the next entry point

@relay/cli built: all ten commands, SourceOfTruthAdapter plus the simulated
legacy connector, gate.ts and frontmatter lint in core (F3/F4). Acceptance
criterion from IMPLEMENTATION_PLAN.md demonstrated live against the built
binary, not just asserted by the unit suite. Not registered in apps.js —
no dashboard exists yet to serve.
EOF
)"
```

---

## Self-review

**Spec coverage** — every Phase 2 deliverables-table row has a task: `init` (14), `new`+`--from` (15), `use` (16), `status` (17), `lint` (18), `gate` (19), `handover` (20), `resume` (21), `verify` (22), `adopt` (23), `SourceOfTruthAdapter` + simulated connector (6, 13), CLI wiring (24). SPEC §7.1's gate contract is Task 4; §7.4's six verify checks are traced individually in Task 22. F1/F2 (blocking, done this session) and F3/F4 (Tasks 4, 2-3) are all closed. The one deliberately deferred piece — `relay init` "installing matching adapters" — is flagged in Task 14 rather than silently dropped, since the adapters themselves don't exist until Phase 3.

**Placeholder scan** — no `TBD`/`TODO`/"add appropriate error handling"/"similar to Task N" anywhere in a code block; every step that changes code shows the code. The one deliberately-incomplete *content* (handover's "Decisions made" section, Task 20) is explicit about being a human-filled prompt, not a code placeholder.

**Type consistency, checked against earlier tasks:**
- `evaluateGate(item, gate, ctx, checks?)` (Task 4) is called identically in `status.ts` (17), `gate.ts` command (19, via the underlying reasons), and `verify.ts` (22).
- `GateAction` (Task 19) is imported and used, not redefined, in `index.ts` (24).
- `HandoverTarget = 'design' | 'build'` (Task 20) matches the `--to` values `index.ts` (24) passes through untyped from commander — commander gives a raw string, so `runHandover` is the actual boundary that rejects an invalid target (its own `TARGETS[toStage]` lookup throws), not the CLI layer. This is intentional: the CLI is a transport and does not duplicate validation core-adjacent code already does.
- `resolveCurrentItemId`/`setCurrentItemId` (Task 16) are used, not reimplemented, everywhere an id needs resolving (17, 18, 19 via default, 21).
- `loadWorkItem(id, defaultLane, cwd)`'s three-argument order is consistent in every call site across Tasks 9, 15, 17-23.

**Execution order note** (also stated inline at Task 17): tasks are numbered in dependency-free reading order for a human, but `commands/gate.ts` (19) must execute before Task 17's tests run, since `status.test.ts` calls `runGate`. Recommended execution order: 1→16 in sequence, then **19, 17, 18**, then 20→26 in sequence.

---

**Plan complete and saved to `docs/plans/phase-2-cli.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
