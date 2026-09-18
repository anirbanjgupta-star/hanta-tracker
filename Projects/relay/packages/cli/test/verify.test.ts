import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent } from '@relay/core';
import { specTemplate, planTemplate } from '../src/templates.js';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runGate } from '../src/commands/gate.js';
import { writeArtifact } from '../src/relay-dir.js';
import { runVerify } from '../src/commands/verify.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

function fillIntent(dir: string, id: string) {
  const path = join(dir, `.relay/work/${id}/intent.md`);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace('## Problem\n\n', '## Problem\n\np\n\n')
    .replace('## Proposed outcome\n\n', '## Proposed outcome\n\no\n\n')
    .replace('## Affected users and systems\n\n', '## Affected users and systems\n\na\n\n')
    .replace('## Constraints\n\n', '## Constraints\n\nc\n\n')
    .replace('## Open questions\n', '## Open questions\nnone\n'));
}

async function driveToBuild(dir: string, id: string, filesDeclared: string): Promise<void> {
  fillIntent(dir, id);
  await runGate(id, 'plan', 'approve', undefined, dir);

  const intentHash = hashContent(readFileSync(join(dir, `.relay/work/${id}/intent.md`), 'utf8'));
  const specRaw = specTemplate(id, 'standard', intentHash)
    .replace('## Requirements\n\n', '## Requirements\n\nr\n\n')
    .replace('## Design\n\n', '## Design\n\nd\n\n')
    .replace('## Flagged concerns\n', '## Flagged concerns\n- [x] none — accepted risk: n/a\n');
  writeArtifact(id, 'spec', specRaw, dir);
  await runGate(id, 'design', 'approve', undefined, dir);

  const specHash = hashContent(specRaw);
  const planRaw = planTemplate(id, 'standard', specHash)
    .replace('## Files that change\n\n', `## Files that change\n\n${filesDeclared}\n\n`)
    .replace('## Work order\n\n', '## Work order\n\n1.\n\n')
    .replace('## Tests that prove completion\n', '## Tests that prove completion\n`a.test.ts`\n');
  writeArtifact(id, 'plan', planRaw, dir);
  await runGate(id, 'build', 'approve', undefined, dir);
}

