import { describe, it, expect, afterEach } from 'vitest';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { writeArtifact } from '../src/relay-dir.js';
import { allocateItemId } from '../src/item-id.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('allocateItemId', () => {
  it('starts at 001 when no items exist', () => {
    repo = makeScratchRepo();
    expect(allocateItemId('SSO for admin', repo.dir)).toBe('001-sso-for-admin');
  });

  it('slugifies punctuation and lowercases', () => {
    repo = makeScratchRepo();
    expect(allocateItemId('Fix the "Save" button!!', repo.dir)).toBe('001-fix-the-save-button');
  });

  it('increments past the highest existing counter', () => {
    repo = makeScratchRepo();
    writeArtifact('001-a', 'intent', 'a', repo.dir);
    writeArtifact('005-b', 'intent', 'b', repo.dir);
    expect(allocateItemId('next thing', repo.dir)).toBe('006-next-thing');
  });

  it('degrades to a bare counter for a punctuation-only title, without throwing', () => {
    repo = makeScratchRepo();
    expect(allocateItemId('!!!', repo.dir)).toBe('001-');
  });
});
