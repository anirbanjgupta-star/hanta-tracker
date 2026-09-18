# Handover — Phase 1 → Phase 2

**From:** Opus session, 2026-09-11 (built `@relay/core`, then reviewed it)
**To:** a fresh session, Sonnet, picking up Phase 2 (`@relay/cli`)
**Format:** the five-part bundle from `docs/SPEC.md` §8, because Relay should be
able to eat its own cooking before it asks a team to.

> Read this file, then `docs/SPEC.md` §4–§12, then the Phase 2 section of
> `docs/IMPLEMENTATION_PLAN.md`. You do not need to read `packages/core`
> line-by-line — Part 1 below tells you what it guarantees and what it does not.

---

## Part 0 — Frozen upstream, content-hashed

Drift detection for this bundle. If a hash below no longer matches, someone
changed the input after this handover was written — read the diff before
trusting anything here.

| Artifact | sha256 (first 16) |
|---|---|
| `docs/SPEC.md` | `9e0f41af8eb08a25` |
| `docs/IMPLEMENTATION_PLAN.md` | `4dcd724946293442` |
| `packages/core/src/ledger.ts` | `b11292ffbe28a2e3` |
| `packages/core/src/state.ts` | `9ddb35a01c4ce1ca` |
| `packages/core/src/schema.ts` | `7b513782b0a9818a` |

Check with: `shasum -a 256 docs/SPEC.md | cut -c1-16`

Phase 1 is commits `631aaae` … `e6c70bd` (ten commits). `git log --oneline` from
`631aaae` is the full build history, one commit per green state.

---

## Part 1 — What Phase 1 actually delivers

**Verified 2026-09-11:** `npx tsc -b packages/core` exits 0.
`npx vitest run` → **36 passed (36)** across 6 files — hash 3, artifact 5,
schema 4, ledger 13, state 6, drift 5.

`@relay/core` is pure. Confirmed by grep, not by intent: the only non-local
imports anywhere in `packages/core/src` are `node:crypto` and `yaml`, both pure.
No fs, no path, no net, no git, no process. **Keep it that way** — it is what
makes the gate logic testable, and it is where the correctness lives.

### The public surface you build on

```ts
hashContent(raw: string): string                    // 'sha256:' + hex, byte-exact
parseArtifact(raw: string, kind): Artifact          // throws if no frontmatter
lintArtifact(artifact): { ok, problems[] }          // body sections only — see F4
parseLedger(text: string): Approval[]               // JSONL, throws on a torn line
serialiseApproval(a: Approval): string              // untested; trivial
validApproval(approvals, gate, currentHash, ctx)    // GateResult — authority only
deriveStage(item, ctx): Stage                       // intake|plan|design|build|done
declaredFiles(planBody): string[]
checkDrift(planBody, touched, fatal): GateResult
```

### What it guarantees

- An approval is void the instant the artifact's bytes change. Mutation-tested:
  disabling the hash comparison fails exactly one test, the `VOIDS` test.
- `stage:` in frontmatter is never read by anything. Two tests enforce it.
- Approvals are ordered by real time, and an unparseable timestamp throws rather
  than being silently mis-ordered.

### What it does NOT do — do not assume otherwise

- **It does not compose a gate.** See F3. `validApproval` is condition 3 of the
  three in SPEC §7.1. Nothing combines completeness + checks + authority.
- **It does not validate frontmatter.** See F4. `upstream` is parsed and then
  never checked by anything.
- **It does not know about lanes beyond one `LaneRule` you pass in.** It never
  reads `LaneRule.requires`. See F2 — this breaks the express lane.
- **It does not touch disk.** Reading `.relay/`, resolving the branch, writing
  the ledger: all yours.

---

## Part 2 — Decisions made, and alternatives rejected

Recorded so you do not relitigate them or quietly reverse them.

1. **`schema.ts` lints with plain string checks, not Zod.** Zod is declared in
   `packages/core/package.json` and is so far unused. *Rejected:* wiring Zod
   into body-section linting, which is substring work Zod adds nothing to.
   **Zod earns its place in your phase** — parsing `config.yml` and `roles.yml`
   is exactly the shape it is good at. Use it there; do not retrofit it onto
   `lintArtifact` just because it is in the manifest.

2. **`gate.ts` and `config.ts` were never created**, although the plan's file
   structure lists both. Phase 1's nine tasks simply do not produce them. This
   was not an oversight to correct mid-phase; it is work that belongs to you
   (F3). Build them in `@relay/core`, not in the CLI.

3. **Two test fixtures in the plan were wrong and were corrected.** Both
   self-approval tests built an approval at the `design` gate while calling
   `validApproval` with `'build'`, so the gate filter found nothing and the
   self-approval branch was never reached. One of them was passing for the wrong
   reason. Fixtures fixed, `ledger.ts` untouched. *Lesson that generalises:* in
   this codebase a test asserting `passed === false` proves almost nothing on its
   own — always assert on the **reason**, because there are nine distinct ways to
   fail a gate and they are not interchangeable.