describe('runVerify', () => {
  it('passes a fully approved item with tests confirmed and no drift', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    // The default roles.yml (seeded by relay init) grants roles only to
    // you@example.com — not eng@example.com, the git identity makeScratchRepo
    // configures (see status.test.ts's same note). Seed the roles the
    // standard lane's gates require so authority actually passes here.
    writeFileSync(join(repo.dir, '.relay/roles.yml'), 'eng@example.com: [product-owner, engineer]\n');
    const { id } = await runNew('test', {}, repo.dir);
    await driveToBuild(repo.dir, id, '`a.ts`');
    execSync('git add .relay && git commit -q -m "pipeline"', { cwd: repo.dir });

    const report = runVerify(repo.dir, { testsPassed: true });
    expect(report.passed).toBe(true);
    expect(report.reasons).toEqual([]);
  });

  it('fails when the branch does not declare a work item', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const report = runVerify(repo.dir, {});
    expect(report.passed).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/does not declare a work item/);
  });

  it('fails when the build gate has no approval yet', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    fillIntent(repo.dir, id);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const report = runVerify(repo.dir, { testsPassed: true });
    expect(report.passed).toBe(false);
    // Prefixed `[build:plan]`, not `[build]` — the gate name alone was
    // ambiguous (GATE_FOR_KIND maps intent->plan, spec->design, plan->build,
    // so a failure on the artifact literally named "plan" was tagged
    // `[build]`). `[build:plan]` does not contain the substring `[build]`
    // (the `:plan` sits before the closing bracket), so this assertion must
    // target the new prefix, not the old one.
    expect(report.reasons.join(' ')).toMatch(/\[build:plan\]/);
  });

  it('fails when --tests-passed was not confirmed', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    await driveToBuild(repo.dir, id, '`a.ts`');
    execSync('git add .relay && git commit -q -m "pipeline"', { cwd: repo.dir });

    const report = runVerify(repo.dir, {});
    expect(report.passed).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/tests/i);
  });

  // Governed requires product-owner (plan), product-owner-or-tech-lead
  // (design), and engineer (build) — see DEFAULT_LANES.governed in
  // packages/core/src/config.ts — and forbids self-approval outright
  // (allowSelfApproval: false). makeScratchRepo's only git identity is
  // eng@example.com, which the default roles.yml (seeded by `relay init`)
  // grants no roles at all. Driving this lane through driveToBuild
  // unmodified therefore fails EVERY gate on role authority before drift is
  // ever reached, and self-approval would fail it a second way even with
  // roles granted, because the approving identity and the verifying
  // identity are the same. Both are seeded/handled below so the drift
  // failure below is isolated and not accidental.
  function setupGovernedItem(filesDeclared: string) {
    // Grant eng@example.com every role governed's gates require, so
    // approving as that identity actually satisfies authority.
    writeFileSync(join(repo.dir, '.relay/roles.yml'), 'eng@example.com: [product-owner, tech-lead, engineer]\n');
    return runNew('test', { lane: 'governed' }, repo.dir).then(async ({ id }) => {
      await driveToBuild(repo.dir, id, filesDeclared); // approved as eng@example.com throughout
      // validApproval checks the identity CURRENTLY reading/verifying
      // against the identity that SIGNED each approval, not whether that
      // identity holds a role — so switching git's configured identity here
      // (after approving, before verifying) is what satisfies
      // allowSelfApproval: false, without touching the approvals recorded.
      execSync('git config user.email verifier@example.com', { cwd: repo.dir });
      return id;
    });
  }

  it('fails on undeclared files touched, for the governed (drift-fatal) lane, isolating drift as the actual cause', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await setupGovernedItem('`a.ts`'); // declares only a.ts
    writeFileSync(join(repo.dir, 'stray.ts'), 'x');
    // Stage only .relay plus the stray file — not `.` — so the diff isn't
    // also carrying .gitignore (written but never committed by runInit)
    // into the touched-files list as a second, incidental stray entry.
    execSync('git add .relay stray.ts && git commit -q -m "pipeline plus a stray file"', { cwd: repo.dir });

    const report = runVerify(repo.dir, { testsPassed: true });
    // Empirically confirmed via a temporary console.log(JSON.stringify(...))
    // before this fix: without the roles.yml seed and identity switch above,
    // this array held six reasons — role-authority failures for
    // [plan],[design],[build] plus mirrored self-approval failures — with
    // this stray.ts line buried as just one more entry, and the old test's
    // `.join(' ')` substring match passed regardless. Asserting the exact
    // array (not a substring match) is what actually isolates drift as the
    // sole cause now.
    expect(report.reasons).toEqual(['Files touched but not declared in plan.md: stray.ts']);
    expect(report.passed).toBe(false);
  });

  it('governed lane, fully approved, no drift, passes', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await setupGovernedItem('`a.ts`');
    execSync('git add .relay && git commit -q -m "pipeline, no stray files"', { cwd: repo.dir });

    const report = runVerify(repo.dir, { testsPassed: true });
    // The lane with the strictest rules (driftIsFatal: true, no
    // self-approval) had no test at all exercising its happy path before
    // this fix. Assert the reasons array itself, not just the boolean, so a
    // false pass hiding behind an unrelated bug can't slip back in.
    expect(report.reasons).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('passes an express-lane item through its single-gate (plan-only) chain', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('fix typo', { lane: 'express' }, repo.dir);

    // Express's only required artifact is plan.md (GATE_FOR_KIND['plan'] =
    // 'build') — a structurally different, single-iteration loop compared to
    // standard/governed's three-kind chain. runNew already scaffolds
    // plan.md directly for an express item; fill its three required
    // sections and declare the touched file, same convention driveToBuild
    // uses for the standard/governed plan.md.
    const planPath = join(repo.dir, `.relay/work/${id}/plan.md`);
    const filled = readFileSync(planPath, 'utf8')
      .replace('## Files that change\n\n', '## Files that change\n\n`a.ts`\n\n')
      .replace('## Work order\n\n', '## Work order\n\n1.\n\n')
      .replace('## Tests that prove completion\n', '## Tests that prove completion\n`a.test.ts`\n');
    writeArtifact(id, 'plan', filled, repo.dir);
    // Express allows self-approval, so no identity switch is needed here.
    await runGate(id, 'build', 'approve', undefined, repo.dir);

    writeFileSync(join(repo.dir, 'a.ts'), 'x');
    execSync('git add . && git commit -q -m "express pipeline"', { cwd: repo.dir });

    const report = runVerify(repo.dir, { testsPassed: true });
    expect(report.reasons).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
