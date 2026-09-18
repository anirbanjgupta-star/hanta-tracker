import { useState, type ReactNode } from 'react';
import type { ItemProjection } from './types.js';

export function Spotlight({
  items,
  children,
}: {
  items: ItemProjection[];
  children: (shown: ItemProjection[]) => ReactNode;
}) {
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const shown = spotlightId ? items.filter((i) => i.id === spotlightId) : items;

  return (
    <div>
      <div>
        {spotlightId ? (
          <button onClick={() => setSpotlightId(null)}>Exit spotlight</button>
        ) : (
          items.map((i) => (
            <button key={i.id} onClick={() => setSpotlightId(i.id)}>
              Spotlight {i.id}
            </button>
          ))
        )}
      </div>
      {children(shown)}
    </div>
  );
}
