# Phase 3 — `@relay/mcp` and `@relay/adapters/claude-code` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@relay/mcp` — the universal integration surface exposing five tools any MCP-capable coding tool can call — and `@relay/adapters/claude-code`, the first per-tool enhancement (a `PreToolUse` hook that blocks source edits before the build gate, a `SessionStart` hook that injects the resume briefing, and three stage-interview skills), then wire `relay init` to install the adapter when Claude Code is detected.

**Architecture:** `@relay/mcp` is a thin MCP server (stdio transport) that calls straight into `@relay/cli`'s already-built, already-tested command functions (`runStatus`, `runResume`, `runHandover`) plus one new primitive (`appendEvent`, for `relay_request_gate`'s "I believe this is ready" signal, which is explicitly never an approval). `@relay/adapters/claude-code` is a second thin layer: its hook scripts are plain Node scripts that call the same `@relay/cli`/`@relay/core` functions, tested by spawning them as real subprocesses with crafted stdin and asserting real exit codes/stdout/stderr — no mocking of the hook contract itself. Both packages are transports, exactly like `@relay/cli`: no gate logic lives in either.

**Tech Stack:** `@modelcontextprotocol/sdk` 1.30.0 (`McpServer` + `StdioServerTransport`, confirmed installed and inspected — `registerTool(name, {title?, description?, inputSchema?}, cb)` is the current non-deprecated API), zod (peer dep of the SDK; the workspace's already-installed zod 3.25.76 satisfies both `^3.23.0` and the SDK's `^3.25 || ^4.0` — no version bump needed, checked directly). Claude Code hooks and skills mechanics below are independently verified (not assumed) against Claude Code's own current documentation and this workspace's own working `.claude/skills/*` and `.mcp.json` files.

---

## Verified facts this plan depends on (read before writing code against them)

**`.mcp.json`** — confirmed by reading this workspace's own file at `/Users/aj/Desktop/Claude/.mcp.json`:
```json
{ "mcpServers": { "<name>": { "command": "node", "args": ["/absolute/path/to/server.js"] } } }
```

