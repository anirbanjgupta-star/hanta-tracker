/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WaitingOnYou } from '../../src/panels/WaitingOnYou.js';
import type { ItemProjection } from '../../src/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WaitingOnYou', () => {
  it('lists only items with a non-empty blockedBy', () => {
    const items: ItemProjection[] = [
      { id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'] },
      { id: '002-y', lane: 'standard', stage: 'build', blockedBy: [] },
    ];
    render(<WaitingOnYou items={items} />);
    expect(screen.getByText('001-x')).toBeInTheDocument();
    expect(screen.queryByText('002-y')).not.toBeInTheDocument();
  });

  it('calls POST /api/gate with action "approve" when Approve is clicked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'] }];
    render(<WaitingOnYou items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/gate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ id: '001-x', gate: 'plan', action: 'approve' }),
    })));
  });

  it('prompts for a reason and calls POST /api/gate with action "reject" on Send back', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    vi.spyOn(window, 'prompt').mockReturnValue('needs more detail');
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'] }];
    render(<WaitingOnYou items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /send back/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/gate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ id: '001-x', gate: 'plan', action: 'reject', reason: 'needs more detail' }),
    })));
  });

  it('does not call fetch for Send back when the reason prompt is cancelled', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const items: ItemProjection[] = [{ id: '001-x', lane: 'standard', stage: 'plan', blockedBy: ['No approval recorded'] }];
    render(<WaitingOnYou items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /send back/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
