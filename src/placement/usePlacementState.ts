/**
 * Blobbi Island — kind:31634 equipment state: read model + hook.
 *
 * Mirrors the kind:31633 read path (`useIslandInventory`) deliberately: same
 * newest-valid-event selection, same "empty state when nothing exists", same
 * single canonical query key per subject. Two protocols with the same
 * addressable-resolution problem should not have two different answers to it.
 *
 * What this module does NOT do is decide what may be drawn. It returns the
 * document as published, warnings and all; `policy.ts` decides which entries
 * survive, and the renderer asks it. Keeping the read honest is what makes the
 * dev inspector able to show "this placement exists but is hidden because…".
 */

import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import {
  KIND_GAME_ITEM_PLACEMENT,
  parseGameItemPlacementResult,
  buildGameItemPlacementEvent,
  type GameItemPlacement,
  type ParseWarning,
} from '@/inventory/package';
import {
  characterEquipmentPlacementD,
  placementTargetForCharacter,
} from './identity';

/** A parsed placement document plus the parse warnings that produced it. */
export interface PlacementState {
  /** The parsed document. Never `null` — an absent event yields an empty one. */
  placement: GameItemPlacement;
  /**
   * Non-fatal parse warnings (stale item tags, duplicate slots, unknown modes…).
   *
   * Surfaced rather than swallowed: every warning the package emits has a
   * consumer action, and the dev tooling shows them verbatim.
   */
  warnings: ParseWarning[];
  /**
   * `true` when no valid kind:31634 event exists yet for this document.
   *
   * The difference matters for writes: the first publish starts from revision
   * 0, and a caller must not treat "nothing published" as "empty because the
   * player removed everything".
   */
  isEmpty: boolean;
}

/** Canonical TanStack Query key factory for a character's equipment document. */
export function placementQueryKey(
  ownerPubkey: string | undefined,
  characterId: string | undefined,
) {
  return ['blobbi-placement-31634', ownerPubkey, characterId] as const;
}

/**
 * An empty, valid placement document for a character.
 *
 * Built through the package builder and parsed back, so the object is exactly
 * what the package produces and never a hand-rolled shape that only looks like
 * one. This is what callers see before the first equip, and what a mutation
 * starts from.
 */
export function buildEmptyPlacement(
  ownerPubkey: string,
  characterId: string,
): GameItemPlacement {
  const template = buildGameItemPlacementEvent({
    id: characterEquipmentPlacementD(characterId),
    target: placementTargetForCharacter(ownerPubkey, characterId),
    placements: [],
  });
  const event: NostrEvent = {
    id: '',
    pubkey: ownerPubkey,
    created_at: 0,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: '',
  };
  const result = parseGameItemPlacementResult(event);
  if (!result.ok) {
    // Unreachable: a freshly-built template always parses. Throwing beats
    // returning a lie, because every caller treats this value as the base of
    // the next published state.
    throw new Error(`buildEmptyPlacement: ${result.error}`);
  }
  return result.value;
}

/**
 * Fetch the newest valid kind:31634 equipment document for a character.
 *
 * Newest-valid-by-`created_at`, exactly like the inventory read: relays may
 * return events out of order, and an older event that happens to arrive last
 * must not win. `revision` is NOT used to pick a winner here — it is advisory
 * and a hostile or buggy publisher controls it; addressable resolution is the
 * protocol's answer and `compareGameItemPlacementRevisions` is only used to
 * detect lost updates during a write.
 */
export async function fetchPlacement(
  nostr: ReturnType<typeof useNostr>['nostr'],
  ownerPubkey: string,
  characterId: string,
  signal: AbortSignal,
): Promise<PlacementState> {
  const events = await nostr.query(
    [
      {
        kinds: [KIND_GAME_ITEM_PLACEMENT],
        authors: [ownerPubkey],
        '#d': [characterEquipmentPlacementD(characterId)],
        limit: 1,
      },
    ],
    { signal },
  );

  const valid = events
    .map((event) => ({ event, result: parseGameItemPlacementResult(event) }))
    .filter((x) => x.result.ok)
    .sort((a, b) => b.event.created_at - a.event.created_at);

  const newest = valid[0];
  if (!newest || !newest.result.ok) {
    return {
      placement: buildEmptyPlacement(ownerPubkey, characterId),
      warnings: [],
      isEmpty: true,
    };
  }

  return {
    placement: newest.result.value,
    warnings: newest.result.warnings,
    isEmpty: false,
  };
}

/**
 * Load a character's equipment document (kind:31634).
 *
 * `ownerPubkey` defaults to the logged-in user because Island only writes
 * documents for its own Blobbis, but it is a parameter so the multiplayer layer
 * can read another player's equipment without pretending to be them.
 */
export function usePlacementState(
  characterId: string | undefined,
  ownerPubkey?: string,
) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const owner = ownerPubkey ?? user?.pubkey;

  return useQuery({
    queryKey: placementQueryKey(owner, characterId),
    queryFn: async (c): Promise<PlacementState> => {
      // `enabled` guarantees both, but the queryFn stays total rather than
      // relying on that from a distance.
      if (!owner || !characterId) {
        return {
          placement: buildEmptyPlacement(owner ?? '', characterId ?? 'unknown'),
          warnings: [],
          isEmpty: true,
        };
      }
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      return fetchPlacement(nostr, owner, characterId, signal);
    },
    enabled: Boolean(owner) && Boolean(characterId),
    staleTime: 15000,
  });
}
