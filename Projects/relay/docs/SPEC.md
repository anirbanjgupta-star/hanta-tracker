# Relay — design specification

**Version:** 1.0 (design agreed 2026-09-11)
**Status:** approved design, not yet implemented
**Source material:** Anthropic, "The AI-Native SDLC Playbook" — https://claude.com/blog/the-ai-native-sdlc-playbook

---

## 1. Problem

The playbook specifies a six-stage AI-native SDLC — Plan, Design, Build, Test,
Deploy, Maintain — where each stage commits a version-controlled artifact the
next stage reads (`intent.md` → `spec.md` → `plan.md` → diff + tests → PR →
incident `intent.md`). It names the gates, the roles that own them, and the
leading and lagging metrics for each stage.

What it does not provide is a runtime. There is no place a work item lives, no
way to know which gate it is sitting at, no record of who let it through, and
no shared view of what is in flight. An individual with Claude Code and good
habits already captures most of the playbook's value; a team does not, because
the missing pieces are all connective tissue between people and between
sessions.

Relay is that runtime. It is not "AI that does the SDLC" — Claude Code already
does the work. Relay is artifact scaffolding, gate enforcement, handover
packaging, and a live shared view of the pipeline.

---

## 2. Design principles

1. **The markdown files are the database.** YAML frontmatter carries machine
   state, the body carries human prose, git carries history, the approval
   ledger carries accountability. No server of record. The audit trail is
   `git log`.
2. **State is derived, never stored.** An item is in Build because an approved
   `spec.md` exists whose hash matches the file on disk — not because someone
   set a field. There is no status field to lie about.
3. **An approval is a signature over a content hash, not a boolean.** Change
   the artifact and the approval voids itself automatically.
4. **Enforce at the merge, not at the keystroke.** Local hooks are ergonomics;
   the required CI check is the enforcement.
5. **Every escape hatch is recorded, never blocked.** A process with no exit
   gets routed around silently, which leaves no data at all.
6. **The compliant path must be the fast path.** Compliance driven by policing
   decays; compliance driven by the process genuinely being faster does not.
7. **Risk lanes, not universal ceremony.** Three documents to change a button
   label is waterfall with markdown, and it will be abandoned in a fortnight.

---

## 3. Scope

### v1 covers
- Stages 1–3: Plan, Design, Build — the full artifact chain and its gates
- A thin **Stage 6 trigger slice**: a deterministic detector that writes an
  `intent.md` into the pipeline with no human in the invocation path
- Live mission-control dashboard with spotlight mode
- Source-of-truth adapter with a simulated legacy connector

### v1 explicitly excludes
- Full Stage 4 (Test) and Stage 5 (Deploy) stage machinery — these depend on
  CI and deployment infrastructure that varies too much per team to model
  usefully yet. They appear on the board as dimmed future lanes.
- Hosted/multi-tenant operation. Relay runs locally against a repo.
- A replay or simulation demo mode. Demos run live (see §14).

### Audience order
1. Keynote artefact — a working prototype that makes the process visible
2. Dogfooded on this workspace's own projects
3. Open-source release for any team

---

## 4. Architecture

```
Coding agent ──MCP + hooks──┐      (Claude Code / Cursor / Codex)
Git commits ────watcher──────┼──▶  Relay daemon  ──WebSocket──▶  Dashboard
.relay/*.md ────watcher──────┘    (event bus +               (live, interactive)
                                   gate engine)
Jira/ServiceNow ◀──adapter──────────────┘
```

TypeScript monorepo, five packages:

| Package | Responsibility |
|---|---|
| `@relay/core` | Schemas, artifact parser, hash + approval logic, gate evaluator, state derivation, adapter interface. Pure — no I/O. The testable heart. |
| `@relay/cli` | `relay init / new / lint / status / gate / handover / adopt / verify / serve` |
| `@relay/daemon` | Fastify. File and git watchers, hook receiver endpoint, event bus, WebSocket feed, serves the dashboard. |
| `@relay/dashboard` | React + Vite. Mission control. |
| `@relay/mcp` | **The primary integration.** MCP server exposing `relay_current_item`, `relay_gate_status`, `relay_resume`, `relay_request_gate`, `relay_handover`. Works in any MCP-capable tool. |
| `@relay/adapters/*` | Per-tool enhancements: `claude-code` (hooks, skills, `CLAUDE.md`), `cursor` (`hooks.json`, `.cursor/rules`), `codex` (`AGENTS.md`). Installed by `relay init` based on what it detects in the repo. |

