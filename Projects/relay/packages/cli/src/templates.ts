import { stringify } from 'yaml';
import { DEFAULT_CONFIG, type Lane } from '@relay/core';

// Do not "helpfully" move this into a section body — schema.ts's sections()
// only starts capturing after the first `##` heading, so text placed here
// is invisible to lintArtifact. Moving it into a section would make an
// unfilled scaffold's `content.trim().length > 0` true and let it pass lint
// as "done" when it's still just boilerplate.
const GUIDANCE = '\n<!-- Every ## section below must be filled in before `relay lint` passes. -->\n\n';

export function frontmatter(fields: Record<string, string | null>): string {
  // null (an express-lane plan.md's upstream) drops the line entirely,
  // rather than writing a literal "upstream: null" nobody asked for.
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

export function intentTemplate(id: string, lane: Lane, externalRef: string | null = null): string {
  return (
    frontmatter({ id, lane, stage: 'plan', external_ref: externalRef }) +
    GUIDANCE +
    '## Problem\n\n' +
    '## Proposed outcome\n\n' +
    '## Affected users and systems\n\n' +
    '## Constraints\n\n' +
    '## Open questions\n'
  );
}

export function specTemplate(id: string, lane: Lane, upstream: string): string {
  return (
    frontmatter({ id, lane, stage: 'design', upstream }) +
    '\n<!-- Every ## section below must be filled in before `relay lint` passes.\n' +
    '     Flagged concerns use a checklist: "- [ ] open" or\n' +
    '     "- [x] resolved — resolved: <how>" / "— accepted risk: <why>". -->\n\n' +
    '## Requirements\n\n' +
    '## Design\n\n' +
    '## Flagged concerns\n'
  );
}

export function planTemplate(id: string, lane: Lane, upstream: string | null): string {
  return (
    frontmatter({ id, lane, stage: 'build', upstream }) +
    GUIDANCE +
    '## Files that change\n\n' +
    '## Work order\n\n' +
    '## Tests that prove completion\n'
  );
}

export function defaultConfigYaml(): string {
  return stringify(DEFAULT_CONFIG);
}

export function defaultRolesYaml(identity: string): string {
  return stringify({ [identity]: ['product-owner', 'tech-lead', 'engineer'] });
}

export function defaultStage6BandsYaml(): string {
  return stringify({
    gateLatencyS: {
      plan: { centerline: 3600, sigma: 1800 },
      design: { centerline: 7200, sigma: 3600 },
      build: { centerline: 14400, sigma: 7200 },
    },
  });
}

export function ciWorkflowYaml(): string {
  return `name: relay verify
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx relay verify
`;
}
