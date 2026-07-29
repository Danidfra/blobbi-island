/**
 * Legacy kind:11125 `storage` opacity tests.
 *
 * Blobbi Island's consumable inventory lives exclusively in kind:31632/31633
 * (`@nostr-games/inventory`). The legacy `storage` tag that some old profiles
 * still carry is treated exactly the way `@blobbi-kit/core` 0.3.0 treats it:
 * as an OPAQUE host extension tag.
 *
 * Opaque means all four of these at once:
 *   - never parsed or exposed as active inventory,
 *   - never created,
 *   - never updated or normalized,
 *   - never deleted.
 *
 * These are behavioral tests over the real read (`parseOwnerProfile`) and write
 * (`mergeOwnerProfileTags`) paths — they assert emitted tags, not source text.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { parseOwnerProfile, mergeOwnerProfileTags } from './blobbi-parsers';
import { KIND_BLOBBONAUT_PROFILE } from './blobbi-kinds';
import type { OwnerProfile } from './blobbi-types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** A kind:11125 event whose tags are exactly `tags`, with nothing prepended. */
function rawProfileEvent(tags: string[][], content = ''): NostrEvent {
  return {
    id: 'x'.repeat(64),
    pubkey: 'p'.repeat(64),
    created_at: 1_700_000_000,
    kind: KIND_BLOBBONAUT_PROFILE,
    tags,
    content,
    sig: 's',
  };
}

/** The same, with the required `d`/`name` tags prepended for brevity. */
function asProfileEvent(rawTags: string[][], content = ''): NostrEvent {
  return rawProfileEvent([['d', 'profile'], ['name', 'Alice'], ...rawTags], content);
}

/** Parse a raw kind:11125 event into the profile the writers actually consume. */
function profileFrom(rawTags: string[][], content = ''): OwnerProfile {
  const profile = parseOwnerProfile(asProfileEvent(rawTags, content));
  if (!profile) throw new Error('fixture failed to parse');
  return profile;
}

/** Every tag with the given name, kept whole (all elements, original order). */
function tagsNamed(tags: string[][], name: string): string[][] {
  return tags.filter(([n]) => n === name);
}

// ─── Read path: storage is not parsed or exposed ─────────────────────────────

describe('parseOwnerProfile does not expose legacy storage as inventory', () => {
  it('exposes no inventory field at all, even when storage tags are present', () => {
    const profile = profileFrom([
      ['storage', 'food_apple:5'],
      ['storage', 'toy_ball:2'],
    ]);

    // The field is gone from the parsed shape entirely — not merely empty.
    expect('inventory' in profile).toBe(false);
    expect((profile as unknown as Record<string, unknown>).inventory).toBeUndefined();
  });

  it('exposes no storage field, and surfaces the tags only as opaque rawTags', () => {
    const profile = profileFrom([['storage', 'food_apple:5']]);

    expect((profile as unknown as Record<string, unknown>).storage).toBeUndefined();
    // Still reachable verbatim for passthrough purposes only.
    expect(tagsNamed(profile.rawTags, 'storage')).toEqual([['storage', 'food_apple:5']]);
  });

  it('still parses every legitimate profile field alongside storage', () => {
    const profile = profileFrom([
      ['coins', '150'],
      ['has', 'blobbi-abc'],
      ['achievements', 'first-egg'],
      ['storage', 'food_apple:5'],
    ]);

    expect(profile.coins).toBe(150);
    expect(profile.ownedPets).toEqual(['blobbi-abc']);
    expect(profile.achievements).toEqual(['first-egg']);
  });
});

// ─── Write path: storage survives republish verbatim ─────────────────────────

describe('mergeOwnerProfileTags preserves legacy storage opaquely', () => {
  it('carries existing storage tags through a republish tag-for-tag', () => {
    const storage = [
      ['storage', 'food_apple:5'],
      ['storage', 'toy_ball:2'],
      ['storage', 'med_vitamins:1'],
    ];
    const out = mergeOwnerProfileTags(profileFrom(storage));

    // Same tags, same values, same relative order, same count.
    expect(tagsNamed(out, 'storage')).toEqual(storage);
  });

  it('preserves malformed and multi-element storage tags without repair', () => {
    // Shapes the old `item:quantity` parser would have rejected or rewritten.
    const weird = [
      ['storage', 'no_quantity'], // missing ":quantity"
      ['storage', 'food_apple:not_a_number'], // non-numeric quantity
      ['storage', ''], // empty value
      ['storage', 'food_pizza:3', 'extra', 'fields'], // arity > 2
      ['storage'], // arity 1, no value at all
    ];
    const out = mergeOwnerProfileTags(profileFrom(weird));

    // Byte-for-byte identical: nothing normalized, dropped, padded or reordered.
    expect(tagsNamed(out, 'storage')).toEqual(weird);
  });

  it('updating normal profile fields neither removes nor duplicates storage', () => {
    const profile = profileFrom([
      ['coins', '200'],
      ['storage', 'food_apple:5'],
    ]);

    const out = mergeOwnerProfileTags({ ...profile, coins: 165, name: 'Renamed' });

    // The intended update happened...
    expect(out.find(([n]) => n === 'coins')?.[1]).toBe('165');
    expect(out.find(([n]) => n === 'name')?.[1]).toBe('Renamed');
    // ...and storage is present exactly once, unchanged.
    expect(tagsNamed(out, 'storage')).toEqual([['storage', 'food_apple:5']]);
  });

  it('repeated republishes are idempotent — the whole tag set reaches a fixed point', () => {
    // Round 1 starts from a raw profile carrying legacy storage plus an
    // unrelated host extension tag.
    const first = mergeOwnerProfileTags(
      profileFrom([['coins', '200'], ['storage', 'food_apple:5'], ['xp', '42']]),
    );

    // Each later round re-parses the PREVIOUS output as the source event, which
    // is exactly what a republish does. No slicing, so this stays correct even
    // if the emitted tag order ever changes.
    let previous = first;
    for (let round = 0; round < 3; round++) {
      const next = mergeOwnerProfileTags(parseOwnerProfile(rawProfileEvent(previous))!);

      // Full-tag-set equality: nothing added, removed, reordered or rewritten.
      expect(next).toEqual(previous);
      previous = next;
    }

    // And the specific tags of interest survived every round exactly once.
    expect(tagsNamed(previous, 'storage')).toEqual([['storage', 'food_apple:5']]);
    expect(tagsNamed(previous, 'xp')).toEqual([['xp', '42']]);
  });
});

