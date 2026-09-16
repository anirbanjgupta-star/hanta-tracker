# Phase 5 — `@relay/dashboard` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@relay/dashboard` — the five-panel mission-control UI from SPEC §13, backed by `@relay/daemon`'s `GET /api/items` and `WS /stream`, plus two small daemon additions this phase genuinely needs (`POST /api/gate` for the "waiting on you" panel's approve/send-back controls, `GET /api/metrics` for the flow-metrics strip) that Phase 4 explicitly deferred to whichever phase actually needed them.

**Architecture:** React 19 + Vite, same layering discipline as every prior phase — the dashboard renders state, it never decides anything. `computeMetrics()` (new, in `@relay/core`, pure) is the one piece of real judgment this phase adds, and it lives in core for the same reason `evaluateGate()` does. Everything else in `@relay/dashboard` is transport and rendering: a `useRelayFeed` hook (fetch + WS subscription, reducer-based state merge) and five panel components consuming it.

**Tech Stack, versions verified against the npm registry before writing this plan (do not assume newer/older):** `react@^19.3.0`, `react-dom@^19.3.0`, `@types/react@^19.3.0`, `@types/react-dom@^19.3.0`, `vite@^6.4.3`, `@vitejs/plugin-react@^4.7.0` (the stable 4.x line — its peer range is `vite: ^4.2.0 || ^5.0.0 || ^6.0.0` with no extra required peers, deliberately chosen over the newer 6.x line, which requires `vite@^8` plus Rolldown/React-Compiler-specific peers this project has no use for — simplicity first). Testing reuses this monorepo's existing root `vitest@2.1.9` (already installed, do not add a second test runner): `@testing-library/react@^16.3.3`, `@testing-library/jest-dom@^7.0.1` (peer-compatible with `vitest >= 0.32`), `@testing-library/user-event@^14.6.7`, `jsdom@^30.0.1`.

**Confirmed empirically before this plan assumed it:** the installed `vitest@2.1.9` supports `test.environmentMatchGlobs?: [string, VitestEnvironment][]` (found in its own shipped type definitions) — this scopes the `jsdom` environment to only `packages/dashboard/test/**`, leaving every other package's tests running in the default `node` environment untouched. One line added to the existing root `vitest.config.ts`, nothing else about it disturbed.

**Grounded in:** `docs/SPEC.md` §13 (the five panels, spotlight, the three hero beats — the third is explicitly Phase 5b's per `IMPLEMENTATION_PLAN.md`, not this phase's), §11 ("Metrics, and why they are free" — derivable from the artifact chain and event log, no manual instrumentation), and `docs/IMPLEMENTATION_PLAN.md`'s own Phase 5 section (React + Vite, the five panels, the recorded-fixture rule, the functional-first gate, and the acceptance criterion).

**A real, already-designed-but-dormant field this plan finally uses:** `packages/core/src/types.ts`'s `Approval` interface has carried an optional `latencyS?: number` since Phase 1 — declared, never once set or read anywhere in the codebase (confirmed by a repo-wide grep before writing this plan). It exists for exactly this phase's gate-latency metric. Task 1 populates it in `runGate` for the first time, rather than inventing a parallel way to compute the same number.

**Honesty boundary, stated up front, matching this project's own established pattern (Phase 3's Task 14, Phase 4's Task 9):** `IMPLEMENTATION_PLAN.md`'s Phase 5 acceptance text names three hero beats, but its own Phase 5b section explicitly owns the third ("the incident strip binding on the dashboard... the third hero beat"), which depends on the Stage 6 detector this repo does not have yet. This plan builds the incident strip panel itself — SPEC §13 lists it as one of Phase 5's five panels — but it renders an honest empty state; wiring it to real breach data is Phase 5b's job, not silently implied as done here. This plan's own acceptance demonstration (Task 13) covers hero beats 1 and 2 only, and says so.

