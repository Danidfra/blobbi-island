/**
 * The presence circuit breaker: a signer refusal pauses presence for the
 * lifecycle: one prompt, one quiet line, no loop, while transient failures
 * keep their existing retry behaviour and leaving the world resets everything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PresenceSignerRefusedError } from '@/lib/presence-publish';
import { getPresenceStatus, setPresenceStatus } from '@/lib/presence-status';
import { useIslandPresence } from './useIslandPresence';

const PUBKEY = 'f'.repeat(64);

function renderPresence(publish: (event: Record<string, unknown>) => Promise<void>) {
  return renderHook(
    () =>
    useIslandPresence({
      islandId: 'island',
      location: 'town',
      pubkey: PUBKEY,
      blobbiD: 'blobbi-aaaaaaaaaaaa-bbbbbbbbbb',
      startPos: { x: 50, y: 75 },
      publish,
      subscribe: () => ({ close: () => {} }),
      fetch31124: async () => ({}) as never,
      percentToPixel: (p) => ({ x: p.x * 10, y: p.y * 7 }),
      pixelToPercent: (p) => ({ x: p.x / 10, y: p.y / 7 }),
      getWorldScale: () => 1,
    }),
    { wrapper: ({ children }) => <MovementBlockerProvider>{children}</MovementBlockerProvider> },
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
let consoleInfo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setPresenceStatus('idle');
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a signer refusal', () => {
  it('stops every further presence publish for the lifecycle, quietly, and the world stays usable', async () => {
    const publish = vi.fn(async () => {
      throw new PresenceSignerRefusedError('declined');
    });
    const { result } = renderPresence(publish);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.signerRefused).toBe(true));
    expect(publish).toHaveBeenCalledTimes(1); // the login prompt, once

    // Walking, hiding, sitting: nothing asks the signer again.
    await act(async () => {
      await result.current.moveTo({ x: 30, y: 80 });
      await result.current.moveTo({ x: 40, y: 82 });
      await result.current.hideAt('bush-1');
      await result.current.setActivity(null);
    });
    expect(publish).toHaveBeenCalledTimes(1);

    // One restrained line, no errors, no per-attempt warnings about presence.
    // (The stub `fetch31124` logs its own "Blobbi not found"; that is the
    // visual loader, not presence.)
    const presenceLogs = (spy: ReturnType<typeof vi.spyOn>) =>
      spy.mock.calls.filter(([message]) => /presence|publish|move|heartbeat|hide/i.test(String(message)));
    expect(consoleInfo).toHaveBeenCalledTimes(1);
    expect(presenceLogs(consoleError)).toHaveLength(0);
    expect(presenceLogs(consoleWarn)).toHaveLength(0);
    expect(result.current.error).toBeUndefined();
    expect(getPresenceStatus()).toBe('signer-declined');
  });

  it('a refusal on a LATER publish (login was accepted) pauses from that point', async () => {
    let calls = 0;
    const publish = vi.fn(async () => {
      calls += 1;
      if (calls >= 2) throw new PresenceSignerRefusedError('declined');
    });
    const { result } = renderPresence(publish);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getPresenceStatus()).toBe('live');
    await act(async () => {
      await result.current.moveTo({ x: 30, y: 80 });
      await result.current.moveTo({ x: 35, y: 80 });
      await result.current.moveTo({ x: 40, y: 80 });
    });
    expect(publish).toHaveBeenCalledTimes(2); // login + the refused move; nothing after
    expect(result.current.signerRefused).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('a transient failure', () => {
  it('is not a refusal: later publishes are still attempted, as before', async () => {
    const publish = vi.fn(async () => {
      throw new Error('relay down');
    });
    const { result } = renderPresence(publish);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.signerRefused).toBe(false);
    await act(async () => {
      await result.current.moveTo({ x: 30, y: 80 });
    });
    expect(publish.mock.calls.length).toBeGreaterThan(1);
    expect(getPresenceStatus()).toBe('live');
  });
});

describe('leaving the world', () => {
  it('resets the status; re-entering asks the signer again', async () => {
    const publish = vi.fn(async () => {
      throw new PresenceSignerRefusedError('declined');
    });
    const first = renderPresence(publish);
    await waitFor(() => expect(first.result.current.signerRefused).toBe(true));
    first.unmount();
    expect(getPresenceStatus()).toBe('idle');

    const second = renderPresence(publish);
    await waitFor(() => expect(second.result.current.signerRefused).toBe(true));
    expect(publish).toHaveBeenCalledTimes(2); // one prompt per lifecycle, never more
  });
});