**`PreToolUse` hook**, registered in `.claude/settings.json`:
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "node /absolute/path/to/pre-tool-use.js" } ] } ] } }
```
Stdin JSON includes (at minimum) `cwd`, `hook_event_name`, `tool_name` (`"Edit"` or `"Write"`), and `tool_input.file_path`. **Blocking mechanism used in this plan: exit code 2 with the reason on stderr** — the simplest, most-documented, most version-stable mechanism (a JSON `hookSpecificOutput.permissionDecision` form also exists but is newer and not needed here). Exit 0 (with nothing on stdout) allows the call.

**`SessionStart` hook**, registered the same way under `"SessionStart"`. **Plain text written to stdout is added to the new session's context.** No JSON wrapper is required for this plan's use case.

**Skills**: a project-scoped skill lives at `.claude/skills/<name>/SKILL.md` with `name`/`description` frontmatter — confirmed against this workspace's own already-working `.claude/skills/panel-app/SKILL.md` etc. No plugin packaging needed for a per-project skill.

**Failure-mode honesty, per this workspace's own gotcha**: if the hook command errors, times out, or Claude Code fails open on it, that is *exactly* why "local hooks are ergonomics, CI is the enforcement" — this plan's `PROJECT.md` update (Task 14) must say this plainly, not imply the hook is a guarantee.

---

## File structure

```
packages/mcp/
  package.json, tsconfig.json                    Task 1
  src/
    tools/current-item.ts                        Task 3 — relay_current_item logic
    tools/gate-status.ts                          Task 4 — relay_gate_status logic
    tools/resume.ts                               Task 5 — relay_resume logic
    tools/request-gate.ts                         Task 6 — relay_request_gate logic
    tools/handover.ts                             Task 7 — relay_handover logic
    index.ts                                      Task 8 — McpServer wiring, bin entry
  test/tools/*.test.ts                            one per tool, Tasks 3-7

packages/adapters/claude-code/
  package.json, tsconfig.json                     Task 9
  src/
    hooks/pre-tool-use.ts                         Task 10
    hooks/session-start.ts                        Task 11
    skills.ts                                     Task 12 — the three SKILL.md bodies as exported strings
    install.ts                                    Task 13 — writes hooks/skills/.mcp.json into a target repo
  test/
    hooks/pre-tool-use.test.ts                    Task 10 — spawns the built script as a real subprocess
    hooks/session-start.test.ts                   Task 11 — spawns the built script as a real subprocess
    install.test.ts                               Task 13

packages/cli/src/relay-dir.ts                     Task 2 — modify: add appendEvent
packages/cli/src/commands/init.ts                 Task 13 — modify: call the adapter's install() when detected
```

`packages/mcp` and `packages/adapters/claude-code` both take `@relay/core` and `@relay/cli` as workspace dependencies (`"@relay/cli": "0.1.0"` in `package.json`, matching the existing `"@relay/core": "0.1.0"` pattern) — neither reimplements anything `@relay/cli` already has tested.

---

## Task 1: Scaffold `@relay/mcp`

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/index.ts` (placeholder, overwritten for real in Task 8)

No test — scaffolding, verified by the build.

- [ ] **Step 1: Create `packages/mcp/package.json`**

```json
{
  "name": "@relay/mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": { "relay-mcp": "./dist/index.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "@relay/core": "0.1.0",
    "@relay/cli": "0.1.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `packages/mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../core" }, { "path": "../cli" }]
}
```

- [ ] **Step 3: Install and confirm the (still-empty) package builds**

```bash
mkdir -p packages/mcp/src && echo 'export {};' > packages/mcp/src/index.ts
npm install
```
Modify `package.json`'s root `"build"` script from `"tsc -b packages/core packages/cli"` to `"tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code"` (the second path doesn't exist yet — Task 9 creates it; this line is correct once both exist, and `tsc -b` on a not-yet-existing project reference will fail, so **do this edit as part of Task 9, not here** — for now, use `"tsc -b packages/core packages/cli packages/mcp"`).

Run: `npx tsc -b packages/core packages/cli packages/mcp`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/package.json packages/mcp/tsconfig.json packages/mcp/src/index.ts package.json package-lock.json
git commit -m "relay(mcp): scaffold @relay/mcp package"
```

---

## Task 2: `relay-dir.ts` — add `appendEvent`

**Files:**
- Modify: `packages/cli/src/relay-dir.ts`
- Test: `packages/cli/test/relay-dir.test.ts`

SPEC §5's file map names `.relay/work/<item-id>/events.jsonl` as "local session event log" — nothing in Phase 1/2 writes it. `relay_request_gate` (Task 6) is its first real writer: an agent's "I believe this gate is ready" is a durable, auditable event, but it is explicitly **not** an approval (SPEC's own words: conflating the two "destroys the audit trail") — it belongs in a separate log, not `approvals.jsonl`.

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/test/relay-dir.test.ts`, after the existing `appendApproval` describe block:

```ts
describe('appendEvent', () => {
  it('appends a JSONL record to events.jsonl', () => {
    repo = makeScratchRepo();
    writeArtifact('001-x', 'intent', 'i', repo.dir);
    appendEvent('001-x', { ts: '2026-09-13T10:00:00Z', type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    appendEvent('001-x', { ts: '2026-09-13T11:00:00Z', type: 'gate_requested', gate: 'design', identity: 'eng@example.com' }, repo.dir);

    const raw = readFileSync(join(itemDir('001-x', repo.dir), 'events.jsonl'), 'utf8');
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].gate).toBe('plan');
    expect(lines[1].gate).toBe('design');
  });
});
```

Add `readFileSync` to the test file's existing `import { ... } from 'node:fs'` line if not already imported, and add `appendEvent` to the existing `import { writeArtifact, loadWorkItem, appendApproval, listItemIds } from '../src/relay-dir.js';` line.

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/cli/test/relay-dir.test.ts`
Expected: FAIL — `appendEvent is not a function`.

- [ ] **Step 3: Implement**

Add to `packages/cli/src/relay-dir.ts`, after `appendApproval`:

```ts
export interface RelayEvent {
  ts: string;
  type: string;
  gate?: string;
  identity?: string;
  [key: string]: unknown;
}

export function appendEvent(id: string, event: RelayEvent, cwd: string): void {
  const dir = itemDir(id, cwd);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/cli/test/relay-dir.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/relay-dir.ts packages/cli/test/relay-dir.test.ts
git commit -m "relay(cli): add appendEvent — events.jsonl, distinct from the approval ledger"
```

---

## Task 3: `relay_current_item` tool logic

**Files:**
- Create: `packages/mcp/src/tools/current-item.ts`
- Test: `packages/mcp/test/tools/current-item.test.ts`

Returns item id, lane, derived stage — a direct, narrower read of what `runStatus` already computes.

- [ ] **Step 1: Write the failing tests**

Create `packages/mcp/test/tools/current-item.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli';
import { currentItem } from '../../src/tools/current-item.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-mcp-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('currentItem', () => {
  it('reports id, lane and stage for the checked-out item', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const result = currentItem(repo.dir);
    expect(result.id).toBe(id);
    expect(result.lane).toBe('standard');
    expect(result.stage).toBe('plan');
  });

  it('throws an actionable error when there is no current item', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(() => currentItem(repo.dir)).toThrow(/relay use/);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/mcp/test/tools/current-item.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/current-item.js'`, and also check whether `@relay/cli` currently exports `runInit`/`runNew`/`runStatus`/`runResume`/`runHandover` from its own `index.ts` at all (it does not — `packages/cli/src/index.ts` is the commander bin entry, not a library surface). **This is a required additional step**, folded into Step 3 below.

- [ ] **Step 3: Implement — first, give `@relay/cli` a library surface**

`@relay/cli`'s `package.json` currently has `"main": "./dist/index.js"` pointing at the commander bin entry (which calls `program.parseAsync(process.argv)` at module load — importing it as a library would try to parse `@relay/mcp`'s own argv, which is wrong). Add a second entry point that re-exports just the command functions, with no side effects on import:

Create `packages/cli/src/lib.ts`:
```ts
export { runInit, type InitResult } from './commands/init.js';
export { runNew, type NewOptions, type NewResult } from './commands/new.js';
export { runUse } from './commands/use.js';
export { runStatus, type StatusResult } from './commands/status.js';
export { runLint, type LintReport } from './commands/lint.js';
export { runGate, type GateAction } from './commands/gate.js';
export { runHandover, type HandoverTarget } from './commands/handover.js';
export { runResume, type ResumeBrief } from './commands/resume.js';
export { runVerify, type VerifyOptions, type VerifyReport } from './commands/verify.js';
export { resolveCurrentItemId } from './current-item.js';
export { loadRelayConfig, buildApprovalContext } from './context.js';
export { loadWorkItem, appendEvent, itemDir } from './relay-dir.js';
```

Modify `packages/cli/package.json` to add an `exports` map alongside the existing `main`/`bin` (do not remove `main` — `bin` must keep resolving to the commander entry):
```json
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "relay": "./dist/index.js" },
  "exports": {
    ".": "./dist/index.js",
    "./lib": "./dist/lib.js"
  },
```

Then `@relay/mcp` and `@relay/adapters/claude-code` import from `@relay/cli/lib`, never from `@relay/cli` bare (which would execute the commander parse).

Create `packages/mcp/src/tools/current-item.ts`:
```ts
import { runStatus } from '@relay/cli/lib';

export interface CurrentItemResult {
  id: string;
  lane: string;
  stage: string;
}

export function currentItem(cwd: string): CurrentItemResult {
  const status = runStatus(cwd);
  return { id: status.id, lane: status.lane, stage: status.stage };
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp && npx vitest run packages/mcp/test/tools/current-item.test.ts`
Expected: clean build, both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib.ts packages/cli/package.json packages/mcp/src/tools/current-item.ts packages/mcp/test/tools/current-item.test.ts
git commit -m "relay(cli,mcp): add @relay/cli's lib surface; relay_current_item logic"
```

---

## Task 4: `relay_gate_status` tool logic

**Files:**
- Create: `packages/mcp/src/tools/gate-status.ts`
- Test: `packages/mcp/test/tools/gate-status.test.ts`

"Which gate blocks, why, who can clear it." The first two come straight from `runStatus`. "Who can clear it" needs inverting `roles.yml` (identity → roles) against the blocking gate's required roles (`lane.gateRoles[gate]`) — nothing in `@relay/core`/`@relay/cli` does this inversion today because nothing else has needed it; it is narrow enough to keep local to this tool rather than added to a shared surface (YAGNI — a second caller can promote it later).

- [ ] **Step 1: Write the failing tests**

Create `packages/mcp/test/tools/gate-status.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli';
import { gateStatus } from '../../src/tools/gate-status.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-mcp-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('gateStatus', () => {
  it('reports the blocking gate, reasons, and which identities can clear it', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeFileSync(join(repo.dir, '.relay/roles.yml'), 'po@example.com: [product-owner]\nlead@example.com: [product-owner, tech-lead]\n');
    const { id } = await runNew('test', {}, repo.dir);

    const result = gateStatus(repo.dir, id);
    expect(result.gate).toBe('plan');
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.canClear.sort()).toEqual(['lead@example.com', 'po@example.com']);
  });

  it('reports no blocking gate once the item is done', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('x', { lane: 'express' }, repo.dir);
    const planPath = join(repo.dir, `.relay/work/${id}/plan.md`);
    writeFileSync(planPath, require('node:fs').readFileSync(planPath, 'utf8')
      .replace('## Files that change\n\n', '## Files that change\n\n`a.ts`\n\n')
      .replace('## Work order\n\n', '## Work order\n\n1.\n\n')
      .replace('## Tests that prove completion\n', '## Tests that prove completion\n`a.test.ts`\n'));
    const { runGate } = await import('@relay/cli');
    await runGate(id, 'build', 'approve', undefined, repo.dir);

    const result = gateStatus(repo.dir, id);
    expect(result.gate).toBeNull();
    expect(result.reasons).toEqual([]);
    expect(result.canClear).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/mcp/test/tools/gate-status.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/mcp/src/tools/gate-status.ts`:

```ts
import { runStatus, loadRelayConfig, buildApprovalContext, loadWorkItem } from '@relay/cli/lib';

export interface GateStatusResult {
  gate: string | null;
  reasons: string[];
  canClear: string[];
}

export function gateStatus(cwd: string, idOverride?: string): GateStatusResult {
  const status = runStatus(cwd, idOverride);
  if (status.blockedBy.length === 0) {
    return { gate: null, reasons: [], canClear: [] };
  }

  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(status.id, config.defaultLane, cwd);
  const ctx = buildApprovalContext(cwd, config.lanes[item.lane]);
  const requiredRoles = ctx.lane.gateRoles[status.stage] ?? [];

  const canClear = requiredRoles.length === 0
    ? Object.keys(ctx.roles)
    : Object.entries(ctx.roles)
        .filter(([, roles]) => roles.some((r) => requiredRoles.includes(r)))
        .map(([identity]) => identity);

  return { gate: status.stage, reasons: status.blockedBy, canClear };
}
```

Note: when `requiredRoles` is empty (the express lane's `gateRoles: {}`), "who can clear it" is everyone with any recorded role — express explicitly has no role requirement, so this is accurate, not a bug.

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/mcp/test/tools/gate-status.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/gate-status.ts packages/mcp/test/tools/gate-status.test.ts
git commit -m "relay(mcp): add relay_gate_status logic — blocking gate, reasons, who can clear it"
```

---

## Task 5: `relay_resume` tool logic

**Files:**
- Create: `packages/mcp/src/tools/resume.ts`
- Test: `packages/mcp/test/tools/resume.test.ts`

"The resume briefing as text" — a direct, thin wrapper. `runResume` already returns a structured `ResumeBrief`; this tool renders it to the same plain-text shape `relay resume`'s CLI output already uses, so a human reading `relay resume` and an agent reading `relay_resume` see identically-shaped information.

- [ ] **Step 1: Write the failing test**

Create `packages/mcp/test/tools/resume.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli';
import { resumeText } from '../../src/tools/resume.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-mcp-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('resumeText', () => {
  it('renders the resume briefing as readable text naming the id and stage', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const text = resumeText(repo.dir, id);
    expect(text).toContain(id);
    expect(text).toContain('stage: plan');
    expect(text).toContain('Next:');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run packages/mcp/test/tools/resume.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/mcp/src/tools/resume.ts`:

```ts
import { runResume } from '@relay/cli/lib';

export function resumeText(cwd: string, idOverride?: string): string {
  const brief = runResume(cwd, idOverride);
  const lines = [`${brief.id} — stage: ${brief.stage}`];
  if (brief.blockedBy.length > 0) {
    lines.push('Blocked by:');
    for (const reason of brief.blockedBy) lines.push(`  - ${reason}`);
  }
  lines.push(`Open questions: ${brief.openQuestions}`);
  lines.push('Recent history:');
  for (const h of brief.recentHistory) lines.push(`  - ${h}`);
  lines.push(`Next: ${brief.next}`);
  return lines.join('\n');
}
```

This is the same rendering `packages/cli/src/index.ts`'s `resume` command already does — deliberately duplicated as plain formatting logic (not extracted into a shared function) because it is presentation, not a judgment call; if the CLI's rendering ever changes, this tool is free to keep its own text shape for MCP clients, which is a different audience (an agent reading text, not a terminal).

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run packages/mcp/test/tools/resume.test.ts`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/resume.ts packages/mcp/test/tools/resume.test.ts
git commit -m "relay(mcp): add relay_resume logic"
```

---

## Task 6: `relay_request_gate` tool logic

**Files:**
- Create: `packages/mcp/src/tools/request-gate.ts`
- Test: `packages/mcp/test/tools/request-gate.test.ts`

**The one rule that matters most in this whole phase**: this must never write to `approvals.jsonl`. It writes to `events.jsonl` (Task 2) instead — a signal, not a signature.

- [ ] **Step 1: Write the failing tests**

Create `packages/mcp/test/tools/request-gate.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew, itemDir } from '@relay/cli';
import { requestGate } from '../../src/tools/request-gate.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-mcp-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('requestGate', () => {
  it('appends an event, never an approval', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const result = requestGate(repo.dir, id);
    expect(result.recorded).toBe(true);

    const dir = itemDir(id, repo.dir);
    const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('gate_requested');
    expect(events[0].gate).toBe('plan');
    expect(events[0].identity).toBe('eng@example.com');

    expect(() => readFileSync(join(dir, 'approvals.jsonl'), 'utf8')).toThrow();
  });

  it('does not change the derived stage — it is a request, not an approval', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    requestGate(repo.dir, id);

    const { runStatus } = await import('@relay/cli');
    expect(runStatus(repo.dir, id).stage).toBe('plan');
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/mcp/test/tools/request-gate.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/mcp/src/tools/request-gate.ts`:

```ts
import { runStatus, appendEvent, buildApprovalContext, loadRelayConfig, loadWorkItem } from '@relay/cli/lib';

export interface RequestGateResult {
  recorded: boolean;
  gate: string;
}

export function requestGate(cwd: string, idOverride?: string): RequestGateResult {
  const status = runStatus(cwd, idOverride);
  const config = loadRelayConfig(cwd);
  const item = loadWorkItem(status.id, config.defaultLane, cwd);
  const ctx = buildApprovalContext(cwd, config.lanes[item.lane]);

  appendEvent(status.id, {
    ts: new Date().toISOString(),
    type: 'gate_requested',
    gate: status.stage,
    identity: ctx.author,
  }, cwd);

  return { recorded: true, gate: status.stage };
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/mcp/test/tools/request-gate.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/request-gate.ts packages/mcp/test/tools/request-gate.test.ts
git commit -m "relay(mcp): add relay_request_gate — records a request, never an approval"
```

---

## Task 7: `relay_handover` tool logic

**Files:**
- Create: `packages/mcp/src/tools/handover.ts`
- Test: `packages/mcp/test/tools/handover.test.ts`

"The bundle for the current stage." `runHandover` needs an explicit `HandoverTarget` (`'design' | 'build'`) — this tool derives it from the current derived stage, since `relay_handover` (unlike the CLI's `relay handover --to <stage>`) is meant to be called with no argument at all: an agent asking "give me the handover for wherever I am" shouldn't have to already know the stage name.

- [ ] **Step 1: Write the failing tests**

Create `packages/mcp/test/tools/handover.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli';
import { handoverForCurrentStage } from '../../src/tools/handover.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-mcp-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('handoverForCurrentStage', () => {
  it('returns the bundle text for a stage handover models (design)', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    const path = join(repo.dir, `.relay/work/${id}/intent.md`);
    require('node:fs').writeFileSync(path, readFileSync(path, 'utf8').replace('## Problem\n\n', '## Problem\n\np\n\n'));
    writeFileSync_ROLES(repo.dir);
    const { runGate } = await import('@relay/cli');
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const text = handoverForCurrentStage(repo.dir, id);
    expect(text).toContain('Frozen upstream artifact');
    expect(text).toContain('spec.md');
  });

  it('throws a clear error at a stage with no modelled handover target', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    expect(() => handoverForCurrentStage(repo.dir, id)).toThrow(/no handover bundle/i);
  });
});

function writeFileSync_ROLES(dir: string) {
  require('node:fs').writeFileSync(join(dir, '.relay/roles.yml'), 'eng@example.com: [product-owner]\n');
}
```

Note: the first test needs `intent.md` fully filled in (all 5 sections) for the `plan` gate approval to succeed via `evaluateGate`'s completeness check inside `runGate` — but `runGate` (Task 19 of Phase 2) does **not** itself call `evaluateGate`; it only writes the approval record unconditionally. Re-check `packages/cli/src/commands/gate.ts`'s actual current behavior before assuming — if it turns out `runGate` writes regardless of completeness (which is correct per Phase 2: "it never decides whether the gate *passes*"), then only the frontmatter/upstream chain matters for `handoverForCurrentStage` to find `intent.md` as the current stage's upstream artifact, and the test above's partial fill is sufficient. Verify by running the test as written first.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/mcp/test/tools/handover.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/mcp/src/tools/handover.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runStatus, itemDir } from '@relay/cli/lib';
import { runHandover, type HandoverTarget } from '@relay/cli/lib';

const STAGE_TO_TARGET: Partial<Record<string, HandoverTarget>> = {
  design: 'design',
  build: 'build',
};

export function handoverForCurrentStage(cwd: string, idOverride?: string): string {
  const status = runStatus(cwd, idOverride);
  const target = STAGE_TO_TARGET[status.stage];
  if (!target) {
    throw new Error(`No handover bundle is defined for stage: ${status.stage}`);
  }

  const path = runHandover(status.id, target, cwd);
  return readFileSync(path, 'utf8');
}
```

Note this reuses `runHandover`'s own `TARGETS` lookup indirectly (via `STAGE_TO_TARGET` here, which mirrors it) rather than exporting `HandoverTarget`'s internal map — `HandoverTarget` the type is already exported from `packages/cli/src/commands/handover.ts`; this small duplication of "design/build are the only two real targets" is the same fact expressed twice (once as a type, once as a lookup), not a maintenance risk, since both are two-line files that would need a matching edit for the same reason (v1 scope expanding past design/build) at the same time.

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/mcp/test/tools/handover.test.ts`
Expected: all pass. If the first test's completeness assumption from Step 1's note turns out wrong, adjust the fixture (fill in all 5 intent sections via the same `fillIntent`-style replacements used throughout `packages/cli/test/*.test.ts`) rather than changing `handoverForCurrentStage`'s logic.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/handover.ts packages/mcp/test/tools/handover.test.ts
git commit -m "relay(mcp): add relay_handover — bundle for whichever stage the item is at"
```

---

## Task 8: MCP server wiring — the real `relay-mcp` bin entry

**Files:**
- Modify: `packages/mcp/src/index.ts` (replaces the `export {};` placeholder)
- No new test file — verification is starting the server and exercising it with the MCP SDK's own client in-process (Step 3).

- [ ] **Step 1: Implement**

Replace the full contents of `packages/mcp/src/index.ts`:

```ts
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { currentItem } from './tools/current-item.js';
import { gateStatus } from './tools/gate-status.js';
import { resumeText } from './tools/resume.js';
import { requestGate } from './tools/request-gate.js';
import { handoverForCurrentStage } from './tools/handover.js';

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

function errorText(err: unknown) {
  return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
}

const server = new McpServer({ name: 'relay', version: '0.1.0' });

server.registerTool(
  'relay_current_item',
  { description: 'Item id, lane, and derived stage for the item on the current branch (or .relay/CURRENT).' },
  async () => {
    try {
      return text(JSON.stringify(currentItem(process.cwd())));
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  'relay_gate_status',
  { description: 'Which gate blocks the current item, why, and which identities can clear it.' },
  async () => {
    try {
      return text(JSON.stringify(gateStatus(process.cwd())));
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  'relay_resume',
  { description: 'The resume briefing for the current item, as text: stage, blockers, open questions, recent history, next step.' },
  async () => {
    try {
      return text(resumeText(process.cwd()));
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  'relay_request_gate',
  { description: "Records that the agent believes the current item's gate is ready for review. Does NOT approve it — only a human (or relay gate --approve) can do that." },
  async () => {
    try {
      return text(JSON.stringify(requestGate(process.cwd())));
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  'relay_handover',
  { description: 'The five-part handover bundle for whichever stage the current item is at.' },
  async () => {
    try {
      return text(handoverForCurrentStage(process.cwd()));
    } catch (err) {
      return errorText(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

`z` is imported but unused in this file as written — every tool here takes no arguments (all five read "the current item," resolved server-side via `resolveCurrentItemId`, never a client-supplied id). Remove the unused `z` import once you confirm no tool needs an `inputSchema` — if a later phase adds a tool taking arguments, that is when `z` earns its place here, not before.

- [ ] **Step 2: Build**

```bash
npx tsc -b packages/core packages/cli packages/mcp
```
Expected: exits 0 (after removing the unused `z` import per Step 1's note, if `noUnusedLocals`-style strictness in `tsconfig.base.json` flags it — check `tsconfig.base.json`'s `strict` setting; if it doesn't specifically enable `noUnusedLocals`, an unused import won't fail the build but should still be removed for cleanliness).

- [ ] **Step 3: Verify the server actually speaks MCP — a real client, not just a build**

Create a throwaway verification script (not committed — delete after use) at `/tmp/relay-mcp-verify.mjs`:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/aj/Desktop/Claude/Projects/relay/packages/mcp/dist/index.js'],
});
const client = new Client({ name: 'relay-mcp-verify', version: '0.0.1' });
await client.connect(transport);

const tools = await client.listTools();
console.log('Tools:', tools.tools.map((t) => t.name));

const result = await client.callTool({ name: 'relay_current_item', arguments: {} });
console.log('relay_current_item on a repo with no item:', JSON.stringify(result));

await client.close();
```

Run it from a scratch repo with no `.relay/` at all (`cd /tmp && mkdir relay-mcp-verify-repo && cd relay-mcp-verify-repo && git init -q && git commit -q --allow-empty -m init && node /tmp/relay-mcp-verify.mjs`).

Expected: `Tools:` lists all five names exactly (`relay_current_item`, `relay_gate_status`, `relay_resume`, `relay_request_gate`, `relay_handover`); the `relay_current_item` call returns an error-shaped result (since there's no `.relay/config.yml` yet) rather than crashing the server process — confirming the `try/catch` → `errorText` path works over the real protocol, not just in a unit test that calls the bare function.

Delete `/tmp/relay-mcp-verify.mjs` and the scratch repo when done. Record the actual tool names and the actual error message observed in the session notes — this is exactly the kind of claim ("the server speaks MCP correctly") this plan's own precedent (Phase 2's Task 25) says must be demonstrated, not asserted.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/index.ts
git commit -m "relay(mcp): wire the real relay-mcp server — all five tools reachable over stdio"
```

---

## Flagged discrepancy, resolved below (same pattern as Phase 2's plan header)

`docs/IMPLEMENTATION_PLAN.md`'s Phase 3 acceptance text reads: *"asking the agent to edit a source file **before the plan gate** is refused by the hook ... after `relay gate build --approve`, the same edit succeeds."* "Before the plan gate" and "after the **build** gate is approved" name two different gates for what should be one condition. Tracing `deriveStage`'s actual semantics (Phase 1/2, unchanged here): for the standard lane, `stage === 'build'` means *plan.md exists but is not yet approved*; `stage === 'done'` means the build gate's approval has landed. The only self-consistent reading, given the unambiguous half of the sentence ("after `relay gate build --approve`, the same edit succeeds"), is: **block source edits until the build gate is approved (`stage === 'done'`)**, regardless of the "plan gate" phrase — which reads as a slip in the original plan text, not a second requirement. This plan's hook (Task 10) implements that reading. Flagged, not silently picked.

---

## Task 9: Scaffold `@relay/adapters/claude-code`

**Files:**
- Create: `packages/adapters/claude-code/package.json`
- Create: `packages/adapters/claude-code/tsconfig.json`
- Create: `packages/adapters/claude-code/src/index.ts` (placeholder; real exports land in Task 13)
- Modify: `package.json` (root `build` script)

No test — scaffolding, verified by the build.

- [ ] **Step 1: Create `packages/adapters/claude-code/package.json`**

```json
{
  "name": "@relay/adapter-claude-code",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@relay/core": "0.1.0",
    "@relay/cli": "0.1.0",
    "@relay/mcp": "0.1.0"
  }
}
```

(Named `@relay/adapter-claude-code`, singular "adapter" — matching how this plan and SPEC §4 refer to it in prose as "the Claude Code adapter," and leaving room for `@relay/adapter-cursor`/`@relay/adapter-codex` as siblings later, each its own package under `packages/adapters/`, rather than one `@relay/adapters` package multiplexing all three internally. `@relay/mcp` is a dependency here — not just `@relay/core`/`@relay/cli` — because Task 13's `install()` needs to resolve the MCP server's own installed path to write `.mcp.json`, via Node's module resolution rather than a fragile relative-path guess between two sibling packages' `dist/` directories.)

- [ ] **Step 2: Create `packages/adapters/claude-code/tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../../core" }, { "path": "../../cli" }, { "path": "../../mcp" }]
}
```

(Three `../` levels — this package is two directories deeper than `packages/cli`.)

- [ ] **Step 3: Install and confirm the (still-empty) package builds**

```bash
mkdir -p packages/adapters/claude-code/src && echo 'export {};' > packages/adapters/claude-code/src/index.ts
npm install
```

Modify `package.json`'s root `"build"` script to:
```json
    "build": "tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code"
```

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/adapters/claude-code/package.json packages/adapters/claude-code/tsconfig.json packages/adapters/claude-code/src/index.ts package.json package-lock.json
git commit -m "relay(adapters): scaffold @relay/adapter-claude-code package"
```

---

## Task 10: The `PreToolUse` hook

**Files:**
- Create: `packages/adapters/claude-code/src/hooks/pre-tool-use.ts`
- Test: `packages/adapters/claude-code/test/hooks/pre-tool-use.test.ts`

Blocks `Edit`/`Write` against source paths until the current item's build gate is approved (`stage === 'done'`, see the flagged-discrepancy note above). `.relay/**` and `.claude/**` are exempt — those are the artifacts and tooling config being authored, not "source." When Relay doesn't apply at all (no `.relay/config.yml`, no resolvable current item), the hook **allows silently** — Relay sits beside the coding tool, it does not become a second permission system for work it isn't tracking.

Tested by spawning the **built** script as a real child process and feeding it real stdin JSON — this is the actual contract Claude Code uses (`node <path>`, stdin JSON in, exit code + stderr out), so the test must exercise exactly that, not a bare function call.

- [ ] **Step 1: Write the failing tests**

Create `packages/adapters/claude-code/test/hooks/pre-tool-use.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli';

const HOOK_PATH = join(process.cwd(), 'dist/hooks/pre-tool-use.js');

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-hook-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runHook(input: object): { status: number; stderr: string } {
  try {
    execFileSync('node', [HOOK_PATH], { input: JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'] });
    return { status: 0, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stderr: Buffer };
    return { status: e.status, stderr: e.stderr.toString() };
  }
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('pre-tool-use hook', () => {
  it('allows edits when there is no .relay/ at all — Relay does not apply here', () => {
    repo = makeScratchRepo();
    const result = runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: 'src/app.ts' } });
    expect(result.status).toBe(0);
  });

  it('allows edits to .relay/ paths regardless of gate state', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('test', {}, repo.dir);
    const result = runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: '.relay/work/001-test/intent.md' } });
    expect(result.status).toBe(0);
  });

  it('blocks a source edit before the build gate is approved, naming the reason', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('test', {}, repo.dir);

    const result = runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: 'src/app.ts' } });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/build gate/i);
  });

  it('allows the same edit once the build gate is approved (express lane, single gate)', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('x', { lane: 'express' }, repo.dir);
    const planPath = join(repo.dir, `.relay/work/${id}/plan.md`);
    writeFileSync(planPath, readFileSync(planPath, 'utf8')
      .replace('## Files that change\n\n', '## Files that change\n\n`src/app.ts`\n\n')
      .replace('## Work order\n\n', '## Work order\n\n1.\n\n')
      .replace('## Tests that prove completion\n', '## Tests that prove completion\n`a.test.ts`\n'));
    const { runGate } = await import('@relay/cli');
    await runGate(id, 'build', 'approve', undefined, repo.dir);

    const result = runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: 'src/app.ts' } });
    expect(result.status).toBe(0);
  });

  it('allows Bash and other non-Edit/Write tools unconditionally', () => {
    repo = makeScratchRepo();
    const result = runHook({ cwd: repo.dir, tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(result.status).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx tsc -b packages/core packages/cli packages/adapters/claude-code && npx vitest run packages/adapters/claude-code/test/hooks/pre-tool-use.test.ts`
Expected: FAIL — `dist/hooks/pre-tool-use.js` does not exist yet.

- [ ] **Step 3: Implement**

Create `packages/adapters/claude-code/src/hooks/pre-tool-use.ts`:

```ts
#!/usr/bin/env node
import { runStatus } from '@relay/cli/lib';

interface HookInput {
  cwd: string;
  tool_name: string;
  tool_input?: { file_path?: string };
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw) as HookInput;

  if (input.tool_name !== 'Edit' && input.tool_name !== 'Write') {
    process.exit(0);
  }

  const filePath = input.tool_input?.file_path ?? '';
  if (filePath.startsWith('.relay/') || filePath.startsWith('.claude/')) {
    process.exit(0);
  }

  let status;
  try {
    status = runStatus(input.cwd);
  } catch {
    // No .relay/config.yml, no resolvable current item, or any other reason
    // Relay doesn't apply here — this hook is ergonomics for tracked work
    // only, never a second permission system for everything else.
    process.exit(0);
  }

  if (status.stage === 'done') {
    process.exit(0);
  }

  const reason = status.blockedBy.length > 0
    ? status.blockedBy.join('; ')
    : `item ${status.id} is at stage '${status.stage}', not yet past its build gate`;
  process.stderr.write(
    `Relay: blocked — the build gate is not yet approved (${reason}). Run \`relay gate build --approve\` once ready.\n`
  );
  process.exit(2);
}

main();
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/adapters/claude-code && npx vitest run packages/adapters/claude-code/test/hooks/pre-tool-use.test.ts`
Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/claude-code/src/hooks/pre-tool-use.ts packages/adapters/claude-code/test/hooks/pre-tool-use.test.ts
git commit -m "relay(adapters): add the PreToolUse hook — blocks source edits before the build gate"
```

---

## Task 11: The `SessionStart` hook

**Files:**
- Create: `packages/adapters/claude-code/src/hooks/session-start.ts`
- Test: `packages/adapters/claude-code/test/hooks/session-start.test.ts`

Injects the resume briefing as plain stdout text (per the verified mechanism: plain text a `SessionStart` hook writes to stdout is added to the new session's context). Silent (no stdout, exit 0) when Relay doesn't apply — same reasoning as Task 10.

- [ ] **Step 1: Write the failing tests**

Create `packages/adapters/claude-code/test/hooks/session-start.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli';

const HOOK_PATH = join(process.cwd(), 'dist/hooks/session-start.js');

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-hook-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runHook(input: object): string {
  return execFileSync('node', [HOOK_PATH], { input: JSON.stringify(input) }).toString();
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('session-start hook', () => {
  it('prints nothing when there is no .relay/ at all', () => {
    repo = makeScratchRepo();
    const out = runHook({ cwd: repo.dir });
    expect(out.trim()).toBe('');
  });

  it('prints the resume briefing when a current item exists', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const out = runHook({ cwd: repo.dir });
    expect(out).toContain(id);
    expect(out).toContain('stage: plan');
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx tsc -b packages/core packages/cli packages/adapters/claude-code && npx vitest run packages/adapters/claude-code/test/hooks/session-start.test.ts`
Expected: FAIL — `dist/hooks/session-start.js` does not exist yet.

- [ ] **Step 3: Implement**

Create `packages/adapters/claude-code/src/hooks/session-start.ts`:

```ts
#!/usr/bin/env node
import { runResume } from '@relay/cli/lib';

interface HookInput {
  cwd: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw) as HookInput;

  try {
    const brief = runResume(input.cwd);
    const lines = [`Relay: resuming ${brief.id} — stage: ${brief.stage}`];
    if (brief.blockedBy.length > 0) lines.push(`Blocked by: ${brief.blockedBy.join('; ')}`);
    lines.push(`Open questions: ${brief.openQuestions}`);
    lines.push(`Next: ${brief.next}`);
    process.stdout.write(lines.join('\n') + '\n');
  } catch {
    // No .relay/config.yml or no resolvable current item — nothing to
    // resume, and printing nothing is correct, not an error.
  }
  process.exit(0);
}

main();
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/adapters/claude-code && npx vitest run packages/adapters/claude-code/test/hooks/session-start.test.ts`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/claude-code/src/hooks/session-start.ts packages/adapters/claude-code/test/hooks/session-start.test.ts
git commit -m "relay(adapters): add the SessionStart hook — injects the resume briefing"
```

---

## Task 12: The three stage-interview skills

**Files:**
- Create: `packages/adapters/claude-code/src/skills.ts`
- Test: `packages/adapters/claude-code/test/skills.test.ts`

SPEC §9: "Skill — the conversational path: `/relay-intent`, `/relay-spec`, `/relay-plan` interview the human, draft, and present for approval. This is how the file gets filled in practice." These are genuinely conversational (an LLM interviewing a human), so there is no behavior to unit-test beyond "the file this plan writes is structurally valid" — frontmatter present, references the right template, doesn't invent a syntax Claude Code doesn't support. Kept as plain exported strings (matching `templates.ts`'s own pattern from Phase 2) rather than external `.md` files, for the same reason: no asset-bundling step needed for a handful of scaffold strings.

- [ ] **Step 1: Write the failing tests**

Create `packages/adapters/claude-code/test/skills.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { INTENT_SKILL, SPEC_SKILL, PLAN_SKILL } from '../src/skills.js';

describe('stage-interview skills', () => {
  it.each([
    ['INTENT_SKILL', INTENT_SKILL, 'relay-intent'],
    ['SPEC_SKILL', SPEC_SKILL, 'relay-spec'],
    ['PLAN_SKILL', PLAN_SKILL, 'relay-plan'],
  ])('%s has valid frontmatter naming itself %s', (_label, content, expectedName) => {
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(new RegExp(`name: ${expectedName}`));
    expect(content).toMatch(/description: .+/);
  });

  it('each skill references the relay command it exists to fill in', () => {
    expect(INTENT_SKILL).toMatch(/intent\.md/);
    expect(SPEC_SKILL).toMatch(/spec\.md/);
    expect(PLAN_SKILL).toMatch(/plan\.md/);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/adapters/claude-code/test/skills.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/adapters/claude-code/src/skills.ts`:

```ts
export const INTENT_SKILL = `---
name: relay-intent
description: Interview the user to draft this item's intent.md — the problem, proposed outcome, affected users and systems, constraints, and open questions. Use when starting a new Relay item or when intent.md exists but relay lint reports empty sections.
---

Interview the user conversationally to fill in \`intent.md\`'s five required sections:
Problem, Proposed outcome, Affected users and systems, Constraints, Open questions.

Ask one section at a time. Do not invent answers the user hasn't given you — an
empty or placeholder section is more honest than a fabricated one, and \`relay lint\`
will catch it either way.

When all five sections are filled in, run \`relay lint\` to confirm, then tell the
user the item is ready for \`relay gate plan --approve\`. Do not approve gates
yourself — that is a human decision, never something this skill does on the
user's behalf.
`;

export const SPEC_SKILL = `---
name: relay-spec
description: Interview the user to draft this item's spec.md — requirements, design, and flagged concerns — from its approved intent.md. Use once the plan gate is approved and spec.md doesn't exist yet or is incomplete.
---

Read the approved \`intent.md\` first. Interview the user to fill in \`spec.md\`'s
three required sections: Requirements, Design, Flagged concerns.

Flagged concerns use a checklist convention: \`- [ ] <concern>\` for something
still open, \`- [x] <concern> — resolved: <how>\` or \`— accepted risk: <why>\` for
something the user has explicitly closed. Do not mark a concern resolved on the
user's behalf — ask.

When done, run \`relay lint\` to confirm, then tell the user the item is ready for
\`relay gate design --approve\`.
`;

export const PLAN_SKILL = `---
name: relay-plan
description: Interview the user (or draft from a plan-mode conversation) to fill in this item's plan.md — files that change, work order, tests that prove completion — from its approved spec.md. Use once the design gate is approved and plan.md doesn't exist yet or is incomplete.
---

Read the approved \`spec.md\` first. Fill in \`plan.md\`'s three required sections:
Files that change, Work order, Tests that prove completion.

"Files that change" must name real, specific paths — this is what \`relay verify\`'s
drift check compares the actual diff against later, so a vague or incomplete list
here will surface as a drift failure at the worst time (in CI, not now).

When done, run \`relay lint\` to confirm, then tell the user the item is ready for
\`relay gate build --approve\` — after which source edits stop being blocked by
the PreToolUse hook.
`;
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/adapters/claude-code/test/skills.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/claude-code/src/skills.ts packages/adapters/claude-code/test/skills.test.ts
git commit -m "relay(adapters): add the three stage-interview skills (SPEC §9)"
```

---

## Task 13: `install()` and wiring it into `relay init`

**Files:**
- Create: `packages/adapters/claude-code/src/install.ts`
- Test: `packages/adapters/claude-code/test/install.test.ts`
- Modify: `packages/adapters/claude-code/src/index.ts`
- Modify: `packages/cli/src/commands/init.ts`
- Test: `packages/cli/test/init.test.ts`

`relay init`'s Task 14 (Phase 2) deliberately scoped itself to *detecting* Tier-1 rule files, flagging explicitly that "installing matching adapters" was Phase 3's job since the adapters didn't exist yet. They exist now.

**Known limitation, stated plainly, not silently implied as solved:** `install()` writes the *absolute path* to this monorepo's own built hook/MCP scripts into the target repo's `.claude/settings.json`/`.mcp.json` — via `import.meta.resolve`, so it always points at whatever is actually installed, not a guessed relative path. This works correctly for every target this plan's own scope covers (this workspace's own projects, and Phase 6's pilot copy) because they all resolve `@relay/adapter-claude-code`/`@relay/mcp` from the same monorepo's `node_modules`. It does **not** yet make Relay portable to a machine that doesn't have this monorepo checked out — that needs either publishing these packages or bundling the hook scripts into single self-contained files (no external imports), and is real future work, not solved here.

- [ ] **Step 1: Write the failing tests**

Create `packages/adapters/claude-code/test/install.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installClaudeCodeAdapter } from '../src/install.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-install-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('installClaudeCodeAdapter', () => {
  it('writes PreToolUse and SessionStart hooks into .claude/settings.json', () => {
    repo = makeScratchRepo();
    installClaudeCodeAdapter(repo.dir);

    const settings = JSON.parse(readFileSync(join(repo.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write');
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toMatch(/pre-tool-use\.js$/);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toMatch(/session-start\.js$/);
  });

  it('writes all three skill files', () => {
    repo = makeScratchRepo();
    installClaudeCodeAdapter(repo.dir);

    for (const name of ['relay-intent', 'relay-spec', 'relay-plan']) {
      const content = readFileSync(join(repo.dir, `.claude/skills/${name}/SKILL.md`), 'utf8');
      expect(content).toMatch(new RegExp(`name: ${name}`));
    }
  });

  it('registers the relay MCP server in .mcp.json', () => {
    repo = makeScratchRepo();
    installClaudeCodeAdapter(repo.dir);

    const mcpConfig = JSON.parse(readFileSync(join(repo.dir, '.mcp.json'), 'utf8'));
    expect(mcpConfig.mcpServers.relay.command).toBe('node');
    expect(mcpConfig.mcpServers.relay.args[0]).toMatch(/mcp\/dist\/index\.js$/);
  });

  it('is idempotent — running twice does not duplicate hook entries', () => {
    repo = makeScratchRepo();
    installClaudeCodeAdapter(repo.dir);
    installClaudeCodeAdapter(repo.dir);

    const settings = JSON.parse(readFileSync(join(repo.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('preserves pre-existing settings.json content it does not own', () => {
    repo = makeScratchRepo();
    mkdirSync(join(repo.dir, '.claude'), { recursive: true });
    writeFileSync(join(repo.dir, '.claude/settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'some-other-tool' }] }] },
      someOtherSetting: true,
    }));

    installClaudeCodeAdapter(repo.dir);

    const settings = JSON.parse(readFileSync(join(repo.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.someOtherSetting).toBe(true);
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse.some((g: { matcher: string }) => g.matcher === 'Bash')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/adapters/claude-code/test/install.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/adapters/claude-code/src/install.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTENT_SKILL, SPEC_SKILL, PLAN_SKILL } from './skills.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface HookEntry { type: string; command: string }
interface HookGroup { matcher?: string; hooks: HookEntry[] }
interface Settings {
  hooks?: { PreToolUse?: HookGroup[]; SessionStart?: HookGroup[] };
  [key: string]: unknown;
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function ensureHook(groups: HookGroup[], matcher: string | undefined, command: string): HookGroup[] {
  const alreadyPresent = groups.some((g) => g.hooks.some((h) => h.command === command));
  if (alreadyPresent) return groups;
  const entry: HookGroup = matcher ? { matcher, hooks: [{ type: 'command', command }] } : { hooks: [{ type: 'command', command }] };
  return [...groups, entry];
}

export interface InstallResult {
  settingsUpdated: boolean;
  skillsWritten: string[];
  mcpRegistered: boolean;
}

export function installClaudeCodeAdapter(targetRepoDir: string): InstallResult {
  const preToolUsePath = join(HERE, 'hooks/pre-tool-use.js');
  const sessionStartPath = join(HERE, 'hooks/session-start.js');

  const settingsPath = join(targetRepoDir, '.claude/settings.json');
  const settings = readJson<Settings>(settingsPath, {});
  settings.hooks = settings.hooks ?? {};
  settings.hooks.PreToolUse = ensureHook(settings.hooks.PreToolUse ?? [], 'Edit|Write', `node ${preToolUsePath}`);
  settings.hooks.SessionStart = ensureHook(settings.hooks.SessionStart ?? [], undefined, `node ${sessionStartPath}`);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  const skills: [string, string][] = [
    ['relay-intent', INTENT_SKILL],
    ['relay-spec', SPEC_SKILL],
    ['relay-plan', PLAN_SKILL],
  ];
  const skillsWritten: string[] = [];
  for (const [name, content] of skills) {
    const dir = join(targetRepoDir, '.claude/skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), content);
    skillsWritten.push(name);
  }

  const mcpEntryPath = fileURLToPath(import.meta.resolve('@relay/mcp'));
  const mcpPath = join(targetRepoDir, '.mcp.json');
  const mcpConfig = readJson<{ mcpServers?: Record<string, { command: string; args: string[] }> }>(mcpPath, {});
  mcpConfig.mcpServers = mcpConfig.mcpServers ?? {};
  const mcpRegistered = !mcpConfig.mcpServers.relay;
  mcpConfig.mcpServers.relay = { command: 'node', args: [mcpEntryPath] };
  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');

  return { settingsUpdated: true, skillsWritten, mcpRegistered };
}
```

Modify `packages/adapters/claude-code/src/index.ts` to export it:
```ts
export { installClaudeCodeAdapter, type InstallResult } from './install.js';
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code && npx vitest run packages/adapters/claude-code/test/install.test.ts`
Expected: all 5 pass.

- [ ] **Step 5: Wire into `relay init`**

Read the current full `packages/cli/src/commands/init.ts` before editing — Task 14 of Phase 2 built it, and this step only adds one thing to its existing `detectedRuleFiles`/`tier` logic, not a rewrite.

`@relay/cli`'s `package.json` needs `@relay/adapter-claude-code` added to `dependencies` (it does not currently depend on it — `@relay/cli` has been a dependency *of* the adapter, not the reverse, until now):
```json
    "@relay/adapter-claude-code": "0.1.0",
```
Run `npm install` after adding it.

Modify `packages/cli/src/commands/init.ts`: add an import and one call, gated on Claude Code actually being detected (a `CLAUDE.md` present — do not install Claude Code hooks into a repo that shows no sign of using Claude Code):

```ts
import { installClaudeCodeAdapter } from '@relay/adapter-claude-code';
```

In `runInit`, after `const detectedRuleFiles = RULE_FILES.filter(...)` and before the `tier` calculation, add:
```ts
  let claudeCodeAdapterInstalled = false;
  if (detectedRuleFiles.includes('CLAUDE.md')) {
    installClaudeCodeAdapter(cwd);
    claudeCodeAdapterInstalled = true;
  }
```
Add `claudeCodeAdapterInstalled: boolean` to `InitResult` and include it in the final `return`.

- [ ] **Step 6: Add a test for the new wiring**

Add to `packages/cli/test/init.test.ts`:

```ts
  it('installs the Claude Code adapter when CLAUDE.md is present', () => {
    repo = makeScratchRepo();
    writeFileSync(join(repo.dir, 'CLAUDE.md'), '# rules');
    const result = runInit(repo.dir);
    expect(result.claudeCodeAdapterInstalled).toBe(true);
    expect(existsSync(join(repo.dir, '.claude/settings.json'))).toBe(true);
    expect(existsSync(join(repo.dir, '.mcp.json'))).toBe(true);
  });

  it('does not install the Claude Code adapter when CLAUDE.md is absent', () => {
    repo = makeScratchRepo();
    const result = runInit(repo.dir);
    expect(result.claudeCodeAdapterInstalled).toBe(false);
    expect(existsSync(join(repo.dir, '.claude/settings.json'))).toBe(false);
  });
```

- [ ] **Step 7: Run to confirm everything passes**

Run: `npm run build && npx vitest run`
Expected: clean build across all four packages; every test file passing, including the two new ones.

- [ ] **Step 8: Commit**

```bash
git add packages/adapters/claude-code/src/install.ts packages/adapters/claude-code/src/index.ts packages/adapters/claude-code/test/install.test.ts packages/cli/src/commands/init.ts packages/cli/package.json packages/cli/test/init.test.ts package-lock.json
git commit -m "relay(cli,adapters): relay init installs the Claude Code adapter when detected"
```

---

## Task 14: Demonstrate the Phase 3 acceptance criterion, `PROJECT.md`, final commit

**Files:**
- Modify: `Projects/relay/PROJECT.md`

**Honesty boundary, stated up front:** the literal acceptance text calls for "a Claude Code session" — an actual live agent process being refused an edit and later succeeding. Nothing in this plan's execution environment can spawn and drive a second, independent, interactive Claude Code CLI session from inside itself. What this task *can* and must do: (a) install the real adapter into a real scratch repo via `relay init`, producing the exact `.claude/settings.json`/`.mcp.json` a live session would read; (b) invoke the resulting hook command **exactly as Claude Code's own documented dispatch mechanism does** — same stdin shape, same exit-code convention — which is a faithful reproduction of the trigger condition, verified against Claude Code's current hook documentation, not assumed; (c) state plainly in `PROJECT.md` that the one thing still unverified is a human (or a session with the ability to drive a second Claude Code process) actually watching a live session get refused, then succeed. This is principle 5 of this workspace's own operating manual — "be honest about testing limits" — applied to the letter of this phase's own acceptance criterion, not a way of skipping it.

- [ ] **Step 1: Full monorepo build and test**

```bash
npm run build && npx vitest run
```
Expected: `tsc -b` exits 0 across all four packages (`core`, `cli`, `mcp`, `adapters/claude-code`); every test file passes; zero `.only`/`.skip`.

- [ ] **Step 2: Install the real adapter into a real scratch repo and drive it end to end**

```bash
cd /tmp && rm -rf relay-phase3-acceptance && mkdir relay-phase3-acceptance && cd relay-phase3-acceptance
git init -q && git config user.email you@example.com && git config user.name You && git commit -q --allow-empty -m init
echo "# rules" > CLAUDE.md
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js init
```
Expected: prints `claudeCodeAdapterInstalled` behavior via the existing `init` output plus (add to the `index.ts` `init` command's console output, if not already there, a line reporting adapter installation — check `packages/cli/src/index.ts`'s current `init` action and add `console.log(result.claudeCodeAdapterInstalled ? 'Claude Code adapter installed.' : 'Claude Code not detected — adapter not installed.');`, commit that as part of this task if it's missing). Confirm real files exist: `.claude/settings.json`, `.claude/skills/relay-intent/SKILL.md`, `.claude/skills/relay-spec/SKILL.md`, `.claude/skills/relay-plan/SKILL.md`, `.mcp.json`.

- [ ] **Step 3: Drive the acceptance sequence, invoking the hook exactly as Claude Code would**

```bash
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js new "test"
```
Expected: id `001-test` created.

Extract the real hook command from the real, just-written settings file and run it exactly as documented (stdin JSON in, check exit code and stderr):
```bash
HOOK_CMD=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')).hooks.PreToolUse[0].hooks[0].command)")
echo "$HOOK_CMD"
echo '{"cwd":"'$(pwd)'","tool_name":"Edit","tool_input":{"file_path":"src/app.ts"}}' | $HOOK_CMD
echo "exit: $?"
```
Expected: exit code 2, stderr names the build gate.

```bash
sed -i '' 's/## Problem/## Problem\nx/' .relay/work/001-test/intent.md
sed -i '' 's/## Proposed outcome/## Proposed outcome\nx/' .relay/work/001-test/intent.md
sed -i '' 's/## Affected users and systems/## Affected users and systems\nx/' .relay/work/001-test/intent.md
sed -i '' 's/## Constraints/## Constraints\nx/' .relay/work/001-test/intent.md
sed -i '' 's/## Open questions/## Open questions\nx/' .relay/work/001-test/intent.md
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js gate plan --approve
```

Approve `design` and `build` too the same way `packages/cli/test/verify.test.ts`'s `driveToBuild` helper does (spec.md, then plan.md, each filled and gated) — reuse that exact sequence, run from the shell rather than the test file, filling `.relay/work/001-test/spec.md` and `.relay/work/001-test/plan.md` by hand with `sed`, declaring `src/app.ts` in plan.md's "Files that change" section, then:
```bash
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js gate build --approve
echo '{"cwd":"'$(pwd)'","tool_name":"Edit","tool_input":{"file_path":"src/app.ts"}}' | $HOOK_CMD
echo "exit: $?"
```
Expected: exit code 0 — the same edit that was refused now succeeds.

- [ ] **Step 4: Record the result, clean up**

Paste the real terminal output (both hook invocations, both exit codes, the stderr message from the first one) into the session notes / this task's own execution log. Then:
```bash
rm -rf /tmp/relay-phase3-acceptance /tmp/relay-mcp-verify.mjs /tmp/relay-mcp-verify-repo
```

- [ ] **Step 5: `PROJECT.md` — Features, Gotchas, Next steps, Changelog**

Mark `@relay/mcp` and `@relay/adapters/claude-code` `[x]` in the Features list with the verified test counts from Step 1. Add a Gotcha for the absolute-path limitation stated in Task 13. Add a Gotcha for `relay_request_gate` never writing an approval (SPEC's own words: conflating the two destroys the audit trail — this is exactly as load-bearing as the "approvals are hashes, not booleans" gotcha already there). Replace the "Next steps" Phase 3 entry with a pointer to Phase 4 (`@relay/daemon`). State plainly in the Changelog, per Step 2's honesty boundary: the hook was verified by invoking it exactly as Claude Code's documented dispatch mechanism does, against a real installed adapter — not by a live, human-observed Claude Code session, which remains open.

- [ ] **Step 6: Commit**

```bash
git add Projects/relay/PROJECT.md
git commit -m "$(cat <<'EOF'
relay: PROJECT.md — Phase 3 (@relay/mcp, @relay/adapters/claude-code) verified

All five MCP tools built and reachable over stdio (verified with a real MCP
client, not just unit tests). PreToolUse/SessionStart hooks and the three
stage-interview skills built; relay init now installs them when Claude Code
is detected. Acceptance sequence driven end-to-end against a real installed
adapter, invoking the hook exactly as Claude Code's documented dispatch
mechanism does. One thing honestly still open: a live, human-observed
Claude Code session actually getting refused and then succeeding — nothing
in this environment can drive a second interactive Claude Code process.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage** — all five MCP tools (Tasks 3-7), server wiring (Task 8), both hooks (Tasks 10-11), the three skills (Task 12), `relay init` integration (Task 13), and the acceptance demonstration (Task 14) are each their own task. `relay_request_gate`'s "never write an approval" constraint is enforced by construction (it only calls `appendEvent`, which only touches `events.jsonl` — there is no code path to `appendApproval` in that file at all) and pinned by a test that reads `approvals.jsonl` and expects it to throw (file doesn't exist).

**Placeholder scan** — no `TBD`/`TODO`/"add appropriate error handling" anywhere in a code block. The one deliberately-scoped-down piece is the absolute-path install limitation (Task 13), stated as a known limitation with a named future fix, not implied as solved.

**Type consistency, checked against earlier tasks:**
- `runStatus`, `runResume`, `runHandover`, `appendEvent`, `loadRelayConfig`, `buildApprovalContext`, `loadWorkItem`, `itemDir` are all re-exported once from `packages/cli/src/lib.ts` (Task 3) and imported from `@relay/cli/lib` everywhere after — no tool or hook re-implements any of them.
- `HandoverTarget` (Phase 2, `commands/handover.ts`) is the same type `handoverForCurrentStage` (Task 7) maps the derived stage onto.
- Every hook (Tasks 10, 11) and `install()` (Task 13) resolve `runStatus`/`runResume` failures the same way: catch, treat as "Relay doesn't apply here," degrade silently — not three different fallback behaviors.

**Flagged discrepancy** (stated at its own point in the plan, not buried): `IMPLEMENTATION_PLAN.md`'s Phase 3 acceptance text names two different gates ("before the plan gate" vs. "after `relay gate build --approve`"); this plan implements the only self-consistent reading.

---

**Plan complete and saved to `docs/plans/phase-3-mcp.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
