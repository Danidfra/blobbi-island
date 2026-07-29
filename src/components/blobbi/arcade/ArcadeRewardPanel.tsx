import { cn } from '@/lib/utils';
import type { ArcadeRewardCalculation } from '@/arcade/reward-policy';
import type { ArcadeRewardState } from '@/hooks/useArcadeReward';
import { getQuantity, useIslandInventory } from '@/inventory';

/**
 * The ticket half of every dedicated game's results screen.
 *
 * Extracted, verbatim in behaviour, from the panel `DanceResults` shipped with
 * — because when Air Hockey and Pool earned reward policies, the alternative
 * was three hand-copied panels whose honesty rules would drift apart. The rules
 * this component enforces are the ones that panel was rebuilt around after a
 * real duplicate-grant defect:
 *
 * | phase | what the copy may say | what the button does |
 * | --- | --- | --- |
 * | `idle` + eligible | "claim these tickets" — never "you have them" | claim |
 * | `idle` + ineligible | why, in words, not a silent zero | nothing |
 * | `claiming` | "saving" — the button is out of action | nothing |
 * | `confirmed` | the tickets are in the inventory; the balance moved and was read back | nothing |
 * | `failed` | nothing was written; retry | claim again |
 * | `unresolved` | it MAY have been written; we will NOT send another grant | **check status, read-only** |
 * | `checking` | a read-only status check is running | nothing |
 * | `already-claimed` | this run was paid, on this browser | nothing |
 *
 * Two things must never appear: a confirmed balance increase the application
 * cannot substantiate, and a **"Try again" button on an unresolved claim**. The
 * second one is not a wording problem — an additive `+N` retried after a
 * publish that actually landed is `+2N`, and re-reading the balance first does
 * not help, because the balance already includes the first grant.
 *
 * ## Per-game surface
 *
 * `dataPrefix` keeps each game's long-standing test selectors intact
 * (`data-dance-reward`, `data-hockey-reward`, `data-pool-reward`), and
 * `ineligibleHint` is the one sentence of game-specific encouragement under a
 * zero — everything else is deliberately identical across the three games.
 *
 * ## The balance line
 *
 * The panel shows the CURRENT ticket balance from the canonical kind:31633
 * inventory (the same shared query the arcade HUD chip reads). Three states,
 * kept distinct on purpose: a number (including a genuine zero — an empty
 * inventory is an answer, not an error), "…" while the first read is in
 * flight, and "unavailable" when the read failed — never a false zero. After a
 * confirmed claim the reward hook invalidates the query, so the number the
 * player watches is the number that actually moved.
 */

interface ArcadeRewardPanelProps {
  /** Null when no production policy could be resolved at all. */
  readonly calculation: ArcadeRewardCalculation | null;
  readonly reward: ArcadeRewardState;
  /** True while the shared lifecycle is in `claiming`. */
  readonly claiming: boolean;
  readonly canClaim: boolean;
  readonly onClaim: () => void;
  /** Read-only status check for an unresolved claim. Never publishes. */
  readonly onCheckStatus: () => void;
  readonly isLoggedIn: boolean;
  /**
   * Data-attribute prefix (`dance`, `hockey`, `pool`) so each game keeps its
   * established selectors.
   */
  readonly dataPrefix: string;
  /**
   * One game-specific sentence rendered after the ineligible reason — the
   * "here is how to earn them" encouragement.
   */
  readonly ineligibleHint: string;
  /** DEV harness only: show the policy identity. Hidden from players. */
  readonly showDebugDetails?: boolean;
}

/**
 * A short, non-committal label for each claim phase.
 *
 * These are STATUS words, not outcomes. `unresolved` reads "Not confirmed"
 * rather than anything that could be mistaken for "saved", because the whole
 * point of that phase is that the application does not know.
 */
const PHASE_CHIP: Readonly<
  Record<ArcadeRewardState['phase'], { label: string; className: string }>
