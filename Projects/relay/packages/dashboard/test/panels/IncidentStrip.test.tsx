/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { IncidentStrip } from '../../src/panels/IncidentStrip.js';

describe('IncidentStrip', () => {
  it('renders a quiet empty state — no incident source exists yet (Phase 5b)', () => {
    render(<IncidentStrip />);
    expect(screen.getByLabelText('Incident strip')).toBeInTheDocument();
    expect(screen.getByText(/no incidents/i)).toBeInTheDocument();
  });
});
