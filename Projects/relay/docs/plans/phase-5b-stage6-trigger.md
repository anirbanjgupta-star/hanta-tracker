# Phase 5b — Stage 6 Trigger Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The third hero beat — a deterministic detector that evaluates a metric against version-controlled control bands and, on a severe breach, writes a valid `intent.md` at the top of the pipeline with no human in the invocation path, per `docs/IMPLEMENTATION_PLAN.md`'s Phase 5b section and SPEC.md's Stage 6 row (§6, §13, §14).

**What SPEC leaves genuinely open, and the decisions made here — flagged, not silently picked, same pattern as every prior phase's documented judgment calls:**

- **Which metric.** SPEC says only "a metric." Decided with the user directly before writing this plan: **gate latency** (`computeMetrics()`'s `gateLatencyS`, built in Phase 5 from `Approval.latencyS`) — already-computed, already-real data, no new instrumentation needed.
- **Control-band format.** "Control bands from a version-controlled config" doesn't specify a shape. This plan uses the literal Western Electric construction — a **centerline** and a **sigma** per gate, in `.relay/policies/stage6-bands.yml` — with 1σ/2σ/3σ zones derived as `centerline ± n·sigma`, rather than requiring a human to pre-compute six boundary numbers by hand.
- **Detection cadence and dedup.** Nothing in SPEC says how often the detector runs or how it avoids re-firing on an unchanged breach forever. This plan reuses Phase 4's already-proven, already-fast file-watcher path (the same one that met the daemon's own "within a second" bar in its own acceptance run) rather than adding a new poll/timer loop, and tracks a small per-gate cursor (`.relay/detector-state.json`, gitignored) so only *newly recorded* approvals since the last check can trigger a finding — not the same standing breach on every unrelated file change.
- **What "the intent writer" and "Claude read-only" concretely produce.** SPEC's stage table says "Detector, then Claude read-only" and the build sequence says "1σ logs, 2σ diagnoses read-only, 3σ may act." This plan reads that as three escalating tiers: 1σ is logged with **no model call at all** (free, deterministic); 2σ calls the model for a short diagnosis that is **logged, never written to disk as an artifact** (true read-only — nothing durable changes); 3σ calls the model to draft a real `intent.md`, written the same way `relay adopt` already writes artifacts.
- **How the dashboard tells a Stage 6 item apart from a human-created one.** `Artifact.origin` already exists as a closed union (`'authored' | 'adopted'`, added for Phase 2's `relay adopt`) — this plan adds a third value, `'stage6-detector'`, the same mechanism already proven, not a new one.
- **API-key availability.** No `ANTHROPIC_API_KEY` is configured in this environment. Confirmed with the user before writing this plan: build the real Anthropic SDK integration (mirroring `relay adopt`'s already-hardened pattern exactly — fence-stripping, `stop_reason` checking, zod validation, and critically its `draftFn`-style dependency-injection seam), verify it with an injected stub throughout the automated suite and the live acceptance run, and state plainly that genuine live-model verification remains open until a real key is supplied — the same honesty-boundary pattern this project has used for every other "can't fully verify in this environment" gap (Phase 3's live Claude Code session, Phase 4/5's real-daemon-plus-browser runs).

**Architecture:** All detection/classification logic is pure and lives in `@relay/core` (same reasoning as `evaluateGate()`/`computeMetrics()` — judgment belongs there, nothing else decides). Orchestration (loading config/state, calling `computeMetrics`, deciding what to do per zone) lives in `@relay/cli` as a new `relay detect` command, reusing `runAdopt`'s exact hardening template for the two model-calling tiers. `@relay/daemon` wires the same orchestration function into its existing watcher-triggered `recompute()`, so a breach surfaces autonomously. `@relay/dashboard`'s `IncidentStrip` (an empty placeholder since Phase 5) finally gets real data.

---

## Task 1: `classifyBreach()` and control-bands parsing in `@relay/core`

**Files:**
- Modify: `packages/core/src/types.ts` (extend `Artifact.origin`)
- Modify: `packages/core/src/artifact.ts` (parse the new origin value)
- Create: `packages/core/src/stage6.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/stage6.test.ts`
- Test: `packages/core/test/artifact.test.ts` (extend existing)

- [ ] **Step 1: Write the failing tests**

First read the current `packages/core/test/artifact.test.ts` in full — this step adds to its existing tests, not a rewrite. Add:
```ts
it('parses origin: stage6-detector distinctly from adopted and authored', () => {
  const raw = '---\nid: 001-x\nlane: standard\norigin: stage6-detector\n---\n\n## Problem\np\n';
  const artifact = parseArtifact(raw, 'intent');
  expect(artifact.origin).toBe('stage6-detector');
});
```

Create `packages/core/test/stage6.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { classifyBreach, parseControlBands } from '../src/stage6.js';

describe('classifyBreach', () => {
  const band = { centerline: 3600, sigma: 1800 };

  it('classifies a value within 1 sigma of the centerline as no breach', () => {
    expect(classifyBreach(4500, band)).toBe('none'); // 900/1800 = 0.5σ
  });

  it('classifies exactly 1 sigma away as the 1-sigma zone', () => {
    expect(classifyBreach(5400, band)).toBe('1sigma'); // 1800/1800 = 1.0σ
  });

  it('classifies exactly 2 sigma away as the 2-sigma zone', () => {
    expect(classifyBreach(7200, band)).toBe('2sigma'); // 3600/1800 = 2.0σ
  });

  it('classifies 3 or more sigma away as the 3-sigma zone', () => {
    expect(classifyBreach(9000, band)).toBe('3sigma'); // 5400/1800 = 3.0σ
    expect(classifyBreach(100000, band)).toBe('3sigma');
  });

  it('classifies a value BELOW the centerline the same way, by absolute deviation', () => {
    expect(classifyBreach(0, band)).toBe('2sigma'); // |0-3600|/1800 = 2.0σ
  });
});

describe('parseControlBands', () => {
  it('parses a valid bands config', () => {
    const yaml = 'gateLatencyS:\n  plan:\n    centerline: 3600\n    sigma: 1800\n';
    const bands = parseControlBands(yaml);
    expect(bands.gateLatencyS.plan).toEqual({ centerline: 3600, sigma: 1800 });
  });

  it('defaults to an empty gateLatencyS when the config has none configured', () => {
    const bands = parseControlBands('gateLatencyS: {}\n');
    expect(bands.gateLatencyS).toEqual({});
  });

  it('rejects a non-positive sigma — a zero or negative sigma makes every value infinitely many "sigmas" away', () => {
    const yaml = 'gateLatencyS:\n  plan:\n    centerline: 3600\n    sigma: 0\n';
    expect(() => parseControlBands(yaml)).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/core/test/stage6.test.ts packages/core/test/artifact.test.ts`
Expected: FAIL — `stage6.js` module missing; the new `artifact.test.ts` case fails because `parseArtifact` doesn't yet recognize `'stage6-detector'`.

- [ ] **Step 3: Implement**

Modify `packages/core/src/types.ts`:
```ts
  origin: 'authored' | 'adopted' | 'stage6-detector';
```
(replaces the existing `origin: 'authored' | 'adopted';` line — everything else in the file stays as-is.)

Modify `packages/core/src/artifact.ts`:
```ts
    origin:
      fm.origin === 'adopted' || fm.origin === 'stage6-detector' ? fm.origin : 'authored',
```
(replaces the existing `origin: fm.origin === 'adopted' ? 'adopted' : 'authored',` line.)

Create `packages/core/src/stage6.ts`:
```ts
import { z } from 'zod';
import type { Stage } from './types.js';

export interface ControlBand {
  centerline: number;
  sigma: number;
}

export interface ControlBandsConfig {
  gateLatencyS: Partial<Record<Stage, ControlBand>>;
}

export type BreachZone = 'none' | '1sigma' | '2sigma' | '3sigma';

// Deviation measured as an absolute distance from the centerline, in sigma
// units — a value can breach by running too fast just as meaningfully as
// too slow (an unrealistically instant approval is as worth flagging as a
// stalled one), so this does not treat "below centerline" as automatically
// fine.
export function classifyBreach(value: number, band: ControlBand): BreachZone {
  const deviation = Math.abs(value - band.centerline) / band.sigma;
  if (deviation >= 3) return '3sigma';
  if (deviation >= 2) return '2sigma';
  if (deviation >= 1) return '1sigma';
  return 'none';
}

const GATE_SCHEMA = z.enum(['plan', 'design', 'build']);
const CONTROL_BAND_SCHEMA = z.object({
  centerline: z.number(),
  sigma: z.number().positive(),
});
const CONTROL_BANDS_SCHEMA = z.object({
  gateLatencyS: z.record(GATE_SCHEMA, CONTROL_BAND_SCHEMA).default({}),
});

export function parseControlBands(raw: string): ControlBandsConfig {
  const { parse: parseYaml } = require('yaml') as typeof import('yaml');
  return CONTROL_BANDS_SCHEMA.parse(parseYaml(raw));
}
```

Note on the `require('yaml')` line: every other file in `@relay/core` that parses YAML (`config.ts`) uses a top-level `import { parse as parseYaml } from 'yaml';` — match that convention instead of the inline `require` shown above, which was written only to keep this snippet self-contained while drafting. Use:
```ts
import { parse as parseYaml } from 'yaml';
```
at the top of the file alongside the `zod` import, and call `parseYaml(raw)` directly in `parseControlBands`. This isn't a stylistic nicety — an inline `require()` inside an ESM package (`"type": "module"`) is exactly the class of bug this project already found and fixed twice this session (Phase 3's `import.meta.resolve` incompatibility, Phase 5's `jsdom` hoisting) — don't introduce a third variant of "assumed module resolution that doesn't actually hold" without checking.

Modify `packages/core/src/index.ts`, add one line:
```ts
export { classifyBreach, parseControlBands, type ControlBand, type ControlBandsConfig, type BreachZone } from './stage6.js';
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/core/test/stage6.test.ts packages/core/test/artifact.test.ts`
Expected: clean build, all tests pass (8 in `stage6.test.ts` + the existing artifact tests plus the one new case).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything still green — both changes are additive (a widened union, a new module).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/artifact.ts packages/core/src/stage6.ts packages/core/src/index.ts packages/core/test/stage6.test.ts packages/core/test/artifact.test.ts
git commit -m "relay(core): add classifyBreach()/parseControlBands(); origin gains 'stage6-detector'"
```

---

## Task 2: Detector state (the dedup cursor) in `@relay/cli`

**Files:**
- Modify: `packages/cli/src/relay-dir.ts`
- Modify: `Projects/relay/.gitignore` (add `.relay/detector-state.json` — wait, this is a per-*target*-repo file, not this monorepo's own `.relay/` — see Step 3's note)
- Test: `packages/cli/test/relay-dir.test.ts` (extend existing)

**Honesty boundary, stated plainly:** this is the one piece of genuinely-persisted, non-recomputable state this whole project has — deliberately, not by accident. Deduplicating "have I already acted on this breach" is impossible to derive purely from `approvals.jsonl` without remembering *what was already checked*, unlike everything else in Relay (state is recomputed from the artifact chain precisely because a *hash and a verdict* fully describe "is this gate cleared" with no memory needed). Losing this file is not a correctness bug — the worst case is a previously-diagnosed breach gets logged or diagnosed again once, never a corrupted gate or ledger — so it's gitignored rather than committed, matching `.relay/CURRENT`'s existing precedent for exactly this kind of "safe to lose, restart clean" file.

- [ ] **Step 1: Write the failing tests**

Read the current `packages/cli/test/relay-dir.test.ts` in full before editing. Add:
```ts
describe('detector state', () => {
  it('returns an empty cursor before any detector run has happened', () => {
    repo = makeScratchRepo();
    expect(loadDetectorState(repo.dir)).toEqual({ lastCheckedTs: {} });
  });

  it('round-trips a saved cursor', () => {
    repo = makeScratchRepo();
    saveDetectorState({ lastCheckedTs: { plan: '2026-09-17T10:00:00Z' } }, repo.dir);
    expect(loadDetectorState(repo.dir)).toEqual({ lastCheckedTs: { plan: '2026-09-17T10:00:00Z' } });
  });
});
```

Add `loadDetectorState, saveDetectorState` to this test file's existing import from `'../src/relay-dir.js'`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/relay-dir.test.ts`
Expected: FAIL — module exports missing.

- [ ] **Step 3: Implement**

Modify `packages/cli/src/relay-dir.ts`, add after `loadRolesText`:
```ts
export interface DetectorState {
  lastCheckedTs: Partial<Record<string, string>>;
}

export function loadDetectorState(cwd: string): DetectorState {
  const path = join(relayRoot(cwd), 'detector-state.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { lastCheckedTs: {} };
}

export function saveDetectorState(state: DetectorState, cwd: string): void {
  writeFileSync(join(relayRoot(cwd), 'detector-state.json'), JSON.stringify(state, null, 2) + '\n');
}
```

This file lives inside each *target* repo's own `.relay/` directory (the one `relay init` scaffolds in whatever project adopts Relay) — not inside this monorepo's own tree, so it needs no entry in `Projects/relay/.gitignore` here. `relay init` (Task 6) will add `.relay/detector-state.json` to the *target* repo's `.gitignore` the same way it already does for `.relay/CURRENT`, via the existing `ensureGitignored` helper in `commands/init.ts`.

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/cli/test/relay-dir.test.ts`
Expected: clean build, all pass.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/relay-dir.ts packages/cli/test/relay-dir.test.ts
git commit -m "relay(cli): add detector-state.json — the Stage 6 dedup cursor"
```

---

## Task 3: `findBreaches()` — deterministic, model-free orchestration

**Files:**
- Create: `packages/cli/src/commands/detect.ts`
- Modify: `packages/cli/src/lib.ts`
- Test: `packages/cli/test/detect.test.ts`

The "plain script, no model involved" half of the detector. Given the current control bands and the current state of `approvals.jsonl` across every item, this determines which gates are in breach *and* whether that breach is new since the last check — with zero network calls, fully unit-testable.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/detect.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runGate } from '../src/commands/gate.js';
import { saveDetectorState } from '../src/relay-dir.js';
import { findBreaches } from '../src/commands/detect.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

function writeBands(dir: string, yaml: string) {
  mkdirSync(join(dir, '.relay/policies'), { recursive: true });
  writeFileSync(join(dir, '.relay/policies/stage6-bands.yml'), yaml);
}

describe('findBreaches', () => {
  it('reports no findings when no bands are configured', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('x', {}, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);
    expect(findBreaches(repo.dir)).toEqual([]);
  });

  it('reports no findings when the average sits within the configured band', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 100\n    sigma: 1000\n');
    const { id } = await runNew('x', {}, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir); // no latencyS recorded — no gate_requested event
    expect(findBreaches(repo.dir)).toEqual([]);
  });

  it('reports a 3-sigma finding for a gate whose average latency is far outside its band', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 3600_000).toISOString(); // 1 hour "request-to-approve" latency
    const { appendEvent } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const findings = findBreaches(repo.dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].gate).toBe('plan');
    expect(findings[0].zone).toBe('3sigma');
  });

  it('does not re-report a breach whose triggering approval was already checked', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 3600_000).toISOString();
    const { appendEvent } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    const approval = await runGate(id, 'plan', 'approve', undefined, repo.dir);

    saveDetectorState({ lastCheckedTs: { plan: approval.ts } }, repo.dir);
    expect(findBreaches(repo.dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/detect.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/cli/src/commands/detect.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyBreach, computeMetrics, parseControlBands,
  type Stage, type ControlBandsConfig,
} from '@relay/core';
import { loadRelayConfig } from '../context.js';
import { listItemIds, loadWorkItem, loadDetectorState } from '../relay-dir.js';

export interface Finding {
  gate: Stage;
  zone: '1sigma' | '2sigma' | '3sigma';
  valueS: number;
  centerlineS: number;
  sigmaS: number;
  newestApprovalTs: string;
}

function loadBands(cwd: string): ControlBandsConfig | null {
  const path = join(cwd, '.relay/policies/stage6-bands.yml');
  return existsSync(path) ? parseControlBands(readFileSync(path, 'utf8')) : null;
}

export function findBreaches(cwd: string): Finding[] {
  const bands = loadBands(cwd);
  if (!bands) return [];

  const config = loadRelayConfig(cwd);
  const items = listItemIds(cwd).map((id) => loadWorkItem(id, config.defaultLane, cwd));
  const metrics = computeMetrics(items);
  const state = loadDetectorState(cwd);

  const findings: Finding[] = [];
  for (const [gate, band] of Object.entries(bands.gateLatencyS) as [Stage, { centerline: number; sigma: number }][]) {
    const stat = metrics.gateLatencyS[gate];
    if (!stat) continue;

    const zone = classifyBreach(stat.avgS, band);
    if (zone === 'none') continue;

    const newestApprovalTs = items
      .flatMap((item) => item.approvals)
      .filter((a) => a.gate === gate && a.latencyS !== undefined)
      .map((a) => a.ts)
      .sort()
      .at(-1);
    if (!newestApprovalTs) continue;

    const lastChecked = state.lastCheckedTs[gate];
    if (lastChecked && newestApprovalTs <= lastChecked) continue; // already handled

    findings.push({
      gate, zone, valueS: stat.avgS, centerlineS: band.centerline, sigmaS: band.sigma, newestApprovalTs,
    });
  }
  return findings;
}
```

Modify `packages/cli/src/lib.ts`, add one line:
```ts
export { findBreaches, type Finding } from './commands/detect.js';
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/cli/test/detect.test.ts`
Expected: clean build, all 4 pass.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/detect.ts packages/cli/src/lib.ts packages/cli/test/detect.test.ts
git commit -m "relay(cli): add findBreaches() — deterministic control-band classification, no model involved"
```

---

## Task 4: The intent writer (3σ) and diagnose function (2σ)

**Files:**
- Modify: `packages/cli/src/commands/detect.ts`
- Test: `packages/cli/test/detect.test.ts` (extend existing)

Mirrors `commands/adopt.ts`'s already-hardened pattern exactly — this is a second caller of the same shape of problem (untrusted LLM JSON in, a real artifact out), not a reason to invent a different one.

- [ ] **Step 1: Write the failing tests**

Add to `packages/cli/test/detect.test.ts`:
```ts
import { runStage6Detect, parseBreachIntentDraft } from '../src/commands/detect.js';

describe('parseBreachIntentDraft', () => {
  it('parses a well-formed response', () => {
    const draft = parseBreachIntentDraft(JSON.stringify({
      title: 'plan gate latency breach',
      problem: 'p', proposedOutcome: 'o', affectedUsersAndSystems: 'a', constraints: 'c', openQuestions: 'q',
    }));
    expect(draft.title).toBe('plan gate latency breach');
  });

  it('strips a markdown fence before parsing', () => {
    const draft = parseBreachIntentDraft('```json\n' + JSON.stringify({
      title: 't', problem: 'p', proposedOutcome: 'o', affectedUsersAndSystems: 'a', constraints: 'c', openQuestions: 'q',
    }) + '\n```');
    expect(draft.title).toBe('t');
  });

  it('throws a clear error on a response that is not the expected shape', () => {
    expect(() => parseBreachIntentDraft('{"title": "t"}')).toThrow(/expected draft shape/);
  });
});