**Port:** 5182 (assigned via `scripts/next-free-port.sh`, free in `apps.js` and
`lsof` as of 2026-09-11).

`@relay/core` holds all judgment. The daemon and CLI are transports; the
dashboard is a view. Anything that decides whether a gate passes lives in core
and is unit-testable without a filesystem.

### 4.1 Relay sits beside the coding tool, not on top of it

Relay is to a coding agent what git is to an editor: both operate on the same
repo, neither wraps the other. The agent edits files; Relay watches files. This
is what makes the tool portable — a wrapper would need reimplementing per tool
and would break on every upstream release, whereas a watcher works with Claude
Code, Cursor, Codex, or a human in vim, unchanged.

There is no "run Relay" step. `relay serve` runs as a daemon alongside the work,
and gates are evaluated continuously as a pure function of the files on disk.

### 4.2 Five integration tiers, degrading gracefully

| Tier | Surface | What it buys | Claude Code | Cursor | Codex |
|---|---|---|---|---|---|
| 0 | Filesystem + git watcher | State, transitions, dashboard, metrics | yes | yes | yes |
| 1 | Rules file | The agent knows the protocol | `CLAUDE.md` | `.cursor/rules` | `AGENTS.md` |
| 2 | MCP server | Agent queries state, requests gates, loads resume briefs | yes | yes | yes |
| 3 | Hooks | Live ticker, local blocking | full | full | partial |
| 4 | CI check | The actual enforcement | tool-agnostic | tool-agnostic | tool-agnostic |

**Tier 2 is the primary integration.** MCP is the one surface every serious tool
supports, and it makes the agent an active participant rather than something
being observed. Hooks are a per-tool enhancement, not a dependency.

**The guarantee is identical across tools, because Tier 4 is where enforcement
lives and CI does not know what editor produced the diff.** Only ergonomics
differ: Claude Code and Cursor get local blocking and a real-time ticker; a tool
with no hook system still gets full state derivation, the full dashboard, and an
unbypassable gate at merge.

Verified integration surfaces as of 2026-09-11: Cursor shipped agent lifecycle
hooks in 1.7 (`onPreEdit` can veto an edit, plus shell and MCP execution hooks)
and supports MCP. Codex CLI supports MCP over stdio and uses `AGENTS.md` as its
instruction file; its hook story is less complete, which is exactly what Tier 0
and Tier 4 exist to cover.

`relay init` detects which tools are present and installs the matching adapters.

### 4.3 Session binding — which item am I on?

The **git branch is the binding**: `relay/<item-id>`. It is durable, shared,
survives every session, and already exists in normal workflow. For flows that do
not branch per item, a gitignored `.relay/CURRENT` pointer set by `relay use
<item>` is the fallback.

Nothing else binds a session to an item. In particular, no session id is stored,
because session ids do not survive the thing this design has to survive.

### 4.4 State, transitions, and resuming

**State is recomputed, never restored.** Three inputs: the artifacts in
`.relay/work/<item>/`, their content hashes, and `approvals.jsonl`. There is no
stored state that can go stale or disagree with the repo.

**Transitions are reconstructed, not tracked.** The watcher notices a file
change, recomputes state, and emits a transition event if the derived stage
moved. The authoritative history is `git log` over the item folder — every
transition, timestamped and attributed, permanently.

**Closing a session costs nothing, because Relay holds no session state.** On
reopen it reads the branch, reads the folder, validates the hashes, and knows
where things stand.

`relay resume` turns that into a briefing: what this item is, which stage, which
gate blocks it, what the last session did, which questions remain open, what is
next. It is the §8 handover bundle pointed at yourself. Where the tool supports
it — a `SessionStart` hook, or the `relay_resume` MCP tool — the brief is loaded
into the agent's context automatically, so a reopened session starts oriented
instead of asking the human to re-explain.

### 4.5 Bringing your own key

