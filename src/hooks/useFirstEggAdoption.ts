/**
 * useFirstEggAdoption — first-egg adoption for a brand-new Blobbonaut.
 *
 * IMPORTANT (orphan-egg fix): this hook is split into two clearly separated
 * responsibilities so that mounting the ceremony can NEVER publish a real event:
 *
 *   1. `generatePreview()` — a PURE, synchronous, local-only function. It derives
 *      a deterministic egg preview using `@blobbi-kit/core` helpers (seed,
 *      canonical d-tag, visual traits). It publishes NOTHING. This is what the
 *      ceremony uses to render the egg/baby during the animation.
 *
 *   2. `finalizeAdoption(preview, name)` — the ONLY function that publishes real
 *      Nostr events, and only when the user submits the final name.
 *
 * finalizeAdoption publish sequence (hardened against orphan/partial profiles):
 *   a. Query the latest existing profile (canonical 11125 + legacy 31125 read).
 *   b. Build the DESIRED FINAL profile tags entirely in memory:
 *        - if no profile exists → buildBlobbonautTags(pubkey) + name,
 *        - merge has[] (union, never shrink) + newly-adopted d,
 *        - set current_companion.
 *   c. Publish the final kind 31124 BABY state with the chosen name.
 *   d. ONLY after the baby publish succeeds, publish EXACTLY ONE final profile
 *      kind 11125 event carrying the merged has[] + current_companion.
 *
 * Adoption is currency-independent (economy reset): it publishes ONLY the two
 * events above — never kind:31633, never a Coin grant, never a `coins` tag.
 * The exactly-once 200-Coin initial allocation happens at economy entry
 * (`src/inventory/economy-entry.ts`), decoupled from adoption entirely; a new
 * and an existing profile follow the identical adoption path.
 *
 * Why this ordering matters:
 *   - No empty/new profile is ever published before the baby exists, so a
 *     first-time user's successful path performs exactly one profile publish
 *     (never create-then-update).
 *   - If the baby publish fails, no profile is created or updated at all.
 *   - If the baby succeeds but the profile publish fails, the promise rejects so
 *     the ceremony stays in retry mode and never calls onComplete. On retry we
 *     re-run from step (a): re-query the latest profile and re-publish the same
 *     baby coordinate + the same final profile (kind 31124 is replaceable, so
 *     re-publishing the same d is a harmless overwrite, not a duplicate).
 *
 * Design decision — egg events are NOT published at all.
 * Island does not support/display eggs, and kind 31124 is a replaceable
 * (addressable) event keyed by `31124:<pubkey>:<d>`. Publishing an egg and then
 * immediately a baby to the same coordinate would just overwrite the egg, adding
 * no protocol value while reintroducing the same orphan class if the flow is
 * abandoned. So we publish only the final baby. Identity/tags still come from
 * `@blobbi-kit/core` via the preview, so history/compat is preserved.
 *
 * Strict publishing (adoption-only):
 *   The shared `useNostrPublish` primitive intentionally SWALLOWS relay
 *   timeout/abort errors and resolves as success (it is tuned for lenient,
 *   fire-and-forget writes like presence/movement). That leniency is unsafe for
 *   adoption: a baby publish that timed out on every relay would be treated as
 *   success, the profile would then be published, `onComplete` would fire, and
 *   the app would enter `playing` — but on reload the baby wouldn't be found and
 *   the user would bounce back to the empty nest.
 *
 *   So this hook publishes the two adoption events through a small, local
 *   `strictPublish` helper (see below) that signs with the same signer + client
 *   tag as `useNostrPublish` but treats ANY failure to publish — timeout, abort,
 *   or all-relays-rejected — as a hard rejection. Success therefore means the
 *   underlying pool's `.event()` resolved, i.e. AT LEAST ONE configured relay
 *   accepted the event (NPool.event rejects only when ALL relays reject/fail).
 *   This is scoped to adoption; no other publisher is changed.
 *
 * Core event/tag/state logic uses `@blobbi-kit/core` helpers. This hook contains
 * no animation/UI.
 */

import { useCallback, useRef } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from './useNostr';
import { useCurrentUser } from './useCurrentUser';
import { useAuthor } from './useAuthor';

import {
  KIND_BLOBBI_STATE,
  KIND_BLOBBONAUT_PROFILE,
  BLOBBONAUT_PROFILE_KINDS,
} from '@/lib/blobbi-kinds';
import {
  buildBlobbonautTags,
  updateBlobbonautTags,
  mergeHasForAdoption,
  getTagValues,
} from '@blobbi-kit/core';
import { validateOwnerProfileEvent } from '@/lib/blobbi-parsers';

import {
  generateEggPreview,
  previewToBabyTags,
  type BlobbiEggPreview,
} from '@/lib/blobbi-egg-preview';

