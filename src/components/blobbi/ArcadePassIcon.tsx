import { formatPassRemaining, useArcadePass } from '@/hooks/useArcadePass';

/**
 * The Arcade Pass indicator.
 *
 * Shown only while a redeemed pass is still running. It says how long is left
 * because the pass is now a 24-hour entitlement rather than a visit-scoped
 * flag — "you have a pass" is no longer the whole story, and a player deciding
 * whether to redeem another one needs the number.
 *
 * The pass is NOT the Arcade Ticket, and not the Arcade Token either: Tokens
 * are what a play costs, Tickets are what a play pays, and the pass is what
 * makes the Tokens unnecessary for a day.
 */
export function ArcadePassIcon() {
  const { isActive, remainingMs } = useArcadePass();

  if (!isActive) return null;

  const remaining = formatPassRemaining(remainingMs);
  return (
    <div className="relative" data-arcade-pass-active>
      <img
        src="/assets/items/tickets/arcade-ticket.png"
        alt={`Arcade Pass active — free plays for ${remaining}`}
        className="w-8 h-8 sm:w-10 sm:h-10 drop-shadow-lg"
        title={`Arcade Pass active — free plays for ${remaining}`}
      />
    </div>
  );
}
