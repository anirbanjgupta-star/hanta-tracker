import { useEffect, useReducer } from 'react';
import { feedReducer, initialFeedState } from './feed.js';

function fetchItems(): Promise<unknown> {
  return fetch('/api/items').then((res) => res.json());
}

export function useRelayFeed() {
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);

  useEffect(() => {
    let cancelled = false;
    // Monotonic counter, not just a boolean: a transition-triggered refetch
    // (below) can fire while an earlier one is still in flight, and the two
    // requests can resolve out of order. Without this, a slower-but-older
    // response landing after a faster-but-newer one would silently clobber
    // correct state with stale data — the exact class of bug this file's
    // refetch-on-transition logic exists to fix, just one step further out.
    // Only ever apply the response whose request was the LAST one sent.
    let latestRequestId = 0;
    function loadItems() {
      const requestId = ++latestRequestId;
      fetchItems().then((items) => {
        if (!cancelled && requestId === latestRequestId) {
          dispatch({ type: 'loaded', items: items as never });
        }
      });
    }

    loadItems();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/stream`);
    ws.onopen = () => dispatch({ type: 'ws-open' });
    ws.onclose = () => dispatch({ type: 'ws-closed' });
    ws.onmessage = (event) => {
      // The reducer's own transition handling (feed.ts) only knows the new
      // `stage` — a transition event carries no `blockedBy`, so it can't
      // tell whether the item is newly unblocked, newly blocked on
      // something else, or still waiting on nothing. Dispatching the raw
      // message first gives an immediate, correct stage move (and logs any
      // non-transition activity); re-fetching /api/items right after
      // reconciles the rest (blockedBy, lane) from the one authoritative
      // source, the same "state is recomputed, never stored" principle the
      // daemon itself is built on. Found live, in Task 14's own acceptance
      // run: without this, an item that moved lanes kept showing its
      // stale, pre-transition blockedBy in the "Waiting on you" panel.
      dispatch({ type: 'ws-message', raw: event.data });
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: unknown }).type === 'transition') {
        loadItems();
      }
    };

    return () => {
      cancelled = true;
      ws.close();
    };
  }, []);

  return state;
}