export function useFirstEggAdoption() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: authorData } = useAuthor(user?.pubkey);

  // Duplicate-submit guard: once finalize is in flight (or done) for this hook
  // instance, remember the promise so a second submit can't create a second
  // profile/baby. Belt-and-suspenders alongside the ceremony's UI guard.
  const finalizeInFlightRef = useRef<Promise<string> | null>(null);

  /**
   * Adoption-only STRICT publish. Signs the event (adding the same
   * `["client","blobbi"]` tag as `useNostrPublish`) and publishes it through the
   * relay pool with a timeout. Unlike `useNostrPublish`, it does NOT swallow
   * timeout/abort errors: ANY failure to publish (timeout, abort, or all relays
   * rejecting) rejects, so a failed baby publish cannot be mistaken for success.
   *
   * Resolves only when the pool's `.event()` resolves, which means at least one
   * configured relay accepted the event (`NPool.event` rejects only when ALL
   * relays reject/fail).
   */
  const strictPublish = useCallback(
    async (template: {
      kind: number;
      content: string;
      tags: string[][];
    }): Promise<NostrEvent> => {
      if (!user) throw new Error('User is not logged in');

      const tags = [...template.tags];
      if (!tags.some(([name]) => name === 'client')) {
        tags.push(['client', 'blobbi']);
      }

      const event = await user.signer.signEvent({
        kind: template.kind,
        content: template.content ?? '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });

      // Rejects on timeout/abort OR when all relays reject — no leniency here.
      await nostr.event(event, { signal: AbortSignal.timeout(5000) });
      return event;
    },
    [nostr, user],
  );

  /**
   * PURE, local-only. Generates a deterministic egg preview. Publishes nothing.
   * Safe to call on ceremony mount — refreshing/abandoning creates zero events.
   */
  const generatePreview = useCallback((): BlobbiEggPreview => {
    if (!user?.pubkey) throw new Error('User is not logged in');
    return generateEggPreview(user.pubkey, 'Egg');
  }, [user?.pubkey]);

  /**
   * The ONLY real publish path. Called on final naming submit.
   *
   * Builds the desired final profile in memory, publishes the final baby state
   * FIRST, then — only if that succeeds — publishes exactly one final profile
   * event linking the baby in (has[] + current_companion). Idempotent per hook
   * instance (guards double-submit). Resolves with the new Blobbi's canonical
   * d-tag on success; rejects on failure (the ceremony must NOT call onComplete
   * on rejection). On retry it re-queries the latest profile and re-publishes
   * the same baby coordinate + final profile.
   */
  const finalizeAdoption = useCallback(
    (preview: BlobbiEggPreview, name: string): Promise<string> => {
      if (finalizeInFlightRef.current) return finalizeInFlightRef.current;

      const run = async (): Promise<string> => {
        if (!user?.pubkey) throw new Error('User is not logged in');
        const pubkey = user.pubkey;
        const finalName = name.trim() || preview.name || 'Blobbi';

        // ── a. Read the latest profile (canonical 11125 + legacy 31125). This
        //       runs on every attempt, so a retry always merges against the
        //       freshest known profile. ──
        const profileEvents = await nostr.query(
          [{ kinds: [...BLOBBONAUT_PROFILE_KINDS], authors: [pubkey], limit: 1 }],
          { signal: AbortSignal.timeout(3000) },
        );
        const existingProfile = profileEvents
          .filter(validateOwnerProfileEvent)
          .sort((a, b) => b.created_at - a.created_at)[0];

        // ── b. Build the DESIRED FINAL profile tags entirely in memory. Nothing
        //       is published yet. For a brand-new user we start from
        //       buildBlobbonautTags + name + coins; for an existing profile we
        //       start from its current tags/content. Then we union has[] (never
        //       shrink) with the new d and set current_companion. This is the
        //       single profile event we will publish AFTER the baby succeeds —
        //       there is deliberately no earlier "empty" profile publish. ──
        let baseProfileTags: string[][];
        let profileContent = '';
        if (!existingProfile) {
          const suggestedName =
            authorData?.metadata?.name ||
            authorData?.metadata?.display_name ||
            'Blobbonaut';
          // NOTE: no `coins` tag. A fresh profile never carries a balance —
          // the canonical Coin balance lives in kind:31633 and the initial
          // allocation belongs to economy entry, not to adoption.
          baseProfileTags = [
            ...buildBlobbonautTags(pubkey),
            ['name', suggestedName],
          ];
        } else {
          baseProfileTags = existingProfile.tags;
          profileContent = existingProfile.content ?? '';
        }

        const existingHas = getTagValues(baseProfileTags, 'has');
        const newHas = mergeHasForAdoption(existingHas, existingHas, preview.d);
        const finalProfileTags = updateBlobbonautTags(baseProfileTags, {
          has: newHas,
          current_companion: preview.d,
        });

        // ── c. Publish the final BABY state (kind 31124) with the chosen name.
        //       No egg is ever published (see file header rationale). If this
        //       fails we throw before touching the profile, so no profile is
        //       created/updated. ──
        const babyTags = previewToBabyTags({ ...preview, name: finalName });
        await strictPublish({
          kind: KIND_BLOBBI_STATE,
          content: '',
          tags: babyTags,
        });

        // ── d. Baby is live — publish EXACTLY ONE final profile event. If this
        //       step fails, run() rejects and the guard is cleared, so the
        //       ceremony stays in retry mode (no onComplete) and a retry will
        //       re-query + re-publish the same baby coordinate + final profile. ──
        await strictPublish({
          kind: KIND_BLOBBONAUT_PROFILE,
          content: profileContent,
          tags: finalProfileTags,
        });

        // Adoption ends here. No currency moves: the initial Coin allocation
        // is economy entry's responsibility and has already run (or will run)
        // independently of whether this user ever adopts.
        return preview.d;
      };

      const promise = run().catch((err) => {
        // Clear the guard on failure so the user can retry the submit.
        finalizeInFlightRef.current = null;
        throw err;
      });
      finalizeInFlightRef.current = promise;
      return promise;
    },
    [nostr, user, authorData, strictPublish],
  );

  return { generatePreview, finalizeAdoption };
}
