import { describe, it, expect, afterEach } from 'vitest';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runUse } from '../src/commands/use.js';
import { resolveCurrentItemId } from '../src/current-item.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runUse', () => {
  it('sets .relay/CURRENT to the given id', () => {
    repo = makeScratchRepo();
    runUse('003-z', repo.dir);
    expect(resolveCurrentItemId(repo.dir)).toBe('003-z');
  });
});
