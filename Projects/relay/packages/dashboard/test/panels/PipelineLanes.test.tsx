/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PipelineLanes } from '../../src/panels/PipelineLanes.js';
import type { ItemProjection } from '../../src/types.js';

describe('PipelineLanes', () => {
  it('places each item under its derived stage\'s lane', () => {
    const items: ItemProjection[] = [
      { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: [] },
      { id: '002-y', lane: 'standard', stage: 'build', blockedBy: [] },
    ];
    render(<PipelineLanes items={items} />);
    expect(screen.getByTestId('lane-plan')).toHaveTextContent('001-x');
    expect(screen.getByTestId('lane-build')).toHaveTextContent('002-y');
    expect(screen.getByTestId('lane-design')).not.toHaveTextContent('001-x');
  });

  it('renders Test, Deploy, Maintain as dimmed lanes with no items ever placed there', () => {
    render(<PipelineLanes items={[]} />);
    expect(screen.getByTestId('lane-test')).toHaveAttribute('data-dimmed', 'true');
    expect(screen.getByTestId('lane-deploy')).toHaveAttribute('data-dimmed', 'true');
    expect(screen.getByTestId('lane-maintain')).toHaveAttribute('data-dimmed', 'true');
    expect(screen.getByTestId('lane-plan')).toHaveAttribute('data-dimmed', 'false');
  });

  it('does not place an "intake" or "done" item in any of the six named lanes', () => {
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'done', blockedBy: [] }];
    render(<PipelineLanes items={items} />);
    for (const lane of ['plan', 'design', 'build', 'test', 'deploy', 'maintain']) {
      expect(screen.getByTestId(`lane-${lane}`)).not.toHaveTextContent('001-x');
    }
  });

  it('renders a gate checkpoint between each of the three live lanes', () => {
    render(<PipelineLanes items={[]} />);
    expect(screen.getByTestId('gate-plan')).toBeInTheDocument();
    expect(screen.getByTestId('gate-design')).toBeInTheDocument();
    expect(screen.getByTestId('gate-build')).toBeInTheDocument();
  });
});