> = {
  idle: { label: 'Ready to collect', className: 'bg-island-purple/15 text-island-purple' },
  claiming: { label: 'Saving…', className: 'bg-island-wood/15 text-island-wood-dark' },
  confirmed: { label: 'In your inventory', className: 'bg-emerald-500/15 text-emerald-800' },
  failed: { label: 'Not saved', className: 'bg-rose-500/15 text-rose-800' },
  unresolved: { label: 'Not confirmed', className: 'bg-amber-500/15 text-amber-800' },
  checking: { label: 'Checking…', className: 'bg-island-wood/15 text-island-wood-dark' },
  'already-claimed': { label: 'Already collected', className: 'bg-island-wood/15 text-island-wood-dark' },
};

/**
 * The current ticket balance, from the same canonical query everything else
 * reads. Rendered only for a logged-in player — a logged-out one has no
 * inventory to misreport.
 */
function BalanceLine({ prefix, itemAddress }: { prefix: string; itemAddress: string }) {
  const { data: inventory, isLoading, isError } = useIslandInventory();

  let value: string;
  let state: 'ready' | 'loading' | 'unavailable';
  if (inventory) {
    value = String(getQuantity(inventory, itemAddress));
    state = 'ready';
  } else if (isError) {
    value = 'unavailable';
    state = 'unavailable';
  } else if (isLoading) {
    value = '…';
    state = 'loading';
  } else {
    // Disabled query (no pubkey) — the caller should not have rendered us, but
    // never show a made-up number.
    value = '…';
    state = 'loading';
  }

  return (
    <p
      {...{ [`data-${prefix}-ticket-balance`]: state }}
      className="flex justify-between gap-3 border-t border-island-purple/15 pt-1.5 text-xs blobbi-text-muted"
    >
      <span>Your Arcade Tickets</span>
      <span
        className="font-mono font-bold text-island-ink"
        aria-label={
          state === 'ready'
            ? `You have ${value} Arcade Ticket${value === '1' ? '' : 's'}`
            : state === 'unavailable'
              ? 'Your ticket balance could not be loaded'
              : 'Loading your ticket balance'
        }
      >
        {state === 'ready' && (
          <span aria-hidden className="mr-1">
            🎟️
          </span>
        )}
        {value}
      </span>
    </p>
  );
}

