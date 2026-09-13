# relay — PROJECT.md

> This is a **handoff file**. A fresh Claude session must be able to resume this project from this file alone — even after a year — as if it were a next-day handoff. If resuming requires rediscovering anything by scanning the codebase, this file has failed. Update it at the end of every session, without being asked.

**Status:** Phase 1 and Phase 2 complete and verified. `@relay/core` (F1-F4 all closed)
and `@relay/cli` (all ten commands, `SourceOfTruthAdapter` + simulated legacy
connector) built via `docs/plans/phase-2-cli.md`'s 26-task TDD plan, executed with
`subagent-driven-development` and independently re-verified at every step. 163/163
tests green (68 core + 95 cli), `tsc -b` clean, Phase 2's stated acceptance criterion
demonstrated live against the built binary. Phases 3-6 not started.
**Tier:** client demo
**Last session:** 2026-09-12

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
- `packages/cli/test/` — **implemented.** 95 tests across 16 files.
- `packages/daemon/` — event spine (planned, Phase 4)
- `packages/dashboard/` — mission control (planned, Phase 5)
- `packages/mcp/` — universal MCP server (planned, Phase 3)
- `packages/adapters/` — per-tool enhancements beyond the simulated connector
  above (planned, Phase 3)

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
- [ ] `@relay/mcp` universal MCP server — not started
- [ ] `@relay/adapters/claude-code` hooks and stage skills — not started
- [ ] `@relay/adapters/cursor` + `codex` — not started
- [ ] `@relay/daemon` event spine — not started
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

## Next steps

Phase 1 and Phase 2 are both done and verified. `docs/plans/phase-2-cli.md`'s
26 tasks are all executed, reviewed, and committed — see the Changelog below
for the real bugs code review caught along the way (several worth knowing
about before touching this code again; also captured as Gotchas above).

1. **`@relay/mcp` next** — it is the universal integration and the one every tool
   supports. Then `@relay/adapters/claude-code` for hooks and skills; Cursor and
   Codex adapters only once the MCP surface has stabilised against one tool.
   `relay_request_gate` must never write an approval.
2. Daemon, then dashboard, then the Stage 6 trigger slice.
3. Register in `apps.js` when the dashboard first boots on 5182.
4. Phase 6 is the acceptance test, against a **copy** of outfit-advisor at
   `Projects/relay-pilot/` — never the real project, never on port 8080.

## Changelog — append-only, newest first

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
