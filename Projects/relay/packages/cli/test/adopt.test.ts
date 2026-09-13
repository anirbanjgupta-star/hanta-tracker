import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runAdopt, extractJson, parseAdoptedDraft, type AdoptedDraft } from '../src/commands/adopt.js';
import { loadWorkItem } from '../src/relay-dir.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

const STUB_DRAFT: AdoptedDraft = {
  title: 'persist catalog metadata',
  intent: {
    problem: 'Items vanish on reseed.',
    proposedOutcome: 'Metadata survives a reseed.',
    affectedUsersAndSystems: 'Catalog service.',
    constraints: 'No schema migration downtime.',
    openQuestions: 'None.',
  },
  spec: { requirements: 'Persist to git.', design: 'Write-through on save.', flaggedConcerns: '- [x] none — accepted risk: n/a' },
  plan: { workOrder: '1. Add writer. 2. Wire routes.', testsThatProveCompletion: '`test/db.test.js`' },
};

describe('runAdopt', () => {
  it('throws when there is no diff against base', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await expect(runAdopt(repo.dir, { draftFn: async () => STUB_DRAFT }))
      .rejects.toThrow(/no diff/i);
  });

  it('drafts intent, spec and plan, marks origin adopted, and reads files-changed from the real diff', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    execSync('git checkout -b relay/adopt-test -q', { cwd: repo.dir });
    writeFileSync(join(repo.dir, 'db.js'), 'module.exports = {};');
    execSync('git add db.js && git commit -q -m "add db writer"', { cwd: repo.dir });

    const result = await runAdopt(repo.dir, { draftFn: async () => STUB_DRAFT });

    const item = loadWorkItem(result.id, 'standard', repo.dir);
    expect(item.artifacts.intent?.origin).toBe('adopted');
    expect(item.artifacts.spec?.origin).toBe('adopted');
    expect(item.artifacts.plan?.origin).toBe('adopted');
    expect(item.artifacts.intent?.body).toMatch(/Items vanish on reseed/);
    expect(item.artifacts.plan?.body).toMatch(/db\.js/);
  });

  it('throws a clear error when no draftFn is given and ANTHROPIC_API_KEY is unset', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    execSync('git checkout -b relay/adopt-test2 -q', { cwd: repo.dir });
    writeFileSync(join(repo.dir, 'x.js'), 'x');
    execSync('git add x.js && git commit -q -m "x"', { cwd: repo.dir });

    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(runAdopt(repo.dir, {})).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});

describe('extractJson', () => {
  it('passes plain JSON through unchanged', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it('strips a ```json code fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a plain ``` code fence with no language tag', () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips preamble text before a fenced block', () => {
    expect(extractJson('Here is the draft:\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe('parseAdoptedDraft', () => {
  const VALID_JSON = JSON.stringify(STUB_DRAFT);

  it('parses a valid, unfenced draft', () => {
    expect(parseAdoptedDraft(VALID_JSON)).toEqual(STUB_DRAFT);
  });

  it('parses a valid draft wrapped in a code fence', () => {
    expect(parseAdoptedDraft('```json\n' + VALID_JSON + '\n```')).toEqual(STUB_DRAFT);
  });

  it('throws a diagnosable error, including the raw response, on invalid JSON', () => {
    expect(() => parseAdoptedDraft('not json at all')).toThrow(/could not parse.*as json/i);
    expect(() => parseAdoptedDraft('not json at all')).toThrow(/not json at all/);
  });

  it('throws a diagnosable error when a required field is missing', () => {
    const missingSpec = JSON.stringify({ title: STUB_DRAFT.title, intent: STUB_DRAFT.intent, plan: STUB_DRAFT.plan });
    expect(() => parseAdoptedDraft(missingSpec)).toThrow(/did not match the expected draft shape/i);
  });

  it('throws when a field has the wrong type instead of silently stringifying it', () => {
    const wrongType = JSON.stringify({ ...STUB_DRAFT, spec: { ...STUB_DRAFT.spec, flaggedConcerns: ['a', 'b'] } });
    expect(() => parseAdoptedDraft(wrongType)).toThrow(/did not match the expected draft shape/i);
  });
});