**Explicitly out of scope, stated with reasons, not silently dropped:** full git-commit-timestamp mining for "time to first conversation" (§11's fuller metric ambition) — `computeMetrics()` in this plan uses only data already on disk (`approvals.jsonl` timestamps, and now `latencyS`), not git log parsing, which is real future work if the simpler metrics prove insufficient. Per-browser-user identity for the dashboard's approve/reject buttons — `POST /api/gate` resolves the approving identity the same way the CLI always has, via `gitIdentity(cwd)` (the daemon host's own git config), so every approval made through the browser is attributed to whoever's identity the daemon process runs as; this is fine for this project's single-user local-daemon v1, not a multi-user auth system, and is stated here rather than left to be discovered later. Full visual/design polish — per this workspace's own "functional first, design second" rule (CLAUDE.md principle 12, and `IMPLEMENTATION_PLAN.md`'s own words: "Phase 1 of the workspace's functional-first rule ends here: build it with clean functional design, then announce that the build is verified before any design pass"), this plan builds clean, functional, unstyled-to-minimally-styled UI and Task 14 ends with that announcement — it does not open a design pass.

---

## Task 1: `runGate` populates `Approval.latencyS`

**Files:**
- Modify: `packages/cli/src/relay-dir.ts` (add `loadEvents`)
- Modify: `packages/cli/src/commands/gate.ts`
- Modify: `packages/cli/test/gate.test.ts`

- [ ] **Step 1: Write the failing test**

First read the current `packages/cli/test/gate.test.ts` in full — this step adds one test to it, not a rewrite. Add:

```ts
it('records latencyS when a matching gate_requested event precedes the approval', async () => {
  repo = makeScratchRepo();
  const raw = '---\nid: 001-x\nlane: standard\n---\n\n## Problem\np\n';
  writeArtifact('001-x', 'intent', raw, repo.dir);
  appendEvent('001-x', { ts: '2026-09-16T10:00:00Z', type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);

  const approval = await runGate('001-x', 'plan', 'approve', undefined, repo.dir);
  expect(approval.latencyS).toBeUndefined(); // the approval's own ts is "now", far more than a plausible test-clock away from the fixed 2026-09-16 event — see Step 2's note before assuming this is wrong.

  // A request timestamped one second before the approval is about to be
  // recorded proves the real latency math, without a flaky real-time sleep.
  const soon = new Date(Date.now() - 1000).toISOString();
  appendEvent('001-x', { ts: soon, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
  const approval2 = await runGate('001-x', 'plan', 'approve', undefined, repo.dir);
  expect(approval2.latencyS).toBeGreaterThanOrEqual(1);
  expect(approval2.latencyS).toBeLessThan(5); // generous upper bound for test-runner jitter
});

it('leaves latencyS undefined when no gate_requested event exists for that gate', async () => {
  repo = makeScratchRepo();
  const raw = '---\nid: 001-x\nlane: standard\n---\n\n## Problem\np\n';
  writeArtifact('001-x', 'intent', raw, repo.dir);

  const approval = await runGate('001-x', 'plan', 'approve', undefined, repo.dir);
  expect(approval.latencyS).toBeUndefined();
});
```

Add `appendEvent` to this test file's existing import from `'../src/relay-dir.js'`.

Note on the first test's first assertion: the fixed timestamp `2026-09-16T10:00:00Z` is far in the past relative to whenever this suite actually runs, so `approval.latencyS` computed against it would be an enormous, meaningless number — not "no event found." The real behavior to test is "the LATEST matching request before this approval wins," which the second half of the test (the `soon` timestamp, ~1 second before the real approval call) actually exercises correctly. Rewrite this first assertion if it does not match Step 3's real implementation once written — **run this test after Step 3, read what it actually reports, and fix the test's own expectation to match correct, verified behavior rather than forcing the implementation to match a guess.**

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/gate.test.ts`
Expected: FAIL — `latencyS` is `undefined` in all cases today (the field is never set), so the "no event" test may already accidentally pass; the "with a preceding event" test should fail (asserting `toBeGreaterThanOrEqual(1)` against `undefined`).

- [ ] **Step 3: Implement**

Add to `packages/cli/src/relay-dir.ts`, after `appendEvent`:
```ts
export function loadEvents(id: string, cwd: string): RelayEvent[] {
  const path = join(itemDir(id, cwd), 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
```

Read the current full `packages/cli/src/commands/gate.ts` before editing — this step adds latency computation to its existing logic, not a rewrite. Modify it:
```ts
import { hashContent, KIND_FOR_GATE, type Approval, type Stage } from '@relay/core';
import { loadWorkItem, appendApproval, loadEvents } from '../relay-dir.js';
import { loadRelayConfig, buildApprovalContext } from '../context.js';
import { LegacyJsonAdapter } from '../adapters/legacy-json.js';
```
(adds `loadEvents` to the existing `relay-dir.js` import line — everything else in the import block stays as-is.)

Inside `runGate`, after the `approval` object is built and before `appendApproval(id, approval, cwd)` is called:
```ts
  const requestEvents = loadEvents(id, cwd)
    .filter((e) => e.type === 'gate_requested' && e.gate === gate)
    .sort((a, b) => Date.parse(String(a.ts)) - Date.parse(String(b.ts)));
  const lastRequest = requestEvents.at(-1);
  if (lastRequest) {
    approval.latencyS = (Date.parse(approval.ts) - Date.parse(String(lastRequest.ts))) / 1000;
  }
```

`approval` must be declared with `let` (or built as a plain mutable object before typing as `const approval: Approval = {...}` and reassigned via `approval.latencyS = ...` — object property assignment works on a `const` binding regardless, only reassigning the binding itself needs `let`, so no change to `const approval: Approval = {...}` is needed here).

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/cli/test/gate.test.ts`
Expected: clean build, all tests pass (including the two new ones — fix the first test's exact assertion per Step 1's own note if what you observe differs from the guess written there).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: every existing test file still passes — `latencyS` is optional and additive; nothing reads it yet outside the new tests.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/relay-dir.ts packages/cli/src/commands/gate.ts packages/cli/test/gate.test.ts
git commit -m "relay(cli): runGate populates Approval.latencyS from the matching gate_requested event"
```

---

## Task 2: `computeMetrics()` in `@relay/core`

**Files:**
- Create: `packages/core/src/metrics.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/metrics.test.ts`

Pure logic, no I/O — same layering as `evaluateGate()`. Takes the `WorkItem[]` the daemon already loads (via `@relay/cli/lib`'s `loadWorkItem`, one call per id from `listItemIds`) and produces the four numbers SPEC §13's metrics strip needs: gate latency, stage cycle time, override count, first-pass rate. Scope, stated plainly: only what's derivable from `approvals.jsonl` timestamps already on disk — no git-commit mining.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/metrics.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/core/test/metrics.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/core/src/metrics.ts`:
```ts
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
```

Modify `packages/core/src/index.ts`, add one line:
```ts
export { computeMetrics, type FlowMetrics } from './metrics.js';
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/core/test/metrics.test.ts`
Expected: clean build, all 7 pass.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything still green — `index.ts`'s new export is additive.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/metrics.ts packages/core/src/index.ts packages/core/test/metrics.test.ts
git commit -m "relay(core): add computeMetrics() — gate latency, stage cycle time, overrides, first-pass rate"
```

---

## Task 3: `POST /api/gate` and `GET /api/metrics` on `@relay/daemon`

**Files:**
- Modify: `packages/cli/src/lib.ts` (export `runGate`'s dependencies already exported are enough — confirm, see Step 1's note)
- Modify: `packages/daemon/src/server.ts`
- Test: `packages/daemon/test/gate-endpoint.test.ts` (new file, kept separate from `server.test.ts` for this task's own focus)

`POST /api/gate` is the one thing the "waiting on you" panel's approve/send-back controls need that nothing built so far provides — Phase 4's own plan named this exact gap and deferred it here, not as an oversight. `GET /api/metrics` wraps Task 2's `computeMetrics()` over every item's full `WorkItem` (not the thinner `ItemProjection`/`StatusResult` `GET /api/items` already returns — metrics need the full `approvals` array).

- [ ] **Step 1: Confirm `runGate` and `loadWorkItem` are both already on `@relay/cli/lib`'s surface**

```bash
grep -n "runGate\|loadWorkItem\|listItemIds" packages/cli/src/lib.ts
```
Expected: both already exported (added in Task 3 of Phase 3's plan, and Task 2 of Phase 4's plan, respectively) — confirm before writing any code that assumes otherwise; if either is missing, add it to the existing `lib.ts` export lines (do not create new ones).

- [ ] **Step 2: Write the failing tests**

Create `packages/daemon/test/gate-endpoint.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli/lib';
import { buildServer } from '../src/server.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-daemon-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "you@example.com"', { cwd: dir }); // matches relay init's default roles.yml grant
  execSync('git config user.name "You"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('POST /api/gate', () => {
  it('approves a gate and returns the recorded approval', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      payload: { id, gate: 'plan', action: 'approve' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.verdict).toBe('approved');
    expect(body.gate).toBe('plan');
    await app.close();
  });

  it('requires a reason for reject, matching the CLI\'s own rule, and returns 400 without one', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      payload: { id, gate: 'plan', action: 'reject' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 with the underlying error message when the gate cannot be approved yet', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      payload: { id, gate: 'design', action: 'approve' }, // spec.md does not exist yet
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/does not exist yet/);
    await app.close();
  });
});

describe('GET /api/metrics', () => {
  it('returns zeroed-out metrics before any gate is approved', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).overrideCount).toBe(0);
    await app.close();
  });

  it('reflects a real approval, including its latencyS-derived gate latency', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    await app.inject({ method: 'POST', url: '/api/gate', payload: { id, gate: 'plan', action: 'approve' } });
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    const body = JSON.parse(res.body);
    expect(body.overrideCount).toBe(0);
    // No gate_requested event was ever written, so latencyS is undefined for
    // this approval — gateLatencyS.plan should not exist, not be zero.
    expect(body.gateLatencyS.plan).toBeUndefined();
    await app.close();
  });
});
```

- [ ] **Step 3: Run to confirm they fail**

Run: `npx vitest run packages/daemon/test/gate-endpoint.test.ts`
Expected: FAIL — `/api/gate` and `/api/metrics` are 404s today.

- [ ] **Step 4: Implement**

Read the current full `packages/daemon/src/server.ts` before editing — this adds two routes to its existing structure, not a rewrite. Modify it:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { watch } from 'chokidar';
import { join } from 'node:path';
import { runGate, loadWorkItem, loadRelayConfig } from '@relay/cli/lib';
import { buildProjection } from './projection.js';
import { diffProjections } from './diff.js';
import { ClientRegistry } from './broadcast.js';
import { computeMetrics } from '@relay/core';
```