describe('runStage6Detect', () => {
  it('acts on a 3-sigma finding: writes an intent.md with origin stage6-detector, advances the cursor', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 3600_000).toISOString();
    const { appendEvent, loadDetectorState } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const draftFn = async () => ({
      title: 'plan gate is slow', problem: 'p', proposedOutcome: 'o',
      affectedUsersAndSystems: 'a', constraints: 'c', openQuestions: 'q',
    });
    const result = await runStage6Detect(repo.dir, { draftFn, diagnoseFn: async () => 'unused' });

    expect(result.acted).toHaveLength(1);
    const newId = result.acted[0];
    const { loadWorkItem } = await import('../src/relay-dir.js');
    const newItem = loadWorkItem(newId, 'standard', repo.dir);
    expect(newItem.artifacts.intent?.origin).toBe('stage6-detector');
    expect(newItem.artifacts.intent?.body).toContain('p'); // the drafted "problem" text landed in the artifact

    const state = loadDetectorState(repo.dir);
    expect(state.lastCheckedTs.plan).toBeTruthy();
  });

  it('diagnoses a 2-sigma finding without writing any new item', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 120_000).toISOString(); // 2 minutes -> exactly 2 sigma
    const { appendEvent, listItemIds } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const before = listItemIds(repo.dir).length;
    const diagnoseFn = async () => 'diagnosis text';
    const result = await runStage6Detect(repo.dir, { draftFn: async () => { throw new Error('must not be called'); }, diagnoseFn });

    expect(result.diagnosed).toHaveLength(1);
    expect(listItemIds(repo.dir).length).toBe(before); // no new item written
  });

  it('logs a 1-sigma finding with no model call of any kind', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 90_000).toISOString(); // 1.5 minutes -> 1 sigma zone
    const { appendEvent } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const result = await runStage6Detect(repo.dir, {
      draftFn: async () => { throw new Error('must not be called'); },
      diagnoseFn: async () => { throw new Error('must not be called'); },
    });
    expect(result.logged).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/detect.test.ts`
Expected: FAIL — `runStage6Detect`/`parseBreachIntentDraft` missing.

- [ ] **Step 3: Implement**

Add to `packages/cli/src/commands/detect.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { allocateItemId } from '../item-id.js';
import { writeArtifact, saveDetectorState } from '../relay-dir.js';
import { frontmatter } from '../templates.js';

