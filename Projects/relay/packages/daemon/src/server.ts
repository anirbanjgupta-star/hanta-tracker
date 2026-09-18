import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { watch } from 'chokidar';
import { join } from 'node:path';
import { runGate, loadWorkItem, loadRelayConfig, listItemIds, findBreaches, runStage6Detect } from '@relay/cli/lib';
import { computeMetrics } from '@relay/core';
import { buildProjection } from './projection.js';
import { diffProjections } from './diff.js';
import { ClientRegistry } from './broadcast.js';

export async function buildServer(cwd: string): Promise<FastifyInstance> {
  const app = Fastify();
  const registry = new ClientRegistry();
  await app.register(websocketPlugin);

  let lastProjection = buildProjection(cwd);

  function recompute() {
    const next = buildProjection(cwd);
    for (const event of diffProjections(lastProjection, next)) {
      registry.broadcast(event);
    }
    lastProjection = next;

    // Fire-and-forget: a breach here is genuinely a side effect (it may
    // write a new item to disk, which is itself a filesystem change this
    // same watcher will pick up on its own next tick and broadcast like
    // any other new item — no separate wiring needed for the incident to
    // reach the dashboard once it exists). Never let a Stage 6 failure
    // (e.g. no ANTHROPIC_API_KEY configured, or a malformed
    // stage6-bands.yml — findBreaches() itself can throw synchronously,
    // e.g. a zod validation error, not just runStage6Detect's own async
    // failures) crash the daemon's own watch loop — this feature is
    // opt-in (no .relay/policies/stage6-bands.yml means findBreaches()
    // returns [] immediately, no-op) and its own errors must degrade the
    // same way a missing .relay/config.yml does everywhere else in this
    // codebase: fail silently, never take down ergonomics that have
    // nothing to do with this feature. The guard call below is
    // synchronous and chokidar's 'all' listener has no surrounding
    // try/catch of its own, so an uncaught throw here would crash the
    // whole process, not just this one feature — confirmed by reproducing
    // it with sigma: 0 in stage6-bands.yml before adding this try/catch.
    try {
      if (findBreaches(cwd).length > 0) {
        runStage6Detect(cwd).catch((err) => {
          console.error('[stage6] detection failed:', (err as Error).message);
        });
      }
    } catch (err) {
      console.error('[stage6] detection failed:', (err as Error).message);
    }
  }

  // Accepted tradeoff, not an oversight: a change landing in the narrow
  // window between the buildProjection() call above and chokidar finishing
  // its own initial directory scan could be missed by both — not in the
  // synchronous snapshot already taken, and suppressed by ignoreInitial
  // while the scan is still running. GET /api/items always reads fresh from
  // disk regardless of lastProjection, so a client that polls or reconnects
  // recovers the true state either way; only a live WS /stream notification
  // for that one edit could be lost. Fine for v1's real usage pattern.
  const watcher = watch(
    [join(cwd, '.relay'), join(cwd, '.git/HEAD'), join(cwd, '.git/refs')],
    { ignoreInitial: true }
  );
  watcher.on('all', recompute);
  app.addHook('onClose', async () => watcher.close());

  app.get('/api/items', async () => buildProjection(cwd));

  app.post('/events', async (request, reply) => {
    registry.broadcast(request.body);
    reply.code(202);
    return { received: true };
  });

  app.post('/api/gate', async (request, reply) => {
    const body = request.body as { id?: unknown; gate?: unknown; action?: unknown; reason?: unknown } | null;
    // id arrives from an untrusted HTTP body here, unlike every other caller
    // of runGate/itemDir so far, which has always been a value the person
    // running the CLI typed themselves — itemDir() does no path sanitization
    // of its own (join(relayRoot(cwd), 'work', id)), so an id like
    // '../../../../tmp/pwned' would otherwise create directories and write
    // approvals.jsonl outside .relay/work entirely. Reject anything that
    // doesn't match the real id shape (allocateItemId in item-id.ts:
    // <3+ digit counter>-<lowercase alnum/hyphen slug, possibly empty>)
    // before it ever reaches runGate.
    const idPattern = /^\d{3,}-[a-z0-9-]*$/;
    const gates = ['plan', 'design', 'build'];
    const actions = ['approve', 'reject', 'override'];
    if (
      typeof body?.id !== 'string' || !idPattern.test(body.id) ||
      typeof body?.gate !== 'string' || !gates.includes(body.gate) ||
      typeof body?.action !== 'string' || !actions.includes(body.action) ||
      (body.reason !== undefined && typeof body.reason !== 'string')
    ) {
      reply.code(400);
      return { error: 'invalid request body — id, gate, and action are required and must have valid shapes' };
    }
    const { id, gate, action, reason } = body as { id: string; gate: 'plan' | 'design' | 'build'; action: 'approve' | 'reject' | 'override'; reason?: string };
    if ((action === 'reject' || action === 'override') && !reason) {
      reply.code(400);
      return { error: `--reason is required for --${action}` };
    }
    try {
      const approval = await runGate(id, gate, action, reason, cwd);
      return approval;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/metrics', async () => {
    const config = loadRelayConfig(cwd);
    const items = listItemIds(cwd).map((id) => loadWorkItem(id, config.defaultLane, cwd));
    return computeMetrics(items);
  });

  app.get('/stream', { websocket: true }, (socket) => {
    registry.add(socket);
    socket.on('close', () => registry.remove(socket));
  });

  return app;
}
