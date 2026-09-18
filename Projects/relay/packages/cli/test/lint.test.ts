import { describe, it, expect, afterEach } from 'vitest';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runLint } from '../src/commands/lint.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runLint', () => {
  it('fails on a freshly scaffolded (empty) intent.md', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const result = runLint(repo.dir, id);
    expect(result.ok).toBe(false);
    expect(result.problems[0].artifact).toBe('intent.md');
    expect(result.problems[0].problems.length).toBeGreaterThan(0);
  });
});
