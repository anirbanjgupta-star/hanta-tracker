import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { makeScratchRepo, type ScratchRepo } from './helpers.js';
import { runInit } from '../src/commands/init.js';

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('runInit', () => {
  it('creates the full .relay/ convention', () => {
    repo = makeScratchRepo();
    const result = runInit(repo.dir);

    expect(existsSync(join(repo.dir, '.relay/config.yml'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/roles.yml'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/templates/intent.md'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/templates/spec.md'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/templates/plan.md'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/schemas/intent.schema.yml'))).toBe(true);
    expect(existsSync(join(repo.dir, '.relay/work'))).toBe(true);
    expect(result.tier).toBe(0);
  });

  it('seeds two example tickets in the simulated legacy connector', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const tickets = JSON.parse(readFileSync(join(repo.dir, '.relay-legacy-tickets.json'), 'utf8'));
    expect(tickets.length).toBe(2);
    expect(tickets[0].ref).toBeTruthy();
  });

  it('adds .relay/CURRENT and the ticket file to .gitignore', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const gitignore = readFileSync(join(repo.dir, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/\.relay\/CURRENT/);
    expect(gitignore).toMatch(/\.relay-legacy-tickets\.json/);
  });

  it('detects a CLAUDE.md rule file and reports tier 1', () => {
    repo = makeScratchRepo();
    writeFileSync(join(repo.dir, 'CLAUDE.md'), '# rules');
    const result = runInit(repo.dir);
    expect(result.tier).toBe(1);
    expect(result.detectedRuleFiles).toContain('CLAUDE.md');
  });

  it('writes a CI workflow only when the remote is on github.com', () => {
    repo = makeScratchRepo();
    execSync('git remote add origin https://github.com/example/repo.git', { cwd: repo.dir });
    runInit(repo.dir);
    expect(existsSync(join(repo.dir, '.github/workflows/relay-verify.yml'))).toBe(true);
  });

  it('skips the CI workflow when there is no GitHub remote', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(existsSync(join(repo.dir, '.github/workflows/relay-verify.yml'))).toBe(false);
  });

  it('refuses to run twice without --force', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(() => runInit(repo.dir)).toThrow(/already initialized/i);
  });

  it('allows re-running with force: true', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    expect(() => runInit(repo.dir, { force: true })).not.toThrow();
  });

  it('does not duplicate .gitignore entries on repeated force runs', () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    runInit(repo.dir, { force: true });
    runInit(repo.dir, { force: true });
    const gitignore = readFileSync(join(repo.dir, '.gitignore'), 'utf8');
    const currentLines = gitignore.split('\n').filter((l) => l.trim() === '.relay/CURRENT');
    expect(currentLines).toHaveLength(1);
  });

  it('still adds the real ignore entry even when a comment merely mentions it', () => {
    repo = makeScratchRepo();
    writeFileSync(join(repo.dir, '.gitignore'), '# TODO: .relay/CURRENT should probably be ignored\n');
    runInit(repo.dir);
    const gitignore = readFileSync(join(repo.dir, '.gitignore'), 'utf8');
    const exactLines = gitignore.split('\n').filter((l) => l.trim() === '.relay/CURRENT');
    expect(exactLines).toHaveLength(1);
  });
});
