# relay — PROJECT.md

> This is a **handoff file**. A fresh Claude session must be able to resume this project from this file alone — even after a year — as if it were a next-day handoff. If resuming requires rediscovering anything by scanning the codebase, this file has failed. Update it at the end of every session, without being asked.

**Status:** Phases 1-4 complete and verified. `@relay/core` (F1-F4 all closed),
`@relay/cli` (all ten commands, `SourceOfTruthAdapter` + simulated legacy
connector), `@relay/mcp` (all five tools reachable over stdio, verified with a
real MCP client), `@relay/adapters/claude-code` (`PreToolUse`/`SessionStart`
hooks, three stage-interview skills, `relay init` wiring) and `@relay/daemon`
(Fastify + `@fastify/websocket` + `chokidar`, holds no authoritative state —
verified by killing and restarting the real process) built via
`docs/plans/phase-2-cli.md` through `docs/plans/phase-4-daemon.md`'s TDD plans,
executed with `subagent-driven-development` and independently re-verified at
every step. 209/209 tests green (68 core + 98 cli + 9 mcp + 18 adapters + 16
daemon), `tsc -b` clean across all five packages, all three phases' stated
acceptance criteria demonstrated live against the built binaries. Phases 5-6
not started.
**Tier:** client demo
**Last session:** 2026-09-14

## What this is

Relay turns Anthropic's "The AI-Native SDLC Playbook" into a working runtime. The
playbook specifies six stages, each committing a markdown artifact the next stage
reads, with named gates and roles — but provides no tool. Relay is the connective
tissue: artifact scaffolding, gate enforcement, handover packaging, and a live
mission-control dashboard showing what is in flight and which gate it waits at.

Audience order: keynote artefact first, then dogfooded on this workspace, then
open-sourced. **Read `docs/SPEC.md` before any implementation work — it is the
approved design and it is detailed.**

## Run it

- **Start:** `bash start.sh` — ⚠ placeholder, fails on purpose until implemented
- **Stop:** `bash stop.sh` — ⚠ placeholder
- **URL:** http://localhost:5182
- **Ports:** 5182 (dashboard + daemon, single origin). Assigned 2026-09-11 via
  `scripts/next-free-port.sh`; free in `apps.js` and `lsof` at that time.
  ⚠ NOT yet registered in `/Users/aj/Desktop/Claude/launcher/server/apps.js` —
  register it when the dashboard first boots, not before.
- **Env/keys:** `.env.example` — nothing required yet. Ingest adapters will need
  provider tokens later.

## Stack

Decided 2026-09-11 (options were TS monorepo / Next.js single app / Python / Go):

- TypeScript monorepo, five packages — see `docs/SPEC.md` §4
- `@relay/core` pure logic, `@relay/cli`, `@relay/daemon` (Fastify + WebSocket),
  `@relay/dashboard` (React + Vite), `@relay/mcp` (universal MCP server),
  `@relay/adapters/*` (claude-code, cursor, codex)
- Storage: markdown + YAML frontmatter in `.relay/`, git as history, no database

## File map

`@relay/core` and `@relay/cli` are implemented and tested. Everything else is
planned — layout in `docs/SPEC.md` §4 and §5.

- `docs/SPEC.md` — the approved design specification. Start here.
- `docs/HANDOVER_PHASE2.md` — the Phase 1 → 2 handover (historical now that
  Phase 2 is done; kept for the decisions-and-rationale record).
- `docs/IMPLEMENTATION_PLAN.md` — the build plan, Phase 0-6. Phases 1-2 done;
  hand Phase 3 onward to a new session.
- `docs/plans/phase-2-cli.md` — the 26-task TDD plan Phase 2 was executed from,
  including a self-review and an execution-order note. Kept as the record of
  what was built and why (several tasks deviated from its literal draft code
  after code review found real bugs — see the Changelog below for the list).
- `package.json` / `tsconfig.base.json` / `vitest.config.ts` — npm workspaces
  root. `npx vitest run` runs everything; `npx tsc -b packages/core packages/cli`
  builds both packages.
- `packages/core/src/` — **implemented.** `types.ts` (shared types), `hash.ts`
  (byte-exact sha256), `artifact.ts` (frontmatter parsing), `schema.ts`
  (frontmatter + section/placeholder lint, `unresolvedConcerns`, `sections`),
  `ledger.ts` (approval validity), `state.ts` (stage derivation, `GATE_FOR_KIND`),
  `drift.ts` (plan-to-diff), `gate.ts` (`evaluateGate` — composes SPEC §7.1's
  three conditions, `KIND_FOR_GATE`), `config.ts` (lane presets, zod-validated
  YAML parsing), `index.ts` (public surface). One responsibility per file,
  nothing in core touches the filesystem.
