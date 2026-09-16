/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Spotlight } from '../src/Spotlight.js';
import type { ItemProjection } from '../src/types.js';

const items: ItemProjection[] = [
  { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: [] },
  { id: '002-y', lane: 'standard', stage: 'build', blockedBy: [] },
];

describe('Spotlight', () => {
  it('renders every item\'s id when nothing is spotlighted', () => {
    render(<Spotlight items={items}>{(shown) => shown.map((i) => <div key={i.id}>{i.id}</div>)}</Spotlight>);
    expect(screen.getByText('001-x')).toBeInTheDocument();
    expect(screen.getByText('002-y')).toBeInTheDocument();
  });

  it('narrows to one item after clicking its spotlight control, and back after clicking exit', () => {
    render(<Spotlight items={items}>{(shown) => shown.map((i) => <div key={i.id}>{i.id}</div>)}</Spotlight>);

    fireEvent.click(screen.getByRole('button', { name: /spotlight 001-x/i }));
    expect(screen.getByText('001-x')).toBeInTheDocument();
    expect(screen.queryByText('002-y')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /exit spotlight/i }));
    expect(screen.getByText('001-x')).toBeInTheDocument();
    expect(screen.getByText('002-y')).toBeInTheDocument();
  });
});
