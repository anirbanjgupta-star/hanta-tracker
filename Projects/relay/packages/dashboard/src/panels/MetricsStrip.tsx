import type { FlowMetrics } from '../types.js';

export function MetricsStrip({ metrics }: { metrics: FlowMetrics }) {
  return (
    <section aria-label="Flow metrics" style={{ display: 'flex', gap: '2rem' }}>
      <div>
        Overrides: <strong>{metrics.overrideCount}</strong>
      </div>
      <div data-testid="first-pass-rate">
        First-pass rate: <strong>{Number.isNaN(metrics.firstPassRate) ? '—' : `${Math.round(metrics.firstPassRate * 100)}%`}</strong>
      </div>
      {Object.entries(metrics.gateLatencyS).map(([gate, stat]) => (
        <div key={gate} data-testid={`gate-latency-${gate}`}>
          {gate} gate latency: <strong>{Math.round(stat!.avgS)}s</strong> (n={stat!.count})
        </div>
      ))}
    </section>
  );
}
