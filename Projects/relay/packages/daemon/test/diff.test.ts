import { describe, it, expect } from 'vitest';
import { diffProjections } from '../src/diff.js';
import type { ItemProjection } from '../src/projection.js';

function item(id: string, stage: ItemProjection['stage']): ItemProjection {
  return { id, lane: 'standard', stage, blockedBy: [] };
}

describe('diffProjections', () => {
  it('emits nothing when no item changed stage', () => {
    const before = [item('001-x', 'plan')];
    const after = [item('001-x', 'plan')];
    expect(diffProjections(before, after)).toEqual([]);
  });

  it('emits a transition event when an existing item changes stage', () => {
    const before = [item('001-x', 'plan')];
    const after = [item('001-x', 'design')];
    expect(diffProjections(before, after)).toEqual([
      { type: 'transition', id: '001-x', from: 'plan', to: 'design' },
    ]);
  });

  it('emits a transition event from "intake" for a newly-appeared item', () => {
    const before: ItemProjection[] = [];
    const after = [item('001-x', 'plan')];
    expect(diffProjections(before, after)).toEqual([
      { type: 'transition', id: '001-x', from: 'intake', to: 'plan' },
    ]);
  });

  it('emits one event per changed item when several change at once', () => {
    const before = [item('001-x', 'plan'), item('002-y', 'design')];
    const after = [item('001-x', 'design'), item('002-y', 'build')];
    const events = diffProjections(before, after);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.id).sort()).toEqual(['001-x', '002-y']);
  });

  it('ignores an item that disappears — a projection never loses items in practice, and reappearance is not this function\'s concern', () => {
    const before = [item('001-x', 'plan')];
    const after: ItemProjection[] = [];
    expect(diffProjections(before, after)).toEqual([]);
  });
});
