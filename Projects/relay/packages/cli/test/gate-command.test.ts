import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runGate } from '../src/commands/gate.js';
import { loadWorkItem } from '../src/relay-dir.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

async function makeItem(dir: string): Promise<string> {
  runInit(dir);
  const { id } = await runNew('test', {}, dir);
  return id;
}

describe('runGate', () => {
  it('appends an approved record with the current hash and git identity', async () => {
    repo = makeScratchRepo();
    const id = await makeItem(repo.dir);
    const approval = await runGate(id, 'plan', 'approve', undefined, repo.dir);

    expect(approval.verdict).toBe('approved');
    expect(approval.identity).toBe('eng@example.com');
    expect(approval.role).toBe('unspecified'); // eng@example.com isn't in the default roles.yml
    const item = loadWorkItem(id, 'standard', repo.dir);
    expect(item.approvals).toHaveLength(1);
  });

  it('assigns the role from roles.yml matching the git identity', async () => {
    repo = makeScratchRepo();
    const id = await makeItem(repo.dir);
    writeFileSync(join(repo.dir, '.relay/roles.yml'), 'eng@example.com: [engineer]\n');

    const approval = await runGate(id, 'plan', 'approve', undefined, repo.dir);
    expect(approval.role).toBe('engineer');
  });

  it('records whichever held role actually satisfies the gate, not just the first one listed', async () => {
    repo = makeScratchRepo();
    const id = await makeItem(repo.dir);
    // The 'plan' gate requires product-owner (see DEFAULT_LANES). Listing
    // engineer first would make the old first()-role logic record the
    // wrong capacity for this approval.
    writeFileSync(join(repo.dir, '.relay/roles.yml'), 'eng@example.com: [engineer, product-owner]\n');

    const approval = await runGate(id, 'plan', 'approve', undefined, repo.dir);
    expect(approval.role).toBe('product-owner');
  });

  it('records a rejection with a reason', async () => {
    repo = makeScratchRepo();
    const id = await makeItem(repo.dir);
    const approval = await runGate(id, 'plan', 'reject', 'not ready', repo.dir);
    expect(approval.verdict).toBe('rejected');
    expect(approval.reason).toBe('not ready');
  });

  it('records an override — never blocked, even with no reason', async () => {
    repo = makeScratchRepo();
    const id = await makeItem(repo.dir);
    const approval = await runGate(id, 'plan', 'override', undefined, repo.dir);
    expect(approval.verdict).toBe('override');
    const item = loadWorkItem(id, 'standard', repo.dir);
    expect(item.approvals).toHaveLength(1); // written, even though it won't pass evaluateGate downstream
  });

  it('throws when the gate has no artifact yet', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await expect(runGate('999-nope', 'design', 'approve', undefined, repo.dir))
      .rejects.toThrow(/spec\.md does not exist/);
  });

  it('pushes to the legacy adapter when sourceOfTruth is legacy and the artifact has an externalRef', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const configPath = join(repo.dir, '.relay/config.yml');
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('sourceOfTruth: repo', 'sourceOfTruth: legacy'));

    const { id } = await runNew('x', { from: 'JIRA-1001' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const tickets = JSON.parse(readFileSync(join(repo.dir, '.relay-legacy-tickets.json'), 'utf8'));
    expect(tickets.find((t: { ref: string }) => t.ref === 'JIRA-1001').relayItem).toBe(id);
  });
});
