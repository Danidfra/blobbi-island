/**
 * Focused tests for the first-egg adoption publish logic.
 *
 * These test the SMALLEST responsible unit — the `useFirstEggAdoption` hook —
 * with the surrounding Nostr hooks mocked, so we can drive relay success/failure
 * deterministically without any ceremony animation timing.
 *
 * Coverage:
 *   - generatePreview() publishes nothing (pure/local).
 *   - finalizeAdoption publishes baby 31124 BEFORE profile 11125.
 *   - a failed (rejected) baby publish prevents the profile publish.
 *   - a TIMED-OUT baby publish is treated as failure (no leniency) and prevents
 *     the profile publish (regression: the shared publish primitive would have
 *     swallowed this).
 *   - a failed profile publish rejects finalizeAdoption (so the ceremony never
 *     calls onComplete / transitions to playing).
 *   - the SAME canonical d is used in the baby `d`, profile `has[]`, and
 *     `current_companion`, and is the resolved value.
 *   - duplicate concurrent submit only publishes once (in-flight guard).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

// ── Mocks (declared before importing the hook under test) ──

const TEST_PUBKEY = 'feb88e80a63d1111222233334444555566667777888899990000aaaabbbbcccc';

const nostrEvent = vi.fn<(event: NostrEvent, opts?: unknown) => Promise<void>>();
const nostrQuery = vi.fn<() => Promise<NostrEvent[]>>();
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => ({
    ...t,
    tags: t.tags ?? [],
    content: t.content ?? '',
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    id: 'test-id-' + Math.random().toString(16).slice(2),
    pubkey: TEST_PUBKEY,
    sig: 'test-sig',
  }),
);

vi.mock('@/hooks/useNostr', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery } }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { pubkey: TEST_PUBKEY, signer: { signEvent } },
  }),
}));

vi.mock('@/hooks/useAuthor', () => ({
  useAuthor: () => ({ data: { metadata: { name: 'Tester' } } }),
}));

import { useFirstEggAdoption } from './useFirstEggAdoption';
import { KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE } from '@/lib/blobbi-kinds';

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}
function tagValues(tags: string[][], name: string): string[] {
  return tags.filter(([n]) => n === name).map(([, v]) => v);
}

describe('useFirstEggAdoption', () => {
  beforeEach(() => {
    nostrEvent.mockReset();
    nostrQuery.mockReset();
    signEvent.mockClear();
    // Default: no existing profile (brand-new user), publishes succeed.
    nostrQuery.mockResolvedValue([]);
    nostrEvent.mockResolvedValue(undefined);
  });

  it('generatePreview() publishes nothing', () => {
    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    expect(preview.d).toMatch(/^blobbi-[a-z0-9]+-[a-z0-9]+$/i);
    expect(preview.seed).toBeTruthy();
    expect(nostrEvent).not.toHaveBeenCalled();
    expect(signEvent).not.toHaveBeenCalled();
  });

  it('publishes the baby (31124) BEFORE the profile (11125)', async () => {
    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    await result.current.finalizeAdoption(preview, 'Puck');

    const publishedKinds = nostrEvent.mock.calls.map(([e]) => e.kind);
    expect(publishedKinds).toEqual([KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE]);
  });

  it('uses the same canonical d in the baby d, profile has[], and current_companion', async () => {
    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    const returnedId = await result.current.finalizeAdoption(preview, 'Puck');

    const babyEvent = nostrEvent.mock.calls[0][0];
    const profileEvent = nostrEvent.mock.calls[1][0];

    expect(returnedId).toBe(preview.d);
    expect(tagValue(babyEvent.tags, 'd')).toBe(preview.d);
    expect(tagValue(babyEvent.tags, 'stage')).toBe('baby');
    expect(tagValue(babyEvent.tags, 'name')).toBe('Puck');
    expect(tagValues(profileEvent.tags, 'has')).toContain(preview.d);
    expect(tagValue(profileEvent.tags, 'current_companion')).toBe(preview.d);
  });

  it('does NOT publish the profile when the baby publish is rejected', async () => {
    nostrEvent.mockRejectedValueOnce(new Error('relay rejected'));

    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    await expect(result.current.finalizeAdoption(preview, 'Puck')).rejects.toThrow();

    // Only the baby publish was attempted; profile never published.
    expect(nostrEvent).toHaveBeenCalledTimes(1);
    expect(nostrEvent.mock.calls[0][0].kind).toBe(KIND_BLOBBI_STATE);
  });

  it('treats a TIMED-OUT baby publish as failure and does NOT publish the profile', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError');
    nostrEvent.mockRejectedValueOnce(timeout);

    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    await expect(result.current.finalizeAdoption(preview, 'Puck')).rejects.toBe(timeout);
    expect(nostrEvent).toHaveBeenCalledTimes(1);
    expect(nostrEvent.mock.calls[0][0].kind).toBe(KIND_BLOBBI_STATE);
  });

  it('rejects finalizeAdoption when the profile publish fails (so onComplete never runs)', async () => {
    // Baby succeeds, profile fails.
    nostrEvent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('profile relay error'));

    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    await expect(result.current.finalizeAdoption(preview, 'Puck')).rejects.toThrow();

    const publishedKinds = nostrEvent.mock.calls.map(([e]) => e.kind);
    expect(publishedKinds).toEqual([KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE]);
  });

  it('allows a safe retry after failure without leaving the guard stuck', async () => {
    nostrEvent.mockRejectedValueOnce(new Error('first attempt fails'));

    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    await expect(result.current.finalizeAdoption(preview, 'Puck')).rejects.toThrow();

    // Retry: publishes succeed this time. Same d (replaceable overwrite).
    nostrEvent.mockResolvedValue(undefined);
    const id = await result.current.finalizeAdoption(preview, 'Puck');

    expect(id).toBe(preview.d);
    const babyTags = nostrEvent.mock.calls.find(([e]) => e.kind === KIND_BLOBBI_STATE)![0].tags;
    expect(tagValue(babyTags, 'd')).toBe(preview.d);
  });

  it('prevents duplicate baby events on concurrent submit (in-flight guard)', async () => {
    let resolveBaby: (() => void) | undefined;
    // First publish (baby) blocks until we release it; profile resolves normally.
    nostrEvent
      .mockImplementationOnce(
        () => new Promise<void>((res) => { resolveBaby = () => res(); }),
      )
      .mockResolvedValue(undefined);

    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    // Fire two concurrent submits before the first resolves.
    const p1 = result.current.finalizeAdoption(preview, 'Puck');
    const p2 = result.current.finalizeAdoption(preview, 'Puck');

    // The two submits share one in-flight promise (guard), so run() executes
    // once — same object identity.
    expect(p1).toBe(p2);

    // Wait until the (single) baby publish is actually in flight, then release.
    await vi.waitFor(() => expect(resolveBaby).toBeTypeOf('function'));
    resolveBaby!();

    const [id1, id2] = await Promise.all([p1, p2]);

    expect(id1).toBe(preview.d);
    expect(id2).toBe(preview.d);

    // Exactly one baby publish despite two submits.
    const babyPublishes = nostrEvent.mock.calls.filter(([e]) => e.kind === KIND_BLOBBI_STATE);
    expect(babyPublishes).toHaveLength(1);
  });
});