4. **`*.tsbuildinfo` is gitignored** in `Projects/relay/.gitignore`. Composite
   builds emit it beside `tsconfig.json`, not inside the already-ignored `dist/`.

5. **Only one review finding was fixed in core; the rest were handed to you.**
   The timestamp-ordering bug was pure logic with one right answer, so it was
   fixed here (commit `e6c70bd`). Everything in Part 3 either needs a design
   decision that is Anirban's to make, or is Phase 2 work by nature. Phase 1 is
   verified against its plan; it was not quietly extended past that gate.

---

## Part 3 — Open questions inherited

Five findings from the Phase 1 review. **F1 and F2 block a working `relay
verify`** — handle them before writing CLI commands on top of them. Each was
confirmed by running code, not by reading it.

### F1 — HIGH. Writing `stage:` back into frontmatter voids every approval

Two spec requirements collide. SPEC §5: `stage` is "written into the file for
human readability". SPEC §7.2: the approval "covers exact bytes". `hashContent`
hashes the whole file, frontmatter included — so the moment anything updates
`stage:` for readability, the hash moves and the approval dies.

Confirmed: approve a spec, change **only** `stage: design` → `stage: build`,
leave the prose untouched, and the gate flips to
`Artifact changed since approval`.

This is a live trap for `relay new`, `relay gate` and the daemon. Pick one,
and record the choice in PROJECT.md:

- **(a) Never rewrite frontmatter after creation.** `stage:` is set once at
  scaffold time and goes stale by design; the dashboard shows real state.
  Cheapest, and keeps "exact bytes" literally true. **Recommended** — and note
  §5 already calls the field "written for readability only".
- **(b) Hash the body only.** Makes `stage:` safely writable, but then
  `upstream`, `lane` and `policies` become editable after approval without
  voiding it. That is strictly worse: it lets someone escalate a lane or swap a
  policy under an approval that still reads as valid.
- **(c) Hash with frontmatter normalised, `stage` stripped.** Works, but "the
  approval covers exact bytes" stops being true and every future reader has to
  learn the exception.

Ask Anirban before implementing anything but (a).

### F2 — HIGH. The express lane is unreachable

`deriveStage` hardcodes the chain `intent → spec → plan` and never consults
`LaneRule.requires`. SPEC §7.6 says the express lane requires `plan.md` **only**.

Confirmed: an express item with an approved `plan.md` and no intent or spec
derives **`intake`** — forever. So the lane the spec designed for copy changes
and typos can never reach `done`, and `relay verify` can never pass for it.

The fix belongs in `state.ts` and needs a design call: build the chain from
`lane.requires` instead of the constant `CHAIN`, deciding which gate each
required artifact answers to. An express item's `plan.md` is approved at the
`build` gate, so the chain is just `[{gate:'build', kind:'plan', next:'done'}]`.
Write the failing test first; `state.test.ts` has the fixtures to copy.

### F3 — MEDIUM. Nobody composes the gate contract

SPEC §7.1 defines a gate as **three** conditions: completeness, checks,
authority. Core implements them as three unconnected functions and composes
nothing. Every caller — CLI, daemon, CI — would otherwise re-derive "is this
gate open?" and they would drift apart.

Build `gate.ts` in core: one function, `evaluateGate(item, gate, ctx):
GateResult`, that runs lint (condition 1), the stage-specific checks (condition
2 — Stage 2: every flagged concern resolved or accepted; Stage 3: named tests
ran), and `validApproval` (condition 3), returning one verdict with all reasons
accumulated. Then `relay status`, `relay verify` and the dashboard all answer
the question the same way. This is the single highest-value thing you build.

### F4 — MEDIUM. Lint ignores frontmatter entirely

`lintArtifact` checks body sections only. SPEC §7.1 condition 1 is "required
frontmatter fields **and** body sections". So:

- `upstream` is parsed by `artifact.ts` and validated by **nothing**.
- SPEC §7.5 lists "spec written before intent accepted" as a violation caught by
  "`spec.md` frontmatter names the intent hash; lint fails if unapproved". That
  check does not exist.

Extend lint to validate frontmatter per kind, and make `upstream` load-bearing:
a `spec.md` whose `upstream` is not the current approved `intent.md` hash must
fail. This is the chain integrity the whole design rests on.

### F5 — LOW. Rough edges, none blocking

- `parseLedger` throws a bare `SyntaxError` on one torn line, making the item
  ungateable with no line number. Failing loudly is **correct** for an audit
  ledger — do not downgrade it to skipping bad lines — but name the line number.
