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
 * A Token is spent only when a run genuinely begins — the moment the machine
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
 * ## Not charging twice for one start
 *
 * Three defences, cheapest first:
 *
 * 1. a synchronous in-flight ref, so two clicks in one tick cannot both reach
 *    the wallet — React state flips a render too late to be the guard;
 * 2. the shared inventory transaction's cross-tab lock and per-tab chain,
 *    which serialise the write itself;
 * 3. refusing admission on an UNCONFIRMED publish. A timeout means the spend
 *    may have landed, so the honest move is to not start the run: the player
 *    keeps a Token they might have paid and loses nothing but a click. The
 *    opposite bias — admit anyway — would hand out free plays on every flaky
 *    publish.
 *
 * That third rule is why this needs no durable operation ledger of its own. A
 * Coin spend must be exactly-once because the money is already gone when the
 * outcome is unknown; a Token spend can simply decline to deliver, which is
 * both safer and far less machinery.
 */

import { useCallback, useMemo, useRef } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isAmbiguousInventoryPublish } from '@/inventory/inventory-transaction';
import { useInventoryMutation, getQuantity } from '@/inventory/useInventoryMutation';
import { useIslandInventory } from '@/inventory/useIslandInventory';
import { hasActiveArcadePass } from '@/arcade/pass/arcade-pass-entitlement';

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

  const hasPass = pubkey ? hasActiveArcadePass(pubkey, now()) : false;

  // Flips before the first await, so it is the actual guard; the disabled
  // button is a courtesy on top of it.
  const admittingRef = useRef(false);

  /**
   * The free path: no charge, no write, no await. A Pass holder's game starts
   * on the same tick they press Play.
   */
  const admitFree = useCallback(
    (gameId: string): ArcadeEntryAdmitted | null => {
      const cost = tokenCostForGame(gameId);
      if (cost === 0) return { ok: true, charged: 0, waivedByPass: false };
      if (pubkey && hasActiveArcadePass(pubkey, now())) {
        return { ok: true, charged: 0, waivedByPass: true };
      }
      return null;
    },
    [pubkey, now],
  );

  const admit = useCallback(
    async (gameId: string): Promise<ArcadeEntryOutcome> => {
      if (admittingRef.current) return { ok: false, reason: 'busy' };
      admittingRef.current = true;
      try {
        if (!pubkey) return { ok: false, reason: 'unavailable' };

        // A free run (or one a Pass waives) writes nothing at all, so the
        // Token balance is provably unchanged rather than merely refunded.
        const free = admitFree(gameId);
        if (free) return free;

        const cost = tokenCostForGame(gameId);

        // An unknown balance is not a zero balance, and it is not a licence to
        // charge either — refuse until the inventory is actually known.
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
    [pubkey, tokenBalance, mutateInventory, admitFree],
  );

  return useMemo(
    () => ({ tokenBalance, hasPass, costFor: tokenCostForGame, admitFree, admit }),
    [tokenBalance, hasPass, admitFree, admit],
  );
}
