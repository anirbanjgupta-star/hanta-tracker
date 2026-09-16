import { describe, it, expect } from 'vitest';
import { feedReducer, initialFeedState } from '../src/feed.js';
import type { ItemProjection } from '../src/types.js';

function item(id: string, stage: ItemProjection['stage']): ItemProjection {
  return { id, lane: 'standard', stage, blockedBy: [] };
}

describe('feedReducer', () => {
  it('starts with an empty item list and disconnected status', () => {
    expect(initialFeedState.items).toEqual([]);
    expect(initialFeedState.connected).toBe(false);
  });

  it('replaces the item list on "loaded"', () => {
    const state = feedReducer(initialFeedState, { type: 'loaded', items: [item('001-x', 'plan')] });
    expect(state.items).toEqual([item('001-x', 'plan')]);
  });

  it('marks connected on "ws-open" and disconnected on "ws-closed"', () => {
    let state = feedReducer(initialFeedState, { type: 'ws-open' });
    expect(state.connected).toBe(true);
    state = feedReducer(state, { type: 'ws-closed' });
    expect(state.connected).toBe(false);
  });

  it('updates one item\'s stage on a transition event, leaving others untouched', () => {
    const loaded = feedReducer(initialFeedState, {
      type: 'loaded',
      items: [item('001-x', 'plan'), item('002-y', 'design')],
    });
    const transitioned = feedReducer(loaded, {
      type: 'ws-message',
      raw: JSON.stringify({ type: 'transition', id: '001-x', from: 'plan', to: 'design' }),
    });
    expect(transitioned.items.find((i) => i.id === '001-x')?.stage).toBe('design');
    expect(transitioned.items.find((i) => i.id === '002-y')?.stage).toBe('design'); // unchanged
  });

  it('adds a new item to the list when a transition event names an id not yet known', () => {
    const loaded = feedReducer(initialFeedState, { type: 'loaded', items: [] });
    const state = feedReducer(loaded, {
      type: 'ws-message',
      raw: JSON.stringify({ type: 'transition', id: '003-z', from: 'intake', to: 'plan' }),
    });
    expect(state.items).toEqual([{ id: '003-z', lane: 'standard', stage: 'plan', blockedBy: [] }]);
  });

  it('appends a non-transition WS message to the activity log, capped at 50 entries, without touching items', () => {
    const withItems = feedReducer(initialFeedState, { type: 'loaded', items: [item('001-x', 'plan')] });
    const state = feedReducer(withItems, {
      type: 'ws-message',
      raw: JSON.stringify({ type: 'tool_use', tool: 'Edit', itemId: '001-x' }),
    });
    expect(state.items).toEqual([item('001-x', 'plan')]);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0]).toEqual({ type: 'tool_use', tool: 'Edit', itemId: '001-x' });
  });

  it('ignores an unparseable WS message rather than throwing', () => {
    const state = feedReducer(initialFeedState, { type: 'ws-message', raw: 'not json{{{' });
    expect(state).toEqual(initialFeedState);
  });
});
