/**
 * Adoption against relays that misbehave.
 *
 * The naming suite proves WHAT is published; this proves what happens when the
 * publish does not go through, which is where a real player lost their Blobbi
 * to `AggregateError: All promises were rejected`.
 *
 * Two rules the tests exist to hold:
 *
 *  - a transient relay failure must not end the ceremony;
 *  - an unanswered PROFILE READ must not be mistaken for "this player has no
 *    Blobbis", because the profile published a moment later is built on it.
 *
 * No real relay, no real keys, no publication.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';

const TEST_PUBKEY = 'feb88e80a63d1111222233334444555566667777888899990000aaaabbbbcccc';
const KIND_PROFILE = 11125;

/** How each successive `nostr.event` call behaves. `true` = accepted. */
let publishOutcomes: Array<boolean | 'hang'> = [];
let publishCalls = 0;
const publishedEvents: NostrEvent[] = [];

/** What the profile read returns, or how it fails. */
let profileEvents: NostrEvent[] = [];
let profileReadFails = false;
let profileReadCalls = 0;

let signerFails = false;
let signCalls = 0;

const nostrEvent = vi.fn(async (event: NostrEvent) => {
  const outcome = publishOutcomes[publishCalls] ?? true;
  publishCalls += 1;
  if (outcome === 'hang') {
    // Never settles: what an unreachable relay looks like before the timeout.
    await new Promise(() => {});
  }
  if (!outcome) {
    // Exactly what NPool.event throws when every relay refuses.
    throw new AggregateError([new Error('relay refused')], 'All promises were rejected');
  }
  publishedEvents.push(event);
});

/*
  `req`, not just `query`, because the completion rule under test lives there:
  an answer is only trustworthy when EOSE arrives. A relay that goes quiet
  yields nothing and closes, which `NPool.query` would flatten into `[]`, and
  which is exactly the lie the adoption read must not believe.
*/
const nostrReq = vi.fn(async function* () {
  profileReadCalls += 1;
  if (profileReadFails) {
    yield ['CLOSED', 'sub', 'relay unreachable'];
    return;
  }
  for (const event of profileEvents) yield ['EVENT', 'sub', event];
  yield ['EOSE', 'sub'];
});

const nostrQuery = vi.fn(async () => {
  if (profileReadFails) throw new Error('relay unreachable');
  return profileEvents;
});

const signEvent = vi.fn(async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => {
  signCalls += 1;
  if (signerFails) throw new Error('user rejected the signing request');
  return {
    ...t,
    tags: t.tags ?? [],
    content: t.content ?? '',
    created_at: t.created_at ?? 1_800_000_000,
    id: `signed-${signCalls}`,
    pubkey: TEST_PUBKEY,
    sig: 'test-sig',
  };
});

vi.mock('@/hooks/useNostr', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery, req: nostrReq } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: TEST_PUBKEY, signer: { signEvent } } }),
}));
vi.mock('@/hooks/useAuthor', () => ({
  useAuthor: () => ({ data: { metadata: { name: 'Tester' } } }),
}));

import { useFirstEggAdoption, AdoptionPublishError } from './useFirstEggAdoption';

function wrapper(profile: ExperienceProfile) {
  return ({ children }: { children: ReactNode }) => (
    <IslandSafetyProvider profile={profile}>{children}</IslandSafetyProvider>
  );
}

/** An existing profile that already owns one Blobbi. */
function profileEvent(has: string[]): NostrEvent {
  return {
    id: 'p'.repeat(64),
    kind: KIND_PROFILE,
    pubkey: TEST_PUBKEY,
    created_at: 1_700_000_000,
    sig: '',
    content: '',
    tags: [
      ['d', TEST_PUBKEY],
      ['name', 'Tester'],
      ...has.map((d) => ['has', d]),
      ['current_companion', has[0] ?? ''],
    ],
  } as NostrEvent;
}

function adoption(profile: ExperienceProfile = 'standard') {
  return renderHook(() => useFirstEggAdoption(), { wrapper: wrapper(profile) });
}

async function adopt(result: { current: ReturnType<typeof useFirstEggAdoption> }, name: string) {
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
  return { error, id, preview };
}

const babyEvents = () => publishedEvents.filter((e) => e.kind === KIND_BLOBBI_STATE);
const profilePublishes = () => publishedEvents.filter((e) => e.kind === KIND_PROFILE);
const hasOf = (event: NostrEvent) => event.tags.filter(([n]) => n === 'has').map(([, v]) => v);

