import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { LegacyJsonAdapter } from '../src/adapters/legacy-json.js';
import type { Artifact, WorkItem } from '@relay/core';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

function seed(dir: string, tickets: unknown[]) {
  writeFileSync(join(dir, '.relay-legacy-tickets.json'), JSON.stringify(tickets));
}

describe('LegacyJsonAdapter.pull', () => {
  it('returns an ArtifactSeed for a known ref', async () => {
    repo = makeScratchRepo();
    seed(repo.dir, [{ ref: 'JIRA-1001', title: 'Persist catalog metadata', body: 'Items vanish on reseed.' }]);
    const adapter = new LegacyJsonAdapter(repo.dir);
    const seedResult = await adapter.pull('JIRA-1001');
    expect(seedResult).toEqual({
      title: 'Persist catalog metadata',
      body: 'Items vanish on reseed.',
      externalRef: 'JIRA-1001',
    });
  });

  it('throws for an unknown ref', async () => {
    repo = makeScratchRepo();
    seed(repo.dir, []);
    const adapter = new LegacyJsonAdapter(repo.dir);
    await expect(adapter.pull('NOPE-1')).rejects.toThrow(/NOPE-1/);
  });
});

describe('LegacyJsonAdapter.push / link', () => {
  it('records a push and a link against the same ticket file', async () => {
    repo = makeScratchRepo();
    seed(repo.dir, [{ ref: 'JIRA-1001', title: 't', body: 'b' }]);
    const adapter = new LegacyJsonAdapter(repo.dir);

    const item: WorkItem = { id: '001-x', lane: 'standard', artifacts: {}, approvals: [] };
    const artifact: Artifact = {
      kind: 'spec', itemId: '001-x', lane: 'standard', upstream: null,
      policies: [], externalRef: 'JIRA-1001', origin: 'authored', body: 'b', raw: 'b',
    };

    const ref = await adapter.push(item, artifact);
    expect(ref).toBe('JIRA-1001');
    await adapter.link(item, 'abc123');

    const tickets = JSON.parse(readFileSync(join(repo.dir, '.relay-legacy-tickets.json'), 'utf8'));
    expect(tickets[0].linkedCommit).toBe('abc123');
    expect(tickets[0].relayItem).toBe('001-x');
  });

  it('throws on push when the externalRef names no known ticket', async () => {
    repo = makeScratchRepo();
    seed(repo.dir, []);
    const adapter = new LegacyJsonAdapter(repo.dir);
    const item: WorkItem = { id: '001-x', lane: 'standard', artifacts: {}, approvals: [] };
    const artifact: Artifact = {
      kind: 'spec', itemId: '001-x', lane: 'standard', upstream: null,
      policies: [], externalRef: 'GHOST-1', origin: 'authored', body: 'b', raw: 'b',
    };
    await expect(adapter.push(item, artifact)).rejects.toThrow(/GHOST-1/);
  });

  it('throws on link when no ticket is linked to the item', async () => {
    repo = makeScratchRepo();
    seed(repo.dir, [{ ref: 'JIRA-1001', title: 't', body: 'b' }]);
    const adapter = new LegacyJsonAdapter(repo.dir);
    const item: WorkItem = { id: '999-orphan', lane: 'standard', artifacts: {}, approvals: [] };
    await expect(adapter.link(item, 'abc123')).rejects.toThrow(/999-orphan/);
  });
});