Inside a coding session Relay needs no model access at all: the agent is already
the model, and Relay supplies templates and context through MCP.

A key is required for exactly two headless paths — `relay adopt` drafting
artifacts backwards from an existing diff, and the Stage 6 detector writing an
`intent.md` with no human in the path. `config.yml` carries `provider` and reads
the key from the environment, never from the repo. A team using neither feature
never needs a key.

---

## 5. The `.relay/` convention

```
.relay/
  config.yml            # lanes, source-of-truth policy, enforcement levels
  roles.yml             # identity → role mapping, resolved like CODEOWNERS
  schemas/
    intent.schema.yml
    spec.schema.yml
    plan.schema.yml
  templates/
    intent.md  spec.md  plan.md
  policies/              # org policy source, compiled into .claude/skills/
  work/
    <item-id>/
      intent.md
      spec.md
      plan.md
      approvals.jsonl    # append-only ledger
      handover/
        design.md        # bundle handed to Stage 2
        build.md         # bundle handed to Stage 3
      events.jsonl       # local session event log
```

One folder per work item, whole lifecycle inside it, greppable. Item ids are
`<counter>-<slug>` (e.g. `047-sso-for-admin`).

### Artifact frontmatter (common fields)

```yaml
id: 047-sso-for-admin
lane: governed          # express | standard | governed
stage: design           # derived, written for readability only — never trusted
upstream: sha256:9f3a…  # hash of the artifact this one descends from
policies: [security-baseline, api-design]
external_ref: JIRA-4821 # optional, set by the adapter
```

`stage` is written into the file for human readability and is **ignored by the
engine**, which always recomputes it. This is deliberate: a field that can be
edited must never be load-bearing.

---

## 6. Stage inputs and outputs

| Stage | Input | Producer | Output artifact | Gate owner |
|---|---|---|---|---|
| 1 Plan | Raw idea, Slack thread, ticket, incident finding | Human + Claude, conversational | `intent.md` — problem, proposed outcome, affected users and systems, constraints, open questions | Product owner |
| 2 Design | Accepted `intent.md` + applicable policy skills | Claude drafts, PO reviews | `spec.md` — requirements, design, flagged concerns | Product owner; tech lead if lane is governed |
| 3 Build | Approved `spec.md` + `CLAUDE.md` + repo | Claude in plan mode, engineer steering | `plan.md` — files that change, work order, tests that prove completion; then the diff | Engineer |
| 6 (trigger slice) | Metric breach from deterministic detector | Detector, then Claude read-only | `intent.md` at the top of the pipeline | Service owner triages |

Each stage takes a **frozen upstream artifact plus a live conversation** and
emits **one committed artifact plus a gate decision**. The conversation is the
input that process tools routinely fail to design for; §9 covers it.

---

## 7. Gates

### 7.1 The gate contract

A gate passes when all three conditions hold, evaluated by `@relay/core`:

1. **Completeness** — required frontmatter fields and body sections present and
   free of placeholders. `relay lint` fails on `TBD`, `TODO`, or empty sections.
2. **Checks** — stage-specific automated conditions. Stage 2: every flagged
   concern has a resolution or an explicit accepted-risk entry. Stage 3: the
   tests named in `plan.md` ran and passed.
3. **Authority** — an approval record signed by an identity holding the
   required role for this item's lane, over the current content hash.

### 7.2 Approval integrity

An approval record in `approvals.jsonl`:

```json
{"ts":"2026-09-11T14:22:31Z","item":"047-sso-for-admin","gate":"design",
 "artifact":"spec.md","hash":"sha256:9f3a…","identity":"a.gupta@…",
 "role":"product-owner","verdict":"approved","latency_s":412}
```

Three properties matter:

- **Hash binding.** The approval covers exact bytes. Edit the spec afterwards
  and the hash no longer matches, the gate reverts to amber, and CI fails.
  This kills approve-then-rewrite, which is how governance quietly dies.
- **Identity binding.** Resolved from git identity locally and from the
  provider's API in CI. Not a name typed into a field.
- **Role binding.** From `.relay/roles.yml`. Self-approval is refused unless
  the lane permits it — express lane does, governed lane never.

### 7.3 Three rings of enforcement