- `packages/core/test/` — **implemented.** 68 tests across 8 files.
- `packages/cli/src/` — **implemented.** `relay-dir.ts` (the only file that
  touches `.relay/` on disk), `git.ts` (all git access via `execFileSync` argv
  arrays — never a raw shell string, fixed twice this session, see Gotchas),
  `context.ts`/`current-item.ts` (shared config/roles/identity/current-item
  resolution), `item-id.ts`, `templates.ts`, `sections.ts` (`extractSection`,
  `openItemsFor`), `adapters/legacy-json.ts` (`SourceOfTruthAdapter` simulated
  connector), `commands/*.ts` (all ten: init, new, use, status, lint, gate,
  handover, resume, verify, adopt), `index.ts` (the real `relay` bin entry,
  wired via commander).
- `packages/cli/test/` — **implemented.** 98 tests across 17 files.
- `packages/mcp/src/` — **implemented.** `tools/*.ts` (`current-item`,
  `gate-status`, `resume`, `request-gate`, `handover` — each a thin wrapper
  over `@relay/cli/lib`), `index.ts` (the real `relay-mcp` bin entry: an
  `McpServer` registering all five tools over `StdioServerTransport`).
- `packages/mcp/test/` — **implemented.** 9 tests across 5 files.
- `packages/adapters/claude-code/src/` — **implemented.** `hooks/pre-tool-use.ts`
  (blocks `Edit`/`Write` on source paths until the build gate is approved;
  exempts `.relay/`/`.claude/`; fails open when Relay doesn't apply),
  `hooks/session-start.ts` (injects the resume briefing as plain stdout text),
  `skills.ts` (three stage-interview skills as exported strings — `relay-intent`,
  `relay-spec`, `relay-plan`), `install.ts` (`installClaudeCodeAdapter` —
  idempotently merges hooks into `.claude/settings.json`, writes the three
  skill files, registers the MCP server in `.mcp.json`), `index.ts` (public
  surface). `relay init` calls it automatically when `CLAUDE.md` is detected.
- `packages/adapters/claude-code/test/` — **implemented.** 18 tests across 4
  files.
- `packages/cli/src/lib.ts` — **implemented.** The side-effect-free re-export
  surface `@relay/mcp`/`@relay/adapters/claude-code` import from
  (`@relay/cli/lib`) — `@relay/cli`'s own `index.ts` runs
  `program.parseAsync(process.argv)` on import, so nothing outside the CLI
  bin entry may import it directly.
- `packages/daemon/src/` — **implemented.** `projection.ts` (`buildProjection` —
  every item's derived stage/gate status, via `@relay/cli/lib`'s `listItemIds`
  + `runStatus`), `diff.ts` (`diffProjections` — pure stage-transition
  detection between two projection snapshots), `broadcast.ts`
  (`ClientRegistry` — WS client tracking and broadcast), `server.ts`
  (`buildServer` — Fastify app wiring `GET /api/items`, `POST /events`,
  `WS /stream`, and the `chokidar` watcher on `.relay/**`/`.git/HEAD`/
  `.git/refs` that recomputes, diffs, and broadcasts on any change),
  `index.ts` (the real `relay-daemon` bin entry, port 5182). Holds no
  authoritative state by construction — every read recomputes from disk;
  the in-memory `lastProjection` is a cache of the last read, never a store.
- `packages/daemon/test/` — **implemented.** 16 tests across 4 files.
- `packages/dashboard/` — mission control (planned, Phase 5)

## Features — with verified status

- [x] `@relay/core` — **verified 2026-09-11.** `npx tsc -b packages/core`
      builds clean; `npx vitest run` passes 36 tests across 6 files (hash 3,
      artifact 5, schema 4, ledger 13, state 6, drift 5). Hash-invalidation
      guard mutation-tested: disabling it fails exactly the VOIDS test. Core is
      pure — the only non-local imports are `node:crypto` and `yaml`.
      ⚠ Reviewed after building: five findings, two blocking, all recorded in
      `docs/HANDOVER_PHASE2.md` Part 3.
- [x] **F1 resolved** (2026-09-11) — option (a): `stage:` is written once at
      scaffold time and never rewritten afterward. No Phase 2 command mutates
      a committed artifact's frontmatter; the dashboard (Phase 5) shows the
      derived stage instead. Handover explicitly permitted proceeding with the
      recommended option without a separate ask (only (b)/(c) required one).
- [x] **F2 fixed** (2026-09-11, commit `8d803d5`) — `deriveStage` now builds
      its chain from `ctx.lane.requires` against fixed kind→gate/next-stage
      maps instead of a hardcoded `intent→spec→plan` chain, so the express
      lane (`requires: [plan]`) is reachable. 39 tests green (36 + 3 new), TDD
      throughout (failing tests confirmed before the fix).
- [x] `gate.ts` — **verified 2026-09-12.** `evaluateGate()` composes SPEC §7.1's
      three conditions (completeness + chain integrity, stage checks,
      authority) into one verdict every caller uses. `KIND_FOR_GATE` derived
      from `state.ts`'s `GATE_FOR_KIND` by inversion, exported from core —
      not hand-duplicated (it was, three times, before code review caught it;
      now lives in exactly one place).
- [x] Frontmatter + chain-integrity lint — **verified 2026-09-12.** `lane` and
      `upstream` (hash format, required for spec/plan except an express-lane
      plan.md) are validated; `evaluateGate`'s chain check enforces that a
      spec/plan's `upstream` names the currently-approved prior artifact,
      closing the SPEC §7.5 "spec written before intent accepted" gap.
- [x] `.relay/` convention, schemas and templates — **verified 2026-09-12.**
      `relay init` scaffolds `config.yml`/`roles.yml`/`templates/`/`schemas/`/
      `work/`, detects Tier-0/1 rule files, writes a GitHub Actions workflow
      when a GitHub remote exists. Schema YAML files mirror core's hardcoded
      rules for teams to read/fork — not yet read back by `relay lint`
      (documented as future work, not silently implied as live).
- [x] `SourceOfTruthAdapter` + simulated legacy connector — **verified
      2026-09-12.** `LegacyJsonAdapter` implements SPEC §12 against a local
      JSON file seeded by `relay init`; `pull`/`push`/`link` all throw
      (not silently no-op) when a referenced ticket doesn't exist.
      `relay new --from <ref>` routes through it.
- [x] `@relay/cli` — **verified 2026-09-12.** All ten commands (init, new, use,
      status, lint, gate, handover, resume, verify, adopt) built, wired into
      the real `relay` binary via commander, and demonstrated against the
      built binary (not just the unit suite) for Phase 2's stated acceptance
      criterion. The CLI is a transport throughout — every gate decision comes
      from `@relay/core`. `npx tsc -b packages/core packages/cli` clean;
      `npx vitest run` — 163/163 tests (68 core + 95 cli).
- [x] `@relay/mcp` universal MCP server — **verified 2026-09-14.** All five
      tools (`relay_current_item`, `relay_gate_status`, `relay_resume`,
      `relay_request_gate`, `relay_handover`) registered on a real `McpServer`
      over `StdioServerTransport`. Verified with a real `@modelcontextprotocol/sdk`
      `Client`, not just the unit suite: connected from a scratch repo with no
      `.relay/` at all, `listTools()` returned all five names, and
      `relay_current_item` returned an `isError: true` result with a clear
      message rather than crashing the server process. `relay_request_gate`
      only ever calls `appendEvent`, never `appendApproval` — enforced by
      construction (no import path to `appendApproval` exists in that file)
      and pinned by a mutation-tested regression test. 9/9 tests, 5 files.
- [x] `@relay/adapters/claude-code` hooks and stage skills — **verified
      2026-09-14.** `PreToolUse` blocks `Edit`/`Write` on source paths until
      the build gate is approved (`stage === 'done'`); `SessionStart` injects
      the resume briefing; three stage-interview skills installed; `relay init`
      wires all of it in automatically when `CLAUDE.md` is detected. Full
      acceptance sequence driven end-to-end against a real installed adapter
      in a scratch repo (`relay init` → `relay new` → hook blocks the edit,
      exit 2, stderr names the build gate → approve plan/design/build gates
      through the real CLI → the identical hook invocation now exits 0). One
      thing honestly still open, per workspace principle 5 ("be honest about
      testing limits"): a live, human-observed Claude Code session actually
      getting refused and then succeeding — nothing in this environment can
      drive a second interactive Claude Code process to watch that happen.
      18/18 tests, 4 files.
- [ ] `@relay/adapters/cursor` + `codex` — not started
- [x] `@relay/daemon` event spine — **verified 2026-09-14.** Fastify server on
      port 5182: `GET /api/items` (every item's derived stage/gate status,
      recomputed from disk on every call — never cached authoritatively),
      `POST /events` (the hook receiver — ephemeral, broadcast-only, never
      persisted), `WS /stream` (the event feed). A `chokidar` watcher on
      `.relay/**` and `.git/HEAD`/`.git/refs` recomputes the projection on
      any change, diffs it against the last-known one, and pushes a
      transition event to every connected client. Verified live against the
      built binary, not just the unit suite: with the real daemon running on
      a scratch repo, approving the `design` gate through the real CLI in a
      separate process pushed the transition event over a real WS connection
      in 651ms (IMPLEMENTATION_PLAN.md's own acceptance bound is one
      second); `curl localhost:5182/api/items` reflected the new stage.
      "No authoritative state" was demonstrated at the process level, not
      just asserted: killed the running daemon and restarted it against the
      same repo — `GET /api/items` returned the byte-identical projection
      both times, reconstructed fresh from disk with zero carryover from the
      killed process. 16/16 tests, 4 files. Explicitly out of scope for this
      phase (stated in `docs/plans/phase-4-daemon.md`'s own header, not
      silently dropped): serving the dashboard's static build (Phase 5
      doesn't exist yet), a browser-facing approve/reject endpoint (not a
      listed Phase 4 deliverable), persisting `POST /events` to disk (SPEC
      §14: ephemeral by design).
- [ ] `@relay/dashboard` mission control — not started
- [ ] Stage 6 trigger slice — not started
- [ ] Design pass — gated behind all of the above per the functional-first rule

## Gotchas

- **State is derived, never stored.** The `stage:` field in artifact frontmatter
  is written for human readability and is deliberately ignored by the engine. Do
  not make it load-bearing — that is the whole point of the design.
- **Approvals are hashes, not booleans.** An approval covers exact bytes; editing
  the artifact must void it. Any shortcut here defeats the entire tool.
- **Local hooks are ergonomics; CI is the enforcement.** Never present a
  pre-edit hook as a guarantee — a human editing files bypasses it, and tools
  without a hook system have no local ring at all.
- **Relay sits beside the coding tool, never on top of it.** It must work with
  Claude Code, Cursor and Codex alike. MCP is the primary integration; hooks are
  a per-tool enhancement. Any design that assumes one vendor is wrong — see
  `docs/SPEC.md` §4.1-4.5.
- **No session state, ever.** Which item you are on comes from the git branch
  (`relay/<item-id>`), state is recomputed from files and hashes on every read.
  Do not add a session store to "make resume faster".
- **`@relay/daemon` holds no authoritative state — the same principle applied
  to the daemon specifically.** `POST /events` is broadcast-only and never
  written to disk (SPEC §14: it's ephemeral tool-lifecycle telemetry, not
  part of `.relay/`'s convention); the in-memory `lastProjection` inside
  `buildServer()` is a cache of the last `buildProjection()` read, not a
  store — every `GET /api/items` call and every watcher-triggered recompute
  reads fresh from disk. Do not add persistence to either path "to make the
  dashboard faster" — verified by killing and restarting the real process
  and confirming an identical projection both times (Phase 4 acceptance
  run). A narrow, accepted race exists between the initial
  `buildProjection()` snapshot and `chokidar`'s own initial scan completing
  (see the comment above `watch(...)` in `packages/daemon/src/server.ts`) —
  `GET /api/items` always recovers the true state regardless; only a single
  live `WS /stream` notification could theoretically be missed.
- **Demos run live.** There is deliberately no replay or simulation demo mode.
  The recorded event stream in the test fixtures exists for UI iteration only and
  must never be wired to a demo path.
- v1 scope is Stages 1–3 plus a thin Stage 6 trigger. Stages 4 and 5 are dimmed
  lanes on the board, not machinery. Resist scope creep here.
- Port 5182 is assigned but unregistered. Check `apps.js` for conflicts again at
  registration time — the assignment is only as fresh as 2026-09-11.
- **Never call git via a raw shell string.** `packages/cli/src/git.ts` routes
  every git invocation through a private `execFileSync`-with-argv-array
  helper. This was a real, exploitable command-injection bug twice this
  session (`touchedFiles`, then `adopt.ts`'s diff calls) before landing here
  as the one rule — `--base <ref>` and similar CLI-flag-sourced values reach
  git eventually, and a shell string turns them into an injection vector.
- **`relay status`/`relay resume` only report a *real* blocker, never "this
  stage's own artifact doesn't exist yet."** Arriving at a stage always means
  its artifact hasn't been drafted — that's day one of the stage, not a
  problem. `evaluateGate` (correctly) flags a missing artifact as a
  completeness failure, so `runStatus` only calls it once the artifact
  exists; do not "simplify" this back into an unconditional call. Found only
  by running the built binary through the plan's own acceptance sequence —
  163 passing unit tests had missed it.
- `KIND_FOR_GATE` (gate → artifact kind) lives in exactly one place:
  `packages/core/src/gate.ts`, derived by inverting `state.ts`'s
  `GATE_FOR_KIND`, exported via core's `index.ts`. It was hand-duplicated
  three times before that (core's own gate.ts, the CLI's gate command, the
  CLI's status command) — import it, never re-derive it.
- **`installClaudeCodeAdapter()` is not yet portable off this monorepo.** It
  writes the *absolute path* to this repo's own built hook/MCP scripts into
  the target repo's `.claude/settings.json`/`.mcp.json`, resolved via
  `createRequire(import.meta.url).resolve(...)` so it always points at
  whatever is actually installed — but that only works for a target that can
  resolve `@relay/adapter-claude-code`/`@relay/mcp` from this same monorepo's
  `node_modules` (this workspace's own projects, and Phase 6's pilot copy).
  Not yet portable to a machine without this repo checked out — needs either
  publishing these packages or bundling the hook scripts into single
  self-contained files. Stated plainly in `docs/plans/phase-3-mcp.md`'s Task
  13, not silently implied as solved.
- **`relay_request_gate` must never write an approval — enforced by
  construction, not by convention.** It only calls `appendEvent` (writes
  `events.jsonl`); there is no code path to `appendApproval` anywhere in that
  file, and `packages/cli/src/lib.ts` (the only surface MCP tools import
  from) doesn't even re-export `appendApproval`. Conflating a request with an
  approval destroys the audit trail this whole tool exists to protect — exactly
  as load-bearing as "approvals are hashes, not booleans" above. If a future
  change to this tool ever needs to write an approval, that is a sign the
  tool's whole purpose has been misunderstood, not a small refactor.
- **`@relay/adapter-claude-code` and `@relay/cli` are a genuine circular
  *package* dependency** (the adapter needs `@relay/cli/lib` for `runStatus`
  etc.; `@relay/cli`'s `init.ts` needs the adapter's `installClaudeCodeAdapter`
  to wire it in) — npm workspaces handle this fine via symlinks, but a static
  or dynamic ESM import between them cannot build under `tsc -b`'s documented
  order (`core cli mcp adapters/claude-code`): whichever is type-checked
  first would need the other's declaration file, which doesn't exist yet.
  `packages/cli/src/commands/init.ts` loads the adapter via
  `createRequire(import.meta.url)` instead — `require()` returns `any`, so
  TypeScript never needs to resolve the adapter's `.d.ts` during `@relay/cli`'s
  own build; the actual lookup happens at runtime, by which point both
  packages are built. Verified the hard way: implemented it as a plain static
  import first, watched it build clean (a false positive from stale `dist/`
  left over from an earlier step), then deleted every `packages/*/dist` and
  `*.tsbuildinfo` to force a genuinely clean build and got the real `TS2307`
  failure — confirming the cycle is real before fixing it. If a third package
  ever needs the same "reach up into a plugin that depends on me" shape,
  reach for this pattern again rather than a project reference.
- **`import.meta.resolve()` doesn't work under Vitest's SSR transform** —
  throws `__vite_ssr_import_meta__.resolve is not a function`. Use
  `createRequire(import.meta.url).resolve(...)` instead wherever a package
  path needs resolving in code that unit tests also exercise; it's the
  standard Node-documented ESM equivalent and Vitest handles it correctly.
- **A single `*` in a vitest `include` glob cannot cross a `/`.** This
  project's `vitest.config.ts` originally read
  `packages/*/test/**/*.test.ts`, which silently never matched
  `packages/adapters/claude-code/test/...` (two path segments deeper than
  every other package) — the adapter's tests were invisible to `npm test`
  with no error, just zero tests collected from that directory. Widened to
  `packages/**/test/**/*.test.ts`. If a future package nests deeper still,
  this glob already covers it; don't narrow it back to a single `*` for
  "clarity."
- **Claude Code's `Edit`/`Write` hook payload carries an absolute
  `file_path`, never relative.** A naive `filePath.startsWith('.relay/')`
  check (as first drafted for the `PreToolUse` hook) never matches a real
  payload, silently turning the `.relay/`/`.claude/` exemption into dead
  code — resolve the path against the hook's `cwd` first
  (`path.relative(cwd, path.resolve(cwd, filePath))`) before comparing the
  leading segment.

## Next steps

Phases 1-4 are done and verified. `docs/plans/phase-2-cli.md` (26 tasks),
`docs/plans/phase-3-mcp.md` (14 tasks), and `docs/plans/phase-4-daemon.md`
(9 tasks) are all fully executed, reviewed, and committed — see the
Changelog below for the real bugs code review (and, for Phase 4, live manual
verification) caught along the way (several worth knowing about before
touching this code again; also captured as Gotchas above).

1. **`@relay/dashboard` next** (Phase 5) — depends on the daemon, which is
   now done and verified. Use the recorded event fixture (SPEC §14) to
   iterate on the UI; it is a test dependency only, never reachable from a
   demo path. Register in `apps.js` when it first boots on port 5182 —
   the daemon already owns that port and has been running against it in
   every verification run this phase, so the dashboard shares the same
   origin rather than needing a new port assignment.
2. Then the Stage 6 trigger slice (Phase 5b — only needs the daemon, not the
   dashboard, so it could in principle land before or alongside Phase 5).
   Cursor and Codex adapters can wait until the MCP surface has been
   dogfooded against real use through Claude Code first.
3. Phase 6 is the acceptance test, against a **copy** of outfit-advisor at
   `Projects/relay-pilot/` — never the real project, never on port 8080.
4. Still genuinely open, not deferred by choice: a live, human-observed
   Claude Code session actually getting an edit refused and then succeeding
   under the real hook — Phase 3's acceptance demo drove the same hook
   command exactly as Claude Code's documented dispatch mechanism does, but
   nothing in this environment can spawn a second interactive Claude Code
   process to watch it happen live. Worth doing once, by hand, before calling
   the adapter production-ready.

## Changelog — append-only, newest first

- 2026-09-14 (Phase 4 — `@relay/daemon`): Executed `docs/plans/phase-4-daemon.md`'s
  9 tasks via `superpowers:subagent-driven-development` — same discipline as
  Phases 2-3. Final state: `npm run build` clean across all five packages,
  `npx vitest run` — 209/209 tests (68 core + 98 cli + 9 mcp + 18 adapters +
  16 daemon), zero `.only`/`.skip`. Two things this phase verified live
  against the built binaries, beyond what the unit suite alone could prove:
  - **The one-second transition bound.** With the real daemon running on a
    scratch repo and a real WS client connected, approving the `design` gate
    through the real CLI in a separate process pushed the transition event
    in 651ms — comfortably under `IMPLEMENTATION_PLAN.md`'s stated bound.
  - **No authoritative state, at the process level.** Killed the running
    daemon mid-session and restarted it against the same repo; `GET
    /api/items` returned the byte-identical projection both times. The
    in-memory `lastProjection` inside `buildServer()` genuinely never
    survives a process death — it's a cache of the last disk read, not a
    store, exactly as Phase 4's own "critical" requirement demanded.
  One real, if narrow, design gap found and documented rather than silently
  left implicit (not a functional bug, so not "fixed," but worth knowing):
  a race window exists between `buildProjection()`'s initial synchronous
  snapshot and `chokidar`'s own initial directory scan completing, during
  which a filesystem change could be missed by both. `GET /api/items` always
  reads fresh regardless, so only a single live `WS /stream` notification
  could theoretically be lost — documented as an accepted v1 tradeoff in
  `packages/daemon/src/server.ts`'s own comment, per code review.
  One improvement made on the plan's own scoping, not just following it:
  the plan assumed `app.inject()` couldn't faithfully test the `WS /stream`
  route and deferred all its verification to a one-off manual run — while
  implementing, `@fastify/websocket`'s own `injectWS()` helper (documented
  in its README, not something the plan's author had checked) turned out to
  make that route just as unit-testable as any other, so two real automated
  tests were added instead of relying on manual verification alone.
  A debugging note worth keeping, since it looks like a bug until it isn't:
  a manual acceptance check that approves a gate with an identity holding no
  role in `.relay/roles.yml` will correctly show *no* stage transition and
  *no* watcher event — the approval is recorded, but `deriveStage`'s role
  check correctly refuses to advance the stage. This happened once during
  this phase's own manual verification and was traced to the test setup
  (a scratch identity never granted a role), not a daemon bug, before being
  correctly diagnosed and re-verified with `relay init`'s own default
  `roles.yml` (which already grants `you@example.com` every role) —
  `docs/IMPLEMENTATION_PLAN.md`'s literal acceptance script already uses
  that exact identity for exactly this reason.

- 2026-09-14 (Phase 3 — `@relay/mcp`, `@relay/adapters/claude-code`): Executed
  `docs/plans/phase-3-mcp.md`'s 14 tasks via `superpowers:subagent-driven-development`
  — same discipline as Phase 2 (fresh implementer subagent per task, independent
  spec-compliance and code-quality review subagents, fixes applied and
  re-verified before moving on, often by mutation testing). Final state:
  `npm run build` clean across all four packages, `npx vitest run` — 193/193
  tests (68 core + 98 cli + 9 mcp + 18 adapters), zero `.only`/`.skip`. The
  acceptance sequence was driven end-to-end against a real installed adapter
  in a scratch repo, invoking the built `PreToolUse` hook exactly as Claude
  Code's documented dispatch mechanism does — not just asserted by the unit
  suite. Real bugs found and fixed along the way, beyond the plan's own draft
  code (the plan itself was written this session, grounded in the actual MCP
  SDK's types and this workspace's own `.mcp.json`, but its illustrative test
  snippets still carried real bugs, all caught before merging, not after):
  - **`import.meta.resolve()` doesn't work under Vitest's SSR transform** —
    `install.ts`'s MCP-server-path resolution used it; every one of
    `install.test.ts`'s 5 cases failed identically with
    `__vite_ssr_import_meta__.resolve is not a function`. Switched to
    `createRequire(import.meta.url).resolve(...)`.
  - **A genuine circular package dependency**, not caught by the plan's own
    test-only verification: `@relay/adapter-claude-code` depends on
    `@relay/cli/lib` (Task 9), and Task 13 has `@relay/cli` depend on the
    adapter (to call `installClaudeCodeAdapter` from `relay init`). Neither a
    static nor a dynamic ESM import can satisfy this under `tsc -b`'s
    documented build order — confirmed by deleting every `packages/*/dist`
    and `*.tsbuildinfo` to force a genuinely clean build, which failed with
    `TS2307: Cannot find module '@relay/adapter-claude-code'` exactly as
    predicted. Fixed by loading the adapter via `createRequire` at runtime
    instead (see Gotchas above) — `require()` returns `any`, so TypeScript
    never needs the adapter's `.d.ts` during `@relay/cli`'s own build.
  - **The `PreToolUse` hook's `.relay/`/`.claude/` exemption was dead code**
    against real Claude Code payloads — `filePath.startsWith('.relay/')`
    never matches an absolute `file_path`, so a legitimate edit to tracked
    Relay artifacts got wrongly funneled into the gate check while a gate was
    pending. Found by code review, confirmed by adding a test with an
    absolute path (the real payload shape) and mutation-testing it: reverted
    to the naive check, watched the new test fail for exactly that reason
    (blocked instead of allowed), restored the fix.
  - **Malformed hook stdin was an unhandled rejection**, not a clean
    fail-open — `main()` was called without an awaited `.catch`. Wrapped it;
    now degrades to exit 0 like every other "Relay doesn't apply" branch.
  - **`vitest.config.ts`'s `include` glob silently never matched the
    adapter's test directory** — `packages/*/test/**/*.test.ts`'s single `*`
    cannot cross the extra `adapters/claude-code` path segment. `npx vitest
    run` with no path argument was collecting zero tests from that directory,
    with no error. Confirmed by running the full suite before and after
    widening the glob to `packages/**/test/**/*.test.ts`.
  - Every task's illustrative test snippet in the plan imported
    `runInit`/`runNew`/etc. from bare `'@relay/cli'`, which resolves to the
    commander bin entry (`index.ts`) and runs `program.parseAsync(process.argv)`
    as an import side effect — confirmed by reading `index.ts`'s last line.
    Every test file actually written imports from `@relay/cli/lib` instead
    (the side-effect-free surface Task 3 introduced for exactly this reason),
    applied consistently across all 12 task implementations.
  One discrepancy inherited from `docs/IMPLEMENTATION_PLAN.md` and resolved
  as the plan's own self-review states: the acceptance text names two
  different gates ("before the plan gate" vs. "after `relay gate build
  --approve`") for what should be one condition — implemented as "blocks
  until the build gate is approved (`stage === 'done'`)," the only
  self-consistent reading given the unambiguous half of the sentence.

- 2026-09-12 (Phase 2 — `@relay/cli`): Executed `docs/plans/phase-2-cli.md`'s
  26 tasks via `superpowers:subagent-driven-development` — a fresh implementer
  subagent per task, then independent spec-compliance and code-quality review
  subagents, fixes applied and re-verified (often by mutation testing: revert
  the fix, confirm the regression test fails for the right reason, restore)
  before moving on. Trivial mechanical tasks (1, 6, 7 — a keyword, a type
  block, export lines) were done directly rather than through the full
  pipeline; everything with real logic went through it. Final state: `tsc -b`
  clean for both packages, `npx vitest run` — 163/163 tests (68 core, 95 cli),
  zero `.only`/`.skip`, Phase 2's stated acceptance criterion demonstrated
  live against the built binary (Task 25), not just asserted by the suite.
  Real bugs found and fixed along the way, beyond the plan's own draft code:
  - **Command injection, twice.** `git.ts`'s `touchedFiles` and later
    `adopt.ts`'s diff calls used raw `execSync` shell strings with
    CLI-flag-sourced values (`--base <ref>`) interpolated in — both fixed to
    `execFileSync` with argv arrays, both confirmed by actually reproducing
    the injection (a `touch` side effect executing) before and after the fix.
  - **Ledger audit-integrity bug.** `relay gate`'s recorded `role` picked
    whichever role was listed first for an identity, not whichever role
    actually satisfied the gate — wrong "in what capacity did they approve"
    on the permanent record for the exact multi-role shape the default
    `roles.yml` ships with.
  - **`relay handover --to build` gap.** Always looked for intent.md's "Open
    questions" section regardless of target; spec.md's real equivalent
    (unresolved "Flagged concerns") was never surfaced. Fixed with a
    per-artifact-kind extractor (`openItemsFor`), shared with `relay resume`.
  - **`relay verify` (the CI enforcement path) had two real bugs**: a
    hardcoded `'main'` base ref crashed uncaught on any non-`main` repo
    instead of returning a report; and its own governed-lane drift test
    passed for the wrong reason (every gate failed on unrelated role/
    self-approval grounds before drift was ever relevant) — rewritten to
    genuinely isolate drift, plus the "governed lane, fully clean" success
    path added, which had never been exercised at all.
  - **`relay adopt`'s LLM-response handling** had no tolerance for a
    markdown-fenced response, no truncation detection, and trusted a bare
    type assertion on model output before writing three files in sequence —
    hardened with fence-stripping, `stop_reason` checking, and zod validation
    before any write.
  - **`relay status`/`relay resume` phantom blockers** — found only by
    running the actual acceptance sequence end-to-end (Task 25), not by any
    unit test: arriving at a freshly-entered stage reported "blocked" because
    that stage's own artifact doesn't exist yet, which is normal, not a
    problem. See Gotchas above.
  - Three separate hand-duplicated copies of the same kind↔gate bijection
    (`KIND_FOR_GATE`) consolidated into one export from core's `gate.ts`.
  One discrepancy inherited from the plan and resolved as the plan specified,
  not silently: SPEC §8 shows a standalone `relay reject`; the shipped CLI
  folds rejection into `relay gate --reject` per the Phase 2 deliverables
  table. Not done, per the workspace Definition of Done: `apps.js`
  registration (no dashboard exists yet to serve — that's Phase 5), `start.sh`/
  `stop.sh` (still intentionally fail — nothing to start until the daemon in
  Phase 4), port 5182 unchanged from its 2026-09-11 assignment.

- 2026-09-11 (Phase 1→2 bridge): Picked up `docs/HANDOVER_PHASE2.md`; verified
  all five Part 0 content hashes matched (no drift since the handover was
  written). **F1 resolved**: option (a) — `stage:` is written once at scaffold
  time and never rewritten after; the handover's own text permitted proceeding
  without a separate ask since only options (b)/(c) required one. **F2 fixed**
  test-first in `@relay/core`: added three failing express-lane tests to
  `state.test.ts`, confirmed they failed for the right reason (the hardcoded
  `intent→spec→plan` chain never looked at `plan.md` for an express item), then
  rebuilt `deriveStage`'s chain from `ctx.lane.requires` against fixed
  kind→gate/next-stage maps. 39/39 tests green, `tsc -b` clean, commit
  `8d803d5`. Then ran `karpathy-guidelines` and `superpowers:writing-plans`
  against Phase 2's scope (per the handover's own instruction, Part 5) and
  wrote `docs/plans/phase-2-cli.md` — 26 tasks, full TDD steps, covering
  `gate.ts` (F3, composes SPEC §7.1's three conditions), frontmatter +
  upstream-chain lint (F4), `config.ts` (zod finally earns its place),
  `SourceOfTruthAdapter` plus a simulated legacy-ticket connector (SPEC §12),
  and all ten `@relay/cli` commands. One discrepancy flagged, not silently
  resolved: SPEC §8 shows a standalone `relay reject`, but the Phase 2
  deliverables table only lists `relay gate --reject`; the plan follows the
  table and folds rejection into `--reject`. **No Phase 2 code has been
  written yet** — the plan is ready for `subagent-driven-development` or
  `executing-plans` to pick up next session.

- 2026-09-11 (Phase 1): Built `@relay/core` test-first, 9 tasks, one commit per
  green state. Verified: clean `tsc -b`, 34/34 tests green. All four invariants
  are enforced by tests, not convention — `artifact.ts` never reads `stage:`,
  an approval voids on hash mismatch, core imports no fs/net/git, and nothing
  in core claims enforcement. Two deviations from the plan, both recorded: (1)
  the plan's two self-approval fixtures in `ledger.test.ts` built a record at
  the `design` gate while calling `validApproval` with `build`, so the gate
  filter found nothing and the self-approval branch was never reached — fixture
  corrected to `gate: 'build'`, implementation untouched; (2) added a one-line
  `.gitignore` for `*.tsbuildinfo`, which composite builds emit beside
  `tsconfig.json` rather than inside the already-ignored `dist/`. Note `zod` is
  declared in `packages/core/package.json` but unused so far — `schema.ts` lints
  with plain string checks; zod earns its place when Phase 2 parses `config.yml`
  and `roles.yml`. Then reviewed core against the spec and found five gaps the
  plan's tests did not cover — two blocking (F1 `stage:` rewrite voids
  approvals; F2 express lane unreachable), two structural (no `gate.ts`
  composing SPEC §7.1's three conditions; lint ignores frontmatter, so
  `upstream` is never validated), plus minor edges. Fixed exactly one in core,
  because it was pure logic with a single right answer: approvals were ordered
  by `localeCompare`, so a chronologically earlier record with a different UTC
  offset won as "latest" and flipped a passing gate to failing — now ordered by
  real time, and an unparseable timestamp throws rather than being guessed at
  (36 tests, commit `e6c70bd`). Everything else was handed over rather than
  silently fixed: F1 needs Anirban's decision, F2 needs a design call, F3/F4 are
  Phase 2 by nature. Wrote `docs/HANDOVER_PHASE2.md`.

- 2026-09-11: Project created. Read the Anthropic AI-native SDLC playbook,
  brainstormed the design across two rounds of decisions (tool shape, audience,
  source of truth, v1 scope, hero beats, demo mode, stack, visual register), and
  wrote `docs/SPEC.md` — 18 sections, design approved. Scaffolded via
  `scripts/new-project.sh relay "client demo"`. Port 5182 assigned. Fixed one
  internal inconsistency in the spec during self-review (governed lane referenced
  a Stage 5 release-manager gate that v1 excludes). Then revised the
  architecture for tool portability: `@relay/plugin` became `@relay/mcp` plus an
  adapter family, added SPEC §4.1-4.5 (five integration tiers, branch-based
  session binding, `relay resume`, BYO-key boundary). Verified Cursor hook and
  Codex MCP support before writing the tier table. Then wrote
  `docs/IMPLEMENTATION_PLAN.md`: Phase 1 in full TDD detail (9 tasks, 34 tests),
  Phases 2-5b scoped, Phase 6 the acceptance test against a COPY of
  outfit-advisor at `Projects/relay-pilot/`. Self-review caught three gaps —
  wrong test count, no owner for the source-of-truth adapter, no owner for the
  Stage 6 trigger slice — all fixed. No code written yet.
