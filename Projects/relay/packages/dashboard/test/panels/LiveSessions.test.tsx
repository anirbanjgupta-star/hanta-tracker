/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LiveSessions } from '../../src/panels/LiveSessions.js';

describe('LiveSessions', () => {
  it('renders an empty state when no activity has arrived', () => {
    render(<LiveSessions activity={[]} />);
    expect(screen.getByText(/no active sessions/i)).toBeInTheDocument();
  });

  it('renders one row per activity entry, most recent first', () => {
    const activity = [
      { type: 'tool_use', tool: 'Write', itemId: '002-y' },
      { type: 'tool_use', tool: 'Edit', itemId: '001-x' },
    ];
    render(<LiveSessions activity={activity} />);
    const rows = screen.getAllByTestId('activity-row');
    expect(rows[0]).toHaveTextContent('Write');
    expect(rows[0]).toHaveTextContent('002-y');
    expect(rows[1]).toHaveTextContent('Edit');
  });

  it('renders an entry missing a recognizable shape without throwing', () => {
    render(<LiveSessions activity={[{ weird: true }]} />);
    expect(screen.getAllByTestId('activity-row')).toHaveLength(1);
  });
});
