import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runStatus } from '../src/commands/status.js';
import { runGate } from '../src/commands/gate.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

function fillIntent(dir: string, id: string) {
  const path = join(dir, `.relay/work/${id}/intent.md`);
  const filled = readFileSync(path, 'utf8')
    .replace('## Problem\n\n', '## Problem\n\np\n\n')
    .replace('## Proposed outcome\n\n', '## Proposed outcome\n\no\n\n')
    .replace('## Affected users and systems\n\n', '## Affected users and systems\n\na\n\n')
    .replace('## Constraints\n\n', '## Constraints\n\nc\n\n')
    .replace('## Open questions\n', '## Open questions\nnone\n');
  writeFileSync(path, filled);
}

// The default roles.yml (seeded by relay init) grants roles only to
// you@example.com — not eng@example.com, the git identity makeScratchRepo
// configures. The standard lane's plan gate requires product-owner, so
// without this, runGate's approval would silently fail its role check and
// deriveStage would never advance past 'plan'.
function setupRoles(dir: string) {
  writeFileSync(join(dir, '.relay/roles.yml'), 'eng@example.com: [product-owner]\n');
}

describe('runStatus', () => {
  it('reports the plan-gate stage when intent exists but is not yet approved', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    setupRoles(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    fillIntent(repo.dir, id);
    expect(runStatus(repo.dir, id).stage).toBe('plan');
  });

  it('reports design once the plan gate is approved', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    setupRoles(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    fillIntent(repo.dir, id);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);
    expect(runStatus(repo.dir, id).stage).toBe('design');
  });

  it('reports no blockers on arrival at a new stage, even though that stage\'s own artifact does not exist yet', async () => {
    // Regression: found via real end-to-end CLI verification, not a unit
    // test. Arriving at 'design' means spec.md hasn't been drafted — that's
    // day one of the stage, not a problem, and evaluateGate's "spec.md does
    // not exist yet" completeness reason must not surface as if it were one.
    repo = makeScratchRepo();
    runInit(repo.dir);
    setupRoles(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    fillIntent(repo.dir, id);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const status = runStatus(repo.dir, id);
    expect(status.stage).toBe('design');
    expect(status.blockedBy).toEqual([]);
  });

  it('falls back to plan with a changed-since-approval reason after intent.md is edited', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    setupRoles(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    fillIntent(repo.dir, id);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const path = join(repo.dir, `.relay/work/${id}/intent.md`);
    writeFileSync(path, readFileSync(path, 'utf8') + '\nedited after approval\n');

    const status = runStatus(repo.dir, id);
    expect(status.stage).toBe('plan');
    expect(status.blockedBy.join(' ')).toMatch(/changed since approval/i);
  });

  it('exposes origin from the intent artifact, defaulting to authored', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('x', {}, repo.dir);
    expect(runStatus(repo.dir, id).origin).toBe('authored');
  });
});