export interface BreachIntentDraft {
  title: string;
  problem: string;
  proposedOutcome: string;
  affectedUsersAndSystems: string;
  constraints: string;
  openQuestions: string;
}

const BREACH_INTENT_DRAFT_SCHEMA = z.object({
  title: z.string(),
  problem: z.string(),
  proposedOutcome: z.string(),
  affectedUsersAndSystems: z.string(),
  constraints: z.string(),
  openQuestions: z.string(),
});

// Same fence-stripping reasoning as adopt.ts's extractJson: models wrap JSON
// in a ```json fence despite being asked for "ONLY" the JSON.
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

export function parseBreachIntentDraft(text: string): BreachIntentDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (err) {
    throw new Error(
      `Could not parse Claude's response as JSON (${(err as Error).message}). Raw response, first 500 chars:\n${text.slice(0, 500)}`
    );
  }
  const result = BREACH_INTENT_DRAFT_SCHEMA.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Claude's response did not match the expected draft shape: ${result.error.message}`);
  }
  return result.data;
}

export type DraftFn = (finding: Finding) => Promise<BreachIntentDraft>;
export type DiagnoseFn = (finding: Finding) => Promise<string>;

function breachSummary(finding: Finding): string {
  return `The ${finding.gate} gate's average approval latency is ${Math.round(finding.valueS)}s, ` +
    `${finding.zone} from its configured centerline of ${finding.centerlineS}s (sigma: ${finding.sigmaS}s).`;
}