beforeEach(() => {
  vi.useRealTimers();
  publishOutcomes = [];
  publishCalls = 0;
  publishedEvents.length = 0;
  profileEvents = [];
  profileReadFails = false;
  profileReadCalls = 0;
  signerFails = false;
  signCalls = 0;
  nostrEvent.mockClear();
  nostrQuery.mockClear();
  nostrReq.mockClear();
  signEvent.mockClear();
});

describe('adoption succeeds', () => {
  it('publishes a baby and a profile under Standard', async () => {
    const { result } = adoption('standard');
    const { error, id } = await adopt(result, 'Rocket');

    expect(error).toBeNull();
    expect(id).toBeTruthy();
    expect(babyEvents()).toHaveLength(1);
    expect(profilePublishes()).toHaveLength(1);
  });

  it('publishes a curated name under a curated experience', async () => {
    const { result } = adoption('family');
    const { error } = await adopt(result, 'Sunny Puff');

    expect(error).toBeNull();
    expect(babyEvents()[0].tags).toContainEqual(['name', 'Sunny Puff']);
  });

  it('keeps the schema exactly as it was', async () => {
    const { result } = adoption('standard');
    await adopt(result, 'Rocket');

    const baby = babyEvents()[0];
    expect(baby.kind).toBe(31124);
    expect(baby.tags.filter(([n]) => n === 'name')).toHaveLength(1);
    expect(baby.tags.some(([n]) => n === 'client')).toBe(true);
    for (const invented of ['retry', 'attempt', 'adoption']) {
      expect(baby.tags.some(([n]) => n === invented)).toBe(false);
    }
  });
});

describe('a relay that does not answer the first time', () => {
  it('retries the SAME signed event rather than giving up', async () => {
    // The regression: one hiccup used to end the ceremony.
    publishOutcomes = [false, true, true];
    const { result } = adoption('standard');
    const { error } = await adopt(result, 'Rocket');

    expect(error).toBeNull();
    expect(babyEvents()).toHaveLength(1);
  });

  it('signs once however many times it publishes', async () => {
    // Re-signing would re-prompt the player and mint a second event id, a
    // retry that landed after a silent success would then be a second Blobbi
    // rather than a duplicate the relay collapses.
    publishOutcomes = [false, false, true, true];
    const { result } = adoption('standard');
    await adopt(result, 'Rocket');

    const babySigns = signEvent.mock.calls.filter(([t]) => t.kind === KIND_BLOBBI_STATE);
    expect(babySigns).toHaveLength(1);
  });
});

describe('a relay that never accepts', () => {
  it('fails cleanly, with a named error and no half-adoption', async () => {
    publishOutcomes = [false, false, false];
    const { result } = adoption('standard');
    const { error, id } = await adopt(result, 'Rocket');

    expect(error).toBeInstanceOf(AdoptionPublishError);
    expect(id).toBeNull();
    // The profile is never touched when the baby did not land.
    expect(profilePublishes()).toHaveLength(0);
  });

  it('does not surface the pool\'s AggregateError', async () => {
    // What a player used to see in the console, and what must never reach copy.
    publishOutcomes = [false, false, false];
    const { result } = adoption('standard');
    const { error } = await adopt(result, 'Rocket');

    expect((error as Error).name).toBe('AdoptionPublishError');
    expect((error as Error).message).not.toContain('All promises were rejected');
    // The cause is kept for diagnostics.
    expect((error as AdoptionPublishError).reason).toBeInstanceOf(AggregateError);
  });

  it('names WHICH write failed', async () => {
    publishOutcomes = [false, false, false];
    const { result } = adoption('standard');
    const { error } = await adopt(result, 'Rocket');
    expect((error as AdoptionPublishError).kind).toBe(KIND_BLOBBI_STATE);
  });

  it('can be retried once the relay comes back', async () => {
    publishOutcomes = [false, false, false];
    const { result } = adoption('standard');
    const first = await adopt(result, 'Rocket');
    expect(first.error).toBeInstanceOf(AdoptionPublishError);

    // The in-flight guard released, so a second submit really runs.
    publishOutcomes = [];
    publishCalls = 0;
    const second = await adopt(result, 'Rocket');
    expect(second.error).toBeNull();
    expect(babyEvents()).toHaveLength(1);
  });
});

describe('a signer that refuses', () => {
  it('is a different failure from a relay that refuses', async () => {
    signerFails = true;
    const { result } = adoption('standard');
    const { error } = await adopt(result, 'Rocket');

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AdoptionPublishError);
    // And it is not retried: a rejected prompt is a decision, not a hiccup.
    expect(signCalls).toBe(1);
    expect(nostrEvent).not.toHaveBeenCalled();
  });
});

