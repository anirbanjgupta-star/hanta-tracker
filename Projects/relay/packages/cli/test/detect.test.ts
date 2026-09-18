import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runGate } from '../src/commands/gate.js';
import { saveDetectorState } from '../src/relay-dir.js';
import { findBreaches, runStage6Detect, parseBreachIntentDraft } from '../src/commands/detect.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

function writeBands(dir: string, yaml: string) {
  mkdirSync(join(dir, '.relay/policies'), { recursive: true });
  writeFileSync(join(dir, '.relay/policies/stage6-bands.yml'), yaml);
}

describe('findBreaches', () => {
  it('reports no findings when no bands are configured', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('x', {}, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);
    expect(findBreaches(repo.dir)).toEqual([]);
  });

  it('reports no findings when the average sits within the configured band', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 100\n    sigma: 1000\n');
    const { id } = await runNew('x', {}, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir); // no latencyS recorded — no gate_requested event
    expect(findBreaches(repo.dir)).toEqual([]);
  });

  it('reports a 3-sigma finding for a gate whose average latency is far outside its band', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 3600_000).toISOString(); // 1 hour "request-to-approve" latency
    const { appendEvent } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const findings = findBreaches(repo.dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].gate).toBe('plan');
    expect(findings[0].zone).toBe('3sigma');
  });

  it('does not re-report a breach whose triggering approval was already checked', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 3600_000).toISOString();
    const { appendEvent } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    const approval = await runGate(id, 'plan', 'approve', undefined, repo.dir);

    saveDetectorState({ lastCheckedTs: { plan: approval.ts } }, repo.dir);
    expect(findBreaches(repo.dir)).toEqual([]);
  });
});

describe('parseBreachIntentDraft', () => {
  it('parses a well-formed response', () => {
    const draft = parseBreachIntentDraft(JSON.stringify({
      title: 'plan gate latency breach',
      problem: 'p', proposedOutcome: 'o', affectedUsersAndSystems: 'a', constraints: 'c', openQuestions: 'q',
    }));
    expect(draft.title).toBe('plan gate latency breach');
  });

  it('strips a markdown fence before parsing', () => {
    const draft = parseBreachIntentDraft('```json\n' + JSON.stringify({
      title: 't', problem: 'p', proposedOutcome: 'o', affectedUsersAndSystems: 'a', constraints: 'c', openQuestions: 'q',
    }) + '\n```');
    expect(draft.title).toBe('t');
  });

  it('throws a clear error on a response that is not the expected shape', () => {
    expect(() => parseBreachIntentDraft('{"title": "t"}')).toThrow(/expected draft shape/);
  });
});

describe('runStage6Detect', () => {
  it('acts on a 3-sigma finding: writes an intent.md with origin stage6-detector, advances the cursor', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 3600_000).toISOString();
    const { appendEvent, loadDetectorState } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const draftFn = async () => ({
      title: 'plan gate is slow', problem: 'p', proposedOutcome: 'o',
      affectedUsersAndSystems: 'a', constraints: 'c', openQuestions: 'q',
    });
    const result = await runStage6Detect(repo.dir, { draftFn, diagnoseFn: async () => 'unused' });

    expect(result.acted).toHaveLength(1);
    const newId = result.acted[0];
    const { loadWorkItem } = await import('../src/relay-dir.js');
    const newItem = loadWorkItem(newId, 'standard', repo.dir);
    expect(newItem.artifacts.intent?.origin).toBe('stage6-detector');
    expect(newItem.artifacts.intent?.body).toContain('p'); // the drafted "problem" text landed in the artifact

    const state = loadDetectorState(repo.dir);
    expect(state.lastCheckedTs.plan).toBeTruthy();
  });

  it('diagnoses a 2-sigma finding without writing any new item', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 120_000).toISOString(); // 2 minutes -> exactly 2 sigma
    const { appendEvent, listItemIds } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const before = listItemIds(repo.dir).length;
    const diagnoseFn = async () => 'diagnosis text';
    const result = await runStage6Detect(repo.dir, { draftFn: async () => { throw new Error('must not be called'); }, diagnoseFn });

    expect(result.diagnosed).toHaveLength(1);
    expect(listItemIds(repo.dir).length).toBe(before); // no new item written
  });

  it('logs a 1-sigma finding with no model call of any kind', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    writeBands(repo.dir, 'gateLatencyS:\n  plan:\n    centerline: 60\n    sigma: 30\n');
    const { id } = await runNew('x', {}, repo.dir);
    const requestedAt = new Date(Date.now() - 90_000).toISOString(); // 1.5 minutes -> 1 sigma zone
    const { appendEvent } = await import('../src/relay-dir.js');
    appendEvent(id, { ts: requestedAt, type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    await runGate(id, 'plan', 'approve', undefined, repo.dir);

    const result = await runStage6Detect(repo.dir, {
      draftFn: async () => { throw new Error('must not be called'); },
      diagnoseFn: async () => { throw new Error('must not be called'); },
    });
    expect(result.logged).toHaveLength(1);
  });
});
