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
