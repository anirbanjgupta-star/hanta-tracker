import type { ItemProjection } from '../types.js';

export function IncidentStrip({ items }: { items: ItemProjection[] }) {
  const incidents = items.filter((item) => item.origin === 'stage6-detector');

  if (incidents.length === 0) {
    return (
      <section aria-label="Incident strip">
        <p>No incidents.</p>
      </section>
    );
  }

  return (
    <section aria-label="Incident strip">
      {incidents.map((item) => (
        <div key={item.id}>{item.id}</div>
      ))}
    </section>
  );
}
