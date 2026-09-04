/**
 * The arrival notice goes to the in-game notice stack, never to the app
 * toaster, and evicting it from the stack does not make the arrival
 * eligible again.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

import { clearGameNotices, gameNoticesSnapshot, showGameNotice } from '@/lib/game-notices';
import type { ExternalInventoryViewResult } from '@/inventory/useExternalInventoryEvents';
import type { ResolvedArrival } from '@/inventory/external-arrivals';

const toastSpy = vi.fn();
vi.mock('@/hooks/useToast', () => ({ toast: (...a: unknown[]) => toastSpy(...a), useToast: () => ({ toast: toastSpy }) }));

let arrivalsCallback: ((arrivals: ResolvedArrival[]) => void) | null = null;
vi.mock('@/inventory/useExternalInventoryEvents', () => ({
  useExternalInventorySync: (): ExternalInventoryViewResult => ({
    inventories: [],
    states: new Map(),
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: 1,
  }),
}));
vi.mock('@/inventory/useExternalInventoryArrivals', () => ({
  useExternalInventoryArrivals: (_view: unknown, options: { onArrivals: (a: ResolvedArrival[]) => void }) => {
    arrivalsCallback = options.onArrivals;
  },
}));

import { ExternalInventoryController } from './ExternalInventoryController';

const strawberry: ResolvedArrival = { itemAddress: 'x', name: 'Strawberry', imageUrl: 'https://img/s.webp', emoji: '🍓', sourceName: 'Nostr Farm', delta: 1 };

beforeEach(() => {
  clearGameNotices();
  toastSpy.mockReset();
  arrivalsCallback = null;
});
afterEach(() => clearGameNotices());

describe('ExternalInventoryController', () => {
  it('raises an in-game notice with the picture, "+N Item" and the source, and no app toast', () => {
    render(<ExternalInventoryController />);
    act(() => arrivalsCallback!([strawberry]));
    expect(gameNoticesSnapshot()).toHaveLength(1);
    expect(gameNoticesSnapshot()[0]).toMatchObject({ title: '+1 Strawberry', description: 'Received from Nostr Farm', imageUrl: 'https://img/s.webp', emoji: '🍓' });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('one reconciliation with several arrivals is one notice', () => {
    render(<ExternalInventoryController />);
    act(() => arrivalsCallback!([strawberry, { ...strawberry, itemAddress: 'y', name: 'Carrot', delta: 2 }]));
    expect(gameNoticesSnapshot().map((n) => n.title)).toEqual(['+1 Strawberry, +2 Carrot']);
  });

  it('a notice evicted by the stack limit is presentation only: the detector is never asked again', () => {
    render(<ExternalInventoryController />);
    act(() => arrivalsCallback!([strawberry]));
    // Two more game moments push the arrival chip out of the stack.
    act(() => {
      showGameNotice({ title: 'B' });
      showGameNotice({ title: 'C' });
    });
    expect(gameNoticesSnapshot().map((n) => n.title)).toEqual(['B', 'C']);
    // Nothing re-raised the arrival: the stack knows no arrivals, and the
    // arrivals hook (whose baseline advanced when it reported) was not
    // re-invoked by the eviction.
    expect(gameNoticesSnapshot().some((n) => n.title === '+1 Strawberry')).toBe(false);
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