Add, inside `buildServer`, after the existing `app.post('/events', ...)` block and before `app.get('/stream', ...)`:
```ts
  app.post('/api/gate', async (request, reply) => {
    const body = request.body as { id: string; gate: 'plan' | 'design' | 'build'; action: 'approve' | 'reject' | 'override'; reason?: string };
    if ((body.action === 'reject' || body.action === 'override') && !body.reason) {
      reply.code(400);
      return { error: `--reason is required for --${body.action}` };
    }
    try {
      const approval = await runGate(body.id, body.gate, body.action, body.reason, cwd);
      return approval;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/metrics', async () => {
    const config = loadRelayConfig(cwd);
    const items = buildProjection(cwd).map((p) => loadWorkItem(p.id, config.defaultLane, cwd));
    return computeMetrics(items);
  });
```

Note: `body.action === 'approve'` never needs a `reason`, matching `packages/cli/src/index.ts`'s own gate command validation (`--reason` required only for `--reject`/`--override`) — this mirrors that rule rather than inventing a new one.

- [ ] **Step 5: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/daemon/test/gate-endpoint.test.ts`
Expected: clean build, all 5 pass.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: everything green, including the existing `server.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/src/server.ts packages/daemon/test/gate-endpoint.test.ts
git commit -m "relay(daemon): add POST /api/gate and GET /api/metrics"
```

---

## Task 4: Scaffold `@relay/dashboard`

**Files:**
- Create: `packages/dashboard/package.json`
- Create: `packages/dashboard/tsconfig.json`
- Create: `packages/dashboard/vite.config.ts`
- Create: `packages/dashboard/index.html`
- Create: `packages/dashboard/src/main.tsx`
- Create: `packages/dashboard/src/App.tsx` (placeholder; real content lands in Task 12)
- Modify: `vitest.config.ts` (root — the one-line `environmentMatchGlobs` addition, confirmed available in Step 0 above)
- Modify: `package.json` (root `build` script — note: `vite build` is a separate concern from `tsc -b`'s project-reference build; see Step 4)

No test — scaffolding, verified by the dev server actually starting (Step 5).

- [ ] **Step 1: Create `packages/dashboard/package.json`**

```json
{
  "name": "@relay/dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^4.7.0",
    "vite": "^6.4.3",
    "@testing-library/react": "^16.3.3",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/user-event": "^14.6.7",
    "jsdom": "^30.0.1"
  }
}
```

`private: true` — this package is never published or `require()`d by another workspace package (unlike every prior package), so it carries no `main`/`types`/`exports` fields.

- [ ] **Step 2: Create `packages/dashboard/tsconfig.json`**

A separate, non-composite config — this package is built by Vite, not `tsc -b` (no `dist/` project-reference output another package consumes), so it does not extend `tsconfig.base.json`'s `composite: true` setup the way every other package does:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create the Vite entry files**

Create `packages/dashboard/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5182',
      '/stream': { target: 'ws://localhost:5182', ws: true },
    },
  },
});
```

The proxy is what lets `vite dev` (typically port 5173) talk to the real daemon on 5182 without a CORS/mixed-origin dance during development — the dashboard's own code always fetches `/api/...` and connects to `/stream` as same-origin relative paths, never a hardcoded `localhost:5182`.

Create `packages/dashboard/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Relay — Mission Control</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `packages/dashboard/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Create `packages/dashboard/src/App.tsx` (placeholder):
```tsx
export default function App() {
  return <div>Relay dashboard — under construction</div>;
}
```

- [ ] **Step 4: Install, and decide the root build script's relationship to this package**

```bash
mkdir -p packages/dashboard/src
npm install
```

Do **not** add `packages/dashboard` to the root `"build": "tsc -b ..."` script — `tsc -b` is for the composite, project-referenced packages (`core` through `daemon`) that `import` each other's compiled output; `@relay/dashboard` is never imported by another package and is built by `vite build`, an entirely different pipeline. Instead add a **new**, separate script:
```json
    "build:dashboard": "npm run build --workspace=@relay/dashboard"
```
placed alongside the existing `"build"` script in the root `package.json`. Running the existing `npm run build` continues to build exactly what it always has; `npm run build:dashboard` is the new, explicit way to build this one package. This is a deliberate choice, not an oversight — conflating the two would make `npm run build`'s meaning inconsistent (some packages type-checked via project references, one bundled via Vite, all under one command name).

- [ ] **Step 5: Confirm the dev server actually starts**

```bash
npx vite --config packages/dashboard/vite.config.ts --root packages/dashboard &
sleep 2
curl -s http://localhost:5173 | grep -o '<title>[^<]*</title>'
kill %1
```
Expected: `<title>Relay — Mission Control</title>` — confirms Vite served the real `index.html`, not a stale process or a build error swallowed silently.

- [ ] **Step 6: Add the vitest `environmentMatchGlobs` line**

Modify the root `vitest.config.ts` (currently `{ test: { include: [...] } }`):
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'packages/**/test/**/*.test.tsx'],
    environmentMatchGlobs: [['packages/dashboard/test/**', 'jsdom']],
  },
});
```
Note the `include` pattern also gains `*.test.tsx` — dashboard's component tests will be `.tsx` files, which the existing pattern (`*.test.ts` only) would not match.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/package.json packages/dashboard/tsconfig.json packages/dashboard/vite.config.ts packages/dashboard/index.html packages/dashboard/src/main.tsx packages/dashboard/src/App.tsx vitest.config.ts package.json package-lock.json
git commit -m "relay(dashboard): scaffold @relay/dashboard (React + Vite)"
```

---

## Task 5: `useRelayFeed` — the one data-fetching hook every panel reads from

**Files:**
- Create: `packages/dashboard/src/feed.ts` (the pure reducer — tested directly, no DOM needed)
- Create: `packages/dashboard/src/useRelayFeed.ts` (the hook — thin, wraps the reducer with `fetch`/`WebSocket`)
- Test: `packages/dashboard/test/feed.test.ts`

Split deliberately: `feed.ts`'s reducer is pure state-transition logic (`(state, action) => state`), testable with plain `vitest run` in the default `node` environment, no `jsdom`/React needed at all. `useRelayFeed.ts` is the thin, mostly-untested-by-unit-tests glue that wires the reducer to a real `fetch` call and a real `WebSocket` — proven by Task 13's live browser acceptance run instead, the same "logic vs. wiring" split Phase 4 used for `diffProjections` vs. the watcher itself.

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/test/feed.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { feedReducer, initialFeedState, type FeedEvent } from '../src/feed.js';
import type { ItemProjection } from '../src/types.js';

function item(id: string, stage: ItemProjection['stage']): ItemProjection {
  return { id, lane: 'standard', stage, blockedBy: [] };
}

describe('feedReducer', () => {
  it('starts with an empty item list and disconnected status', () => {
    expect(initialFeedState.items).toEqual([]);
    expect(initialFeedState.connected).toBe(false);
  });

  it('replaces the item list on "loaded"', () => {
    const state = feedReducer(initialFeedState, { type: 'loaded', items: [item('001-x', 'plan')] });
    expect(state.items).toEqual([item('001-x', 'plan')]);
  });

  it('marks connected on "ws-open" and disconnected on "ws-closed"', () => {
    let state = feedReducer(initialFeedState, { type: 'ws-open' });
    expect(state.connected).toBe(true);
    state = feedReducer(state, { type: 'ws-closed' });
    expect(state.connected).toBe(false);
  });

  it('updates one item\'s stage on a transition event, leaving others untouched', () => {
    const loaded = feedReducer(initialFeedState, {
      type: 'loaded',
      items: [item('001-x', 'plan'), item('002-y', 'design')],
    });
    const transitioned = feedReducer(loaded, {
      type: 'ws-message',
      raw: JSON.stringify({ type: 'transition', id: '001-x', from: 'plan', to: 'design' }),
    });
    expect(transitioned.items.find((i) => i.id === '001-x')?.stage).toBe('design');
    expect(transitioned.items.find((i) => i.id === '002-y')?.stage).toBe('design'); // unchanged
  });

  it('adds a new item to the list when a transition event names an id not yet known', () => {
    const loaded = feedReducer(initialFeedState, { type: 'loaded', items: [] });
    const state = feedReducer(loaded, {
      type: 'ws-message',
      raw: JSON.stringify({ type: 'transition', id: '003-z', from: 'intake', to: 'plan' }),
    });
    expect(state.items).toEqual([{ id: '003-z', lane: 'standard', stage: 'plan', blockedBy: [] }]);
  });

  it('appends a non-transition WS message to the activity log, capped at 50 entries, without touching items', () => {
    const withItems = feedReducer(initialFeedState, { type: 'loaded', items: [item('001-x', 'plan')] });
    const state = feedReducer(withItems, {
      type: 'ws-message',
      raw: JSON.stringify({ type: 'tool_use', tool: 'Edit', itemId: '001-x' }),
    });
    expect(state.items).toEqual([item('001-x', 'plan')]);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0]).toEqual({ type: 'tool_use', tool: 'Edit', itemId: '001-x' });
  });

  it('ignores an unparseable WS message rather than throwing', () => {
    const state = feedReducer(initialFeedState, { type: 'ws-message', raw: 'not json{{{' });
    expect(state).toEqual(initialFeedState);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/dashboard/test/feed.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/dashboard/src/types.ts` (the shapes the dashboard renders — deliberately re-declared here rather than importing `@relay/daemon`'s types, since `@relay/dashboard` has no build-time dependency on any other workspace package, matching Task 4's "never `import`s another package" scaffolding decision):
