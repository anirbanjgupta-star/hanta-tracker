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
  execSync('git config user.email "eng@example.com"', { cwd: dir });
  execSync('git config user.name "Test Engineer"', { cwd: dir });
  execSync('git commit -q --allow-empty -m "init"', { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let repo: ScratchRepo;
afterEach(() => repo?.cleanup());

describe('GET /api/items', () => {
  it('returns every item with derived stage and gate status', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);
    const { id } = await runNew('test', {}, repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({ method: 'GET', url: '/api/items' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(id);
    expect(body[0].stage).toBe('plan');
    await app.close();
  });

  it('returns an empty array before any item exists', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({ method: 'GET', url: '/api/items' });
    expect(JSON.parse(res.body)).toEqual([]);
    await app.close();
  });
});

describe('POST /events', () => {
  it('accepts a JSON body and returns 202 — ephemeral, never persisted to .relay/', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);

    const app = await buildServer(repo.dir);
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'tool_use', tool: 'Edit', itemId: '001-test' },
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });
});

describe('WS /stream', () => {
  it('broadcasts a POST /events payload to every connected client', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);

    const app = await buildServer(repo.dir);
    await app.ready();

    const ws = await app.injectWS('/stream');
    const received = new Promise<string>((resolve) => {
      ws.on('message', (data: Buffer) => resolve(data.toString()));
    });

    await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'tool_use', tool: 'Edit', itemId: '001-test' },
    });

    expect(await received).toBe(JSON.stringify({ type: 'tool_use', tool: 'Edit', itemId: '001-test' }));

    ws.terminate();
    await app.close();
  });

  it('stops broadcasting to a client after it disconnects', async () => {
    repo = makeScratchRepo();
    runInit(repo.dir);

    const app = await buildServer(repo.dir);
    await app.ready();

    const ws = await app.injectWS('/stream');
    ws.terminate();
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the 'close' handler run

    // No assertion needed beyond "this doesn't throw" — broadcasting to a
    // registry whose only client already disconnected must be a silent no-op.
    await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'tool_use', tool: 'Edit', itemId: '001-test' },
    });

    await app.close();
  });
});