// The only place ANTHROPIC_API_KEY is read for this feature — never
// config.yml or any other repo file (SPEC §4.5), same rule adopt.ts
// already follows. Exercised live, once, manually with a real key; the
// automated suite and this task's own acceptance run always inject a stub
// via opts.draftFn/opts.diagnoseFn instead — no ANTHROPIC_API_KEY is
// configured in this environment, so this path has not itself been run
// against the real API as of this commit. Stated here, not silently
// implied as verified.
function requireClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — the Stage 6 detector needs a key from the environment, never from the repo (SPEC §4.5)');
  }
  return new Anthropic({ apiKey });
}

async function draftWithClaude(finding: Finding): Promise<BreachIntentDraft> {
  const client = requireClient();
  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content:
        'A deterministic control-band detector (not a model) has flagged an operational problem in an ' +
        'AI-native SDLC pipeline. Draft this as a Relay intent.md: a short kebab-friendly title, and the ' +
        'five sections a triaging service owner needs. Respond with ONLY this JSON shape: ' +
        '{"title": string, "problem": string, "proposedOutcome": string, "affectedUsersAndSystems": string, ' +
        '"constraints": string, "openQuestions": string}.\n\n' + breachSummary(finding),
    }],
  });
  if (message.stop_reason === 'max_tokens') {
    throw new Error("Claude's draft was truncated (hit max_tokens) before finishing.");
  }
  const text = message.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
  return parseBreachIntentDraft(text);
}

