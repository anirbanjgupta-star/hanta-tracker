import { describe, it, expect, vi } from 'vitest';
import { ClientRegistry } from '../src/broadcast.js';

function fakeSocket(readyState = 1) {
  return { readyState, send: vi.fn() };
}

describe('ClientRegistry', () => {
  it('sends a JSON-serialised event to every registered open client', () => {
    const registry = new ClientRegistry();
    const a = fakeSocket();
    const b = fakeSocket();
    registry.add(a as never);
    registry.add(b as never);

    registry.broadcast({ type: 'transition', id: '001-x', from: 'plan', to: 'design' });

    const payload = JSON.stringify({ type: 'transition', id: '001-x', from: 'plan', to: 'design' });
    expect(a.send).toHaveBeenCalledWith(payload);
    expect(b.send).toHaveBeenCalledWith(payload);
  });

  it('skips a client that is not in the open state', () => {
    const registry = new ClientRegistry();
    const closed = fakeSocket(3); // WebSocket.CLOSED
    registry.add(closed as never);

    registry.broadcast({ type: 'transition', id: '001-x', from: 'plan', to: 'design' });

    expect(closed.send).not.toHaveBeenCalled();
  });

  it('stops sending to a client after it is removed', () => {
    const registry = new ClientRegistry();
    const a = fakeSocket();
    registry.add(a as never);
    registry.remove(a as never);

    registry.broadcast({ type: 'transition', id: '001-x', from: 'plan', to: 'design' });

    expect(a.send).not.toHaveBeenCalled();
  });
});
