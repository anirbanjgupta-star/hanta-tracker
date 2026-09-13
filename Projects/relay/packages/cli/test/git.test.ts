import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { currentBranch, createBranch, gitIdentity, itemIdFromBranch, touchedFiles, logSubjects, diffText } from '../src/git.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('currentBranch / itemIdFromBranch', () => {
  it('reads the current branch name', () => {
    repo = makeScratchRepo();
    execSync('git checkout -b relay/001-x -q', { cwd: repo.dir });
    expect(currentBranch(repo.dir)).toBe('relay/001-x');
  });

  it('extracts the item id from a relay/<id> branch', () => {
    expect(itemIdFromBranch('relay/047-sso-for-admin')).toBe('047-sso-for-admin');
  });

  it('returns null for a branch with no relay/ prefix', () => {
    expect(itemIdFromBranch('main')).toBeNull();
  });
});

describe('createBranch', () => {
  it('creates and checks out a new branch', () => {
    repo = makeScratchRepo();
    createBranch('relay/test-id', repo.dir);
    expect(currentBranch(repo.dir)).toBe('relay/test-id');
  });
});

describe('gitIdentity', () => {
  it('reads git config user.email', () => {
    repo = makeScratchRepo();
    expect(gitIdentity(repo.dir)).toBe('eng@example.com');
  });
});

describe('touchedFiles', () => {
  it('lists files changed since a base ref', () => {
    repo = makeScratchRepo();
    execSync('git checkout -b relay/001-x -q', { cwd: repo.dir });
    writeFileSync(join(repo.dir, 'a.ts'), 'x');
    execSync('git add a.ts && git commit -q -m "add a.ts"', { cwd: repo.dir });
    expect(touchedFiles('main', repo.dir)).toEqual(['a.ts']);
  });

  it('never lets baseRef reach a shell — an injection attempt fails as a bad git ref, not as a command', () => {
    repo = makeScratchRepo();
    const markerPath = join(repo.dir, 'pwned');
    const malicious = `main; touch ${markerPath}`;
    expect(() => touchedFiles(malicious, repo.dir)).toThrow();
    expect(readdirSync(repo.dir).some((f) => f.startsWith('pwned'))).toBe(false);
  });
});

describe('diffText', () => {
  it('returns the full diff text against a base ref', () => {
    repo = makeScratchRepo();
    execSync('git checkout -b relay/001-x -q', { cwd: repo.dir });
    writeFileSync(join(repo.dir, 'a.ts'), 'hello world');
    execSync('git add a.ts && git commit -q -m "add a.ts"', { cwd: repo.dir });
    expect(diffText('main', repo.dir)).toMatch(/\+hello world/);
  });
});

describe('logSubjects', () => {
  it('lists recent commit subjects touching a path, most recent first', () => {
    repo = makeScratchRepo();
    const dir = join(repo.dir, 'stuff');
    writeFileSync(join(repo.dir, 'stuff.txt'), 'placeholder');
    execSync('mkdir -p stuff', { cwd: repo.dir });
    writeFileSync(join(dir, 'a.txt'), '1');
    execSync('git add stuff && git commit -q -m "first commit"', { cwd: repo.dir });
    writeFileSync(join(dir, 'a.txt'), '2');
    execSync('git add stuff && git commit -q -m "second commit"', { cwd: repo.dir });

    expect(logSubjects(dir, 5, repo.dir)).toEqual(['second commit', 'first commit']);
  });

  it('returns an empty array when no commits touch the pathspec', () => {
    repo = makeScratchRepo();
    expect(logSubjects(join(repo.dir, 'never-existed'), 5, repo.dir)).toEqual([]);
  });
});
