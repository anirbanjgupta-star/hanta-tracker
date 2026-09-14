import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli/lib';
import { buildProjection } from '../src/projection.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-daemon-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('buildProjection', () => {
  it('returns an empty array before any item exists', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(buildProjection(repo.dir)).toEqual([]);
  });

  it('reports id, lane, stage and blockedBy for every item, sorted by id', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('second', {}, repo.dir);
    execSync('git checkout -q main', { cwd: repo.dir });
    await runNew('first', {}, repo.dir);
    execSync('git checkout -q main', { cwd: repo.dir });

    const items = buildProjection(repo.dir);
    expect(items.map((i) => i.id)).toEqual(['001-second', '002-first']);
    expect(items[0].lane).toBe('standard');
    expect(items[0].stage).toBe('plan');
    expect(items[0].blockedBy.length).toBeGreaterThan(0);
  });

  it('is deterministic — calling it twice with no changes yields an identical result', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('test', {}, repo.dir);

    const first = buildProjection(repo.dir);
    const second = buildProjection(repo.dir);
    expect(second).toEqual(first);
  });
});
