import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { resolveCurrentItemId, setCurrentItemId } from '../src/current-item.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('resolveCurrentItemId', () => {
  it('resolves from a relay/<id> branch', () => {
    repo = makeScratchRepo();
    execSync('git checkout -b relay/001-x -q', { cwd: repo.dir });
    expect(resolveCurrentItemId(repo.dir)).toBe('001-x');
  });

  it('falls back to .relay/CURRENT off a non-relay branch', () => {
    repo = makeScratchRepo();
    setCurrentItemId('002-y', repo.dir);
    expect(resolveCurrentItemId(repo.dir)).toBe('002-y');
  });

  it('prefers the branch over a stale CURRENT file', () => {
    repo = makeScratchRepo();
    setCurrentItemId('002-y', repo.dir);
    execSync('git checkout -b relay/001-x -q', { cwd: repo.dir });
    expect(resolveCurrentItemId(repo.dir)).toBe('001-x');
  });

  it('throws with actionable guidance when neither is set', () => {
    repo = makeScratchRepo();
    expect(() => resolveCurrentItemId(repo.dir)).toThrow(/relay use/);
  });

  it('falls through to CURRENT in detached HEAD state, rather than false-matching HEAD as a branch', () => {
    repo = makeScratchRepo();
    setCurrentItemId('002-y', repo.dir);
    execSync('git checkout --detach -q', { cwd: repo.dir });
    expect(resolveCurrentItemId(repo.dir)).toBe('002-y');
  });
});