| Ring | Mechanism | Stops | Bypassable |
|---|---|---|---|
| Local | Pre-edit hooks (Claude Code `PreToolUse`, Cursor `onPreEdit`) | The agent editing source before an approved `plan.md` exists — the hook denies and the tool call never runs | Yes: a human editing files directly, editing the hook config, or using a tool with no hook system |
| CI | `relay verify` as a required status check | Merging anything whose artifact chain, approvals, or plan-to-diff alignment fails | No — runs on infrastructure the developer does not control |
| Branch protection | Code owner approval, deploy hook | Direct commits to the default branch, unauthorised production release | Only by an org admin, and the provider logs it |

The local ring is ergonomics. The CI ring is the enforcement. Changes to
`.claude/**` and `.relay/**` are protected paths requiring review, so the local
ring cannot be silently disarmed.

### 7.4 `relay verify` — the CI check

On every pull request:

1. Does this diff belong to a declared work item? (branch name, commit trailer,
   or PR body reference)
2. Does the item have the artifacts its lane requires?
3. Do those artifacts validate against schema?
4. Is there a valid approval for each required gate, over the current hash,
   from a qualifying role?
5. Do the files touched fall within those declared in `plan.md`? (Drift is a
   warning in standard lane, a hard fail in governed.)
6. Were any gates overridden, and is each override recorded with a reason?

### 7.5 Violation catalogue

| Violation | Caught by | Where |
|---|---|---|
| Agent codes before plan approved | `PreToolUse` hook denies the edit | Local, immediately |
| Human codes before plan approved | `relay verify` — diff has no approved plan | CI, at PR |
| Spec written before intent accepted | `spec.md` frontmatter names the intent hash; lint fails if unapproved | Local + CI |
| Spec edited after approval | Hash mismatch voids the approval | CI |
| Author approves own spec | Role check plus self-approval rule | CI |
| Diff wanders outside the plan | Files touched compared to `plan.md` | CI |
| Tests skipped or weakened | CI verifies the tests named in `plan.md` ran green; a hook blocks edits to test files during a fix task | Both |
| Flagged concern never resolved | Every concern needs a resolution or accepted-risk entry | CI |
| Merge without code owner | Branch protection | Provider |

### 7.6 Risk lanes

| Lane | Artifacts required | Gates | Typical |
|---|---|---|---|
| Express | `plan.md` only | Self-approved; automated checks only | Copy change, config, typo |
| Standard | `intent` → `spec` → `plan` | PO on spec, engineer on plan | Most features |
| Governed | Full chain, concerns must be resolved | PO + tech lead on spec, engineer on plan, named release manager to ship | Security surface, data model, external API, regulated change |

The lane is declared at intake. Anyone may escalate it; downgrading requires a
recorded reason.

This table describes the full model. The release-manager gate in the governed
lane belongs to Stage 5 and lands when Stage 5 does; in v1 the governed lane
ends at the engineer's plan gate like the others, with the extra spec-side
approval and concern resolution already enforced.

### 7.7 Escape hatches

- **Break-glass.** `relay gate override --reason "…"` passes the gate and
  writes a named override to the ledger. Never blocked, always visible.
  Override count is a first-class dashboard metric — a team running twelve a
  week has a process problem to discuss, not a compliance problem to punish.
- **Retroactive adoption.** `relay adopt` reads an existing diff and has the
  agent draft the intent, spec and plan backwards for human approval. Artifacts
  are marked `origin: adopted` so the trail stays truthful. Necessary because
  telling a senior engineer their working code is invalid only works once.

---

## 8. Handovers

A handover is where AI-native pipelines actually break, because the receiving
session starts cold with none of the conversation that produced the artifact.

`relay handover <item> --to <stage>` generates a bundle containing five things:

1. The frozen upstream artifact, content-hashed so drift is detectable
2. **Decisions made and alternatives rejected** — the reasoning that would
   otherwise die with the session
3. **Open questions inherited** — carried forward explicitly, never dropped
4. **Applicable policies** — resolved once rather than rediscovered
5. **What this stage owes** — the acceptance criteria it will be judged against

The bundle is written for two readers at once: a teammate skimming it in ninety
seconds, and a fresh Claude session loading it as context. That dual audience is
the binding design constraint.

