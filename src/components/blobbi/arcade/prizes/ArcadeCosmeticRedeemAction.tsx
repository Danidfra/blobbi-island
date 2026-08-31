/**
 * The redeem control for one cosmetic Prize Counter reward — the second LIVE
 * redemption, and the only place on the shelf that can spend a ticket.
 *
 * ## Why it is a separate module
 *
 * `PrizeCounter` is provably write-free: `prize-counter-boundaries.test.ts`
 * walks its whole transitive import graph and fails if a spend writer, a
 * mutation hook or a delivery store appears anywhere in it. That guarantee is
 * worth keeping even now that the shelf sells things, so this component reaches
 * the panel through `PrizeCounter`'s `redeemSlot` render prop. A callback
 * carries no imports; everything financial lives here.
 *
 * ## What this component contributes, and what it does not
 *
 * `useArcadePrizeRedemption` owns the durable ledger, the same-tick lock, the
 * strict publish, the verification and the ambiguous-publish rules. The atomic
 * redeemer owns the mutation. This component contributes only the two things
 * neither can know: which prize is on screen, and what the player should be
 * offered right now.
 *
 * It NEVER equips what it redeems. Owning (kind:31633) and wearing
 * (kind:31634) are different facts, and the wardrobe is where the second one
 * is decided.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNostr } from '@nostrify/react';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useIslandInventory } from '@/inventory/useIslandInventory';
import { getInventoryItemQuantity } from '@/inventory/package';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';
import { useArcadePrizeRedemption } from '@/hooks/useArcadePrizeRedemption';
import { officialArcadePrizeAsRedeemable } from '@/arcade/prizes/official-prize-catalog';
import { evaluatePrizeEligibility } from '@/arcade/prizes/prize-redemption';
import { createArcadeCosmeticRedeemer } from '@/inventory/arcade-cosmetic-redeemer';
import type { ResolvedArcadePrize } from './useOfficialArcadePrizes';

/**
 * Phases where offering the button again would risk a SECOND debit. The spend
 * may have landed; the only safe action is a read.
 */
const NEVER_RETRY = new Set(['reserving', 'spending', 'spend-unresolved', 'checking', 'delivering']);

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

export interface ArcadeCosmeticRedeemActionProps {
  readonly resolved: ResolvedArcadePrize;
}

