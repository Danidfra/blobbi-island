/**
 * Adoption handoff: what the app must do with a freshly hatched Blobbi
 * BETWEEN "the relay accepted the events" and "the relay serves them back".
 *
 * ## The race this closes
 *
 * Hatching publishes a kind 31124 baby and a kind 11125 profile whose
 * `current_companion` names it. Both are accepted by a relay before the
 * ceremony ends. But "accepted" is not "indexed": a read issued a few hundred
 * milliseconds later can still come back without them, and `relay-read.ts`
 * reads an empty answer twice and then BELIEVES it (confirmed-empty). Until
 * this module existed the Island refetched straight after the publish, so on a
 * slow relay the caches ended up holding a confirmed-empty profile and a Blobbi
 * list without the baby. The router kept the player in the world (it selects
 * by the hatch handler's manual id), but the in-world renderer derives its
 * Blobbi from the profile cache and drew its "no Blobbi selected" egg instead.
 * Nothing refetched that profile again without a reload.
 *
 * ## The rule
 *
 * The published events ARE the authoritative state; the relay is merely late.
 * So the caches are written from the signed events first (read-your-write), the
 * world enters on that, and the relay is only consulted to CONFIRM. The four
 * caches are invalidated once the relay serves the new companion, never
 * before, the same discipline `useSetCurrentCompanion` already applies to a
 * companion switch. No second Blobbi is ever published: nothing here signs or
 * sends anything.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type { QueryClient } from '@tanstack/react-query';

import type { Blobbi } from '@/hooks/useBlobbis';
import { petStateToLegacyBlobbi } from '@/hooks/useBlobbis';
import { BLOBBONAUT_PROFILE_KINDS, KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';
import {
  parseOwnerProfile,
  parsePetState,
  validateOwnerProfileEvent,
  validatePetStateEvent,
} from '@/lib/blobbi-parsers';
import type { OwnerProfile, PetState } from '@/lib/blobbi-types';

/** What a successful adoption hands back: the id and the two signed events. */
export interface AdoptionHandoff {
  /** The new Blobbi's canonical `d` tag. */
  blobbiId: string;
  /** The published kind 31124 baby state. */
  babyEvent: NostrEvent;
  /** The published kind 11125 profile naming the baby as current companion. */
  profileEvent: NostrEvent;
}

/** The four caches that answer "who is my Blobbi" somewhere in the app. */
export function adoptionCacheKeys(pubkey: string) {
  return {
    blobbis: ['blobbis', pubkey] as const,
    petStates: ['pet-states', pubkey] as const,
    blobbonautProfile: ['blobbonaut-profile', pubkey] as const,
    ownerProfile: ['owner-profile', pubkey] as const,
  };
}

function upsertById<T extends { id: string }>(list: T[] | undefined, item: T): T[] {
  const others = (list ?? []).filter((entry) => entry.id !== item.id);
  return [...others, item];
}

/**
 * Write the hatched Blobbi into every cache that resolves the companion, from
 * the signed events themselves. Idempotent: applying the same handoff twice
 * leaves one Blobbi. Returns false (and writes nothing) when the events do not
 * parse, which cannot happen for events this app just built, but is the
 * honest answer rather than a cache holding `null`.
 */
export function applyAdoptionHandoff(
  queryClient: QueryClient,
  pubkey: string,
  handoff: AdoptionHandoff,
): boolean {
  if (!validatePetStateEvent(handoff.babyEvent) || !validateOwnerProfileEvent(handoff.profileEvent)) {
    return false;
  }
  const baby = parsePetState(handoff.babyEvent);
  const profile = parseOwnerProfile(handoff.profileEvent);
  if (!baby || !profile || baby.id !== handoff.blobbiId) return false;

  const keys = adoptionCacheKeys(pubkey);
  queryClient.setQueryData<Blobbi[]>(keys.blobbis, (old) =>
    upsertById(old, petStateToLegacyBlobbi(baby)),
  );
  queryClient.setQueryData<PetState[]>(keys.petStates, (old) => upsertById(old, baby));
  queryClient.setQueryData<OwnerProfile | null>(keys.blobbonautProfile, profile);
  queryClient.setQueryData<OwnerProfile | null>(keys.ownerProfile, profile);
  return true;
}

/** The minimal relay surface the confirmation poll needs. */
export interface AdoptionRelayReader {
  query(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]>;
}

export interface ConfirmAdoptionOptions {
  /** Read attempts before giving up. */
  attempts?: number;
  /** Pause between attempts, in milliseconds. */
  delayMs?: number;
  /** Per-read deadline, in milliseconds. */
  timeoutMs?: number;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_CONFIRM: Required<Omit<ConfirmAdoptionOptions, 'sleep'>> = {
  attempts: 8,
  delayMs: 500,
  timeoutMs: 2000,
};

/**
 * Poll until the relay serves BOTH halves of the adoption: the baby's kind
 * 31124 and a profile whose `current_companion` is the baby. One query with
 * two filters per attempt. Resolves true once confirmed, false when the window
 * closes without it; never throws.
 */
export async function confirmAdoptionOnRelay(
  nostr: AdoptionRelayReader,
  pubkey: string,
  blobbiId: string,
  options: ConfirmAdoptionOptions = {},
): Promise<boolean> {
  const attempts = options.attempts ?? DEFAULT_CONFIRM.attempts;
  const delayMs = options.delayMs ?? DEFAULT_CONFIRM.delayMs;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIRM.timeoutMs;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const events = await nostr.query(
        [
          { kinds: [KIND_BLOBBI_STATE], authors: [pubkey], '#d': [blobbiId], limit: 1 },
          { kinds: [...BLOBBONAUT_PROFILE_KINDS], authors: [pubkey], limit: 1 },
        ],
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      const babyServed = events.some(
        (event) =>
          event.kind === KIND_BLOBBI_STATE &&
          validatePetStateEvent(event) &&
          parsePetState(event)?.id === blobbiId,
      );
      const latestProfile = events
        .filter((event) => event.kind !== KIND_BLOBBI_STATE)
        .filter(validateOwnerProfileEvent)
        .sort((a, b) => b.created_at - a.created_at)[0];
      const companionServed = latestProfile
        ? parseOwnerProfile(latestProfile)?.currentCompanion === blobbiId
        : false;
      if (babyServed && companionServed) return true;
    } catch {
      // A transient read failure is just "not yet".
    }
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  return false;
}

/**
 * Confirm on the relay, then (and only then) let the four caches refetch the
 * authoritative copies. Unconfirmed: the caches keep the written state, which
 * is correct; the next natural refetch picks up the relay's copy.
 */
export async function reconcileAdoptionWithRelay(
  queryClient: QueryClient,
  nostr: AdoptionRelayReader,
  pubkey: string,
  blobbiId: string,
  options?: ConfirmAdoptionOptions,
): Promise<boolean> {
  const confirmed = await confirmAdoptionOnRelay(nostr, pubkey, blobbiId, options);
  if (!confirmed) return false;
  const keys = adoptionCacheKeys(pubkey);
  await Promise.all(
    Object.values(keys).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
  return true;
}
