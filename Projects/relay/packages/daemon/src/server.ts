import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { watch } from 'chokidar';
import { join } from 'node:path';
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

  app.get('/stream', { websocket: true }, (socket) => {
    registry.add(socket);
    socket.on('close', () => registry.remove(socket));
  });

  return app;
}
