import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli/lib';
import { resumeText } from '../../src/tools/resume.js';

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

describe('resumeText', () => {
  it('renders the resume briefing as readable text naming the id and stage', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const text = resumeText(repo.dir, id);
    expect(text).toContain(id);
    expect(text).toContain('stage: plan');
    expect(text).toContain('Next:');
  });
});
