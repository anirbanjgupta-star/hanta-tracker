/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from '../src/App.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
}

describe('App', () => {
  it('renders all five panels once items have loaded', async () => {
    const emptyMetrics = { gateLatencyS: {}, stageCycleTimeS: {}, overrideCount: 0, firstPassRate: NaN };
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/items') {
        return Promise.resolve(new Response(JSON.stringify([
          { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'], origin: 'authored' },
        ]), { status: 200 }));
      }
      if (url === '/api/metrics') {
        return Promise.resolve(new Response(JSON.stringify(emptyMetrics), { status: 200 }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }));
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

    render(<App />);

    await waitFor(() => expect(screen.getByLabelText('Pipeline lanes')).toBeInTheDocument());
    expect(screen.getByLabelText('Waiting on you')).toBeInTheDocument();
    expect(screen.getByLabelText('Live sessions')).toBeInTheDocument();
    expect(screen.getByLabelText('Incident strip')).toBeInTheDocument();
    expect(screen.getByLabelText('Flow metrics')).toBeInTheDocument();
  });
});
