/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { IncidentStrip } from '../../src/panels/IncidentStrip.js';
import type { ItemProjection } from '../../src/types.js';

describe('IncidentStrip', () => {
  it('renders a quiet empty state when nothing has origin stage6-detector', () => {
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'plan', blockedBy: [], origin: 'authored' }];
    render(<IncidentStrip items={items} />);
    expect(screen.getByLabelText('Incident strip')).toBeInTheDocument();
    expect(screen.getByText(/no incidents/i)).toBeInTheDocument();
  });

  it('lists only items whose origin is stage6-detector', () => {
    const items: ItemProjection[] = [
      { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: [], origin: 'authored' },
      { id: '002-y', lane: 'standard', stage: 'plan', blockedBy: [], origin: 'stage6-detector' },
    ];
    render(<IncidentStrip items={items} />);
    expect(screen.getByText('002-y')).toBeInTheDocument();
    expect(screen.queryByText('001-x')).not.toBeInTheDocument();
  });
});