async function diagnoseWithClaude(finding: Finding): Promise<string> {
  const client = requireClient();
  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: 'In two or three sentences, diagnose a likely cause for this operational anomaly. ' +
        'This is read-only — you are not fixing anything or filing anything, only explaining.\n\n' + breachSummary(finding),
    }],
  });
  return message.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
}

export interface Stage6DetectOptions {
  draftFn?: DraftFn;
  diagnoseFn?: DiagnoseFn;
}

export interface Stage6DetectResult {
  acted: string[];
  diagnosed: Finding[];
  logged: Finding[];
}

export async function runStage6Detect(cwd: string, opts: Stage6DetectOptions = {}): Promise<Stage6DetectResult> {
  const draftFn = opts.draftFn ?? draftWithClaude;
  const diagnoseFn = opts.diagnoseFn ?? diagnoseWithClaude;
  const config = loadRelayConfig(cwd);
  const state = loadDetectorState(cwd);
  const result: Stage6DetectResult = { acted: [], diagnosed: [], logged: [] };

  for (const finding of findBreaches(cwd)) {
    if (finding.zone === '3sigma') {
      const draft = await draftFn(finding);
      const id = allocateItemId(draft.title, cwd);
      const intentRaw =
        frontmatter({ id, lane: config.defaultLane, stage: 'plan', upstream: null, origin: 'stage6-detector' }) +
        `\n## Problem\n\n${draft.problem}\n\n` +
        `## Proposed outcome\n\n${draft.proposedOutcome}\n\n` +
        `## Affected users and systems\n\n${draft.affectedUsersAndSystems}\n\n` +
        `## Constraints\n\n${draft.constraints}\n\n` +
        `## Open questions\n\n${draft.openQuestions}\n`;
      writeArtifact(id, 'intent', intentRaw, cwd);
      result.acted.push(id);
    } else if (finding.zone === '2sigma') {
      const diagnosis = await diagnoseFn(finding);
      console.log(`[stage6] ${finding.gate} gate 2-sigma breach — diagnosis: ${diagnosis}`);
      result.diagnosed.push(finding);
    } else {
      console.log(`[stage6] ${finding.gate} gate 1-sigma breach — ${breachSummary(finding)}`);
      result.logged.push(finding);
    }
    state.lastCheckedTs[finding.gate] = finding.newestApprovalTs;
  }

  saveDetectorState(state, cwd);
  return result;
}
```

Add `loadDetectorState` (already imported for `findBreaches`) alongside `saveDetectorState` to this file's existing `relay-dir.js` import line.

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/cli/test/detect.test.ts`
Expected: clean build, all pass (4 from Task 3 + 3 `parseBreachIntentDraft` + 3 `runStage6Detect` = 10).

- [ ] **Step 5: Mutation-test the "no model call for 1σ" and "no artifact write for 2σ" claims**

These are exactly the kind of "verify by breaking it" claims this project always checks rather than trusts. Temporarily swap the 1σ branch's `console.log` for a call to `diagnoseFn`, rerun the 1σ test, confirm it now fails (`must not be called` thrown) — then revert. Do the same for the 2σ branch: temporarily make it also call `writeArtifact`/`allocateItemId` the way the 3σ branch does, rerun the 2σ test, confirm `listItemIds(repo.dir).length` now differs from `before` — then revert.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/detect.ts packages/cli/src/lib.ts packages/cli/test/detect.test.ts
git commit -m "relay(cli): add the Stage 6 intent writer (3sigma) and diagnose function (2sigma)"
```

---

## Task 5: `relay detect` — the real CLI command

**Files:**
- Modify: `packages/cli/src/index.ts`
- Test: manual, verified by running the built binary (matches this project's own established pattern for wiring a command function into the real commander program — Phase 2's own commands were unit-tested at the `run*` function level, with the commander wiring itself checked by hand once).

- [ ] **Step 1: Implement**

Read the current full `packages/cli/src/index.ts` before editing — this adds one command among the existing ten, not a rewrite. Add the import:
```ts
import { runStage6Detect } from './commands/detect.js';
```
and, after the existing `adopt` command block, before `program.parseAsync(process.argv);`:
```ts
program.command('detect')
  .action(guarded(async () => {
    const result = await runStage6Detect(process.cwd());
    if (result.acted.length > 0) console.log(`Filed: ${result.acted.join(', ')}`);
    if (result.diagnosed.length > 0) console.log(`Diagnosed (2-sigma, read-only): ${result.diagnosed.length}`);
    if (result.logged.length > 0) console.log(`Logged (1-sigma): ${result.logged.length}`);
    if (result.acted.length === 0 && result.diagnosed.length === 0 && result.logged.length === 0) {
      console.log('No breaches.');
    }
  }));
```

- [ ] **Step 2: Build and run it by hand against a forced breach**

```bash
npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon
SCRATCH=$(mktemp -d)
cd "$SCRATCH"
git init -q && git config user.email you@example.com && git config user.name You && git commit -q --allow-empty -m init
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js init
mkdir -p .relay/policies
echo 'gateLatencyS:
  plan:
    centerline: 60
    sigma: 30' > .relay/policies/stage6-bands.yml
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js new "test"
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js gate plan --approve
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js detect
```
Expected: since no `ANTHROPIC_API_KEY` is set in this environment, and this run uses the REAL `draftWithClaude` (no stub — this is the one intentional live path this task exercises), the command should fail with the explicit `ANTHROPIC_API_KEY is not set` error — **run this and confirm you see exactly that message, not some other crash** — this is the honest, correct behavior for an unconfigured environment, not a bug to work around. Record this observed output.

- [ ] **Step 3: Clean up**

```bash
rm -rf "$SCRATCH"
```

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "relay(cli): add the real 'relay detect' command"
```

---

## Task 6: `relay init` ships a default control-bands config

