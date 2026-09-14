# Phase 4 — `@relay/daemon` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@relay/daemon` — a Fastify server that holds no authoritative state, projecting every work item's derived stage and gate status from disk, pushing transitions over a WebSocket, and receiving hook-originated activity events, exactly as `docs/IMPLEMENTATION_PLAN.md`'s Phase 4 section specifies.

**Architecture:** The daemon is a thin, stateless transport, same layering discipline as `@relay/cli` and `@relay/mcp` before it — every judgment call still comes from `@relay/core`/`@relay/cli/lib`. Three parts: (1) `projection.ts` — a pure(-ish) read of `.relay/work/**` into the shape `GET /api/items` returns, reusing `runStatus`/`listItemIds` from `@relay/cli/lib`; (2) a `chokidar` + git-ref watcher that recomputes the projection on any relevant filesystem change and diffs it against the last-known projection to detect stage transitions; (3) a Fastify server wiring `GET /api/items`, `POST /events` (the hook receiver — ephemeral, broadcast-only, never persisted), and `WS /stream` (the event feed) together.

**Tech Stack:** Fastify 5, `@fastify/websocket` 11, `chokidar` 5, all already available on the npm registry (verified versions: `fastify@5.12.4`, `@fastify/websocket@11.3.0`, `chokidar@5.0.0`). Port 5182 — already assigned to this project per `PROJECT.md`, shared with the not-yet-built dashboard (Phase 5).

**Grounded in:** `docs/IMPLEMENTATION_PLAN.md`'s Phase 4 section (deliverables list, the "critical: no authoritative state" requirement and its own literal acceptance criterion), `docs/SPEC.md` §4.4 ("State, transitions, and resuming" — state is recomputed, never restored; transitions are reconstructed, not tracked), §5 (the `.relay/` convention this reads), and §14 ("Events and instrumentation" — `POST /events` receives tool-lifecycle telemetry from hooks, which is ephemeral and never persisted; the file/git watcher alone produces every state transition and metric even without hooks).