- `Stage` doubles as the gate type, so `gate: 'intake'` and `gate: 'done'` are
  representable nonsense. A separate `Gate = 'plan'|'design'|'build'` would stop
  it at compile time.
- `declaredFiles` returns every backticked span in the "Files that change"
  section, so a `` `readDb()` `` mentioned there counts as a declared file.
  Harmless today; filter to path-shaped strings when convenient.
- `checkDrift` exempts paths by the literal prefix `.relay/`. **Normalise
  touched paths to repo-relative POSIX before calling it**, or the exemption
  silently stops working and drift either passes everything or fails everything.
- `WorkItem.lane` and `Artifact.lane` can disagree and nothing reconciles them.
  SPEC §7.6 allows anyone to escalate and requires a recorded reason to
  downgrade; that rule has no owner yet.
- `serialiseApproval` is exported but untested.

---

## Part 4 — Applicable policies

Resolved once so you do not rediscover them.

- **`/Users/aj/Desktop/Claude/CLAUDE.md` is the operating manual.** Run
  `/karpathy-guidelines` before implementation work, and the `fable-playbook`
  skill before code review or convention calls. Both are required, not optional.
- **Workflow:** DISCOVER → ASK → UNDERSTAND → IMPLEMENT → VERIFY.
- **Three strikes is a hard rule.** If the same bug survives three fix attempts,
  stop and write up what you tried, observed and suspect. A fourth attempt is
  worse than the first, because the context is now full of dead ends.
- **Never assume a port.** `bash scripts/next-free-port.sh`. 5182 is assigned to
  Relay and was re-confirmed free on 2026-09-11, but re-check at registration.
- **Do not register Relay in `apps.js` until the dashboard actually boots** —
  that is Phase 5, not yours. The only launcher registry is
  `/Users/aj/Desktop/Claude/launcher/server/apps.js`; never touch
  `launcher_backup_*`.
- **Commit every green state**, one commit per working feature. Checkpoint
  before any refactor. Never end a session with working code uncommitted.
- **Update PROJECT.md before declaring done** — it is the handoff contract.
- **TDD is not optional here.** Watch every test fail before implementing it.
  The reason is concrete: two of the plan's own fixtures were wrong, and one was
  passing for the wrong reason. Tests you did not watch fail prove nothing.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` —
  change the name to the model actually doing the work.

### The four invariants — weakening any one makes the tool worthless

1. State is derived, never stored. `stage:` is decoration.
2. An approval is a signature over a content hash. Editing voids it. There is no
   re-validate step; validity is recomputed on every read.
3. `@relay/core` is pure. Strings and objects in, objects out.
4. Local hooks are ergonomics; **CI is the enforcement.** Never describe a
   pre-edit hook as a guarantee.

---

## Part 5 — What Phase 2 owes

Per the plan, **start by running `superpowers:writing-plans` against the Phase 2
scope and writing `docs/plans/phase-2-cli.md` with full TDD steps.** Do not
start coding from the scope table alone.

Deliverables, in the order that respects dependencies:

1. **F1 and F2 first** — a decision on F1 and a fix for F2. Both sit underneath
   every command you are about to write.
2. **`gate.ts` and `config.ts` in core** (F3, F4). Still pure. Still test-first.
3. **The `.relay/` convention** — config, roles, schemas, templates — created by
   `relay init`. Core deliberately knows nothing about folders; the CLI owns all
   filesystem work.
4. **The commands:** `init`, `new`, `use`, `status`, `lint`, `gate`, `handover`,
   `resume`, `verify`, `adopt`. Table in the plan's Phase 2 section.
5. **`SourceOfTruthAdapter`** (SPEC §12) plus a simulated legacy connector
   against a local JSON file, so a demo never needs a reachable Jira. Plus
   `relay new --from <ref>` routed through it. This has no other owner.

**The hard constraint:** the CLI is a transport. Every gate decision comes from
`@relay/core`. The moment a CLI command decides whether a gate passes, the
design is broken and the logic is no longer testable without a filesystem.

**Acceptance, from the plan — demonstrate it, do not assert it.** On a scratch
git repo: `relay init && relay new "test" && relay gate plan --approve && relay
status` reports stage `design`. Then edit `intent.md` and `relay status` reports
`plan` again, with a reason naming the change. Paste the real terminal output.

### Where models were specified

The plan assigns Phase 1 to Opus (subtle pure logic) and Phases 2–5 to Sonnet
(wiring against types that already exist). Phase 6 starts on Sonnet and
escalates to Opus if a failure survives two attempts. Separately: when Relay's
own headless paths need a model — `relay adopt`, the Stage 6 intent writer —
default to `claude-opus-5` via the official `@anthropic-ai/sdk`, with the key
read from the environment and never from the repo.
