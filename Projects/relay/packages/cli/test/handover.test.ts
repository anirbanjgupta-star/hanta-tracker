import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent } from '@relay/core';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { runNew } from '../src/commands/new.js';
import { runHandover } from '../src/commands/handover.js';
import { writeArtifact } from '../src/relay-dir.js';
import { specTemplate } from '../src/templates.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runHandover', () => {
  it('writes a five-part bundle to handover/design.md', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    const path = join(repo.dir, `.relay/work/${id}/intent.md`);
    writeFileSync(path, readFileSync(path, 'utf8').replace(
      '## Open questions\n', '## Open questions\nShould this cover mobile too?\n'
    ));

    const written = runHandover(id, 'design', repo.dir);
    expect(existsSync(written)).toBe(true);
    const bundle = readFileSync(written, 'utf8');
    expect(bundle).toMatch(/Frozen upstream artifact/);
    expect(bundle).toMatch(/Decisions made and alternatives rejected/);
    expect(bundle).toMatch(/Should this cover mobile too\?/);
    expect(bundle).toMatch(/Applicable policies/);
    expect(bundle).toMatch(/What this stage owes/);
    expect(bundle).toMatch(/spec\.md/); // design owes a spec.md
  });

  it('throws for an unmodelled --to target', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    // @ts-expect-error deliberately invalid at the type level too
    expect(() => runHandover(id, 'done', repo.dir)).toThrow(/no handover bundle/i);
  });

  it('surfaces unresolved flagged concerns as open items for --to build, not "None recorded"', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const intentHash = hashContent(readFileSync(join(repo.dir, `.relay/work/${id}/intent.md`), 'utf8'));
    const specRaw = specTemplate(id, 'standard', intentHash)
      .replace('## Requirements\n\n', '## Requirements\n\nr\n\n')
      .replace('## Design\n\n', '## Design\n\nd\n\n')
      .replace('## Flagged concerns\n', '## Flagged concerns\n- [ ] Does this scale to 10x load?\n');
    writeArtifact(id, 'spec', specRaw, repo.dir);

    const written = runHandover(id, 'build', repo.dir);
    const bundle = readFileSync(written, 'utf8');
    expect(bundle).toMatch(/Does this scale to 10x load\?/);
    expect(bundle).not.toMatch(/None recorded\./);
  });

  it('reports "None recorded." when the upstream artifact truly has no open items', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);
    // Fresh intent.md's "## Open questions" section is empty by design.

    const written = runHandover(id, 'design', repo.dir);
    const bundle = readFileSync(written, 'utf8');
    expect(bundle).toMatch(/None recorded\./);
  });

  it('reports "none declared" when the upstream artifact has no policies', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const written = runHandover(id, 'design', repo.dir);
    const bundle = readFileSync(written, 'utf8');
    expect(bundle).toMatch(/none declared/);
  });
});