**Handover is bidirectional.** `relay reject <item> --to design --reason "…"`
returns an item upstream with the reason attached. Without a modelled rejection
path everything becomes an informal message and the audit trail lies.

---

## 9. How artifacts get created

Never by hand, never free-form. Four pieces per artifact type:

- **Schema** (`.relay/schemas/*.schema.yml`) — required frontmatter, required
  sections, allowed enum values. Machine-checkable.
- **Template** — the skeleton with section headers and inline guidance,
  scaffolded by `relay new`.
- **Skill** — the conversational path: `/relay-intent`, `/relay-spec`,
  `/relay-plan` interview the human, draft, and present for approval. This is
  how the file gets filled in practice.
- **Linter** — `relay lint`, run locally and in CI, so a half-written artifact
  cannot pass a gate.

Teams fork the templates and policies into an org pack. That is the
customisation seam: one repo owns schemas and policy skills, every product repo
consumes them as a versioned dependency.

---

## 10. How information gets in

Four doors, because if the only door is a terminal, the product owner never
walks through it.

1. **Conversational** (primary) — the stage skills, reached through the MCP
   server in any tool, or as native skills in Claude Code
2. **Ingest** — `relay new --from github-issue|jira|slack-thread <ref>`, seeding
   an `intent.md` from wherever the idea was actually born
3. **Direct edit** — it is markdown in a repo; some people will just open the
   file, and that must remain valid
4. **Dashboard** — a browser form for review, comment, approve or reject
   without cloning anything

All four converge on the same file. Exactly one source of truth per artifact.

---

## 11. Outputs

**Per item:** the artifact chain, the approval ledger, the handover bundles, and
`relay export` — a single audit document covering idea to production with names
and timestamps on every judgement call.

**Per team:** cycle-time and gate-latency dashboard derived from git and the
event log; a WIP board showing what sits at which gate and whose approval it
waits on; the policy pack.

**Per organisation:** templates and policy pack as a versioned, reusable
standard.

### Metrics, and why they are free

Every leading and lagging metric the playbook names is derivable from commit
timestamps on the artifact chain and from the event log. Time from first
conversation to committed `intent.md`; elapsed time between `intent.md` and
`spec.md`; requirements rework after build starts. Nobody fills in a field, and
nobody instruments anything — the dashboard maintains itself.

---

## 12. Source of truth adapter

Teams already running Jira or ServiceNow will not accept "the repo is the
truth". Teams without them should not be forced to run one. Both are the same
codebase with a policy setting.

```ts
interface SourceOfTruthAdapter {
  pull(ref: string): Promise<ArtifactSeed>
  push(item: WorkItem, artifact: Artifact): Promise<ExternalRef>
  link(item: WorkItem, sha: string): Promise<void>
}
```

`config.yml` sets `sourceOfTruth: "legacy" | "repo"`, which decides the conflict
policy — which side wins when both have changed.

- **legacy** (default for enterprise): markdown files are working copies;
  results are written back through the adapter. The legacy record carries the
  commit SHA.
- **repo**: markdown is authoritative; the legacy ticket links to the commit.

Ships with a **simulated connector** so a demo never depends on someone's
sandbox being reachable.

---

## 13. Dashboard

Register: **mission control** — dense, multi-panel, everything visible at once.

### Panels
1. **Incident strip** (top) — Stage 6 breaches erupting into the pipeline
2. **Pipeline lanes** — Plan, Design, Build live; Test, Deploy, Maintain dimmed.
   Gates render as checkpoints *between* lanes, not as a field on a card.
   Cards pulse while an agent is actively working them.
3. **Live sessions ticker** — tool-by-tool agent activity, plan mode visibly
   distinct from build mode
4. **Waiting on you** — the gate queue filtered by the viewer's role, with
   approve and send-back controls
5. **Flow metrics strip** — stage cycle time, gate latency, first-pass merge
   rate, override count

### Spotlight
Mission control is the least legible register to a first-time viewer, so one
mechanism carries the cost: **spotlight** collapses the board to a single item
and back. Same UI, three camera angles — one item for the unblock beat, the full
board for parallel agents, the incident strip for the loop closing.

