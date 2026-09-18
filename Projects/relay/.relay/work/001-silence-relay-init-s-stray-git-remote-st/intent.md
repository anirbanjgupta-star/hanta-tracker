---
id: 001-silence-relay-init-s-stray-git-remote-st
lane: standard
stage: plan
---

<!-- Every ## section below must be filled in before `relay lint` passes. -->

## Problem

`packages/cli/src/git.ts`'s `remoteIsGitHub()` correctly handles the "no
`origin` remote" case logically (catches the thrown error, returns
`false`), but the underlying `git remote get-url origin` child process
still writes its own raw `fatal: No such remote 'origin'` line to stderr
before that catch runs — Node's `execFileSync` doesn't suppress a failed
child's stderr just because the caller goes on to catch the resulting JS
exception. Every `relay init` on a repo with no `origin` remote prints this
line, even though the command's own reported outcome ("No GitHub remote —
CI workflow skipped") is completely correct. Found live during Phase 6's
acceptance test (`docs/ACCEPTANCE.md`) and confirmed pre-existing, not
something that session's changes caused — it also appears 7 times in
`init.test.ts`'s own existing test output.

## Proposed outcome

`relay init` (and anything else that calls `remoteIsGitHub()`) produces no
stray stderr output when a repo simply has no `origin` remote — that's an
expected, normal state for a fresh repo, not an error worth surfacing.

## Affected users and systems

- `packages/cli/src/git.ts` — `remoteIsGitHub()`, the one place this git
  call is made.
- Anyone running `relay init` on a repo without a GitHub `origin` — which
  is every scratch/pilot repo this project's own test suite and acceptance
  runs have used all along.
- `init.test.ts` — its own test output currently carries this noise;
  worth confirming it's gone once fixed, not just that the logical
  assertions still pass.

## Constraints

- Must not change `remoteIsGitHub()`'s actual return value or behavior for
  any real remote configuration (GitHub, non-GitHub, or none) — this is a
  stderr-noise fix only, not a logic change.
- Must not swallow a genuine, unexpected git failure (e.g. a corrupted
  `.git` directory) silently — only the specific, expected "no such
  remote" case should go quiet.

## Open questions

- Cleanest fix: pass `stdio: ['ignore', 'pipe', 'ignore']` to the one
  `execFileSync` call inside `remoteIsGitHub()` (suppressing only that
  call's stderr, not `git.ts`'s shared `git()` helper's behavior for every
  other caller), or check `git remote` output for the name first before
  ever calling `get-url`. Either is small; `spec.md` should pick one and
  say why.
