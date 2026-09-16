import { describe, it, expect } from 'vitest';
import { feedReducer, initialFeedState } from '../src/feed.js';
import sampleSession from './fixtures/sample-session.json';

describe('recorded fixture playback', () => {
  it('replays a realistic session and reaches the expected final state — proves feedReducer against non-synthetic input', () => {
    let state = initialFeedState;
    for (const event of sampleSession) {
      state = feedReducer(state, { type: 'ws-message', raw: JSON.stringify(event) });
    }

    expect(state.items.find((i) => i.id === '001-checkout-fix')?.stage).toBe('build');
    expect(state.items.find((i) => i.id === '002-sso-support')?.stage).toBe('design');
    expect(state.activity).toHaveLength(2); // the two tool_use entries, transitions never touch activity
  });
});
