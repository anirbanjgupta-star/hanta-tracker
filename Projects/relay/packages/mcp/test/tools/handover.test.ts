import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew, runGate } from '@relay/cli/lib';
import { handoverForCurrentStage } from '../../src/tools/handover.js';

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

describe('handoverForCurrentStage', () => {
  it('returns the bundle text for a stage handover models (design)', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    const path = join(repo.dir, `.relay/work/${id}/intent.md`);
    writeFileSync(path, readFileSync(path, 'utf8').replace('## Problem\n\n', '## Problem\n\np\n\n'));
    writeRoles(repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const text = handoverForCurrentStage(repo.dir, id);
    expect(text).toContain('Frozen upstream artifact');
    expect(text).toContain('spec.md');
  });

  it('throws a clear error at a stage with no modelled handover target', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    expect(() => handoverForCurrentStage(repo.dir, id)).toThrow(/no handover bundle/i);
  });
});

function writeRoles(dir: string) {
  writeFileSync(join(dir, '.relay/roles.yml'), 'eng@example.com: [product-owner]\n');
}