### The three hero beats
1. **Unblock** — a card sits amber at the Design gate, agent blocked. The PO
   approves in the browser; the gate turns green, the terminal unblocks itself,
   the card slides into Build.
2. **Parallel** — three or four agents working different items simultaneously
   while one person steers.
3. **Loop closing** — a breach detected, `intent.md` written, appearing at the
   top of the pipeline with no human in the invocation path.

---

## 14. Events and instrumentation

Instrumentation fidelity is tiered (§4.2), and the dashboard degrades rather
than breaking.

**With hooks** (Claude Code, Cursor): session and tool lifecycle events POST to
the daemon, so the dashboard knows an agent is in plan mode on item 047, reading
three files, about to write a diff. Nobody reports progress — progress reports
itself.

**Without hooks**: the file and git watcher still produces every state
transition and every metric. What is lost is only the tool-by-tool ticker, which
degrades to file-level activity.

The watcher also covers the direct-edit door, so hand-edited artifacts appear
live regardless of tool.

**Demos run live.** There is no replay or simulation mode. The UI keeps a local
state model so rendering never waits on a round trip, degrades gracefully when a
session stalls, and supports pre-warmed sessions. A deterministic recorded event
stream exists as a **test fixture only** — real-time UI cannot be iterated on
with non-repeatable input — and is never used on stage.

---

## 15. Why this serves a team, not an individual

1. **Policy is shared and versioned.** One security skill, consumed by forty
   repos, updated once.
2. **Approvals are accountable.** Every gate names a person; `git log` is the
   compliance evidence.
3. **Cold pickup.** Handover bundles let any teammate or any fresh agent resume
   an item without the originator. The highest-value property, because
   AI-native teams generate far more parallel in-flight work than one person
   can hold.
4. **Flow is visible.** Four items stuck behind one product owner is the actual
   bottleneck the playbook predicts, and you can see it.
5. **Lessons compound.** A repeated mistake becomes a `CLAUDE.md` line once, not
   forty times.
6. **Capacity becomes measurable.** When review becomes the bottleneck, you have
   numbers to argue with.

---

## 16. Build sequence

Phase 1 is functional only. The design pass on mission control begins after the
pipeline demonstrably works end to end, per the workspace rule against blending
build and polish.

1. `@relay/core` + `@relay/cli` + the `.relay/` convention and schemas
2. `@relay/mcp` — the universal integration, plus `@relay/adapters/claude-code`
   (hooks and stage skills). Cursor and Codex adapters follow once the MCP
   surface has stabilised against one tool.
3. `@relay/daemon` — the event spine, with the recorded fixture for testing
4. `@relay/dashboard` — mission control, then spotlight
5. Stage 6 trigger slice — detector to `intent.md`, closing the loop
6. Design pass

---

## 17. Known limits

Stated plainly, because they are the boundary between a tool and a culture.

- **Relay cannot make a rubber stamp into judgment.** A product owner can
  approve a governed spec in eleven seconds without reading it. Relay will
  record that approval as valid, and put the eleven-second gate latency on the
  dashboard. It surfaces the behaviour; the team decides what to do.
- **Local hooks constrain the agent, not the person.** A human editing files
  directly is caught at the merge, never before.
- **An org admin can disable the CI check.** That is a trust boundary Relay
  cannot police; the provider's audit log is the only record.
- **Local blocking depends on the tool.** Tools without a pre-edit hook get no
  local ring at all; their guarantee comes entirely from CI. This is a real
  difference in ergonomics, not in enforcement, and `relay init` reports which
  tier a repo is actually running at so nobody assumes protection they lack.
- **Artifact quality is only structurally checkable.** Schema validation catches
  incompleteness, not shallowness. An advisory review subagent can flag a spec
  that fails to address its intent's open questions, but this is a finding, not
  a gate.

---

## 18. Open questions

Deferred deliberately; none block the build sequence.

1. Item id scheme when Relay runs across multiple repos for one team
2. Whether the policy pack is an npm dependency or a git submodule
3. How `relay verify` identifies the work item on providers other than GitHub
4. Whether Stage 4 and 5 machinery is worth building generically, or should
   remain per-team configuration