**Explicitly out of scope for this phase** (per `IMPLEMENTATION_PLAN.md`'s own Phase 4 deliverables list — do not add these now): serving the built dashboard's static files (Phase 5 doesn't exist yet — there is nothing to serve; add that wiring when Phase 5 builds `packages/dashboard/dist/`), any `POST` endpoint for submitting a gate approval/rejection from the browser (not listed as a Phase 4 deliverable; Phase 5's dashboard "approve and send-back controls" would need this, but that's Phase 5's job to spec against a UI that exists), and persisting `POST /events` payloads to disk (SPEC §14 is explicit these are ephemeral instrumentation, not part of `.relay/`'s file convention).

---

## Task 1: Scaffold `@relay/daemon`

**Files:**
- Create: `packages/daemon/package.json`
- Create: `packages/daemon/tsconfig.json`
- Create: `packages/daemon/src/index.ts` (placeholder; real entry point lands in Task 8)
- Modify: `package.json` (root `build` script)

No test — scaffolding, verified by the build, same pattern as Phase 3's Task 1 and Task 9.

- [ ] **Step 1: Create `packages/daemon/package.json`**

```json
{
  "name": "@relay/daemon",
  "version": "0.1.0",
  "type": "module",
  "bin": { "relay-daemon": "./dist/index.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@relay/core": "0.1.0",
    "@relay/cli": "0.1.0",
    "fastify": "^5.12.0",
    "@fastify/websocket": "^11.3.0",
    "chokidar": "^5.0.0"
  }
}
```

`@relay/daemon` depends on `@relay/cli` (for `@relay/cli/lib`'s `runStatus`/`listItemIds`), the same relationship `@relay/mcp` and `@relay/adapters/claude-code` already have — no circularity here, since `@relay/cli` will never need to import `@relay/daemon` back (unlike Phase 3's `@relay/adapter-claude-code` situation).

- [ ] **Step 2: Create `packages/daemon/tsconfig.json`**

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
mkdir -p packages/daemon/src && echo 'export {};' > packages/daemon/src/index.ts
npm install
```

Modify `package.json`'s root `"build"` script to:
```json
    "build": "tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon"
```

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/daemon/package.json packages/daemon/tsconfig.json packages/daemon/src/index.ts package.json package-lock.json
git commit -m "relay(daemon): scaffold @relay/daemon package"
```

---

## Task 2: `listItemIds` on the `@relay/cli/lib` surface, and `buildProjection()`

**Files:**
- Modify: `packages/cli/src/lib.ts`
- Create: `packages/daemon/src/projection.ts`
- Test: `packages/daemon/test/projection.test.ts`

`GET /api/items` needs "every item with derived stage and gate status" (`IMPLEMENTATION_PLAN.md`, Phase 4 deliverables). `runStatus(cwd, id)` already computes exactly that shape for one item (Phase 2); `listItemIds(cwd)` already exists in `packages/cli/src/relay-dir.ts` but was never added to the `@relay/cli/lib` re-export surface, because nothing needed it there before now.

- [ ] **Step 1: Write the failing test**

Create `packages/daemon/test/projection.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli/lib';
import { buildProjection } from '../src/projection.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-daemon-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('buildProjection', () => {
  it('returns an empty array before any item exists', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(buildProjection(repo.dir)).toEqual([]);
  });

  it('reports id, lane, stage and blockedBy for every item, sorted by id', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('second', {}, repo.dir);
    // runNew leaves the new branch checked out, so resolving the next id must
    // return to a branch that does not name an item (same convention Phase 2's
    // own tests use — see packages/cli/test/item-id.test.ts).
    execSync('git checkout -q main', { cwd: repo.dir });
    await runNew('first', {}, repo.dir);
    execSync('git checkout -q main', { cwd: repo.dir });

    const items = buildProjection(repo.dir);
    expect(items.map((i) => i.id)).toEqual(['001-second', '002-first']);
    expect(items[0].lane).toBe('standard');
    expect(items[0].stage).toBe('plan');
    expect(items[0].blockedBy.length).toBeGreaterThan(0);
  });

  it('is deterministic — calling it twice with no changes yields an identical result', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('test', {}, repo.dir);

    const first = buildProjection(repo.dir);
    const second = buildProjection(repo.dir);
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/daemon/test/projection.test.ts`
Expected: FAIL — module missing, and check whether `main`'s default branch name is actually `main` in a freshly-`git init`'d repo on this machine (some `git` installs default to `master`). Run `git init -q && git branch --show-current` in a throwaway directory first if unsure, and adjust the checkout target in the test to match — do not assume.

- [ ] **Step 3: Implement**

Add to `packages/cli/src/lib.ts` (after the existing `relay-dir.js` export line):
```ts
export { loadWorkItem, appendEvent, itemDir, listItemIds } from './relay-dir.js';
```
(Replaces the existing `export { loadWorkItem, appendEvent, itemDir } from './relay-dir.js';` line — same line, one more name.)

Create `packages/daemon/src/projection.ts`:
```ts
import { runStatus, listItemIds, type StatusResult } from '@relay/cli/lib';

export type ItemProjection = StatusResult;

export function buildProjection(cwd: string): ItemProjection[] {
  return listItemIds(cwd)
    .map((id) => runStatus(cwd, id))
    .sort((a, b) => a.id.localeCompare(b.id));
}
```

`ItemProjection` is a type alias, not a new shape — `runStatus`'s `StatusResult` (`{id, lane, stage, blockedBy}`) already is what `GET /api/items` needs per element; giving it its own exported name here is about the daemon's own vocabulary (a "projection" of every item, not "the status of one item"), not a structural difference.

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/daemon/test/projection.test.ts`
Expected: clean build, all 3 tests pass.

- [ ] **Step 5: Run the full suite — confirm the `lib.ts` change didn't break anything importing it**

Run: `npx vitest run`
Expected: every existing test file still passes (the change only adds an export, never removes or renames one).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib.ts packages/daemon/src/projection.ts packages/daemon/test/projection.test.ts
git commit -m "relay(cli,daemon): export listItemIds from @relay/cli/lib; add buildProjection()"
```

---

## Task 3: `diffProjections()` — pure stage-transition detection

**Files:**
- Create: `packages/daemon/src/diff.ts`
- Test: `packages/daemon/test/diff.test.ts`

The watcher (Task 7) needs to turn "the projection changed" into "which items transitioned, and to what" — a pure function over two `ItemProjection[]` snapshots, with no filesystem or network dependency, so it is fully unit-testable without chokidar or a live server.

- [ ] **Step 1: Write the failing tests**

Create `packages/daemon/test/diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffProjections } from '../src/diff.js';
import type { ItemProjection } from '../src/projection.js';

function item(id: string, stage: ItemProjection['stage']): ItemProjection {
  return { id, lane: 'standard', stage, blockedBy: [] };
}

describe('diffProjections', () => {
  it('emits nothing when no item changed stage', () => {
    const before = [item('001-x', 'plan')];
    const after = [item('001-x', 'plan')];
    expect(diffProjections(before, after)).toEqual([]);
  });

  it('emits a transition event when an existing item changes stage', () => {
    const before = [item('001-x', 'plan')];
    const after = [item('001-x', 'design')];
    expect(diffProjections(before, after)).toEqual([
      { type: 'transition', id: '001-x', from: 'plan', to: 'design' },
    ]);
  });

  it('emits a transition event from "intake" for a newly-appeared item', () => {
    const before: ItemProjection[] = [];
    const after = [item('001-x', 'plan')];
    expect(diffProjections(before, after)).toEqual([
      { type: 'transition', id: '001-x', from: 'intake', to: 'plan' },
    ]);
  });

  it('emits one event per changed item when several change at once', () => {
    const before = [item('001-x', 'plan'), item('002-y', 'design')];
    const after = [item('001-x', 'design'), item('002-y', 'build')];
    const events = diffProjections(before, after);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.id).sort()).toEqual(['001-x', '002-y']);
  });

  it('ignores an item that disappears — a projection never loses items in practice, and reappearance is not this function\'s concern', () => {
    const before = [item('001-x', 'plan')];
    const after: ItemProjection[] = [];
    expect(diffProjections(before, after)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/daemon/test/diff.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/daemon/src/diff.ts`:
```ts
import type { ItemProjection } from './projection.js';

export interface TransitionEvent {
  type: 'transition';
  id: string;
  from: string;
  to: string;
}

export function diffProjections(before: ItemProjection[], after: ItemProjection[]): TransitionEvent[] {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const events: TransitionEvent[] = [];

  for (const item of after) {
    const prior = beforeById.get(item.id);
    const from = prior?.stage ?? 'intake';
    if (from !== item.stage) {
      events.push({ type: 'transition', id: item.id, from, to: item.stage });
    }
  }

  return events;
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/daemon/test/diff.test.ts`
Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/diff.ts packages/daemon/test/diff.test.ts
git commit -m "relay(daemon): add diffProjections() — pure stage-transition detection"
```

---

## Task 4: WebSocket client registry and broadcast

**Files:**
- Create: `packages/daemon/src/broadcast.ts`
- Test: `packages/daemon/test/broadcast.test.ts`

A small, dependency-free registry of connected WS clients, tested against fake socket-shaped objects rather than a real network connection — the real `@fastify/websocket` wiring (Task 6) is what actually proves this works over a real socket, via a live client.

- [ ] **Step 1: Write the failing tests**

Create `packages/daemon/test/broadcast.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ClientRegistry } from '../src/broadcast.js';

function fakeSocket(readyState = 1) {
  return { readyState, send: vi.fn() };
}

describe('ClientRegistry', () => {
  it('sends a JSON-serialised event to every registered open client', () => {
    const registry = new ClientRegistry();
    const a = fakeSocket();
    const b = fakeSocket();
    registry.add(a as never);
    registry.add(b as never);

    registry.broadcast({ type: 'transition', id: '001-x', from: 'plan', to: 'design' });

    const payload = JSON.stringify({ type: 'transition', id: '001-x', from: 'plan', to: 'design' });
    expect(a.send).toHaveBeenCalledWith(payload);
    expect(b.send).toHaveBeenCalledWith(payload);
  });

  it('skips a client that is not in the open state', () => {
    const registry = new ClientRegistry();
    const closed = fakeSocket(3); // WebSocket.CLOSED
    registry.add(closed as never);

    registry.broadcast({ type: 'transition', id: '001-x', from: 'plan', to: 'design' });

    expect(closed.send).not.toHaveBeenCalled();
  });

  it('stops sending to a client after it is removed', () => {
    const registry = new ClientRegistry();
    const a = fakeSocket();
    registry.add(a as never);
    registry.remove(a as never);

    registry.broadcast({ type: 'transition', id: '001-x', from: 'plan', to: 'design' });

    expect(a.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/daemon/test/broadcast.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/daemon/src/broadcast.ts`:
```ts
interface SocketLike {
  readyState: number;
  send(data: string): void;
}

const OPEN = 1;

export class ClientRegistry {
  private clients = new Set<SocketLike>();

  add(socket: SocketLike): void {
    this.clients.add(socket);
  }

  remove(socket: SocketLike): void {
    this.clients.delete(socket);
  }

  broadcast(event: unknown): void {
    const payload = JSON.stringify(event);
    for (const socket of this.clients) {
      if (socket.readyState === OPEN) socket.send(payload);
    }
  }
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run packages/daemon/test/broadcast.test.ts`
Expected: all 3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/broadcast.ts packages/daemon/test/broadcast.test.ts
git commit -m "relay(daemon): add ClientRegistry — WS client tracking and broadcast"
```

---

## Task 5: Fastify server — `GET /api/items` and `POST /events`

**Files:**
- Create: `packages/daemon/src/server.ts`
- Test: `packages/daemon/test/server.test.ts`

The two plain-HTTP routes first, tested via Fastify's own `app.inject()` (no real port opened, no network flakiness) — `WS /stream` and the file watcher follow in Tasks 6-7, since they need a real socket and real filesystem events respectively to prove anything, and get their own live-acceptance verification instead of an inject()-based unit test.

**Before writing this task's code**, verify `@fastify/websocket@11.3.0`'s actual registration and handler API against what is really installed — API shape has changed across major versions of this package, and this plan's own code must be checked against the real, installed `node_modules/@fastify/websocket`, not assumed from memory. Run:
```bash
cat node_modules/@fastify/websocket/README.md | grep -A 15 "fastify.get"
```
and adjust the `WS /stream` registration in Task 6 (not this task) to match whatever the real README shows, if it differs from Task 6's draft code.

- [ ] **Step 1: Write the failing tests**

Create `packages/daemon/test/server.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli/lib';
import { buildServer } from '../src/server.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-daemon-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('GET /api/items', () => {
  it('returns every item with derived stage and gate status', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = buildServer(repo.dir);
    const res = await app.inject({ method: 'GET', url: '/api/items' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(id);
    expect(body[0].stage).toBe('plan');
    await app.close();
  });

  it('returns an empty array before any item exists', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);

    const app = buildServer(repo.dir);
    const res = await app.inject({ method: 'GET', url: '/api/items' });
    expect(JSON.parse(res.body)).toEqual([]);
    await app.close();
  });
});

describe('POST /events', () => {
  it('accepts a JSON body and returns 202 — ephemeral, never persisted to .relay/', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);

    const app = buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'tool_use', tool: 'Edit', itemId: '001-test' },
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run packages/daemon/test/server.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/daemon/src/server.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { buildProjection } from './projection.js';
import { ClientRegistry } from './broadcast.js';

export function buildServer(cwd: string): FastifyInstance {
  const app = Fastify();
  const registry = new ClientRegistry();

  app.get('/api/items', async () => buildProjection(cwd));

  app.post('/events', async (request, reply) => {
    registry.broadcast(request.body);
    reply.code(202);
    return { received: true };
  });

  return app;
}
```

`registry` is created but the `WS /stream` route that actually uses it for real client registration is added in Task 6 — `POST /events` already broadcasts to it here so the two tasks don't need to touch this file's `registry` wiring twice. An empty registry's `broadcast()` is a no-op, so this is safe before Task 6 lands.

- [ ] **Step 4: Run to confirm they pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/daemon/test/server.test.ts`
Expected: clean build, all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/server.ts packages/daemon/test/server.test.ts
git commit -m "relay(daemon): add GET /api/items and POST /events"
```

---

## Task 6: `WS /stream`

**Files:**
- Modify: `packages/daemon/src/server.ts`
- Modify: `packages/daemon/package.json` (add `@fastify/websocket` — already listed in Task 1's dependencies; nothing to add here if Task 1 was followed, this step is a no-op unless Task 1 was skipped)

No new automated test file — a WS upgrade is real-socket behavior that `app.inject()` cannot faithfully exercise end-to-end (it can simulate the HTTP upgrade handshake but not full bidirectional message delivery in every Fastify/`ws` version). Verified instead by Task 9's live acceptance run, against a real listening server and a real WebSocket client — same reasoning Phase 3's Task 8 used for the real MCP server wiring.

- [ ] **Step 1: Confirm the real `@fastify/websocket` API** (do this before writing any code — do not assume the shape below is correct without checking)

```bash
cat node_modules/@fastify/websocket/README.md | grep -B2 -A 20 "fastify.get"
```

Read the actual output. The sketch below matches `@fastify/websocket@11.x`'s documented API as of this plan being written (the handler's first argument is the raw `ws` socket itself, not a wrapper object) — if the installed version's README shows a different shape, follow the README, not this sketch, and note the discrepancy in the commit message.

- [ ] **Step 2: Implement**

Modify `packages/daemon/src/server.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { buildProjection } from './projection.js';
import { ClientRegistry } from './broadcast.js';

export async function buildServer(cwd: string): Promise<FastifyInstance> {
  const app = Fastify();
  const registry = new ClientRegistry();
  await app.register(websocketPlugin);

  app.get('/api/items', async () => buildProjection(cwd));

  app.post('/events', async (request, reply) => {
    registry.broadcast(request.body);
    reply.code(202);
    return { received: true };
  });

  app.get('/stream', { websocket: true }, (socket) => {
    registry.add(socket);
    socket.on('close', () => registry.remove(socket));
  });

  return app;
}
```

`buildServer` becomes `async` because `@fastify/websocket` registration is asynchronous (`app.register` returns a promise) — update every call site (the test file from Task 5, plus Task 8's bin entry) to `await buildServer(cwd)`.

Update `packages/daemon/test/server.test.ts`'s three `const app = buildServer(repo.dir);` lines to `const app = await buildServer(repo.dir);`.

- [ ] **Step 3: Run to confirm the existing HTTP tests still pass**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/daemon/test/server.test.ts`
Expected: clean build, all 3 tests still pass (now via `await buildServer(...)`).

- [ ] **Step 4: Manually verify the WS route over a real socket, once, before committing**

```bash
node -e "
const { buildServer } = await import('/Users/aj/Desktop/Claude/Projects/relay/packages/daemon/dist/server.js');
const app = await buildServer(process.cwd());
await app.listen({ port: 0 });
const port = app.server.address().port;
const ws = new WebSocket('ws://localhost:' + port + '/stream');
ws.onopen = () => console.log('WS OPEN on port', port);
ws.onmessage = (e) => { console.log('WS MESSAGE:', e.data); process.exit(0); };
setTimeout(async () => {
  await fetch('http://localhost:' + port + '/events', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({hello: 'world'}) });
}, 200);
" --input-type=module
```
Expected: prints `WS OPEN on port <n>` then `WS MESSAGE: {"hello":"world"}` and exits. This is a throwaway verification, not committed — if it doesn't behave this way, fix `server.ts` before moving on; do not commit code you have not actually seen pass a message over a real socket.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/server.ts packages/daemon/test/server.test.ts
git commit -m "relay(daemon): add WS /stream — real client registration over a real socket, verified live"
```

---

## Task 7: Wire the watcher — `.relay/**` and `.git/HEAD`/refs

**Files:**
- Modify: `packages/daemon/src/server.ts`

Ties Tasks 2 (`buildProjection`), 3 (`diffProjections`) and the `WS /stream` registry together: on any relevant filesystem change, recompute the projection, diff it against the last-known one, broadcast any transitions. No new automated test file, for the same reason as Task 6 — real filesystem-event timing is not something a unit test should assert on; Task 9's live run is where this gets proven, against the literal one-second acceptance bound `IMPLEMENTATION_PLAN.md` states.

- [ ] **Step 1: Implement**

Modify `packages/daemon/src/server.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { watch } from 'chokidar';
import { join } from 'node:path';
import { buildProjection } from './projection.js';
import { diffProjections } from './diff.js';
import { ClientRegistry } from './broadcast.js';

export async function buildServer(cwd: string): Promise<FastifyInstance> {
  const app = Fastify();
  const registry = new ClientRegistry();
  await app.register(websocketPlugin);

  let lastProjection = buildProjection(cwd);

  function recompute() {
    const next = buildProjection(cwd);
    for (const event of diffProjections(lastProjection, next)) {
      registry.broadcast(event);
    }
    lastProjection = next;
  }

  const watcher = watch(
    [join(cwd, '.relay'), join(cwd, '.git/HEAD'), join(cwd, '.git/refs')],
    { ignoreInitial: true }
  );
  watcher.on('all', recompute);
  app.addHook('onClose', async () => watcher.close());

  app.get('/api/items', async () => buildProjection(cwd));

  app.post('/events', async (request, reply) => {
    registry.broadcast(request.body);
    reply.code(202);
    return { received: true };
  });

  app.get('/stream', { websocket: true }, (socket) => {
    registry.add(socket);
    socket.on('close', () => registry.remove(socket));
  });

  return app;
}
```

`lastProjection` is computed once at `buildServer()` call time (the daemon's own startup), not persisted anywhere — restarting the process always recomputes it fresh from disk, which is exactly the "no authoritative state" requirement: the in-memory variable is a cache of the last read, never the source of truth.

- [ ] **Step 2: Run to confirm nothing broke**

Run: `npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon && npx vitest run packages/daemon/test/server.test.ts`
Expected: clean build, all 3 tests still pass (the watcher does not interfere with `inject()`-based tests, since `ignoreInitial: true` means it only fires on changes made after `buildServer()` returns, and the tests never modify `.relay/` after that point).

- [ ] **Step 3: Commit**

```bash
git add packages/daemon/src/server.ts
git commit -m "relay(daemon): wire the .relay/ and .git watcher — recompute, diff, broadcast transitions"
```

---

## Task 8: The real `relay-daemon` bin entry

**Files:**
- Modify: `packages/daemon/src/index.ts`

- [ ] **Step 1: Implement**

Replace the full contents of `packages/daemon/src/index.ts`:
```ts
#!/usr/bin/env node
import { buildServer } from './server.js';

const PORT = 5182;
const cwd = process.cwd();

const app = await buildServer(cwd);
await app.listen({ port: PORT });
console.log(`Relay daemon listening on http://localhost:${PORT} (watching ${cwd}/.relay)`);
```

- [ ] **Step 2: Build**

```bash
npx tsc -b packages/core packages/cli packages/mcp packages/adapters/claude-code packages/daemon
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/daemon/src/index.ts
git commit -m "relay(daemon): wire the real relay-daemon bin entry, port 5182"
```

---

## Task 9: Live acceptance demonstration, `PROJECT.md`, final commit

**Files:**
- Modify: `Projects/relay/PROJECT.md`

Demonstrates `IMPLEMENTATION_PLAN.md`'s own literal Phase 4 acceptance criterion: *"with the daemon running, `relay gate design --approve` in another terminal pushes a transition event over the WebSocket within one second, and `curl localhost:5182/api/items` reflects the new stage."* Also demonstrates the "critical" no-authoritative-state requirement — already pinned by Task 2's determinism test at the unit level, additionally shown here at the process level: kill the daemon, restart it, confirm `GET /api/items` reports the identical projection with no state carried between the two process lifetimes.

Before starting: check nothing else is already listening on port 5182 (`lsof -i :5182`) — this project's own assigned port, but confirm it is free at the moment of this run rather than assuming the earlier 2026-09-11 assignment still holds.

- [ ] **Step 1: Full monorepo build and test**

```bash
npm run build && npx vitest run
```
Expected: `tsc -b` exits 0 across all five packages (`core`, `cli`, `mcp`, `adapters/claude-code`, `daemon`); every test file passes; zero `.only`/`.skip`.

- [ ] **Step 2: Set up a real scratch repo with a real item, driven to the `design` gate**

```bash
lsof -i :5182 || echo "port 5182 free"
SCRATCH=$(mktemp -d)
cd "$SCRATCH"
git init -q && git config user.email you@example.com && git config user.name You && git commit -q --allow-empty -m init
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js init
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js new "daemon acceptance test"
sed -i '' 's/## Problem/## Problem\nx/' .relay/work/001-daemon-acceptance-test/intent.md
sed -i '' 's/## Proposed outcome/## Proposed outcome\nx/' .relay/work/001-daemon-acceptance-test/intent.md
sed -i '' 's/## Affected users and systems/## Affected users and systems\nx/' .relay/work/001-daemon-acceptance-test/intent.md
sed -i '' 's/## Constraints/## Constraints\nx/' .relay/work/001-daemon-acceptance-test/intent.md
sed -i '' 's/## Open questions/## Open questions\nx/' .relay/work/001-daemon-acceptance-test/intent.md
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js gate plan --approve
```
Expected: item `001-daemon-acceptance-test` created and sitting at the `design` stage (its `plan` gate approved, `spec.md` not yet drafted).

- [ ] **Step 3: Start the real daemon in the background, connect a real WS client, time the transition**

```bash
node /Users/aj/Desktop/Claude/Projects/relay/packages/daemon/dist/index.js &
DAEMON_PID=$!
sleep 1

node -e "
const ws = new WebSocket('ws://localhost:5182/stream');
const start = Date.now();
ws.onmessage = (e) => {
  console.log('Received after', Date.now() - start, 'ms:', e.data);
  process.exit(0);
};
setTimeout(() => { console.log('TIMEOUT — no message within 1s'); process.exit(1); }, 1000);
" --input-type=module &
CLIENT_PID=$!

sleep 0.3
node /Users/aj/Desktop/Claude/Projects/relay/packages/cli/dist/index.js gate design --approve
wait $CLIENT_PID
```
Expected: the client script prints `Received after <n> ms: {"type":"transition","id":"001-daemon-acceptance-test","from":"design","to":"build"}` with `<n>` under 1000 — record the actual number observed, do not round it away.

Note: `relay gate design --approve` on its own will fail (`spec.md does not exist yet`) unless `spec.md` was drafted first — before this step, write a minimal valid `spec.md` the same way Phase 3's Task 14 did (via the real `specTemplate`/`hashContent`/`writeArtifact` functions, not hand-typed frontmatter): adapt Phase 3's `packages/mcp/scratch-acceptance.mjs` pattern (already deleted, but its content is in this repo's git history at commit `4f2c1f2`'s parent if needed for reference) to write `spec.md` with the correct `upstream` hash of `intent.md` before running `gate design --approve`.

- [ ] **Step 4: Confirm `curl` reflects the new stage, then kill and restart the daemon to prove no state survives**

```bash
curl -s http://localhost:5182/api/items | node -e "process.stdin.once('data', d => console.log(JSON.parse(d)))"
```
Expected: shows `"stage":"build"` for `001-daemon-acceptance-test`.

```bash
kill $DAEMON_PID
sleep 0.5
node /Users/aj/Desktop/Claude/Projects/relay/packages/daemon/dist/index.js &
DAEMON_PID=$!
sleep 1
curl -s http://localhost:5182/api/items
kill $DAEMON_PID
```
Expected: identical `stage: "build"` for the same item, reconstructed from disk with zero in-memory carryover from the killed process — the literal "kill it and restart it, must reconstruct everything" requirement, demonstrated at the process level, not just asserted by Task 2's unit test.

- [ ] **Step 5: Record the result, clean up**

Paste the real terminal output (the timed WS message, the curl output before and after restart) into the session notes / this task's own execution log.

```bash
rm -rf "$SCRATCH"
```

- [ ] **Step 6: `PROJECT.md` — Features, Gotchas, Next steps, Changelog**

Mark `@relay/daemon` `[x]` in the Features list with the verified test count from Step 1 and the actual observed transition latency from Step 3. Add a Gotcha for `POST /events`/the daemon's in-memory `lastProjection` being deliberately non-authoritative (mirrors the existing "no session state, ever" Gotcha — this is the same principle applied to the daemon specifically, worth its own line since it is this phase's central design constraint). Replace the "Next steps" Phase 4 entry with a pointer to Phase 5 (`@relay/dashboard`).

- [ ] **Step 7: Commit**

```bash
git add PROJECT.md
git commit -m "relay: PROJECT.md — Phase 4 (@relay/daemon) verified"
```

---

## Self-review

**Spec coverage** — every `IMPLEMENTATION_PLAN.md` Phase 4 deliverable has its own task: `chokidar` + git watcher (Task 7), `POST /events` (Task 5), `GET /api/items` (Task 5), `WS /stream` (Task 6), in-memory projection rebuilt from disk (Task 2, pinned non-authoritative by Task 7's `lastProjection` comment and proven live in Task 9 Step 4's kill-and-restart). The "critical" no-stored-state requirement has both a unit-level proof (Task 2's determinism test) and a process-level proof (Task 9).

**Placeholder scan** — no `TBD`/`TODO`/"add appropriate error handling" in any code block. Two things are explicitly flagged as unverified-until-run rather than assumed: `@fastify/websocket`'s exact handler API (Task 6 Step 1 — checked against the real installed README before code is written) and the default git branch name on this machine (Task 2 Step 2 — checked before the test asserts against it).

**Type consistency** — `ItemProjection` (Task 2) is a type alias for `@relay/cli/lib`'s existing `StatusResult`, not a new parallel shape; `TransitionEvent` (Task 3) is the one event shape both `diffProjections` and `ClientRegistry.broadcast` (Task 4) agree on, and it's what `server.ts` (Task 7) actually broadcasts — no second event shape invented anywhere else.

**Scope discipline** — dashboard static-file serving, an approve/reject HTTP endpoint, and persisting `POST /events` to disk are named explicitly as out of scope in this plan's header, with the specific reason each is deferred (nothing to serve yet; not a listed Phase 4 deliverable; SPEC §14 says these are ephemeral by design) — not silently dropped.
