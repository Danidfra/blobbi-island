import { cn } from '@/lib/utils';
import {
  formatFreePlays,
  formatPassRemaining,
  useArcadePass,
} from '@/hooks/useArcadePass';

/**
 * The Arcade Pass indicator; both limits, always.
 *
 * The Pass includes a finite number of free plays inside a 24-hour window, so
 * a chip that showed only the clock would keep promising free games after the
 * allowance ran out. Two states, and the exhausted one is deliberately still
 * visible rather than hidden: a player whose plays start costing Tokens again
 * needs to be told why, and a chip that disappeared would read as a bug.
 *
 * ```
 *   plays left   "Arcade Pass · 14 free plays · 18h 42m left"
 *   exhausted    "Arcade Pass · free plays used · games cost Tokens"
 *   expired      nothing
 * ```
 *
 * The Pass is not the Arcade Ticket and not the Arcade Token: Tokens are what
 * a play costs, Tickets are what a play pays, and the Pass is what covers a
 * limited run of plays.
 */
export function ArcadePassIcon() {
  const { isActive, isUsable, remainingMs, remainingFreePlays } = useArcadePass();

  if (!isActive) return null;

  const label = isUsable
    ? `Arcade Pass: ${formatFreePlays(remainingFreePlays)}, ${formatPassRemaining(remainingMs)} left`
    : 'Arcade Pass: free plays used, games cost Arcade Tokens again';

  return (
    <div
      className="relative"
      data-arcade-pass-active
      data-arcade-pass-usable={isUsable ? 'true' : 'false'}
    >
      <img
        src="/assets/items/tickets/arcade-ticket.png"
        alt={label}
        title={label}
        className={cn(
          'w-8 h-8 sm:w-10 sm:h-10 drop-shadow-lg',
          // Spent, not gone. Dimming says "this no longer does anything"
          // without removing the explanation from the screen.
          !isUsable && 'opacity-50 grayscale',
        )}
      />
      {isUsable && (
        <span
          aria-hidden
          className="absolute -bottom-1 -right-1 min-w-[1.15rem] rounded-full border border-white/70 bg-island-purple px-1 text-center text-[0.65rem] font-bold leading-[1.15rem] text-white shadow"
        >
          {remainingFreePlays}
        </span>
      )}
    </div>
  );
}
