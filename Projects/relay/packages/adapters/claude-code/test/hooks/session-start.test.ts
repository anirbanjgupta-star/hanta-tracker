import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli/lib';

const HOOK_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../dist/hooks/session-start.js');

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-hook-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runHook(input: object): string {
  return execFileSync('node', [HOOK_PATH], { input: JSON.stringify(input) }).toString();
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('session-start hook', () => {
  it('prints nothing when there is no .relay/ at all', () => {
    repo = makeScratchRepo();
    const out = runHook({ cwd: repo.dir });
    expect(out.trim()).toBe('');
  });

  it('prints the resume briefing when a current item exists', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const out = runHook({ cwd: repo.dir });
    expect(out).toContain(id);
    expect(out).toContain('stage: plan');
  });
});
