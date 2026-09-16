export function LiveSessions({ activity }: { activity: unknown[] }) {
  if (activity.length === 0) {
    return (
      <section aria-label="Live sessions">
        <p>No active sessions.</p>
      </section>
    );
  }

  return (
    <section aria-label="Live sessions">
      {activity.map((entry, i) => {
        const e = entry as { type?: string; tool?: string; itemId?: string };
        return (
          <div key={i} data-testid="activity-row">
            {e.tool ?? e.type ?? 'event'}
            {e.itemId ? ` — ${e.itemId}` : ''}
          </div>
        );
      })}
    </section>
  );
}