```ts
export type Stage = 'intake' | 'plan' | 'design' | 'build' | 'done';

export interface ItemProjection {
  id: string;
  lane: string;
  stage: Stage;
  blockedBy: string[];
}

export interface TransitionEvent {
  type: 'transition';
  id: string;
  from: string;
  to: string;
}
```

Create `packages/dashboard/src/feed.ts`:
```ts
import type { ItemProjection, TransitionEvent } from './types.js';

export interface FeedState {
  items: ItemProjection[];
  connected: boolean;
  activity: unknown[];
}

export type FeedAction =
  | { type: 'loaded'; items: ItemProjection[] }
  | { type: 'ws-open' }
  | { type: 'ws-closed' }
  | { type: 'ws-message'; raw: string };

export const initialFeedState: FeedState = { items: [], connected: false, activity: [] };

const MAX_ACTIVITY = 50;

function isTransitionEvent(value: unknown): value is TransitionEvent {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'transition';
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'loaded':
      return { ...state, items: action.items };
    case 'ws-open':
      return { ...state, connected: true };
    case 'ws-closed':
      return { ...state, connected: false };
    case 'ws-message': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(action.raw);
      } catch {
        return state;
      }
      if (isTransitionEvent(parsed)) {
        const known = state.items.some((i) => i.id === parsed.id);
        const items = known
          ? state.items.map((i) => (i.id === parsed.id ? { ...i, stage: parsed.to as ItemProjection['stage'] } : i))
          : [...state.items, { id: parsed.id, lane: 'standard', stage: parsed.to as ItemProjection['stage'], blockedBy: [] }];
        return { ...state, items };
      }
      return { ...state, activity: [parsed, ...state.activity].slice(0, MAX_ACTIVITY) };
    }
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/dashboard/test/feed.test.ts`
Expected: all 7 pass, in the default `node` environment (no `jsdom` needed for this file — it never touches the DOM).

- [ ] **Step 5: Implement the hook itself (no dedicated unit test — proven live in Task 13)**

Create `packages/dashboard/src/useRelayFeed.ts`:
```tsx
import { useEffect, useReducer } from 'react';
import { feedReducer, initialFeedState } from './feed.js';

export function useRelayFeed() {
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/items')
      .then((res) => res.json())
      .then((items) => {
        if (!cancelled) dispatch({ type: 'loaded', items });
      });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/stream`);
    ws.onopen = () => dispatch({ type: 'ws-open' });
    ws.onclose = () => dispatch({ type: 'ws-closed' });
    ws.onmessage = (event) => dispatch({ type: 'ws-message', raw: event.data });

    return () => {
      cancelled = true;
      ws.close();
    };
  }, []);

  return state;
}
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: everything green, including the new `feed.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/types.ts packages/dashboard/src/feed.ts packages/dashboard/src/useRelayFeed.ts packages/dashboard/test/feed.test.ts
git commit -m "relay(dashboard): add useRelayFeed — GET /api/items + WS /stream, reducer-based state merge"
```

---

## Task 6: Pipeline lanes panel

**Files:**
- Create: `packages/dashboard/src/panels/PipelineLanes.tsx`
- Test: `packages/dashboard/test/panels/PipelineLanes.test.tsx`

SPEC §13: "Plan, Design, Build live; Test, Deploy, Maintain dimmed. Gates render as checkpoints *between* lanes, not as a field on a card. Cards pulse while an agent is actively working them." "Pulse" (a CSS animation keyed off live activity) is a design-pass concern per this plan's own functional-first scope — this task renders the correct structure and correct item placement; the pulse animation itself is deferred, noted inline as a `TODO`-free, explicitly-commented placeholder rather than silently absent.

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/test/panels/PipelineLanes.test.tsx`:
```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PipelineLanes } from '../../src/panels/PipelineLanes.js';
import type { ItemProjection } from '../../src/types.js';