// ─── Write path: storage is never created ────────────────────────────────────

describe('mergeOwnerProfileTags never invents storage', () => {
  it('a profile with no storage tag produces no storage tag', () => {
    const out = mergeOwnerProfileTags(profileFrom([['coins', '10']]));
    expect(tagsNamed(out, 'storage')).toEqual([]);
  });

  it('a fully populated profile still emits no storage tag', () => {
    const out = mergeOwnerProfileTags(
      profileFrom([
        ['coins', '999'],
        ['pettingLevel', '7'],
        ['lifetimeBlobbis', '4'],
        ['favoriteBlobbi', 'blobbi-abc'],
        ['starterBlobbi', 'blobbi-def'],
        ['current_companion', 'blobbi-abc'],
        ['style', 'neon'],
        ['background', 'space'],
        ['title', 'Explorer'],
        ['has', 'blobbi-abc'],
        ['achievements', 'first-egg'],
      ]),
    );
    expect(tagsNamed(out, 'storage')).toEqual([]);
  });

  it('supplying storage as a managed profile field cannot create it', () => {
    // The typed API has no `storage`/`inventory` field, so this models a caller
    // reaching past the types. It must still be ignored by the writer.
    const rogue = {
      ...profileFrom([['coins', '10']]),
      storage: ['food_apple:99'],
      inventory: [{ itemId: 'food_apple', quantity: 99 }],
    } as unknown as OwnerProfile;

    expect(tagsNamed(mergeOwnerProfileTags(rogue), 'storage')).toEqual([]);
  });

  it('supplying storage as a managed field cannot replace an existing one', () => {
    const rogue = {
      ...profileFrom([['storage', 'food_apple:5']]),
      storage: ['food_apple:99'],
    } as unknown as OwnerProfile;

    // The pre-existing tag wins because it is passed through opaquely; the
    // injected value is never serialized.
    expect(tagsNamed(mergeOwnerProfileTags(rogue), 'storage')).toEqual([
      ['storage', 'food_apple:5'],
    ]);
  });
});

// ─── Neighbouring extension tags are unaffected ──────────────────────────────

describe('storage opacity does not disturb neighbouring extension tags', () => {
  it('preserves arbitrary unknown extension tags alongside storage', () => {
    const out = mergeOwnerProfileTags(
      profileFrom([
        ['storage', 'food_apple:5'],
        ['xp', '42'],
        ['level', '3'],
        ['room', 'bedroom'],
        ['blobbi_onboarding_done', 'true'],
        ['x-custom-ext', 'keepme', 'and-this-too'],
      ]),
    );

    expect(tagsNamed(out, 'storage')).toEqual([['storage', 'food_apple:5']]);
    expect(out.find(([n]) => n === 'xp')?.[1]).toBe('42');
    expect(out.find(([n]) => n === 'level')?.[1]).toBe('3');
    expect(out.find(([n]) => n === 'room')?.[1]).toBe('bedroom');
    expect(out.find(([n]) => n === 'blobbi_onboarding_done')?.[1]).toBe('true');
    // Multi-element unknown tags keep every element.
    expect(tagsNamed(out, 'x-custom-ext')).toEqual([
      ['x-custom-ext', 'keepme', 'and-this-too'],
    ]);
  });

  it('leaves inv on its own separate, caller-managed track', () => {
    // `inv` (accessories/cosmetics) is deliberately NOT emitted by this merge —
    // the accessory system owns it via updateInvTags, and callers such as
    // useCoinsMutation re-append the raw inv tags verbatim. `storage` is
    // handled differently on purpose: it is passed through here. This test pins
    // that the two never get conflated in either direction.
    const out = mergeOwnerProfileTags(
      profileFrom([
        ['inv', 'hat_01', 'qty', '3'],
        ['storage', 'food_apple:5'],
      ]),
    );

    expect(tagsNamed(out, 'inv')).toEqual([]); // caller-managed, untouched here
    expect(tagsNamed(out, 'storage')).toEqual([['storage', 'food_apple:5']]);
  });
});
