import type { ItemProjection } from './projection.js';

export interface TransitionEvent {
  type: 'transition';
  id: string;
  from: string;
  to: string;
}

export function diffProjections(before: ItemProjection[], after: ItemProjection[]): TransitionEvent[] {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const events: TransitionEvent[] = [];

  for (const item of after) {
    const prior = beforeById.get(item.id);
    const from = prior?.stage ?? 'intake';
    if (from !== item.stage) {
      events.push({ type: 'transition', id: item.id, from, to: item.stage });
    }
  }

  return events;
}
