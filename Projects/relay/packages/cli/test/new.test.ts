import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew, withProblemFilled } from '../src/commands/new.js';
import { loadWorkItem } from '../src/relay-dir.js';
import { currentBranch } from '../src/git.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runNew', () => {
  it('allocates an id, scaffolds intent.md, and creates the branch', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const result = await runNew('SSO for admin', {}, repo.dir);

    expect(result.id).toBe('001-sso-for-admin');
    expect(currentBranch(repo.dir)).toBe('relay/001-sso-for-admin');
    const item = loadWorkItem(result.id, 'standard', repo.dir);
    expect(item.artifacts.intent).toBeDefined();
    expect(item.artifacts.intent?.lane).toBe('standard');
  });

  it('scaffolds plan.md directly for an express-lane item', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const result = await runNew('fix typo', { lane: 'express' }, repo.dir);

    const item = loadWorkItem(result.id, 'express', repo.dir);
    expect(item.artifacts.plan).toBeDefined();
    expect(item.artifacts.intent).toBeUndefined();
  });

  it('rejects --from on an express-lane item', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await expect(runNew('x', { lane: 'express', from: 'JIRA-1001' }, repo.dir))
      .rejects.toThrow(/express/i);
  });

  it('seeds intent.md from the simulated legacy connector with --from', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir); // seeds JIRA-1001 via Task 14
    const result = await runNew('ignored title', { from: 'JIRA-1001' }, repo.dir);

    const item = loadWorkItem(result.id, 'standard', repo.dir);
    expect(item.artifacts.intent?.body).toMatch(/Items added through the UI/);
    expect(item.artifacts.intent?.externalRef).toBe('JIRA-1001');
  });

  it('throws a clear error when config.yml has not been initialized', async () => {
    repo = makeScratchRepo();
    await expect(runNew('x', {}, repo.dir)).rejects.toThrow(/relay init/i);
  });

  it('leaves no branch or item behind when --from names an unknown ref', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const startingBranch = currentBranch(repo.dir);

    await expect(runNew('x', { from: 'NOPE-1' }, repo.dir)).rejects.toThrow(/NOPE-1/);

    expect(currentBranch(repo.dir)).toBe(startingBranch);
    expect(existsSync(join(repo.dir, '.relay/work'))).toBe(true);
    expect(readdirSync(join(repo.dir, '.relay/work'))).toEqual([]);
  });
});

describe('withProblemFilled', () => {
  it('throws instead of silently no-opping when the template has no Problem section to seed', () => {
    expect(() => withProblemFilled('## Something Else\n\n', 'seed body')).toThrow(/Problem/);
  });

  it('inserts the seed body right after the Problem heading', () => {
    const result = withProblemFilled('## Problem\n\n## Next\n', 'seed body');
    expect(result).toContain('## Problem\n\nseed body\n\n## Next\n');
  });
});
