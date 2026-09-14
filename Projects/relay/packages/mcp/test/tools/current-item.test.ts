import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli/lib';
import { currentItem } from '../../src/tools/current-item.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-mcp-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('currentItem', () => {
  it('reports id, lane and stage for the checked-out item', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const result = currentItem(repo.dir);
    expect(result.id).toBe(id);
    expect(result.lane).toBe('standard');
    expect(result.stage).toBe('plan');
  });

  it('throws an actionable error when there is no current item', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(() => currentItem(repo.dir)).toThrow(/relay use/);
  });
});
