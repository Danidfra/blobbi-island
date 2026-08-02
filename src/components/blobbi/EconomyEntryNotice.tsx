/**
 * Compact pre-world economy-entry status.
 *
 * Shown in the existing loading/selection shell ONLY while something needs
 * saying: the initial allocation is actively applying, its confirmation is
 * ambiguous, or a retryable failure needs user action. Plain checking and the
 * settled/applied state render nothing — entry must never feel like a gate.
 *
 * Copy is child-friendly and never leaks Nostr terminology (no event kinds,
 * relays, operation ids, or migration language). The retry button appears
 * only for states the service can retry SAFELY (it re-checks the durable
 * marker before ever publishing again).
 */

import { useEconomyEntryStatus } from '@/inventory/useEconomyEntry';

export function EconomyEntryNotice() {
  const entry = useEconomyEntryStatus();

  let message: string | null = null;
  let showRetry = false;

  if (entry.phase === 'applying') {
    message = 'Preparing your Island Coins…';
  } else if (entry.phase === 'ambiguous') {
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
      className="pointer-events-auto fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-xs font-medium text-purple-800 shadow-md backdrop-blur dark:bg-slate-800/90 dark:text-purple-200"
    >
      <span className="inline-flex items-center gap-2">
        <span aria-hidden>🪙</span>
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
