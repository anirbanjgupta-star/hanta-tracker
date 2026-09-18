import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew, itemDir, runStatus } from '@relay/cli/lib';
import { requestGate } from '../../src/tools/request-gate.js';

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

describe('requestGate', () => {
  it('appends an event, never an approval', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const result = requestGate(repo.dir, id);
    expect(result.recorded).toBe(true);

    const dir = itemDir(id, repo.dir);
    const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('gate_requested');
    expect(events[0].gate).toBe('plan');
    expect(events[0].identity).toBe('eng@example.com');

    expect(() => readFileSync(join(dir, 'approvals.jsonl'), 'utf8')).toThrow();
  });

  it('does not change the derived stage — it is a request, not an approval', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    requestGate(repo.dir, id);

    expect(runStatus(repo.dir, id).stage).toBe('plan');
  });
});