export function ArcadeRewardPanel({
  calculation,
  reward,
  claiming,
  canClaim,
  onClaim,
  onCheckStatus,
  isLoggedIn,
  dataPrefix,
  ineligibleHint,
  showDebugDetails = false,
}: ArcadeRewardPanelProps) {
  const prefix = dataPrefix;

  if (!calculation) {
    return (
      <p
        {...{ [`data-${prefix}-reward`]: 'unavailable' }}
        role="status"
        className="rounded-2xl border-2 border-island-wood/25 p-3 text-sm blobbi-text-muted"
      >
        Arcade Tickets could not be worked out for this run, so none are being offered. Your score
        still stands.
      </p>
    );
  }

  /**
   * Zero tickets, said kindly and said once.
   *
   * A run can be ineligible for reasons that are nobody's fault — it was cut
   * short, or it never reached the end. The copy names the reason and then says
   * the useful thing: how tickets are earned, which the Play again button is
   * right there to do.
   */
  if (!calculation.eligible) {
    return (
      <div
        {...{ [`data-${prefix}-reward`]: 'ineligible' }}
        role="status"
        className="rounded-2xl border-2 border-island-wood/25 bg-island-cream/60 p-3 text-center"
      >
        <p className="text-sm font-bold text-island-ink">
          <span aria-hidden>🎟️ </span>No Arcade Tickets this time
        </p>
        <p className="mt-1 text-xs blobbi-text-muted">
          {calculation.ineligibleReason}. {ineligibleHint}
        </p>
      </div>
    );
  }

  const busy = claiming || reward.phase === 'claiming';
  const checking = reward.phase === 'checking';
  const confirmed = reward.phase === 'confirmed';
  const already = reward.phase === 'already-claimed';
  /**
   * The claim MAY have been published. The only action offered is a read-only
   * status check — there is deliberately no path from here to another publish.
   */
  const unresolved = reward.phase === 'unresolved';
  const chip = PHASE_CHIP[reward.phase];

  return (
    <div
      {...{ [`data-${prefix}-reward`]: reward.phase }}
      className="space-y-2 rounded-2xl border-2 border-island-purple/30 bg-island-purple/[0.06] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-island-ink">Arcade Tickets</h4>
        <span
          {...{ [`data-${prefix}-reward-chip`]: reward.phase }}
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            chip.className,
          )}
        >
          {chip.label}
        </span>
      </div>

      {/* The earned quantity, large enough to be the point of the panel. */}
      <p className="text-center font-mono text-4xl font-black leading-none text-island-purple">
        <span aria-hidden className="mr-1 text-2xl">
          🎟️
        </span>
        {calculation.quantity}
      </p>

      <ul className="space-y-0.5 text-xs blobbi-text-muted">
        {calculation.components.map((line) => (
          <li key={line.label} className="flex justify-between gap-3">
            <span>
              {line.label}
              {line.detail ? ` (${line.detail})` : ''}
            </span>
            <span className="font-mono">{line.tickets > 0 ? `+${line.tickets}` : line.tickets}</span>
          </li>
        ))}
        {calculation.capApplied && (
          <li className="font-bold">Capped at {calculation.cap} per run.</li>
        )}
      </ul>

      {reward.message && (
        <p
          role="status"
          {...{ [`data-${prefix}-reward-message`]: true }}
          className={cn(
            'rounded-lg px-2 py-1.5 text-xs',
            confirmed && 'bg-emerald-500/10 text-emerald-800',
            reward.phase === 'failed' && 'bg-rose-500/10 text-rose-800',
            unresolved && 'bg-amber-500/10 text-amber-800',
            already && 'bg-island-wood/10',
            (busy || checking) && 'bg-island-wood/10',
          )}
        >
          {reward.message}
        </p>
      )}

      {/*
        An unresolved claim gets ONE action, and it does not publish. Offering
        "Try again" here is what turned a 3-ticket reward into 6: the retry is an
        additive +N on a balance that may already include the first +N.
      */}
      {unresolved || checking ? (
        <button
          type="button"
          {...{ [`data-${prefix}-check-status`]: true }}
          onClick={onCheckStatus}
          disabled={checking || !isLoggedIn}
          className={cn(
            'min-h-[44px] w-full rounded-full border-2 border-island-wood/40 px-4 py-2 text-sm font-bold',
            'bg-island-cream text-island-ink disabled:opacity-50',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          )}
        >
          {checking ? 'Checking…' : 'Check ticket status'}
        </button>
      ) : (
        !confirmed &&
        !already && (
          <button
            type="button"
            {...{ [`data-${prefix}-claim`]: true }}
            onClick={onClaim}
            disabled={busy || !canClaim || !isLoggedIn}
            className={cn(
              'min-h-[44px] w-full rounded-full border-2 border-island-purple px-4 py-2 text-sm font-bold',
              'bg-island-purple text-white disabled:opacity-50',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
            )}
          >
            {busy
              ? 'Saving your tickets…'
              : !isLoggedIn
                ? 'Log in to keep these tickets'
                : reward.phase === 'failed'
                  ? 'Try again'
                  : `Claim ${calculation.quantity} tickets`}
          </button>
        )
      )}

      {isLoggedIn && <BalanceLine prefix={prefix} itemAddress={calculation.itemAddress} />}

      {/*
        Policy identity is protocol trivia, not player copy. It stays available
        for the DEV harness and for a support conversation, and out of the way
        otherwise.
      */}
      {showDebugDetails && (
        <p {...{ [`data-${prefix}-reward-policy`]: true }} className="text-[11px] blobbi-text-muted">
          Policy {calculation.policyId} v{calculation.policyVersion}
        </p>
      )}
    </div>
  );
}