**Files:**
- Modify: `packages/cli/src/templates.ts`
- Modify: `packages/cli/src/commands/init.ts`
- Test: `packages/cli/test/init.test.ts` (extend existing)

Without this, the acceptance criterion ("forcing a band breach") has nothing to force a breach against out of the box — matching how `config.yml`/`roles.yml` are already scaffolded with real, usable defaults, not empty stubs.

- [ ] **Step 1: Write the failing test**

Read the current `packages/cli/test/init.test.ts` in full before editing. Add:
```ts
it('scaffolds a default Stage 6 control-bands config', () => {
  repo = makeScratchRepo();
  runInit(repo.dir);
  const bands = readFileSync(join(repo.dir, '.relay/policies/stage6-bands.yml'), 'utf8');
  expect(bands).toMatch(/gateLatencyS/);
  expect(bands).toMatch(/plan/);
});

it('adds detector-state.json to .gitignore', () => {
  repo = makeScratchRepo();
  runInit(repo.dir);
  const gitignore = readFileSync(join(repo.dir, '.gitignore'), 'utf8');
  expect(gitignore).toMatch(/\.relay\/detector-state\.json/);
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/init.test.ts`
Expected: FAIL — the file doesn't exist yet, `.gitignore` doesn't yet mention it.

- [ ] **Step 3: Implement**

