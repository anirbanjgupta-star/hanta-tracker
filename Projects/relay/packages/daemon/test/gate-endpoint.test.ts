import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { runInit, runNew } from '@relay/cli/lib';
import { buildServer } from '../src/server.js';

interface ScratchRepo { dir: string; cleanup(): void }
function makeScratchRepo(): ScratchRepo {
  const dir = mkdtempSync(join(tmpdir(), 'relay-daemon-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "you@example.com"', { cwd: dir }); // matches relay init's default roles.yml grant
  execSync('git config user.name "You"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('POST /api/gate', () => {
  it('approves a gate and returns the recorded approval', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      payload: { id, gate: 'plan', action: 'approve' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.verdict).toBe('approved');
    expect(body.gate).toBe('plan');
    await app.close();
  });

  it('requires a reason for reject, matching the CLI\'s own rule, and returns 400 without one', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      payload: { id, gate: 'plan', action: 'reject' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 with the underlying error message when the gate cannot be approved yet', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      payload: { id, gate: 'design', action: 'approve' }, // spec.md does not exist yet
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/does not exist yet/);
    await app.close();
  });

  it('rejects a path-traversal id with 400 before it ever reaches runGate/itemDir', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      payload: { id: '../../../../tmp/relay-traversal-test', gate: 'plan', action: 'approve' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 rather than crashing when the request body is missing entirely', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({ method: 'POST', url: '/api/gate' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for a gate value outside the known three', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST', url: '/api/gate',
      payload: { id, gate: 'bogus', action: 'approve' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('GET /api/metrics', () => {
  it('returns zeroed-out metrics before any gate is approved', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).overrideCount).toBe(0);
    await app.close();
  });

  it('reflects a real approval, including its latencyS-derived gate latency', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    await app.inject({ method: 'POST', url: '/api/gate', payload: { id, gate: 'plan', action: 'approve' } });
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    const body = JSON.parse(res.body);
    expect(body.overrideCount).toBe(0);
    // No gate_requested event was ever written, so latencyS is undefined for
    // this approval — gateLatencyS.plan should not exist, not be zero.
    expect(body.gateLatencyS.plan).toBeUndefined();
    await app.close();
  });
});
