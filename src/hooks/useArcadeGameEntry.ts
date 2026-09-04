/**
 * The turnstile: the ONE place a run is admitted to an arcade game.
 *
 * Three games, one gate. Each machine calls `admit` at its commitment
 * boundary and dispatches the run id it hands back; none of them knows what a
 * play costs, how a Pass waives it, or how a retry is kept from charging
 * twice.
 *
 * ## Where the charge happens, and where it does not
 *
 * A Token is spent only when a run genuinely begins, the moment the machine
 * would dispatch `start` or `replay`. Opening a cabinet, reading the
 * instructions, picking a difficulty, closing the modal and backing out are
 * all free, because none of them is a play. A replay IS a play, so it is
 * charged like any other.
 *
 * ```
 *   open cabinet ─ browse ─ pick difficulty      free
 *   press Play ──▶ admit() ──▶ charge ──▶ start  one run, one Token
 *   back out before Play                         free, nothing written
 * ```
 *
 * ## One start costs exactly one thing
 *
 * A Pass no longer waives plays without limit; it includes a finite allowance,
 * so a Pass-admitted start SPENDS something too. The turnstile therefore
 * charges exactly one of two currencies and never both:
 *
 * ```
 *   usable Pass   →  one free play consumed, zero Tokens
 *   otherwise     →  the game's Token cost, no play consumed
 * ```
 *
 * Which is why the Pass branch lives in `admit` and not in `admitFree`.
 * `admitFree` is the zero-I/O path, and it is now reserved for starts that
 * genuinely cost NOTHING, a game with no Token price at all. Consuming a
 * finite allowance is a write, and a write belongs at the same commitment
 * boundary as the Token spend, not on a fast path beside it.
 *
 * ## Not charging twice for one start
 *
 * Four defences, cheapest first:
 *
 * 1. a synchronous in-flight ref, so two clicks in one tick cannot both reach
 *    the wallet: React state flips a render too late to be the guard;
 * 2. the pass entitlement's own cross-tab lock, so two TABS cannot both spend
 *    the last free play (`consumeArcadeFreePlay` re-checks inside the lock);
 * 3. the shared inventory transaction's cross-tab lock and per-tab chain,
 *    which serialise the Token write itself;
 * 4. refusing admission on an UNCONFIRMED publish. A timeout means the spend
 *    may have landed, so the honest move is to not start the run: the player
 *    keeps a Token they might have paid and loses nothing but a click. The
 *    opposite bias: admit anyway, would hand out free plays on every flaky
 *    publish.
 *
 * That last rule is why this needs no durable operation ledger of its own. A
 * Coin spend must be exactly-once because the money is already gone when the
 * outcome is unknown; a Token spend can simply decline to deliver, which is
 * both safer and far less machinery.
 */

import { useCallback, useMemo, useRef } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isAmbiguousInventoryPublish } from '@/inventory/inventory-transaction';
import { useInventoryMutation, getQuantity } from '@/inventory/useInventoryMutation';
import { useIslandInventory } from '@/inventory/useIslandInventory';
import {
  consumeArcadeFreePlay,
  hasUsableArcadePass,
} from '@/arcade/pass/arcade-pass-entitlement';

import { ARCADE_TOKEN_ADDRESS } from '@/arcade/tokens/arcade-token';
import { tokenCostForGame } from '@/arcade/tokens/game-entry-policy';
import {
  type ArcadeEntryAdmitted,
  type ArcadeEntryOutcome,
  type ArcadeGameEntry,
} from '@/arcade/tokens/game-entry';

export function useArcadeGameEntry(now: () => number = Date.now): ArcadeGameEntry {
  const { user } = useCurrentUser();
  const inventory = useIslandInventory();
  const { mutateAsync: mutateInventory } = useInventoryMutation();
  const pubkey = user?.pubkey;

  const tokenBalance = inventory.data
    ? getQuantity(inventory.data, ARCADE_TOKEN_ADDRESS)
    : null;

  // "Will the next start be free?": both limits, so an exhausted pass reports
  // false and the UI stops promising free plays it cannot deliver.
  const hasPass = pubkey ? hasUsableArcadePass(pubkey, now()) : false;

  // Flips before the first await, so it is the actual guard; the disabled
  // button is a courtesy on top of it.
  const admittingRef = useRef(false);

  /**
   * The genuinely-costless path: no charge, no write, no await.
   *
   * Only games with no Token price qualify. A Pass start does NOT, because it
   * spends a free play; see the header. Returns `null` whenever anything at
   * all has to be consumed, and the caller must then await {@link admit}.
   */
  const admitFree = useCallback((gameId: string): ArcadeEntryAdmitted | null => {
    if (tokenCostForGame(gameId) === 0) {
      return { ok: true, charged: 0, waivedByPass: false };
    }
    return null;
  }, []);

  const admit = useCallback(
    async (gameId: string): Promise<ArcadeEntryOutcome> => {
      if (admittingRef.current) return { ok: false, reason: 'busy' };
      admittingRef.current = true;
      try {
        if (!pubkey) return { ok: false, reason: 'unavailable' };

        // A run that costs nothing writes nothing at all, so the Token balance
        // is provably unchanged rather than merely refunded.
        const free = admitFree(gameId);
        if (free) return free;

        const cost = tokenCostForGame(gameId);

        // ── The Pass, if it still has a play in it ──
        //
        // Checked and consumed in one locked step. A `false` here is not an
        // error: the pass may have expired, run out, or lost the last play to
        // another tab while this call queued. In every one of those cases the
        // correct next move is the same, fall through and charge Tokens.
        if (pubkey && hasUsableArcadePass(pubkey, now())) {
          if (await consumeArcadeFreePlay(pubkey, now())) {
            return { ok: true, charged: 0, waivedByPass: true };
          }
        }

        // An unknown balance is not a zero balance, and it is not a licence to
        // charge either: refuse until the inventory is actually known.
        if (tokenBalance === null) return { ok: false, reason: 'unavailable' };
        if (tokenBalance < cost) {
          return { ok: false, reason: 'insufficient-tokens', needed: cost };
        }

        try {
          await mutateInventory({
            type: 'remove',
            address: ARCADE_TOKEN_ADDRESS,
            amount: cost,
          });
        } catch (error) {
          // Possibly-landed: decline the run rather than risk a free play.
          if (isAmbiguousInventoryPublish(error)) {
            return { ok: false, reason: 'unconfirmed' };
          }
          return { ok: false, reason: 'unavailable' };
        }

        return { ok: true, charged: cost, waivedByPass: false };
      } finally {
        admittingRef.current = false;
      }
    },
    [pubkey, tokenBalance, mutateInventory, admitFree, now],
  );

  return useMemo(
    () => ({ tokenBalance, hasPass, costFor: tokenCostForGame, admitFree, admit }),
    [tokenBalance, hasPass, admitFree, admit],
  );
}
