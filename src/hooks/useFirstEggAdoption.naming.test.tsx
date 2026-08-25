/**
 * The own-name writer boundary.
 *
 * The composer is UI. These tests bypass it entirely and call
 * `finalizeAdoption` directly, which is what a modified build, a console, or a
 * future second naming surface would do. The assertion that matters is that
 * nothing is **signed** — a refusal after signing would already have handed the
 * name to a signer, and a refusal after publishing would be no refusal at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';

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
  useCurrentUser: () => ({ user: { pubkey: TEST_PUBKEY, signer: { signEvent } } }),
}));
vi.mock('@/hooks/useAuthor', () => ({
  useAuthor: () => ({ data: { metadata: { name: 'Tester' } } }),
}));

import { useFirstEggAdoption } from './useFirstEggAdoption';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';

function wrapper(profile: ExperienceProfile) {
  return ({ children }: { children: ReactNode }) => (
    <IslandSafetyProvider profile={profile}>{children}</IslandSafetyProvider>
  );
}

async function adopt(profile: ExperienceProfile, name: string) {
  const { result } = renderHook(() => useFirstEggAdoption(), { wrapper: wrapper(profile) });
  const preview = result.current.generatePreview();

  let error: unknown = null;
  let id: string | null = null;
  await act(async () => {
    try {
      id = await result.current.finalizeAdoption(preview, name);
    } catch (caught) {
      error = caught;
    }
  });
  return { error, id };
}

const babyEvents = () =>
  nostrEvent.mock.calls.map(([event]) => event).filter((event) => event.kind === KIND_BLOBBI_STATE);

const nameOf = (event: NostrEvent) => event.tags.find(([n]) => n === 'name')?.[1];

beforeEach(() => {
  nostrEvent.mockReset().mockResolvedValue(undefined);
  nostrQuery.mockReset().mockResolvedValue([]);
  signEvent.mockClear();
});

describe('free-text naming', () => {
  it('publishes the name as typed, trimmed', async () => {
    const { error } = await adopt('standard', '  Rocket  ');

    expect(error).toBeNull();
    expect(nameOf(babyEvents()[0])).toBe('Rocket');
  });

  it('still accepts a name the curated vocabulary would refuse', async () => {
    // Standard's semantics are unchanged by this phase.
    const { error } = await adopt('standard', 'Captain Wiggles');
    expect(error).toBeNull();
    expect(nameOf(babyEvents()[0])).toBe('Captain Wiggles');
  });

  it('falls back to the preview name when nothing was typed, as it always has', async () => {
    // Existing behaviour, deliberately preserved: the writer's fallback chain is
    // `typed || preview.name || 'Blobbi'`. The ceremony guards against an empty
    // submission anyway, so this only fires for a direct caller.
    const { error } = await adopt('standard', '   ');

    expect(error).toBeNull();
    expect(nameOf(babyEvents()[0])).toBeTruthy();
  });
});

describe('curated naming', () => {
  it('publishes an approved combination', async () => {
    const { error } = await adopt('family', 'Sunny Puff');

    expect(error).toBeNull();
    expect(nameOf(babyEvents()[0])).toBe('Sunny Puff');
  });

  it.each([
    ['a clean sentence', 'message me on telegram'],
    ['a plausible free name', 'Rocket'],
    ['a half-approved pair', 'Sunny Telegram'],
    ['prohibited text', 'fuck off'],
    ['the words reversed', 'Puff Sunny'],
    ['an empty name', '   '],
  ])('refuses %s', async (_label, name) => {
    const { error } = await adopt('family', name);
    expect(error).toBeInstanceOf(Error);
  });

  it('refuses BEFORE anything is signed or published', async () => {
    // The claim that makes the composer optional: a caller holding the writer
    // gets nothing, and the signer is never asked.
    await adopt('family', 'message me on telegram');

    expect(signEvent).not.toHaveBeenCalled();
    expect(nostrEvent).not.toHaveBeenCalled();
  });

  it('does not even read the existing profile before refusing', async () => {
    // The refusal is the first thing in the writer, so a rejected name costs no
    // relay round trip at all.
    await adopt('family', 'Rocket');
    expect(nostrQuery).not.toHaveBeenCalled();
  });
});

describe('the published schema is unchanged', () => {
  it('still writes the name as a plain `name` tag on kind 31124', async () => {
    // This phase is application-side: no new kind, no new tag, no naming event.
    await adopt('family', 'Sunny Puff');

    const baby = babyEvents()[0];
    expect(baby.kind).toBe(31124);
    expect(baby.tags.filter(([n]) => n === 'name')).toHaveLength(1);
    expect(nameOf(baby)).toBe('Sunny Puff');
  });

  it('introduces no naming-specific tag', async () => {
    await adopt('family', 'Sunny Puff');

    const tagNames = new Set(babyEvents()[0].tags.map(([n]) => n));
    for (const invented of ['curated_name', 'name_kind', 'safe_name', 'family_name']) {
      expect(tagNames.has(invented)).toBe(false);
    }
  });
});
