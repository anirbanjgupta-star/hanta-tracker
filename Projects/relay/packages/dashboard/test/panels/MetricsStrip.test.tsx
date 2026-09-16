/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MetricsStrip } from '../../src/panels/MetricsStrip.js';
import type { FlowMetrics } from '../../src/types.js';

const metrics: FlowMetrics = {
  gateLatencyS: { plan: { count: 2, avgS: 90 } },
  stageCycleTimeS: { design: { count: 1, avgS: 3600 } },
  overrideCount: 1,
  firstPassRate: 0.75,
};

describe('MetricsStrip', () => {
  it('renders the override count and first-pass rate as a percentage', () => {
    render(<MetricsStrip metrics={metrics} />);
    expect(screen.getByText(/overrides/i)).toHaveTextContent('1');
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });

  it('renders "—" for first-pass rate when it is NaN (no gate approved yet)', () => {
    render(<MetricsStrip metrics={{ ...metrics, firstPassRate: NaN }} />);
    expect(screen.getByTestId('first-pass-rate')).toHaveTextContent('—');
  });

  it('renders a gate-latency entry per gate present in the data', () => {
    render(<MetricsStrip metrics={metrics} />);
    expect(screen.getByTestId('gate-latency-plan')).toHaveTextContent('90');
  });
});