describe('PipelineLanes', () => {
  it('places each item under its derived stage\'s lane', () => {
    const items: ItemProjection[] = [
      { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: [] },
      { id: '002-y', lane: 'standard', stage: 'build', blockedBy: [] },
    ];
    render(<PipelineLanes items={items} />);
    expect(screen.getByTestId('lane-plan')).toHaveTextContent('001-x');
    expect(screen.getByTestId('lane-build')).toHaveTextContent('002-y');
    expect(screen.getByTestId('lane-design')).not.toHaveTextContent('001-x');
  });

  it('renders Test, Deploy, Maintain as dimmed lanes with no items ever placed there', () => {
    render(<PipelineLanes items={[]} />);
    expect(screen.getByTestId('lane-test')).toHaveAttribute('data-dimmed', 'true');
    expect(screen.getByTestId('lane-deploy')).toHaveAttribute('data-dimmed', 'true');
    expect(screen.getByTestId('lane-maintain')).toHaveAttribute('data-dimmed', 'true');
    expect(screen.getByTestId('lane-plan')).toHaveAttribute('data-dimmed', 'false');
  });

  it('does not place an "intake" or "done" item in any of the six named lanes', () => {
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'done', blockedBy: [] }];
    render(<PipelineLanes items={items} />);
    for (const lane of ['plan', 'design', 'build', 'test', 'deploy', 'maintain']) {
      expect(screen.getByTestId(`lane-${lane}`)).not.toHaveTextContent('001-x');
    }
  });

  it('renders a gate checkpoint between each of the three live lanes', () => {
    render(<PipelineLanes items={[]} />);
    expect(screen.getByTestId('gate-plan')).toBeInTheDocument();
    expect(screen.getByTestId('gate-design')).toBeInTheDocument();
    expect(screen.getByTestId('gate-build')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/dashboard/test/panels/PipelineLanes.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/dashboard/src/panels/PipelineLanes.tsx`:
```tsx
import type { ItemProjection, Stage } from '../types.js';

const LIVE_LANES: Stage[] = ['plan', 'design', 'build'];
const DIMMED_LANES = ['test', 'deploy', 'maintain'] as const;

export function PipelineLanes({ items }: { items: ItemProjection[] }) {
  return (
    <section aria-label="Pipeline lanes" style={{ display: 'flex', gap: '1rem' }}>
      {LIVE_LANES.map((stage, i) => (
        <div key={stage} style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div data-testid={`lane-${stage}`} data-dimmed="false">
            <h3>{stage}</h3>
            {items
              .filter((item) => item.stage === stage)
              .map((item) => (
                // Cards pulsing while an agent actively works them (SPEC §13)
                // is a design-pass concern — this renders correct placement
                // only, no animation, per this plan's functional-first scope.
                <div key={item.id} data-testid={`item-${item.id}`}>
                  {item.id}
                </div>
              ))}
          </div>
          {i < LIVE_LANES.length - 1 && <div data-testid={`gate-${stage}`}>→</div>}
        </div>
      ))}
      <div data-testid="gate-build">→</div>
      {DIMMED_LANES.map((stage) => (
        <div key={stage} data-testid={`lane-${stage}`} data-dimmed="true">
          <h3>{stage}</h3>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/dashboard/test/panels/PipelineLanes.test.tsx`
Expected: all 4 pass. If the double `gate-build` (one inside the `LIVE_LANES.map` loop's last-non-rendered iteration guard, one after it) renders two elements with the same `data-testid`, `getByTestId` will throw "found multiple elements" — **run this and read the actual failure before assuming the sketch above is correct; fix the structure (e.g. render the gate after build unconditionally, once, outside the map, and only render the two inter-lane gates from inside the map) so exactly one `gate-build` node exists**, matching what the test asserts.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/panels/PipelineLanes.tsx packages/dashboard/test/panels/PipelineLanes.test.tsx
git commit -m "relay(dashboard): add PipelineLanes panel"
```

---

## Task 7: Waiting-on-you panel — approve and send-back, wired to `POST /api/gate`

**Files:**
- Create: `packages/dashboard/src/panels/WaitingOnYou.tsx`
- Test: `packages/dashboard/test/panels/WaitingOnYou.test.tsx`

SPEC §13: "the gate queue filtered by the viewer's role, with approve and send-back controls." Role-filtering by *viewer* identity needs a signed-in viewer concept this v1 daemon does not have (the daemon resolves one identity — its own host's git config — for every write, per this plan's own stated out-of-scope note); this panel filters by "blocked at all" instead of by role, and is honest about that narrowing in a code comment, not a silent simplification.

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/test/panels/WaitingOnYou.test.tsx`:
```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WaitingOnYou } from '../../src/panels/WaitingOnYou.js';
import type { ItemProjection } from '../../src/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WaitingOnYou', () => {
  it('lists only items with a non-empty blockedBy', () => {
    const items: ItemProjection[] = [
      { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'] },
      { id: '002-y', lane: 'standard', stage: 'build', blockedBy: [] },
    ];
    render(<WaitingOnYou items={items} />);
    expect(screen.getByText('001-x')).toBeInTheDocument();
    expect(screen.queryByText('002-y')).not.toBeInTheDocument();
  });

  it('calls POST /api/gate with action "approve" when Approve is clicked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'] }];
    render(<WaitingOnYou items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/gate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ id: '001-x', gate: 'plan', action: 'approve' }),
    })));
  });

  it('prompts for a reason and calls POST /api/gate with action "reject" on Send back', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    vi.spyOn(window, 'prompt').mockReturnValue('needs more detail');
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'] }];
    render(<WaitingOnYou items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /send back/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/gate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ id: '001-x', gate: 'plan', action: 'reject', reason: 'needs more detail' }),
    })));
  });

  it('does not call fetch for Send back when the reason prompt is cancelled', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'] }];
    render(<WaitingOnYou items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /send back/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/dashboard/test/panels/WaitingOnYou.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/dashboard/src/panels/WaitingOnYou.tsx`:
```tsx
import type { ItemProjection } from '../types.js';

async function postGate(body: { id: string; gate: string; action: string; reason?: string }) {
  await fetch('/api/gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Filtered by "blocked at all," not by the viewer's role (SPEC §13's stated
// intent) — this daemon has no signed-in-viewer concept yet, per this
// plan's own out-of-scope note. Narrowing stated here, not silently done.
export function WaitingOnYou({ items }: { items: ItemProjection[] }) {
  const waiting = items.filter((item) => item.blockedBy.length > 0);

  return (
    <section aria-label="Waiting on you">
      {waiting.map((item) => (
        <div key={item.id}>
          <span>{item.id}</span>
          <button onClick={() => postGate({ id: item.id, gate: item.stage, action: 'approve' })}>
            Approve
          </button>
          <button
            onClick={() => {
              const reason = window.prompt('Reason for sending this back:');
              if (reason) postGate({ id: item.id, gate: item.stage, action: 'reject', reason });
            }}
          >
            Send back
          </button>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/dashboard/test/panels/WaitingOnYou.test.tsx`
Expected: all 4 pass.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/panels/WaitingOnYou.tsx packages/dashboard/test/panels/WaitingOnYou.test.tsx
git commit -m "relay(dashboard): add WaitingOnYou panel — approve/send-back wired to POST /api/gate"
```

---

## Task 8: Live sessions ticker

**Files:**
- Create: `packages/dashboard/src/panels/LiveSessions.tsx`
- Test: `packages/dashboard/test/panels/LiveSessions.test.tsx`

SPEC §13: "tool-by-tool agent activity, plan mode visibly distinct from build mode." SPEC §14: without hooks, this "degrades to file-level activity" — meaning this panel has no obligation to synthesize activity from nothing; it renders whatever arrives over `useRelayFeed`'s `activity` array (raw `POST /events` broadcasts), which is empty until something actually posts to that endpoint. This is the honest behavior, not a bug to paper over with fake placeholder rows.

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/test/panels/LiveSessions.test.tsx`:
```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LiveSessions } from '../../src/panels/LiveSessions.js';

describe('LiveSessions', () => {
  it('renders an empty state when no activity has arrived', () => {
    render(<LiveSessions activity={[]} />);
    expect(screen.getByText(/no active sessions/i)).toBeInTheDocument();
  });

  it('renders one row per activity entry, most recent first', () => {
    const activity = [
      { type: 'tool_use', tool: 'Write', itemId: '002-y' },
      { type: 'tool_use', tool: 'Edit', itemId: '001-x' },
    ];
    render(<LiveSessions activity={activity} />);
    const rows = screen.getAllByTestId('activity-row');
    expect(rows[0]).toHaveTextContent('Write');
    expect(rows[0]).toHaveTextContent('002-y');
    expect(rows[1]).toHaveTextContent('Edit');
  });

  it('renders an entry missing a recognizable shape without throwing', () => {
    render(<LiveSessions activity={[{ weird: true }]} />);
    expect(screen.getAllByTestId('activity-row')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/dashboard/test/panels/LiveSessions.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/dashboard/src/panels/LiveSessions.tsx`:
```tsx
export function LiveSessions({ activity }: { activity: unknown[] }) {
  if (activity.length === 0) {
    return (
      <section aria-label="Live sessions">
        <p>No active sessions.</p>
      </section>
    );
  }

  return (
    <section aria-label="Live sessions">
      {activity.map((entry, i) => {
        const e = entry as { type?: string; tool?: string; itemId?: string };
        return (
          <div key={i} data-testid="activity-row">
            {e.tool ?? e.type ?? 'event'}
            {e.itemId ? ` — ${e.itemId}` : ''}
          </div>
        );
      })}
    </section>
  );
}
```

`activity`'s "most recent first" ordering is already guaranteed by `feed.ts`'s reducer (Task 5: `[parsed, ...state.activity]` prepends), not something this component needs to sort itself.

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/dashboard/test/panels/LiveSessions.test.tsx`
Expected: all 3 pass.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/panels/LiveSessions.tsx packages/dashboard/test/panels/LiveSessions.test.tsx
git commit -m "relay(dashboard): add LiveSessions ticker panel"
```

---

## Task 9: Metrics strip panel

**Files:**
- Create: `packages/dashboard/src/panels/MetricsStrip.tsx`
- Test: `packages/dashboard/test/panels/MetricsStrip.test.tsx`

Renders `GET /api/metrics` (Task 3). Fetched independently of `useRelayFeed` — metrics are not part of the live item/WS stream, they're a separate, occasionally-refreshed read (SPEC §11: "nobody instruments anything, the dashboard maintains itself" — a periodic re-fetch is enough, no WS channel needed for numbers that change on the order of minutes, not milliseconds).

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/test/panels/MetricsStrip.test.tsx`:
```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MetricsStrip } from '../../src/panels/MetricsStrip.js';
import type { FlowMetrics } from '../../src/types.js';

const metrics: FlowMetrics = {
  gateLatencyS: { plan: { count: 2, avgS: 90 } },
  stageCycleTimeS: { design: { count: 1, avgS: 3600 } },
  overrideCount: 1,
  firstPassRate: 0.75,
};

describe('MetricsStrip', () => {
  it('renders the override count and first-pass rate as a percentage', () => {
    render(<MetricsStrip metrics={metrics} />);
    expect(screen.getByText(/overrides/i)).toHaveTextContent('1');
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });

  it('renders "—" for first-pass rate when it is NaN (no gate approved yet)', () => {
    render(<MetricsStrip metrics={{ ...metrics, firstPassRate: NaN }} />);
    expect(screen.getByTestId('first-pass-rate')).toHaveTextContent('—');
  });

  it('renders a gate-latency entry per gate present in the data', () => {
    render(<MetricsStrip metrics={metrics} />);
    expect(screen.getByTestId('gate-latency-plan')).toHaveTextContent('90');
  });
});
```

- [ ] **Step 2: Add `FlowMetrics` to the dashboard's own local types**

Modify `packages/dashboard/src/types.ts`, add (same "no cross-package import" reasoning as Task 5's `ItemProjection`):
```ts
export interface FlowMetrics {
  gateLatencyS: Partial<Record<Stage, { count: number; avgS: number }>>;
  stageCycleTimeS: Partial<Record<Stage, { count: number; avgS: number }>>;
  overrideCount: number;
  firstPassRate: number;
}
```

- [ ] **Step 3: Run to confirm the tests fail**

Run: `npx vitest run packages/dashboard/test/panels/MetricsStrip.test.tsx`
Expected: FAIL — `MetricsStrip.js` module missing (the `types.ts` addition alone should build clean, but there's nothing rendering yet).

- [ ] **Step 4: Implement**

Create `packages/dashboard/src/panels/MetricsStrip.tsx`:
```tsx
import type { FlowMetrics } from '../types.js';

export function MetricsStrip({ metrics }: { metrics: FlowMetrics }) {
  return (
    <section aria-label="Flow metrics" style={{ display: 'flex', gap: '2rem' }}>
      <div>
        Overrides: <strong>{metrics.overrideCount}</strong>
      </div>
      <div data-testid="first-pass-rate">
        First-pass rate: <strong>{Number.isNaN(metrics.firstPassRate) ? '—' : `${Math.round(metrics.firstPassRate * 100)}%`}</strong>
      </div>
      {Object.entries(metrics.gateLatencyS).map(([gate, stat]) => (
        <div key={gate} data-testid={`gate-latency-${gate}`}>
          {gate} gate latency: <strong>{Math.round(stat!.avgS)}s</strong> (n={stat!.count})
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run packages/dashboard/test/panels/MetricsStrip.test.tsx`
Expected: all 3 pass.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/types.ts packages/dashboard/src/panels/MetricsStrip.tsx packages/dashboard/test/panels/MetricsStrip.test.tsx
git commit -m "relay(dashboard): add MetricsStrip panel"
```

---

## Task 10: Incident strip (empty-state panel — Phase 5b binds real data)

**Files:**
- Create: `packages/dashboard/src/panels/IncidentStrip.tsx`
- Test: `packages/dashboard/test/panels/IncidentStrip.test.tsx`

Stated plainly, per this plan's own honesty-boundary section: this panel exists and renders correctly, but nothing in this repo produces incident data yet — that is Phase 5b's Stage 6 detector. This task is scoped to "the panel is real and ready," not "incidents are real."

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/test/panels/IncidentStrip.test.tsx`:
```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { IncidentStrip } from '../../src/panels/IncidentStrip.js';

describe('IncidentStrip', () => {
  it('renders a quiet empty state — no incident source exists yet (Phase 5b)', () => {
    render(<IncidentStrip />);
    expect(screen.getByLabelText('Incident strip')).toBeInTheDocument();
    expect(screen.getByText(/no incidents/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/dashboard/test/panels/IncidentStrip.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/dashboard/src/panels/IncidentStrip.tsx`:
```tsx
// Real panel, no real data source yet — the Stage 6 detector that would
// populate this (a band breach writing an intent.md with no human in the
// path) is Phase 5b, not this phase. See docs/plans/phase-5-dashboard.md's
// own header for why this is a stated scope boundary, not an oversight.
export function IncidentStrip() {
  return (
    <section aria-label="Incident strip">
      <p>No incidents.</p>
    </section>
  );
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/dashboard/test/panels/IncidentStrip.test.tsx`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/panels/IncidentStrip.tsx packages/dashboard/test/panels/IncidentStrip.test.tsx
git commit -m "relay(dashboard): add IncidentStrip panel (empty-state; Phase 5b binds real data)"
```

---

## Task 11: Spotlight mode

**Files:**
- Create: `packages/dashboard/src/Spotlight.tsx`
- Test: `packages/dashboard/test/Spotlight.test.tsx`

SPEC §13: "spotlight collapses the board to a single item and back. Same UI, three camera angles." Scoped here to the mechanism (a toggle that narrows `items` to one id and back) — the three specific "camera angles" (unblock beat / parallel beat / incident-strip beat) are demonstrated live in Task 13, not separately unit-tested framings.

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/test/Spotlight.test.tsx`:
```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Spotlight } from '../src/Spotlight.js';
import type { ItemProjection } from '../src/types.js';

const items: ItemProjection[] = [
  { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: [] },
  { id: '002-y', lane: 'standard', stage: 'build', blockedBy: [] },
];

describe('Spotlight', () => {
  it('renders every item\'s id when nothing is spotlighted', () => {
    render(<Spotlight items={items}>{(shown) => shown.map((i) => <div key={i.id}>{i.id}</div>)}</Spotlight>);
    expect(screen.getByText('001-x')).toBeInTheDocument();
    expect(screen.getByText('002-y')).toBeInTheDocument();
  });

  it('narrows to one item after clicking its spotlight control, and back after clicking exit', () => {
    render(<Spotlight items={items}>{(shown) => shown.map((i) => <div key={i.id}>{i.id}</div>)}</Spotlight>);

    fireEvent.click(screen.getByRole('button', { name: /spotlight 001-x/i }));
    expect(screen.getByText('001-x')).toBeInTheDocument();
    expect(screen.queryByText('002-y')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /exit spotlight/i }));
    expect(screen.getByText('001-x')).toBeInTheDocument();
    expect(screen.getByText('002-y')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/dashboard/test/Spotlight.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/dashboard/src/Spotlight.tsx`:
```tsx
import { useState, type ReactNode } from 'react';
import type { ItemProjection } from './types.js';

export function Spotlight({
  items,
  children,
}: {
  items: ItemProjection[];
  children: (shown: ItemProjection[]) => ReactNode;
}) {
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const shown = spotlightId ? items.filter((i) => i.id === spotlightId) : items;

  return (
    <div>
      <div>
        {spotlightId ? (
          <button onClick={() => setSpotlightId(null)}>Exit spotlight</button>
        ) : (
          items.map((i) => (
            <button key={i.id} onClick={() => setSpotlightId(i.id)}>
              Spotlight {i.id}
            </button>
          ))
        )}
      </div>
      {children(shown)}
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/dashboard/test/Spotlight.test.tsx`
Expected: both pass.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/Spotlight.tsx packages/dashboard/test/Spotlight.test.tsx
git commit -m "relay(dashboard): add Spotlight — collapse to one item and back"
```

---

## Task 12: `App.tsx` — wire every panel together

**Files:**
- Modify: `packages/dashboard/src/App.tsx`
- Test: `packages/dashboard/test/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/test/App.test.tsx`:
```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from '../src/App.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
}

describe('App', () => {
  it('renders all five panels once items have loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'] },
    ]), { status: 200 })));
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

    render(<App />);

    await waitFor(() => expect(screen.getByLabelText('Pipeline lanes')).toBeInTheDocument());
    expect(screen.getByLabelText('Waiting on you')).toBeInTheDocument();
    expect(screen.getByLabelText('Live sessions')).toBeInTheDocument();
    expect(screen.getByLabelText('Incident strip')).toBeInTheDocument();
    expect(screen.getByLabelText('Flow metrics')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/dashboard/test/App.test.tsx`
Expected: FAIL — `App` still renders only the Task 4 placeholder text.

- [ ] **Step 3: Implement**

Replace `packages/dashboard/src/App.tsx` in full:
```tsx
import { useEffect, useState } from 'react';
import { useRelayFeed } from './useRelayFeed.js';
import { PipelineLanes } from './panels/PipelineLanes.js';
import { WaitingOnYou } from './panels/WaitingOnYou.js';
import { LiveSessions } from './panels/LiveSessions.js';
import { MetricsStrip } from './panels/MetricsStrip.js';
import { IncidentStrip } from './panels/IncidentStrip.js';
import { Spotlight } from './Spotlight.js';
import type { FlowMetrics } from './types.js';

const EMPTY_METRICS: FlowMetrics = { gateLatencyS: {}, stageCycleTimeS: {}, overrideCount: 0, firstPassRate: NaN };

export default function App() {
  const feed = useRelayFeed();
  const [metrics, setMetrics] = useState<FlowMetrics>(EMPTY_METRICS);

  useEffect(() => {
    const refresh = () => fetch('/api/metrics').then((res) => res.json()).then(setMetrics);
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <IncidentStrip />
      <Spotlight items={feed.items}>{(shown) => <PipelineLanes items={shown} />}</Spotlight>
      <LiveSessions activity={feed.activity} />
      <WaitingOnYou items={feed.items} />
      <MetricsStrip metrics={metrics} />
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/dashboard/test/App.test.tsx`
Expected: passes.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything green — this is the largest test run of this phase, confirm the full count before moving on.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/App.tsx packages/dashboard/test/App.test.tsx
git commit -m "relay(dashboard): wire App.tsx — all five panels + spotlight"
```

---

## Task 13: The recorded event fixture (test dependency only — never a demo path)

**Files:**
- Create: `packages/dashboard/test/fixtures/sample-session.json`
- Test: `packages/dashboard/test/fixture-playback.test.ts`

SPEC §14, verbatim: "A deterministic recorded event stream exists as a **test fixture only** — real-time UI cannot be iterated on with non-repeatable input — and is never used on stage." `IMPLEMENTATION_PLAN.md`'s Phase 5 section repeats this. This task builds exactly that: a fixture file under `test/`, imported by exactly one test, never referenced from `src/` at all — so there is no code path by which a demo run could ever load it.

- [ ] **Step 1: Create the fixture**

Create `packages/dashboard/test/fixtures/sample-session.json` — a realistic sequence of the same event shapes `feed.ts` (Task 5) already handles:
```json
[
  { "type": "transition", "id": "001-checkout-fix", "from": "intake", "to": "plan" },
  { "type": "tool_use", "tool": "Write", "itemId": "001-checkout-fix" },
  { "type": "transition", "id": "001-checkout-fix", "from": "plan", "to": "design" },
  { "type": "transition", "id": "002-sso-support", "from": "intake", "to": "plan" },
  { "type": "tool_use", "tool": "Edit", "itemId": "002-sso-support" },
  { "type": "transition", "id": "001-checkout-fix", "from": "design", "to": "build" },
  { "type": "transition", "id": "002-sso-support", "from": "plan", "to": "design" }
]
```

- [ ] **Step 2: Write the failing test**

Create `packages/dashboard/test/fixture-playback.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { feedReducer, initialFeedState } from '../src/feed.js';
import sampleSession from './fixtures/sample-session.json';

describe('recorded fixture playback', () => {
  it('replays a realistic session and reaches the expected final state — proves feedReducer against non-synthetic input', () => {
    let state = initialFeedState;
    for (const event of sampleSession) {
      state = feedReducer(state, { type: 'ws-message', raw: JSON.stringify(event) });
    }

    expect(state.items.find((i) => i.id === '001-checkout-fix')?.stage).toBe('build');
    expect(state.items.find((i) => i.id === '002-sso-support')?.stage).toBe('design');
    expect(state.activity).toHaveLength(2); // the two tool_use entries, transitions never touch activity
  });
});
```

Add `"resolveJsonModule": true` to `packages/dashboard/tsconfig.json`'s `compilerOptions` if importing the `.json` fixture directly does not already type-check cleanly — check this in Step 3 before assuming it is needed.

- [ ] **Step 3: Run to confirm it fails, then passes**

Run: `npx vitest run packages/dashboard/test/fixture-playback.test.ts`
Expected: FAIL first (fixture/test did not exist a moment ago in this exact form — confirm the failure is for the right reason, not a typo), then, once both files above exist, passes.

- [ ] **Step 4: Confirm the fixture has no live code path — the one check this task genuinely needs**

```bash
grep -rn "sample-session" packages/dashboard/src/
```
Expected: no output. If anything under `src/` references this fixture, that is the bug this task exists to prevent — fix it before committing, per SPEC §14's explicit rule.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/test/fixtures/sample-session.json packages/dashboard/test/fixture-playback.test.ts packages/dashboard/tsconfig.json
git commit -m "relay(dashboard): add the recorded event fixture — test dependency only, per SPEC §14"
```

---

## Task 14: Live acceptance demonstration, `PROJECT.md`, the functional-first announcement, final commit

**Files:**
- Modify: `Projects/relay/PROJECT.md`

**Honesty boundary, stated up front, same pattern as every prior phase's final task:** `IMPLEMENTATION_PLAN.md`'s Phase 5 acceptance names three hero beats; this plan's own header already explained the third (an item appearing from the Stage 6 trigger) is Phase 5b's, not buildable yet since no detector exists. This task demonstrates hero beats 1 (unblock) and 2 (parallel/concurrent activity) live, in a real browser, against the real daemon and the real dashboard dev server — using the Browser pane tools, not a description of what a browser would show.

- [ ] **Step 1: Full monorepo build and test**

```bash
npm run build && npm run build:dashboard && npx vitest run
```
Expected: `tsc -b` exits 0 across all five composite packages; `vite build` succeeds for `@relay/dashboard` (a real production bundle, not just the dev server); every test file passes, zero `.only`/`.skip`.

- [ ] **Step 2: Set up a real scratch repo with two items, one blocked, and start both real processes**

```bash
lsof -i :5182 || echo "port 5182 free"
lsof -i :5173 || echo "port 5173 free"
SCRATCH=$(mktemp -d)
cd "$SCRATCH"
git init -q && git config user.email you@example.com && git config user.name You && git commit -q --allow-empty -m init
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js init
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js new "checkout fix"
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js use 001-checkout-fix
git checkout -q main
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js new "sso support"
```
Expected: two items exist, both sitting at the `plan` stage, both blocked (empty `intent.md`).

Start the daemon in this scratch repo, and the dashboard dev server pointed at it (Task 4's Vite config already proxies `/api` and `/stream` to `localhost:5182`):
```bash
cd "$SCRATCH" && node /Users/aj/Desktop/Claude/Projects/relay/packages/daemon/dist/index.js &
cd /Users/aj/Desktop/Claude/Projects/relay && npx vite --config packages/dashboard/vite.config.ts --root packages/dashboard &
sleep 2
```

- [ ] **Step 3: Hero beat 2 (parallel) — open the dashboard in the Browser pane, confirm both items render in their correct lanes**

Use `mcp__Claude_Browser__navigate` to `http://localhost:5173`, then `mcp__Claude_Browser__read_page` or a screenshot to confirm: both `001-checkout-fix` and `002-sso-support` appear under the "plan" lane, and both appear in the "Waiting on you" panel — this is the "multiple agents/items visible at once" beat, demonstrated with two concurrently in-flight items rather than a live agent process (this environment cannot spawn a second live coding agent, the same honestly-stated limitation Phase 3's Task 14 already established for this workspace).

- [ ] **Step 4: Hero beat 1 (unblock) — approve a gate through the API, watch the browser update without a page reload**

Fill `001-checkout-fix`'s `intent.md` (same section-filling pattern every prior acceptance task in this project has used), then approve its `plan` gate via the real `POST /api/gate` endpoint (proving the browser's own button would do the same thing, without requiring simulated clicks through a form-filled reason prompt in an automated run):
```bash
sed -i '' 's/## Problem/## Problem\nx/' "$SCRATCH/.relay/work/001-checkout-fix/intent.md"
sed -i '' 's/## Proposed outcome/## Proposed outcome\nx/' "$SCRATCH/.relay/work/001-checkout-fix/intent.md"
sed -i '' 's/## Affected users and systems/## Affected users and systems\nx/' "$SCRATCH/.relay/work/001-checkout-fix/intent.md"
sed -i '' 's/## Constraints/## Constraints\nx/' "$SCRATCH/.relay/work/001-checkout-fix/intent.md"
sed -i '' 's/## Open questions/## Open questions\nx/' "$SCRATCH/.relay/work/001-checkout-fix/intent.md"
curl -s -X POST http://localhost:5182/api/gate -H 'content-type: application/json' \
  -d '{"id":"001-checkout-fix","gate":"plan","action":"approve"}'
```
Then, without navigating or reloading, use the Browser pane's `read_page` or a screenshot again: `001-checkout-fix` has moved to the "design" lane and out of "Waiting on you" — proving the live WS update path (daemon watcher → transition event → `useRelayFeed`'s reducer → re-render), not a page refresh picking up new data.

- [ ] **Step 5: Record the result, clean up**

Record what was actually observed in each screenshot/`read_page` call — not a description of what should have appeared.

```bash
kill %1 %2 2>/dev/null
rm -rf "$SCRATCH"
```

- [ ] **Step 6: `PROJECT.md` — Features, Gotchas, Next steps, Changelog, and the functional-first announcement**

Mark `@relay/dashboard` `[x]` in the Features list with the verified test count from Step 1, and state plainly which two hero beats were demonstrated live and which one (the third) is Phase 5b's. Add a Gotcha for the `POST /api/gate` single-daemon-identity limitation (stated in this plan's own header). Add a Gotcha for the recorded fixture rule (SPEC §14) mirroring how existing Gotchas already state "demos run live." Replace the "Next steps" Phase 5 entry with a pointer to Phase 5b (`Stage 6 trigger slice`).

**Then say it explicitly, in `PROJECT.md`'s own words, per `IMPLEMENTATION_PLAN.md`'s own instruction and CLAUDE.md principle 12:** "Build is done and verified — ready to focus on design." Do not start a design pass in this same task — that is a deliberate, separate decision this plan's own scope excludes, to be taken up only when asked.

- [ ] **Step 7: Commit**

```bash
git add Projects/relay/PROJECT.md
git commit -m "$(cat <<'EOF'
relay: PROJECT.md — Phase 5 (@relay/dashboard) verified, functional build done

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage** — all five SPEC §13 panels have their own task (6-10); spotlight (Task 11); the two daemon additions Phase 4 deferred (Task 3); the metrics computation SPEC §11 promises is "free" (Task 2), grounded in a field (`Approval.latencyS`) the codebase already declared but never used; the recorded-fixture rule from SPEC §14 (Task 13); the live acceptance demonstration (Task 14), honest about which hero beat is out of this phase's reach.

**Placeholder scan** — no `TBD`/`TODO`/"add appropriate error handling" in any code block. The two things genuinely left undone are named as such with reasons: card-pulse animation (Task 6, explicitly a design-pass concern) and the incident strip's real data source (Task 10, explicitly Phase 5b's).

**Type consistency** — `ItemProjection`/`Stage`/`TransitionEvent`/`FlowMetrics` are declared once in `packages/dashboard/src/types.ts` (Tasks 5 and 9) and imported everywhere else in this package; no panel re-declares its own shape for the same data.

**Version grounding** — every dependency version in Task 4 was checked against the live npm registry and cross-checked for peer-dependency compatibility (`@vitejs/plugin-react`'s stable 4.x line deliberately chosen over its newer 6.x line's unwanted extra peers) before being written into this plan, not assumed from training-data recall.

**Scope discipline** — full git-commit-timestamp metrics, per-viewer-role gate filtering, per-browser-user identity, and visual design polish are each named explicitly as out of scope in this plan's own header, with the reason for each, not silently dropped.
