import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { writeArtifact, loadWorkItem, appendApproval, listItemIds, appendEvent, itemDir, loadDetectorState, saveDetectorState } from '../src/relay-dir.js';
import { hashContent } from '@relay/core';
import type { Approval } from '@relay/core';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('writeArtifact / loadWorkItem', () => {
  it('round-trips an artifact written to disk', () => {
    repo = makeScratchRepo();
    const raw = '---\nid: 001-x\nlane: standard\n---\n\n## Problem\np\n';
    writeArtifact('001-x', 'intent', raw, repo.dir);

    const item = loadWorkItem('001-x', 'standard', repo.dir);
    expect(item.artifacts.intent?.raw).toBe(raw);
    expect(item.artifacts.spec).toBeUndefined();
    expect(item.approvals).toEqual([]);
  });

  it('falls back to the given default lane when no artifact exists yet', () => {
    repo = makeScratchRepo();
    const item = loadWorkItem('002-y', 'express', repo.dir);
    expect(item.lane).toBe('express');
    expect(item.artifacts).toEqual({});
  });

  it('derives lane from the intent artifact when present', () => {
    repo = makeScratchRepo();
    const raw = '---\nid: 003-z\nlane: governed\n---\n\n## Problem\np\n';
    writeArtifact('003-z', 'intent', raw, repo.dir);
    const item = loadWorkItem('003-z', 'standard', repo.dir);
    expect(item.lane).toBe('governed');
  });

  it('falls through to spec when intent is absent (express-style items skip intent)', () => {
    repo = makeScratchRepo();
    const raw = '---\nid: 004-w\nlane: express\nupstream: sha256:' + 'a'.repeat(64) + '\n---\n\n## Requirements\nr\n';
    writeArtifact('004-w', 'spec', raw, repo.dir);
    const item = loadWorkItem('004-w', 'standard', repo.dir);
    expect(item.lane).toBe('express');
  });
});

describe('appendApproval', () => {
  it('appends a JSONL record readable back by loadWorkItem', () => {
    repo = makeScratchRepo();
    const raw = '---\nid: 001-x\nlane: standard\n---\n\nbody\n';
    writeArtifact('001-x', 'intent', raw, repo.dir);
    const approval: Approval = {
      ts: '2026-09-11T10:00:00Z', itemId: '001-x', gate: 'plan', artifact: 'intent.md',
      hash: hashContent(raw), identity: 'po@example.com', role: 'product-owner', verdict: 'approved',
    };
    appendApproval('001-x', approval, repo.dir);
    appendApproval('001-x', { ...approval, ts: '2026-09-11T11:00:00Z' }, repo.dir);

    const item = loadWorkItem('001-x', 'standard', repo.dir);
    expect(item.approvals).toHaveLength(2);
  });
});

describe('appendEvent', () => {
  it('appends a JSONL record to events.jsonl', () => {
    repo = makeScratchRepo();
    writeArtifact('001-x', 'intent', 'i', repo.dir);
    appendEvent('001-x', { ts: '2026-09-13T10:00:00Z', type: 'gate_requested', gate: 'plan', identity: 'eng@example.com' }, repo.dir);
    appendEvent('001-x', { ts: '2026-09-13T11:00:00Z', type: 'gate_requested', gate: 'design', identity: 'eng@example.com' }, repo.dir);

    const raw = readFileSync(join(itemDir('001-x', repo.dir), 'events.jsonl'), 'utf8');
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].gate).toBe('plan');
    expect(lines[1].gate).toBe('design');
  });
});

describe('listItemIds', () => {
  it('returns an empty list before any item exists', () => {
    repo = makeScratchRepo();
    expect(listItemIds(repo.dir)).toEqual([]);
  });

  it('lists item directories under .relay/work', () => {
    repo = makeScratchRepo();
    writeArtifact('001-a', 'intent', 'a', repo.dir);
    writeArtifact('002-b', 'intent', 'b', repo.dir);
    expect(listItemIds(repo.dir).sort()).toEqual(['001-a', '002-b']);
  });
});

describe('detector state', () => {
  it('returns an empty cursor before any detector run has happened', () => {
    repo = makeScratchRepo();
    expect(loadDetectorState(repo.dir)).toEqual({ lastCheckedTs: {} });
  });

  it('round-trips a saved cursor', () => {
    repo = makeScratchRepo();
    saveDetectorState({ lastCheckedTs: { plan: '2026-09-17T10:00:00Z' } }, repo.dir);
    expect(loadDetectorState(repo.dir)).toEqual({ lastCheckedTs: { plan: '2026-09-17T10:00:00Z' } });
  });
});