export function ArcadeCosmeticRedeemAction({ resolved }: ArcadeCosmeticRedeemActionProps) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const inventory = useIslandInventory();
  const { prize, name, owned, equipped } = resolved;

  // Arcade TICKETS — never Tokens, never Coins. A Prize Counter cosmetic is
  // paid for in exactly one currency.
  const balance = inventory.data
    ? getInventoryItemQuantity(inventory.data, TICKET_ADDRESS)
    : null;

  // The prize record the ledger and the machine speak. Derived from the
  // catalog entry — the canonical address, the frozen price and the catalog
  // version all come from there, never from this component.
  const redeemable = useMemo(
    () => officialArcadePrizeAsRedeemable(prize, name),
    [prize, name],
  );

  /*
    The redeemer must be built ONCE per prize, not once per render.

    `useNostr()` and `useCurrentUser()` are free to hand back a fresh object
    each render, and a redeemer rebuilt on every render means a fresh
    `ownership` identity, which the redemption hook watches to refresh what the
    player owns — a render loop with a relay read in it. Stable proxies read
    the live values at CALL time, so the redeemer stays identity-stable while
    still using the current pool and signer.
  */
  const nostrRef = useRef(nostr);
  nostrRef.current = nostr;
  const userRef = useRef(user);
  userRef.current = user;

  const stableNostr = useMemo(
    () =>
      ({
        query: (...args: unknown[]) =>
          (nostrRef.current as { query: (...a: unknown[]) => unknown }).query(...args),
        /*
          A GETTER, not a wrapper function. The shared read layer decides
          whether it can distinguish "the relay finished" from "the read was
          truncated" by testing whether `req` EXISTS — so a proxy that always
          defines it would claim an EOSE-aware read a bare fake cannot deliver.
          This mirrors the real pool's shape instead of asserting it.
        */
        get req() {
          const pool = nostrRef.current as {
            req?: (...a: unknown[]) => unknown;
          };
          return typeof pool.req === 'function'
            ? (...args: unknown[]) => pool.req!(...args)
            : undefined;
        },
        event: (...args: unknown[]) =>
          (nostrRef.current as { event: (...a: unknown[]) => unknown }).event(...args),
      }) as unknown as Parameters<typeof createArcadeCosmeticRedeemer>[0]['nostr'],
    [],
  );
  const stableUser = useMemo(
    () =>
      ({
        get pubkey() {
          return userRef.current?.pubkey ?? '';
        },
        get signer() {
          return userRef.current?.signer;
        },
      }) as unknown as Parameters<typeof createArcadeCosmeticRedeemer>[0]['user'],
    [],
  );

  const pubkey = user?.pubkey;
  const redeemer = useMemo(() => {
    if (!pubkey) return null;
    return createArcadeCosmeticRedeemer({
      nostr: stableNostr,
      user: stableUser,
      prize: redeemable,
    });
  }, [pubkey, stableNostr, stableUser, redeemable]);

  const { state, redeem, checkSpendStatus, finishDelivery, hydrateForPrize } =
    useArcadePrizeRedemption({
      // Never fall through to the hook's default production writer: that one
      // spends tickets WITHOUT granting the prize, which is the exact
      // non-atomic behaviour this path exists to replace.
      writer: redeemer?.writer ?? LOGGED_OUT_WRITER,
      // Before login there is nothing to deliver to. The refusing stub keeps
      // the hook's contract (ownership is required) without ever pretending a
      // logged-out visitor owns or could be granted anything.
      ownership: redeemer?.ownership ?? LOGGED_OUT_OWNERSHIP,
    });

  /*
    Adopt any durable record for THIS prize on mount and whenever the selection
    changes. A tab closed mid-spend leaves an unresolved record; without this
    the panel would offer a fresh Redeem button over tickets that may already
    be gone.
  */
  useEffect(() => {
    hydrateForPrize(redeemable);
  }, [hydrateForPrize, redeemable]);

  const mine = state.prizeId === redeemable.id;
  const phase = mine ? state.phase : 'idle';
  const busy = mine && ['reserving', 'spending', 'delivering', 'checking'].includes(phase);

  // The rendered inventory is good enough to DISABLE a button; it is never the
  // last word on spending. The authoritative refusal happens inside the write
  // lock, against the newest kind:31633 event (`arcade-cosmetic-redeemer.ts`).
  const eligibility = evaluatePrizeEligibility({
    prize: redeemable,
    balance,
    owned,
    loggedIn: Boolean(pubkey),
  });

  const onRedeem = useCallback(() => {
    void redeem(redeemable);
  }, [redeem, redeemable]);

  /*
    ── One "you have it" state, however you got here ──

    Owning it is the fact; having just bought it is only the occasion. Both
    mean the same thing to the counter — do not sell this again — so they
    render as one element with different copy, rather than two branches that
    can drift. The freshly-confirmed wording is dropped once the prize is
    actually worn, where "it's yours!" would be stale news.
  */
  const has = owned || phase === 'confirmed';
  if (has && !busy) {
    const justBought = phase === 'confirmed' && !equipped;
    return (
      <p
        data-prize-redeem-state={phase === 'confirmed' ? 'confirmed' : 'owned'}
        role="status"
        className="rounded-xl border-2 border-island-grass/40 bg-island-grass/10 px-3 py-2 text-center text-xs font-bold text-island-grass-dark"
      >
        {justBought ? `${name} is yours!` : 'Owned'}
        {equipped ? ' · equipped' : ' — wear it from your wardrobe'}
      </p>
    );
  }

  return (
    <div data-prize-redeem={prize.d} className="space-y-1.5">
      {phase === 'spend-unresolved' ? (
        // Reconcile-only. The spend may have landed, so the ONE safe action is
        // a read — which for an atomic redemption asks whether the PRIZE is
        // there, the single fact only this redemption's event could produce.
        <Button
          variant="soft"
          className="min-h-[44px] w-full"
          onClick={() => void checkSpendStatus(redeemable)}
          data-prize-redeem-action="check"
        >
          Check status
        </Button>
      ) : phase === 'delivery-recovery' ? (
        // Already paid. Finishing spends nothing.
        <Button
          variant="accent"
          className="min-h-[44px] w-full"
          onClick={() => {
            if (state.redemption) void finishDelivery(redeemable, state.redemption);
          }}
          data-prize-redeem-action="finish"
        >
          Finish delivery
        </Button>
      ) : (
        <Button
          variant="accent"
          className="min-h-[44px] w-full"
          disabled={busy || !eligibility.eligible || !redeemer || NEVER_RETRY.has(phase)}
          onClick={onRedeem}
          data-prize-redeem-action="redeem"
        >
          {busy ? 'Redeeming…' : `Redeem — ${prize.tickets} Tickets`}
        </Button>
      )}

      {/* One reason, the most actionable one, in words. */}
      {!eligibility.eligible && !busy && phase === 'idle' && (
        <p data-prize-redeem-reason={eligibility.reason} className="text-center text-[11px] blobbi-text-muted">
          {eligibility.reason === 'insufficient-tickets' && balance !== null
            ? `You have ${balance} of ${prize.tickets} Arcade Tickets.`
            : REASON_COPY[eligibility.reason]}
        </p>
      )}

      {mine && state.message && (
        <p role="alert" data-prize-redeem-message className="text-center text-[11px] text-island-danger">
          {state.message}
        </p>
      )}
    </div>
  );
}

const REASON_COPY: Readonly<Record<string, string>> = {
  'logged-out': 'Log in to redeem prizes.',
  'coming-soon': 'This prize is not for sale yet.',
  owned: 'You already own this one.',
  'balance-unavailable': 'Your ticket balance could not be read just now.',
  'insufficient-tickets': 'You do not have enough Arcade Tickets yet.',
  'invalid-price': 'This prize cannot be redeemed.',
};

/**
 * The logged-out delivery store: owns nothing, delivers nothing, refuses.
 *
 * The hook requires an `ownership` and this is the honest one to give it
 * before there is a signed-in user to deliver to. It cannot be reached by a
 * redemption — the button is disabled and `redeem` refuses a signed-out user
 * first — and if it ever were, it refuses rather than inventing a grant.
 */
const LOGGED_OUT_WRITER = {
  async spendTickets(): Promise<void> {
    throw new Error('Log in to redeem prizes.');
  },
  async readTicketQuantity() {
    return null;
  },
};

const LOGGED_OUT_OWNERSHIP = {
  atomicWithSpend: true,
  async hasPrize() {
    return false;
  },
  async hasDelivery() {
    return false;
  },
  async grantPrize(): Promise<void> {
    throw new Error('Log in to redeem prizes.');
  },
  async listOwnedPrizes() {
    return [];
  },
};
