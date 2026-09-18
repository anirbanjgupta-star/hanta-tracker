import type { ItemProjection, TransitionEvent } from './types.js';

export interface FeedState {
  items: ItemProjection[];
  connected: boolean;
  activity: unknown[];
}

export type FeedAction =
  | { type: 'loaded'; items: ItemProjection[] }
  | { type: 'ws-open' }
  | { type: 'ws-closed' }
  | { type: 'ws-message'; raw: string };

export const initialFeedState: FeedState = { items: [], connected: false, activity: [] };

const MAX_ACTIVITY = 50;

function isTransitionEvent(value: unknown): value is TransitionEvent {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'transition';
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'loaded':
      return { ...state, items: action.items };
    case 'ws-open':
      return { ...state, connected: true };
    case 'ws-closed':
      return { ...state, connected: false };
    case 'ws-message': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(action.raw);
      } catch {
        return state;
      }
      if (isTransitionEvent(parsed)) {
        const known = state.items.some((i) => i.id === parsed.id);
        // lane/blockedBy/origin are placeholders for a brand-new item — a
        // transition event carries none of them — corrected moments later
        // by useRelayFeed's own refetch-on-transition (same reasoning as
        // the stale-blockedBy fix from Phase 5's own acceptance run).
        const items = known
          ? state.items.map((i) => (i.id === parsed.id ? { ...i, stage: parsed.to as ItemProjection['stage'] } : i))
          : [...state.items, { id: parsed.id, lane: 'standard', stage: parsed.to as ItemProjection['stage'], blockedBy: [], origin: 'authored' as const }];
        return { ...state, items };
      }
      return { ...state, activity: [parsed, ...state.activity].slice(0, MAX_ACTIVITY) };
    }
    default:
      return state;
  }
}