describe('the profile read is not allowed to lie', () => {
  it('keeps every Blobbi the player already owns', async () => {
    profileEvents = [profileEvent(['blobbi-one', 'blobbi-two'])];
    const { result } = adoption('standard');
    const { preview } = await adopt(result, 'Rocket');

    const has = hasOf(profilePublishes()[0]);
    expect(has).toContain('blobbi-one');
    expect(has).toContain('blobbi-two');
    expect(has).toContain(preview.d);
  });

  it('THE DATA-LOSS PATH: an unanswered read never becomes "no profile"', async () => {
    /*
      `NPool.query` cannot fail: a timeout and a genuinely new player both come
      back empty. Believing that empty would publish a profile whose `has[]`
      held only the new Blobbi, dropping every previous one. Adoption fails
      instead, and the player retries.
    */
    profileReadFails = true;
    const { result } = adoption('standard');
    const { error } = await adopt(result, 'Rocket');

    expect(error).toBeInstanceOf(Error);
    expect(publishedEvents).toHaveLength(0);
  });

  it('confirms an empty answer before believing it', async () => {
    // A brand-new player is a real empty, read twice before it is trusted.
    profileEvents = [];
    const { result } = adoption('standard');
    const { error } = await adopt(result, 'Rocket');

    expect(error).toBeNull();
    expect(profileReadCalls).toBeGreaterThanOrEqual(2);
    expect(hasOf(profilePublishes()[0])).toHaveLength(1);
  });

  it('reads once when the player already has a profile', async () => {
    profileEvents = [profileEvent(['blobbi-one'])];
    const { result } = adoption('standard');
    await adopt(result, 'Rocket');
    expect(profileReadCalls).toBe(1);
  });
});

describe('partial success', () => {
  it('leaves the baby published and reports the failure', async () => {
    // Baby accepted; the profile that links it in refused every attempt.
    publishOutcomes = [true, false, false, false];
    const { result } = adoption('standard');
    const { error } = await adopt(result, 'Rocket');

    expect(error).toBeInstanceOf(AdoptionPublishError);
    expect((error as AdoptionPublishError).kind).toBe(11125);
    expect(babyEvents()).toHaveLength(1);
    expect(profilePublishes()).toHaveLength(0);
  });

  it('reconciles on retry instead of creating a second Blobbi', async () => {
    publishOutcomes = [true, false, false, false];
    const { result } = adoption('standard');
    // The SAME preview the ceremony holds across a retry, the coordinate is
    // decided before the first submit and does not change when one fails.
    const preview = result.current.generatePreview();
    await act(async () => {
      await result.current.finalizeAdoption(preview, 'Rocket').catch(() => {});
    });

    // The relay now holds the baby AND, on retry, the profile read answers.
    profileEvents = [profileEvent(['blobbi-one'])];
    publishOutcomes = [];
    publishCalls = 0;
    let secondError: unknown = null;
    await act(async () => {
      try {
        await result.current.finalizeAdoption(preview, 'Rocket');
      } catch (e) {
        secondError = e;
      }
    });

    expect(secondError).toBeNull();
    // Addressable: the same coordinate, republished, not a new one.
    const babies = babyEvents();
    expect(new Set(babies.map((e) => e.tags.find(([n]) => n === 'd')?.[1])).size).toBe(1);
    expect(hasOf(profilePublishes()[0])).toContain(preview.d);
  });
});

describe('double submit', () => {
  it('runs the adoption once and gives both callers the same answer', async () => {
    const { result } = adoption('standard');
    const preview = result.current.generatePreview();

    let a: string | null = null;
    let b: string | null = null;
    await act(async () => {
      const first = result.current.finalizeAdoption(preview, 'Rocket');
      const second = result.current.finalizeAdoption(preview, 'Rocket');
      [a, b] = await Promise.all([first, second]);
    });

    expect(a).toBe(b);
    expect(babyEvents()).toHaveLength(1);
    expect(profilePublishes()).toHaveLength(1);
  });

  it('rejects both callers once, without publishing twice', async () => {
    // The double console line came from two SUBMITS sharing one run; each
    // caller catches, so each logs. The work still happens once.
    publishOutcomes = [false, false, false];
    const { result } = adoption('standard');
    const preview = result.current.generatePreview();

    const errors: unknown[] = [];
    await act(async () => {
      const first = result.current.finalizeAdoption(preview, 'Rocket').catch((e) => errors.push(e));
      const second = result.current.finalizeAdoption(preview, 'Rocket').catch((e) => errors.push(e));
      await Promise.all([first, second]);
    });

    expect(errors).toHaveLength(2);
    expect(errors[0]).toBe(errors[1]);
    // Three attempts for ONE event, not six.
    expect(publishCalls).toBe(3);
  });
});
