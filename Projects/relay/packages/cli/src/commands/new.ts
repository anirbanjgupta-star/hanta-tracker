import { type Lane } from '@relay/core';
import { writeArtifact } from '../relay-dir.js';
import { allocateItemId } from '../item-id.js';
import { createBranch } from '../git.js';
import { loadRelayConfig } from '../context.js';
import { intentTemplate, planTemplate } from '../templates.js';
import { LegacyJsonAdapter } from '../adapters/legacy-json.js';

export interface NewOptions {
  lane?: Lane;
  from?: string;
}

export interface NewResult {
  id: string;
  lane: Lane;
  branch: string;
}

export function withProblemFilled(template: string, body: string): string {
  const marker = '## Problem\n\n';
  const filled = template.replace(marker, `${marker}${body}\n\n`);
  // A literal-string match against intentTemplate's exact output: if that
  // template's heading text or spacing ever changes, this must fail loudly
  // rather than silently ship an intent.md with the --from seed dropped.
  if (filled === template) {
    throw new Error('Could not find "## Problem" section to seed — intentTemplate output may have changed');
  }
  return filled;
}

export async function runNew(title: string, opts: NewOptions, cwd: string): Promise<NewResult> {
  const config = loadRelayConfig(cwd);

  const lane = opts.lane ?? config.defaultLane;
  const laneRule = config.lanes[lane];
  const firstKind = laneRule.requires[0];

  // Must run before any side effect below (id allocation, branch creation,
  // file writes) — express items have no intent.md for --from to seed.
  if (opts.from && firstKind !== 'intent') {
    throw new Error(`--from seeds an intent.md; the ${lane} lane's first required artifact is ${firstKind}, not intent`);
  }

  const id = allocateItemId(title, cwd);
  const branch = `relay/${id}`;

  let raw: string;
  if (firstKind === 'intent') {
    let template = intentTemplate(id, lane, opts.from ?? null);
    if (opts.from) {
      const seed = await new LegacyJsonAdapter(cwd).pull(opts.from);
      template = withProblemFilled(template, seed.body);
    }
    raw = template;
  } else {
    raw = planTemplate(id, lane, null);
  }

  createBranch(branch, cwd);
  writeArtifact(id, firstKind, raw, cwd);

  return { id, lane, branch };
}
