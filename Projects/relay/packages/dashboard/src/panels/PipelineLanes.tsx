import type { ItemProjection, Stage } from '../types.js';

const LIVE_LANES: Stage[] = ['plan', 'design', 'build'];
const DIMMED_LANES = ['test', 'deploy', 'maintain'] as const;

export function PipelineLanes({ items }: { items: ItemProjection[] }) {
  return (
    <section aria-label="Pipeline lanes" style={{ display: 'flex', gap: '1rem' }}>
      {LIVE_LANES.map((stage) => (
        <div key={stage} style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div data-testid={`lane-${stage}`} data-dimmed="false">
            <h3>{stage}</h3>
            {items
              .filter((item) => item.stage === stage)
              .map((item) => (
                // Cards pulsing while an agent actively works them (SPEC §13)
                // is a design-pass concern — this renders correct placement
                // only, no animation, per this plan's functional-first scope.
                <div key={item.id} data-testid={`item-${item.id}`}>
                  {item.id}
                </div>
              ))}
          </div>
          <div data-testid={`gate-${stage}`}>→</div>
        </div>
      ))}
      {DIMMED_LANES.map((stage) => (
        <div key={stage} data-testid={`lane-${stage}`} data-dimmed="true">
          <h3>{stage}</h3>
        </div>
      ))}
    </section>
  );
}
