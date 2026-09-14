import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { runInit, runNew, runGate } from '@relay/cli/lib';

const HOOK_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../dist/hooks/pre-tool-use.js');

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-hook-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runHook(input: object): { status: number; stderr: string } {
  try {
    execFileSync('node', [HOOK_PATH], { input: JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'] });
    return { status: 0, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stderr: Buffer };
    return { status: e.status, stderr: e.stderr.toString() };
  }
}

function runHookRaw(input: string, cwd: string): { status: number; stderr: string } {
  try {
    execFileSync('node', [HOOK_PATH], { input, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    return { status: 0, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stderr: Buffer };
    return { status: e.status, stderr: e.stderr.toString() };
  }
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('pre-tool-use hook', () => {
  it('allows edits when there is no .relay/ at all — Relay does not apply here', () => {
    repo = makeScratchRepo();
    const result = runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: join(repo.dir, 'src/app.ts') } });
    expect(result.status).toBe(0);
  });

  it('allows edits to .relay/ paths regardless of gate state, given an absolute file_path (the real Claude Code payload shape)', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('test', {}, repo.dir);
    const result = runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: join(repo.dir, '.relay/work/001-test/intent.md') } });
    expect(result.status).toBe(0);
  });

  it('also allows a relative .relay/ file_path (defensive — real payloads are absolute, but a relative one should behave the same)', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('test', {}, repo.dir);
    const result = runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: '.relay/work/001-test/intent.md' } });
    expect(result.status).toBe(0);
  });

  it('blocks a source edit before the build gate is approved, naming the reason', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('test', {}, repo.dir);

    const result = runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: join(repo.dir, 'src/app.ts') } });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/build gate/i);
  });

  it('allows the same edit once the build gate is approved (express lane, single gate)', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('x', { lane: 'express' }, repo.dir);
    const planPath = join(repo.dir, `.relay/work/${id}/plan.md`);
    writeFileSync(planPath, readFileSync(planPath, 'utf8')
      .replace('## Files that change\n\n', '## Files that change\n\n`src/app.ts`\n\n')
      .replace('## Work order\n\n', '## Work order\n\n1.\n\n')
      .replace('## Tests that prove completion\n', '## Tests that prove completion\n`a.test.ts`\n'));
    await runGate(id, 'build', 'approve', undefined, repo.dir);

    const result = runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: join(repo.dir, 'src/app.ts') } });
    expect(result.status).toBe(0);
  });

  it('allows Bash and other non-Edit/Write tools unconditionally', () => {
    repo = makeScratchRepo();
    const result = runHook({ cwd: repo.dir, tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(result.status).toBe(0);
  });

  it('fails open (exit 0) on malformed stdin instead of crashing', () => {
    repo = makeScratchRepo();
    const result = runHookRaw('not valid json{{{', repo.dir);
    expect(result.status).toBe(0);
  });
});
