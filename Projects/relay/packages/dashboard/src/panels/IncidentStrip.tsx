// Real panel, no real data source yet — the Stage 6 detector that would
// populate this (a band breach writing an intent.md with no human in the
// path) is Phase 5b, not this phase. See docs/plans/phase-5-dashboard.md's
// own header for why this is a stated scope boundary, not an oversight.
export function IncidentStrip() {
  return (
    <section aria-label="Incident strip">
      <p>No incidents.</p>
    </section>
  );
}
