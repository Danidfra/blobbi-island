/**
 * Compact economy-entry status, in and out of the world.
 *
 * Shown ONLY while something needs saying: the initial allocation is actively
 * applying, its confirmation is ambiguous, or a retryable failure needs user
 * action. Plain checking and the settled/applied state render nothing — entry
 * must never feel like a gate.
 *
 * ## Why it now also speaks inside the world
 *
 * The notice used to be mounted only by the pre-world shell, on the reasoning
 * that the in-world Coins surface owns this. That surface lives inside the
 * Blobbi info modal, which a player may never open — so a failed allocation
 * left a new player at 0 Coins with no visible way back. In the world the
 * notice therefore says the two things the modal cannot say on its own: that
 * the allocation FAILED and can be retried, and that an attempt is running.
 * The routine `ambiguous` state stays with the Coins surface, because it is
 * not a failure and asks nothing of the player.
 *
 * Both contexts drive the SAME `retry()` from `useEconomyEntryStatus` — there
 * is one retry action in the app, not one per surface.
 *
 * Copy is child-friendly and never leaks Nostr terminology (no event kinds,
 * relays, operation ids, or migration language). The retry button appears
 * only for states the service can retry SAFELY (it re-checks the durable
 * marker before ever publishing again).
 */

import { cn } from '@/lib/utils';
import { useEconomyEntryStatus } from '@/inventory/useEconomyEntry';
import { CoinIcon } from './CoinAmount';

interface EconomyEntryNoticeProps {
  /**
   * Rendered over the playing world rather than in the pre-world shell.
   *
   * Changes both what is said (see the module note) and where: the chip lifts
   * clear of the in-world action dock instead of sitting on the shell's
   * bottom edge.
   */
  inWorld?: boolean;
}

export function EconomyEntryNotice({ inWorld = false }: EconomyEntryNoticeProps = {}) {
  const entry = useEconomyEntryStatus();

  let message: string | null = null;
  let showRetry = false;

  // In the world `checking` counts as working too: the only way to reach it
  // there is a retry (or an unusually slow first check), and both deserve
  // immediate feedback. Before the world it stays silent, so a normal sign-in
  // never flashes a chip.
  const working = entry.phase === 'applying' || (inWorld && entry.phase === 'checking');

  if (working) {
    message = 'Preparing your Island Coins…';
  } else if (entry.phase === 'ambiguous' && !inWorld) {
    message = 'Confirming your Island Coins…';
  } else if (entry.phase === 'failed' && entry.canRetry) {
    message = "We couldn't prepare your Island Coins yet.";
    showRetry = true;
  }

  if (!message) return null;

  return (
    <div
      role="status"
      data-economy-entry-notice
      data-economy-entry-in-world={inWorld ? '' : undefined}
      className={cn(
        'pointer-events-auto fixed left-1/2 z-40 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-xs font-medium text-purple-800 shadow-md backdrop-blur dark:bg-slate-800/90 dark:text-purple-200',
        // Clear of the action dock in the world; on the shell's edge outside it.
        inWorld ? 'bottom-24' : 'bottom-4',
      )}
    >
      <span className="inline-flex items-center gap-2">
        {/* The official Coin mark, so every economy surface shows the same
            currency rather than a stand-in emoji. */}
        <CoinIcon />
        {message}
        {showRetry && (
          <button
            type="button"
            className="underline"
            onClick={() => entry.retry()}
          >
            Try again
          </button>
        )}
      </span>
    </div>
  );
}
