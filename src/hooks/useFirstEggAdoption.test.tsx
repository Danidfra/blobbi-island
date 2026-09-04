/**
 * Focused tests for the first-egg adoption publish logic.
 *
 * These test the SMALLEST responsible unit, the `useFirstEggAdoption` hook,
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

  it('publishes ONLY baby (31124) then profile (11125): adoption is currency-free', async () => {
    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    await result.current.finalizeAdoption(preview, 'Puck');

    const publishedKinds = nostrEvent.mock.calls.map(([e]) => e.kind);
    // Economy reset: adoption creates/adopts a Blobbi and nothing else. The
    // initial 200-Coin allocation belongs to economy entry, so NO kind:31633
    // event is published here and a fresh profile carries NO coins tag.
    expect(publishedKinds).toEqual([KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE]);
    expect(publishedKinds).not.toContain(31633);
    const profileEvent = nostrEvent.mock.calls[1][0];
    expect(profileEvent.tags.find(([n]: string[]) => n === 'coins')).toBeUndefined();
  });

  it('regression: adoption never publishes kind:31633, for new OR existing profiles', async () => {
    // New profile (default mock: no existing profile).
    {
      const { result } = renderHook(() => useFirstEggAdoption());
      await result.current.finalizeAdoption(result.current.generatePreview(), 'A');
      expect(nostrEvent.mock.calls.every(([e]) => e.kind !== 31633)).toBe(true);
    }
    // Existing profile: identical currency-independent behavior.
    nostrEvent.mockClear();
    nostrQuery.mockResolvedValue([
      {
        id: 'existing-profile',
        pubkey: TEST_PUBKEY,
        created_at: 1000,
        kind: KIND_BLOBBONAUT_PROFILE,
        tags: [
          ['d', `blobbi-owner-${TEST_PUBKEY.slice(0, 16)}`],
          ['name', 'Existing'],
          ['coins', '5000'],
        ],
        content: '',
        sig: 'sig',
      },
    ]);
    {
      const { result } = renderHook(() => useFirstEggAdoption());
      await result.current.finalizeAdoption(result.current.generatePreview(), 'B');
      const kinds = nostrEvent.mock.calls.map(([e]) => e.kind);
      expect(kinds).toEqual([KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE]);
      // The legacy coins tag rides through opaquely, preserved verbatim,
      // never updated, never triggering any grant.
      const profileEvent = nostrEvent.mock.calls[1][0];
      expect(profileEvent.tags).toContainEqual(['coins', '5000']);
    }
  });

  it('uses the same canonical d in the baby d, profile has[], and current_companion', async () => {
    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    const handoff = await result.current.finalizeAdoption(preview, 'Puck');

    const babyEvent = nostrEvent.mock.calls[0][0];
    const profileEvent = nostrEvent.mock.calls[1][0];

    expect(handoff.blobbiId).toBe(preview.d);
    // The signed events ride along so the Island can write its caches from
    // them instead of trusting a relay read issued a moment after the publish.
    expect(handoff.babyEvent).toBe(babyEvent);
    expect(handoff.profileEvent).toBe(profileEvent);
    expect(tagValue(babyEvent.tags, 'd')).toBe(preview.d);
    expect(tagValue(babyEvent.tags, 'stage')).toBe('baby');
    expect(tagValue(babyEvent.tags, 'name')).toBe('Puck');
    expect(tagValues(profileEvent.tags, 'has')).toContain(preview.d);
    expect(tagValue(profileEvent.tags, 'current_companion')).toBe(preview.d);
  });

  it('does NOT publish the profile when the baby publish is rejected', async () => {
    // Every attempt: one refusal is now retried, so a single rejection would
    // simply succeed on the next try. See `useFirstEggAdoption.publish.test`.
    nostrEvent.mockRejectedValue(new Error('relay rejected'));

    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    await expect(result.current.finalizeAdoption(preview, 'Puck')).rejects.toThrow();

    // Only the baby was attempted; the profile is never touched.
    expect(nostrEvent.mock.calls.every(([e]) => e.kind === KIND_BLOBBI_STATE)).toBe(true);
    expect(nostrEvent.mock.calls[0][0].kind).toBe(KIND_BLOBBI_STATE);
  });

  it('treats a TIMED-OUT baby publish as failure and does NOT publish the profile', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError');
    nostrEvent.mockRejectedValue(timeout);

    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    // The named failure carries the timeout as its cause rather than replacing
    // it: the ceremony maps the type, diagnostics keep the reason.
    await expect(result.current.finalizeAdoption(preview, 'Puck')).rejects.toMatchObject({
      name: 'AdoptionPublishError',
      kind: KIND_BLOBBI_STATE,
      reason: timeout,
    });
    expect(nostrEvent.mock.calls[0][0].kind).toBe(KIND_BLOBBI_STATE);
  });

  it('rejects finalizeAdoption when the profile publish fails (so onComplete never runs)', async () => {
    // Baby succeeds, profile fails.
    nostrEvent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('profile relay error'));

    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    await expect(result.current.finalizeAdoption(preview, 'Puck')).rejects.toThrow();

    const publishedKinds = nostrEvent.mock.calls.map(([e]) => e.kind);
    // The baby once, then the profile until it gives up.
    expect(publishedKinds[0]).toBe(KIND_BLOBBI_STATE);
    expect(publishedKinds.slice(1).every((kind) => kind === KIND_BLOBBONAUT_PROFILE)).toBe(true);
  });

  it('allows a safe retry after failure without leaving the guard stuck', async () => {
    nostrEvent.mockRejectedValue(new Error('first attempt fails'));

    const { result } = renderHook(() => useFirstEggAdoption());
    const preview = result.current.generatePreview();

    await expect(result.current.finalizeAdoption(preview, 'Puck')).rejects.toThrow();

    // Retry: publishes succeed this time. Same d (replaceable overwrite).
    nostrEvent.mockResolvedValue(undefined);
    const { blobbiId: id } = await result.current.finalizeAdoption(preview, 'Puck');

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
    // once: same object identity.
    expect(p1).toBe(p2);

    // Wait until the (single) baby publish is actually in flight, then release.
    await vi.waitFor(() => expect(resolveBaby).toBeTypeOf('function'));
    resolveBaby!();

    const [h1, h2] = await Promise.all([p1, p2]);

    expect(h1.blobbiId).toBe(preview.d);
    expect(h2.blobbiId).toBe(preview.d);

    // Exactly one baby publish despite two submits.
    const babyPublishes = nostrEvent.mock.calls.filter(([e]) => e.kind === KIND_BLOBBI_STATE);
    expect(babyPublishes).toHaveLength(1);
  });
});