Add to `packages/cli/src/templates.ts`, after `defaultRolesYaml`:
```ts
export function defaultStage6BandsYaml(): string {
  return stringify({
    gateLatencyS: {
      plan: { centerline: 3600, sigma: 1800 },
      design: { centerline: 7200, sigma: 3600 },
      build: { centerline: 14400, sigma: 7200 },
    },
  });
}
```
(One hour ± 30 minutes for `plan`, two hours ± one hour for `design`, four hours ± two hours for `build` — plausible starting points for a team that hasn't measured its own real cycle times yet, exactly the kind of default a team is expected to tune once they have real history, stated here rather than left unexplained.)

Read the current full `packages/cli/src/commands/init.ts` before editing. Modify `runInit`, after the existing `mkdirSync` loop and template-writing lines for `config.yml`/`roles.yml`, add:
```ts
  mkdirSync(join(relayDir, 'policies'), { recursive: true });
  writeFileSync(join(relayDir, 'policies/stage6-bands.yml'), defaultStage6BandsYaml());
```
and add `defaultStage6BandsYaml` to the existing `import { ... } from '../templates.js';` block.

Modify the existing `ensureGitignored(cwd, ['.relay/CURRENT', '.relay-legacy-tickets.json']);` call to:
```ts
  ensureGitignored(cwd, ['.relay/CURRENT', '.relay-legacy-tickets.json', '.relay/detector-state.json']);
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/cli/test/init.test.ts`
Expected: clean build, all pass.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/templates.ts packages/cli/src/commands/init.ts packages/cli/test/init.test.ts
git commit -m "relay(cli): relay init scaffolds a default Stage 6 control-bands config"
```

---

## Task 7: Wire the detector into `@relay/daemon`'s watcher

**Files:**
- Modify: `packages/daemon/src/server.ts`
- Test: manual, verified live (same reasoning as Phase 4's watcher wiring — real filesystem-event timing is not a unit-test concern).

This is what actually satisfies "no human in the invocation path" — the same watcher that already reacts to any `.relay/` change within roughly half a second (Phase 4's own measured acceptance run) now also runs the Stage 6 check on every tick, with a stub `draftFn`/`diagnoseFn` unless a real key is present.

- [ ] **Step 1: Implement**

Read the current full `packages/daemon/src/server.ts` before editing — this adds one call inside the existing `recompute()`, not a rewrite. Modify:
```ts
import { runGate, loadWorkItem, loadRelayConfig, listItemIds, findBreaches, runStage6Detect } from '@relay/cli/lib';
```
(adds `findBreaches, runStage6Detect` to the existing import line.)

Modify `recompute()`:
```ts
  function recompute() {
    const next = buildProjection(cwd);
    for (const event of diffProjections(lastProjection, next)) {
      registry.broadcast(event);
    }
    lastProjection = next;

    // Fire-and-forget: a breach here is genuinely a side effect (it may
    // write a new item to disk, which is itself a filesystem change this
    // same watcher will pick up on its own next tick and broadcast like
    // any other new item — no separate wiring needed for the incident to
    // reach the dashboard once it exists). Never let a Stage 6 failure
    // (e.g. no ANTHROPIC_API_KEY configured) crash the daemon's own watch
    // loop — this feature is opt-in (no .relay/policies/stage6-bands.yml
    // means findBreaches() returns [] immediately, no-op) and its own
    // errors must degrade the same way a missing .relay/config.yml does
    // everywhere else in this codebase: fail silently, never take down
    // ergonomics that have nothing to do with this feature.
    if (findBreaches(cwd).length > 0) {
      runStage6Detect(cwd).catch((err) => {
        console.error('[stage6] detection failed:', (err as Error).message);
      });
    }
  }
```

Note the double call to `findBreaches` (once as a cheap guard, once inside `runStage6Detect`) — deliberate, not an oversight: `findBreaches` is pure computation with no I/O beyond reading already-cached-by-the-OS small files, so calling it twice costs nothing measurable, and this way `runStage6Detect` (which does real work: state loading, potentially a network call) is only invoked when there is actually something to do, keeping the common case (a normal watcher tick with no gate anywhere near a control band) as cheap as it was before this task.

- [ ] **Step 2: Build and verify live against a forced breach**

```bash
npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon
SCRATCH=$(mktemp -d)
cd "$SCRATCH"
git init -q && git config user.email you@example.com && git config user.name You && git commit -q --allow-empty -m init
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js init
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js new "test"
node /Users/aj/Desktop/Claude/Projects/relay/packages/daemon/dist/index.js &
sleep 1
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js gate plan --approve
sleep 1
```
Expected: the daemon's own stderr shows `[stage6] detection failed: ANTHROPIC_API_KEY is not set...` — confirming the wiring actually fires on a real watcher tick (not just that the code compiles), and fails exactly the way Task 5 already established is correct for this unconfigured environment. **This is the honest, current state of live verification for this task — record the actual observed stderr line, not a description of what should appear.**

- [ ] **Step 3: Clean up**

```bash
kill %1 2>/dev/null
rm -rf "$SCRATCH"
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: everything green — this change adds a call inside an existing function; no existing daemon test exercises a real control-bands config, so none of them should be affected.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/server.ts
git commit -m "relay(daemon): wire the Stage 6 detector into the existing watcher tick"
```

---

## Task 8: `IncidentStrip` — real data, at last

**Files:**
- Modify: `packages/cli/src/commands/status.ts` (expose `origin`)
- Modify: `packages/dashboard/src/types.ts`
- Modify: `packages/dashboard/src/panels/IncidentStrip.tsx`
- Modify: `packages/dashboard/src/App.tsx`
- Test: `packages/cli/test/status.test.ts` (extend existing)
- Test: `packages/dashboard/test/panels/IncidentStrip.test.tsx` (extend existing)

- [ ] **Step 1: Write the failing tests**

Read the current `packages/cli/test/status.test.ts` in full before editing. Add:
```ts
it('exposes origin from the intent artifact, defaulting to authored', async () => {
  repo = makeScratchRepo();
  runInit(repo.dir);
  const { id } = await runNew('x', {}, repo.dir);
  expect(runStatus(repo.dir, id).origin).toBe('authored');
});
```

Replace `packages/dashboard/test/panels/IncidentStrip.test.tsx` in full:
```tsx
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { IncidentStrip } from '../../src/panels/IncidentStrip.js';
import type { ItemProjection } from '../../src/types.js';

describe('IncidentStrip', () => {
  it('renders a quiet empty state when nothing has origin stage6-detector', () => {
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'plan', blockedBy: [], origin: 'authored' }];
    render(<IncidentStrip items={items} />);
    expect(screen.getByLabelText('Incident strip')).toBeInTheDocument();
    expect(screen.getByText(/no incidents/i)).toBeInTheDocument();
  });

  it('lists only items whose origin is stage6-detector', () => {
    const items: ItemProjection[] = [
      { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: [], origin: 'authored' },
      { id: '002-y', lane: 'standard', stage: 'plan', blockedBy: [], origin: 'stage6-detector' },
    ];
    render(<IncidentStrip items={items} />);
    expect(screen.getByText('002-y')).toBeInTheDocument();
    expect(screen.queryByText('001-x')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/cli/test/status.test.ts packages/dashboard/test/panels/IncidentStrip.test.tsx`
Expected: FAIL — `origin` missing from `StatusResult`; `IncidentStrip` doesn't yet accept an `items` prop.

- [ ] **Step 3: Implement**

Read the current full `packages/cli/src/commands/status.ts` before editing. Modify:
```ts
export interface StatusResult {
  id: string;
  lane: string;
  stage: Stage;
  blockedBy: string[];
  origin: 'authored' | 'adopted' | 'stage6-detector';
}
```
and in `runStatus`, before the final `return`, add:
```ts
  const origin = item.artifacts.intent?.origin ?? 'authored';
```
then add `origin` to the returned object: `return { id, lane: item.lane, stage, blockedBy, origin };`.

(This mirrors exactly how `lane` is already derived from the earliest-stage artifact a few lines above in `loadWorkItem` — `origin` only ever lives on `intent.md`, since that's the one artifact Stage 6/`relay adopt` actually write from scratch, so reading it off `item.artifacts.intent` specifically, not `spec`/`plan`, is correct, not an oversight.)

Modify `packages/dashboard/src/types.ts`, add `origin` to `ItemProjection`:
```ts
export interface ItemProjection {
  id: string;
  lane: string;
  stage: Stage;
  blockedBy: string[];
  origin: 'authored' | 'adopted' | 'stage6-detector';
}
```

Replace `packages/dashboard/src/panels/IncidentStrip.tsx` in full:
```tsx
import type { ItemProjection } from '../types.js';

export function IncidentStrip({ items }: { items: ItemProjection[] }) {
  const incidents = items.filter((item) => item.origin === 'stage6-detector');

  if (incidents.length === 0) {
    return (
      <section aria-label="Incident strip">
        <p>No incidents.</p>
      </section>
    );
  }

  return (
    <section aria-label="Incident strip">
      {incidents.map((item) => (
        <div key={item.id}>{item.id}</div>
      ))}
    </section>
  );
}
```

Modify `packages/dashboard/src/App.tsx`, the one line rendering `<IncidentStrip />`:
```tsx
      <IncidentStrip items={feed.items} />
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx tsc --noEmit -p packages/dashboard/tsconfig.json && npx vitest run packages/cli/test/status.test.ts packages/dashboard/test/panels/IncidentStrip.test.tsx packages/dashboard/test/App.test.tsx`
Expected: clean build, clean type-check, all pass. `App.test.tsx` needs its mocked `/api/items` fixture item to carry an `origin` field now — read that test file's current fixture object and add `origin: 'authored'` to it if `ItemProjection`'s widened shape makes the existing fixture fail to type-check or fail a runtime assertion; verify by actually running it rather than assuming the existing fixture still satisfies the type.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/status.ts packages/cli/test/status.test.ts packages/dashboard/src/types.ts packages/dashboard/src/panels/IncidentStrip.tsx packages/dashboard/src/App.tsx packages/dashboard/test/panels/IncidentStrip.test.tsx
git commit -m "relay(cli,dashboard): IncidentStrip renders real Stage 6 items"
```

---

## Task 9: Live acceptance demonstration, `PROJECT.md`, final commit

**Files:**
- Modify: `Projects/relay/PROJECT.md`

**Honesty boundary, stated up front, same pattern as every prior phase's final task:** no `ANTHROPIC_API_KEY` is configured in this environment. This task demonstrates the full deterministic pipeline — a forced breach detected by the real daemon, the real intent writer invoked with a stubbed model response producing a real, lint-clean `intent.md` with `origin: stage6-detector`, and the card appearing in the dashboard's Incident Strip live — using a stub in place of the one genuinely untestable piece (an actual network call to Anthropic). Live verification against the real API remains open until a real key is supplied, exactly as Task 5 and Task 7 already found and recorded honestly rather than worked around.

- [x] **Step 1: Full monorepo build and test**

```bash
npm run build && npm run build:dashboard && npx vitest run
```
Expected: clean across the board, zero `.only`/`.skip`.

- [x] **Step 2: Set up a real scratch repo, force a 3-sigma breach, start the real daemon and dashboard**

```bash
lsof -i :5182 || echo "port 5182 free"
lsof -i :5173 || echo "port 5173 free"
SCRATCH=$(mktemp -d)
cd "$SCRATCH"
git init -q && git config user.email you@example.com && git config user.name You && git commit -q --allow-empty -m init
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js init
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js new "checkout timeout"
```
Force a real 3-sigma breach the same way `packages/cli/test/detect.test.ts` does — via `relay_request_gate`'s event shape, written directly (there is no CLI command for writing a past-dated event; use the same `appendEvent`-via-script pattern this project has used for every prior acceptance run's fixture setup):
```bash
node --input-type=module -e "
import { appendEvent } from '/Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/relay-dir.js';
const requestedAt = new Date(Date.now() - 3600_000).toISOString();
appendEvent('001-checkout-timeout', { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, '$SCRATCH');
"
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js gate plan --approve
```

**Since the daemon's own wired-in `runStage6Detect` (Task 7) always calls the REAL `draftWithClaude` with no way to inject a stub from outside the process**, this step's live demonstration of the *drafting* half needs a small, temporary, uncommitted patch to prove the deterministic detection → intent-writing path end-to-end without a real key: temporarily edit the built `packages/daemon/dist/server.js` (not the source — this is a throwaway verification, exactly like Phase 3's Task 6 hand-verified the WS route before any test existed for it) to call `runStage6Detect(cwd, { draftFn: async () => ({ title: 'checkout gate is slow', problem: 'p', proposedOutcome: 'o', affectedUsersAndSystems: 'a', constraints: 'c', openQuestions: 'q' }) })` instead of the zero-argument call, confirm the behavior, then restore the real built file (rerun `npm run build` to regenerate it cleanly) before moving on — do not leave the source or the dist output patched.

```bash
node /Users/aj/Desktop/Claude/Projects/relay/packages/daemon/dist/index.js &
cd /Users/aj/Desktop/Claude/Projects/relay && npm run dev --workspace=@relay/dashboard &
sleep 2
```

- [x] **Step 3: Trigger the breach and observe**

```bash
cd "$SCRATCH"
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js gate plan --approve
sleep 1
curl -s http://localhost:5182/api/items
```
Expected: a new item appears alongside `001-checkout-timeout`, with `stage: "plan"` and derived from `origin: stage6-detector` — confirm by reading its `intent.md` directly:
```bash
cat "$SCRATCH"/.relay/work/*/intent.md
```

- [x] **Step 4: Confirm the dashboard's Incident Strip shows it live**

Use `mcp__Claude_Browser__navigate` to `http://localhost:5173`, then `read_page`: the new item's id should appear under "Incident strip", not just under "Pipeline lanes" — confirming `origin` correctly threaded all the way from the written frontmatter through `runStatus` through the daemon's `GET /api/items` through `useRelayFeed` to `IncidentStrip`'s own filter.

- [x] **Step 5: Confirm `relay lint` accepts the auto-written intent.md**

```bash
cd "$SCRATCH"
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js lint $(ls .relay/work | grep -v checkout-timeout)
```
Expected: `lint clean` — the acceptance criterion's own words are "a lint-clean intent.md," not merely "a file exists," so this check is not optional.

- [x] **Step 6: Record the result, restore the daemon's real build, clean up**

```bash
kill %1 %2 2>/dev/null
rm -rf "$SCRATCH"
cd /Users/aj/Desktop/Claude/Projects/relay && npm run build
```
Confirm via `git status` that nothing under `packages/daemon/dist/` or any source file is left in the temporarily-patched state from Step 2 — `dist/` is gitignored, so this is a sanity check on your own working state, not something `git status` would catch on its own.

- [x] **Step 7: `PROJECT.md` — Features, Gotchas, Next steps, Changelog**

Mark the Stage 6 trigger slice `[x]` in the Features list with the verified test count from Step 1, and state plainly: deterministic detection and the full write path verified live end-to-end with a stubbed model response; genuine live-API verification remains open pending a real `ANTHROPIC_API_KEY`. Add a Gotcha for `.relay/detector-state.json` being the one genuinely-persisted, gitignored, safe-to-lose piece of state in the whole system (mirroring the "no session state, ever" Gotcha's own reasoning, stating explicitly why this one file is the deliberate exception). Add a Gotcha for the control-band config format (centerline + sigma, not six raw boundary numbers) and where defaults come from. Replace the "Next steps" pointer.

- [x] **Step 8: Commit**

```bash
git add Projects/relay/PROJECT.md
git commit -m "$(cat <<'EOF'
relay: PROJECT.md — Phase 5b (Stage 6 trigger slice) verified

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage** — the deterministic detector (Tasks 1, 3), the intent writer via the Anthropic SDK (Task 4), the incident strip binding (Task 8), and the "no human in the invocation path" requirement (Task 7, via the existing watcher rather than a new poll loop) each have their own task. The three Western Electric tiers (1σ log / 2σ diagnose-read-only / 3σ act) are each independently tested and each mutation-tested against the other two tiers' behavior (Task 4, Step 5) so "read-only really means read-only" isn't just asserted by a docstring.

**Placeholder scan** — no `TBD`/`TODO`/"add appropriate error handling." The one thing stated as genuinely unverified rather than solved: real live-API confirmation, blocked purely on this environment having no `ANTHROPIC_API_KEY` — confirmed with the user directly before this plan was written, not assumed.

**Type consistency** — `Finding`, `BreachIntentDraft`, `ControlBand`/`ControlBandsConfig`, and the widened `origin` union are each declared once and reused everywhere they appear (core → cli → daemon → dashboard), the same discipline every prior phase's self-review already checked for.

**Scope discipline** — a rolling/windowed average (vs. this plan's simple all-time mean) and multi-metric detectors beyond gate latency are both real, named future work, not silently implied as done. Both were live design choices, made with the user directly, not defaults quietly assumed.
