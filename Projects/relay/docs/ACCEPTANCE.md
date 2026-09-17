# Phase 6 — Acceptance test, against a copy of `outfit-advisor`

Run 2026-09-17. Per `docs/IMPLEMENTATION_PLAN.md`'s Phase 6 section — this is v1's definition of done.

**Setup:** `Projects/relay-pilot/outfit-advisor/` — a copy of `Projects/outfit-advisor/` (rsync, excluding `node_modules`, `.git`, `server/data`), given its own git history, run on port **8090** (never 8080, the real project's port — confirmed still running there, untouched, throughout this entire run). Migrated 31 suits / 18 watches, confirmed rendering live in the Browser pane before Relay touched anything.

**Overall result: all ten criteria demonstrated, with evidence below.** Getting there surfaced four real, previously-undiscovered gaps in Relay itself — two were bugs, fixed on the spot with TDD, matching this project's established practice; two are honestly-recorded limitations, not fixed, because fixing them wasn't what this criterion asked for. All are detailed under the criterion where they surfaced.

---

## Task 6.1 — the pilot copy

- Copy created at `Projects/relay-pilot/outfit-advisor/`, own git history (`git init`, initial commit `bee0a39`), own port (8090).
- `npm install` in `server/` (deps live there, not at the repo root — the top-level `npm install` attempt failed for exactly that reason, corrected immediately).
- `node scripts/migrate.js` seeded 31 suits / 18 watches.
- Verified rendering **before** Relay touched anything: `curl` confirmed `200`/31 suits, and a real browser screenshot showed the catalog UI rendering correctly (title, filters, 31/31 suits, real photos).
- Not registered in `apps.js` — confirmed, no entry added.

## Task 6.2 — the ten criteria

### 1. `relay init` — detect, scaffold, report tier

Ran on a repo with no `.claude/`/`CLAUDE.md`. Output: `Tier 0 reached. No GitHub remote — CI workflow skipped. Claude Code not detected — adapter not installed.` `.relay/` fully scaffolded (config, roles, policies, schemas, templates, work/).

**Real bug found and fixed:** `defaultRolesYaml()` (`packages/cli/src/templates.ts`) hardcoded the literal placeholder `you@example.com` instead of the actual git identity of whoever ran `init` — meaning **every fresh `relay init`, for anyone, ever, granted zero roles to the person who just ran it.** In a `governed`-lane repo this makes self-approval correctly-but-uselessly blocked from minute one, with no obvious cause. Fixed: `defaultRolesYaml(identity: string)` now takes the identity; `init.ts` passes `gitIdentity(cwd)`. TDD: a failing test confirmed the exact wrong output first (`init.test.ts`, `templates.test.ts` updated), then the fix, then 278/278 green. This is a correctness fix to Relay itself, not the pilot — landed in `packages/cli/src/templates.ts` and `commands/init.ts`.

**Real gap found, not fixed (out of this criterion's scope, but blocking below):** `runInit`'s `force` option exists and is unit-tested, but `relay init`'s actual CLI command (`packages/cli/src/index.ts`) never exposed a `--force` flag — so a real user could never re-scaffold `.relay/` (e.g. after adding a `CLAUDE.md` for the first time) without deleting `.relay/` by hand. **Fixed alongside the roles.yml bug**, since criterion 6 below could not otherwise be demonstrated without either wiring it or destructively restarting the whole item's history: `.option('--force')` added to the `init` command, passed through to `runInit`.

**Minor cosmetic issue, left alone:** every `remoteIsGitHub()` check on a repo with no `origin` remote prints `error: No such remote 'origin'` to stderr — `git`'s own raw error, leaking past the `try/catch` that correctly handles the *logical* outcome (`remoteIsGitHub` returns `false`, `init` correctly reports "No GitHub remote"). Confirmed pre-existing and not something this session's changes caused: the same line appears 7 times in the existing `init.test.ts` suite's own output, unrelated to any edit made here. Noise, not a correctness problem — not fixed, per the "adjacent, mention don't fix" rule.

### 2. Daemon + dashboard board

No `relay serve` command exists — the plan's own wording doesn't match the built tool; the daemon (`@relay/daemon`, its own binary/`node packages/daemon/dist/index.js`) and the dashboard (`npm run dev --workspace=@relay/dashboard`) are, and always have been, two separate processes (already noted in `PROJECT.md`'s own "Next steps"). Started both against the pilot repo on 5182/5173. `GET /api/items` returned `[]`; the Browser pane confirmed all five panels empty and correct (no incidents, no items in any lane, no active sessions, nothing waiting).

### 3. `relay new "persist catalog metadata in git" --lane governed`

Created `001-persist-catalog-metadata-in-git` on branch `relay/001-persist-catalog-metadata-in-git`, lane `governed`. Confirmed via `git branch`, `.relay/work/`, `GET /api/items`, and a live screenshot: the card appeared under "plan" in Pipeline Lanes and in Waiting on You.

### 4. Agent drafts `intent.md`

Drafted directly (I am the acting agent in this environment) from real inspection of the pilot's own `server/lib/db.js` and `server/routes/suits.js` — the Problem/Proposed outcome/Affected systems/Constraints/Open questions sections describe the actual, real data-loss mechanism, not a generic placeholder. `relay lint` → clean. `relay status` → stage `plan`, blocked only by "No approval recorded."

### 5. Approve in the browser → Design; spec drafted, concern flagged and resolved

Clicking the dashboard's real Approve button **correctly failed** the first time: `governed`'s `allowSelfApproval: false` blocked it, since I am the only identity in this environment (the item's author and the only possible approver). This is the lane's control working as designed, not a bug.

**Discovered gap:** the dashboard's "Waiting on you" panel exposes only Approve/Send back — no override control — so a governed-lane, single-approver deadlock like this one can only be broken from the CLI, never from the dashboard that's meant to be mission control. Not fixed (a Phase 5 dashboard scope question, not this criterion's), but worth knowing.

Used `relay gate plan --override --reason "..."` (the tool's own designed escape hatch for exactly this situation) — item moved to `design`, confirmed live in the dashboard. Drafted `spec.md`: **Design** resolves the concern explicitly (`db.json` stops being gitignored and becomes tracked — the simplest option that fits this single-user, no-concurrent-writer project, with the rejected alternative — a separate append-log — named and reasoned about). **Flagged concerns** checklist: three items, all `[x]` resolved or accepted-risk, none left open. `relay lint` → clean.

### 6. Agent blocked from editing `server/` until the build gate passes

Adopting the adapter required a `CLAUDE.md` to exist **at `relay init` time** (tier detection happens then, not retroactively) — added one to the pilot copy, then re-ran `relay init --force` (the flag wired for criterion 1 above). `Tier 1 reached... Claude Code adapter installed.` — `.claude/settings.json`, three skills, `.mcp.json` all present.

Simulated the `PreToolUse` hook directly via stdin, matching Phase 3's own precedent (no way to spawn a second interactive Claude Code session in this environment — same honestly-stated limitation as every prior phase):

```
$ echo '{"cwd":"...","tool_name":"Edit","tool_input":{"file_path":"server/lib/db.js"}}' \
  | node .../hooks/pre-tool-use.js
Relay: blocked — the build gate is not yet approved (No approval recorded). Run `relay gate build --approve` once ready.
exit code: 2
```

After drafting `plan.md`, implementing the fix, running the tests, and recording an evidence-backed build-gate override (see criterion 7), `relay status` reported stage `done`. Re-ran the identical hook invocation: **exit code 0, no output** — unblocked.

**Genuine architecture finding, documented, not a bug:** `runGate`'s `override` action never calls `evaluateGate` — it unconditionally records the approval. Whether that override is *accepted* as authorizing forward progress is decided by `deriveStage`, which (by an explicit, deliberate comment in `packages/cli/src/commands/status.ts`) uses the thin, authority-only `validApproval` — never the full `evaluateGate` (lint completeness, chain integrity, unresolved concerns, the build gate's tests-passed check). So **`--override` on the build gate advances local stage to `done` regardless of whether tests were ever run** — only `relay verify` (via `evaluateGate`, fed real `--tests-passed` evidence) would catch a false claim. This is consistent with, and a live confirmation of, `PROJECT.md`'s own existing Gotcha ("Local hooks are ergonomics; CI is the enforcement") — extended here to `override` specifically, which wasn't previously spelled out. Recorded as a new Gotcha in `PROJECT.md` (see below). Not fixed — it matches documented intent.

Because the tool itself doesn't independently verify tests were run, I made sure the audit trail itself was honest anyway: an early experimental override was tried first, deliberately, to test this exact question (reason: `"test: confirm override does not bypass the tests-passed check"`) — then, after actually running the tests for real, a second, genuine override was recorded naming the real evidence (`"Ran server/test/db-persistence.test.js via 'npm test' in server/ — both named tests pass (2/2)..."`). Both are visible in `.relay/work/001-persist-catalog-metadata-in-git/approvals.jsonl`, left as-is — a true record of what happened, not cleaned up to look tidier.

### 7. The real defect, fixed through the pipeline

**The defect** (from `outfit-advisor`'s own PROJECT.md, confirmed by reading `server/lib/db.js`/`server/routes/suits.js` directly): catalog metadata added through the UI lived only in `server/data/db.json`, untracked runtime state — a `scripts/migrate.js` re-run would silently lose anything added after the original 31/18 seed.

**Nuance found while implementing:** `outfit-advisor`'s own `PROJECT.md` describes this file as "gitignored" — true for the *real* project (the rule lives in the **workspace-root** `.gitignore`, scoped to `Projects/outfit-advisor/server/data/db.json` specifically), but the pilot copy is its own separate git repo and never inherited that rule — `db.json` there was simply untracked, not ignored. The actual code fix is the same either way (track the file); `spec.md`'s "remove from `.gitignore`" language doesn't literally apply to the pilot's own repo, which is worth knowing if this pilot is ever compared line-for-line against the real project's actual `.gitignore`.

**The fix:** `server/data/db.json` committed to git (commit `996fe43`). `scripts/migrate.js`'s existing idempotency guard (refuses to overwrite when suits already exist) already covered the "don't destroy on re-run" requirement — confirmed by reading it, not assumed; no code change needed there.

**The tests** (this project had no test directory before this): `server/test/db-persistence.test.js`, using Node's built-in `node:test`/`node:assert` (no new dependency) — named in `plan.md` before being written, exactly as the acceptance criterion requires:
1. `db.json` is tracked in git (`git ls-files`) — mutation-tested: failed correctly when the file was deliberately unstaged, passed once restaged.
2. `scripts/migrate.js` exits non-zero and leaves the catalog unchanged when data already exists.

`server/package.json`'s `"test"` script changed from a placeholder `exit 1` stub to `node --test`. **2/2 tests pass.**

### 8. The crown jewel — `relay verify` catches a tampered `spec.md`

Baseline: `relay verify --base main --tests-passed` → **passed** (the plain `--base main` run, without `--tests-passed`, correctly failed first, on the build gate's tests-passed condition — confirming `verify`, unlike local `gate --override`, really does check this).

Edited `spec.md` directly (adding one sentence) *after* its recorded approval, without re-approving:

```
$ relay verify --base main --tests-passed
001-persist-catalog-metadata-in-git: verify FAILED
  - [design:spec] Artifact changed since approval (approved sha256:7355f4fe..., current sha256:9dd81c80...)
  - [build:plan] upstream spec is not currently approved: Artifact changed since approval (approved sha256:7355f4fe..., current sha256:9dd81c80...)
```

Named the exact hash mismatch, and correctly cascaded the failure to the downstream build gate's chain-integrity check too — not faked, not a canned message.

Re-approved design (`--override`, same solo-environment reason as every other gate here), updated `plan.md`'s `upstream` field to the new spec hash (a real workflow would redraft `plan.md` to acknowledge the new upstream — done here), re-approved build:

```
$ relay verify --base main --tests-passed
001-persist-catalog-metadata-in-git: verify passed.
```

**If this had been faked, it would have been the whole tool's failure. It wasn't.**

### 9. Cold resume

Killed both the daemon and dashboard processes (`kill`, confirmed via `lsof` on both ports — genuinely dead, not just backgrounded). Ran `relay resume` with nothing else running:

```
001-persist-catalog-metadata-in-git — stage: done
Open questions: None recorded.
Recent history:
  - relay: scaffold .relay/ tooling and item 001's artifacts (intent, spec, plan, approvals)
Next: Nothing — this item is complete.
```

Accurate on every count: stage really is `done`; "None recorded" is correct because `resume` reports the *current* (last) artifact's open questions and `plan.md` has no such section — the item's original open questions (in `intent.md`) were genuinely resolved during design, not silently dropped; "recent history" was empty until `.relay/work/`'s artifacts were actually committed to the pilot's own git history (they hadn't been — a gap in *this run's* workflow, not in Relay, since these files are ordinary tracked source per the tool's whole design) — after committing, the real commit subject appeared.

### 10. Real metrics

```
$ curl -s http://localhost:5182/api/metrics
{"gateLatencyS":{},"stageCycleTimeS":{},"overrideCount":6,"firstPassRate":1}
```

`overrideCount: 6` matches, by hand-count, the exact six `--override` actions recorded above (plan, design, an experimental build override, a real evidence-backed build override, a design re-approval, a build re-approval). `gateLatencyS` is correctly empty — no `gate_requested` events were ever emitted for this item, so there's genuinely nothing to compute latency from. Confirmed identically in the dashboard's Flow Metrics panel (screenshot: "Overrides: 6", "First-pass rate: 100%") — the same numbers, same source, nothing hand-entered anywhere.

## Task 6.3 — report and clean up

- This document.
- `cd /Users/aj/Desktop/Claude && git status --short Projects/outfit-advisor` → **no output.** The real project is untouched. It was running on port 8080 (its own, pre-existing, launcher-independent process) the entire time; the pilot only ever used 8090.
- `Projects/relay-pilot/` is left in place — **not deleted**, per the plan's own "ask before deleting" instruction.

## Summary of what this run changed in Relay itself

- `packages/cli/src/templates.ts`, `commands/init.ts` — `defaultRolesYaml` now takes and stamps the real git identity instead of a hardcoded placeholder. Real bug, real fix, TDD, 278/278 green.
- `packages/cli/src/index.ts` — `relay init` gained a `--force` flag wired to the already-tested, already-existing `runInit({force})` option.
- `PROJECT.md` — Features/Gotchas/Next steps to be updated to reflect Phase 6's completion and these two fixes (done as part of this same session, see the Changelog entry there).
