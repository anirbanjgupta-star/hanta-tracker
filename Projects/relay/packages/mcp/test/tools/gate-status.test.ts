import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew, runGate } from '@relay/cli/lib';
import { gateStatus } from '../../src/tools/gate-status.js';

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

describe('gateStatus', () => {
  it('reports the blocking gate, reasons, and which identities can clear it', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeFileSync(join(repo.dir, '.relay/roles.yml'), 'po@example.com: [product-owner]\nlead@example.com: [product-owner, tech-lead]\n');
    const { id } = await runNew('test', {}, repo.dir);

    const result = gateStatus(repo.dir, id);
    expect(result.gate).toBe('plan');
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.canClear.sort()).toEqual(['lead@example.com', 'po@example.com']);
  });

  it('reports no blocking gate once the item is done', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('x', { lane: 'express' }, repo.dir);
    const planPath = join(repo.dir, `.relay/work/${id}/plan.md`);
    writeFileSync(planPath, readFileSync(planPath, 'utf8')
      .replace('## Files that change\n\n', '## Files that change\n\n`a.ts`\n\n')
      .replace('## Work order\n\n', '## Work order\n\n1.\n\n')
      .replace('## Tests that prove completion\n', '## Tests that prove completion\n`a.test.ts`\n'));
    await runGate(id, 'build', 'approve', undefined, repo.dir);

    const result = gateStatus(repo.dir, id);
    expect(result.gate).toBeNull();
    expect(result.reasons).toEqual([]);
    expect(result.canClear).toEqual([]);
  });
});
