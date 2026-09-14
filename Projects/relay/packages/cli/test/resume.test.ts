import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent } from '@relay/core';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runResume } from '../src/commands/resume.js';
import { writeArtifact } from '../src/relay-dir.js';
import { specTemplate } from '../src/templates.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runResume', () => {
  it('reports id, stage, blocking reasons, open questions and recent history', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    const path = join(repo.dir, `.relay/work/${id}/intent.md`);
    writeFileSync(path, readFileSync(path, 'utf8').replace(
      '## Open questions\n', '## Open questions\nWho owns rollout?\n'
    ));
    execSync(`git add .relay && git commit -q -m "draft intent for ${id}"`, { cwd: repo.dir });

    const brief = runResume(repo.dir, id);
    expect(brief.id).toBe(id);
    expect(brief.stage).toBe('plan');
    expect(brief.openQuestions).toMatch(/Who owns rollout/);
    expect(brief.recentHistory.join(' ')).toMatch(/draft intent/);
    expect(brief.next).toMatch(/plan/i);
  });

  it('reports "nothing — complete" once the item reaches done', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('x', { lane: 'express' }, repo.dir);
    const path = join(repo.dir, `.relay/work/${id}/plan.md`);
    writeFileSync(path, readFileSync(path, 'utf8')
      .replace('## Files that change\n\n', '## Files that change\n\n`a.ts`\n\n')
      .replace('## Work order\n\n', '## Work order\n\n1.\n\n')
      .replace('## Tests that prove completion\n', '## Tests that prove completion\n`a.test.ts`\n'));

    const { runGate } = await import('../src/commands/gate.js');
    await runGate(id, 'build', 'approve', undefined, repo.dir);

    const brief = runResume(repo.dir, id);
    expect(brief.stage).toBe('done');
    expect(brief.next).toMatch(/nothing/i);
  });

  it('reads open items from spec.md (not intent.md) once spec exists but plan does not', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const intentHash = hashContent(readFileSync(join(repo.dir, `.relay/work/${id}/intent.md`), 'utf8'));
    const specRaw = specTemplate(id, 'standard', intentHash)
      .replace('## Requirements\n\n', '## Requirements\n\nr\n\n')
      .replace('## Design\n\n', '## Design\n\nd\n\n')
      .replace('## Flagged concerns\n', '## Flagged concerns\n- [ ] Does this scale?\n');
    writeArtifact(id, 'spec', specRaw, repo.dir);

    const brief = runResume(repo.dir, id);
    expect(brief.openQuestions).toMatch(/Does this scale\?/);
  });
});
