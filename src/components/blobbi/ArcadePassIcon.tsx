import { useArcadePass } from '@/hooks/useArcadePass';

/**
 * The Arcade Pass indicator.
 *
 * Previously this ran `setInterval(checkPass, 1000)` for the whole session, in
 * every location, because `sessionStorage` fires no event for same-tab writes.
 * It now subscribes to `src/lib/arcade-pass.ts`, where the writers notify
 * directly and a single shared `storage` listener covers the cross-tab case.
 *
 * The pass is NOT the Arcade Ticket — see `ArcadeTicketBalance`, which renders
 * the kind:31633 currency next to this chip. Two arcade concepts, two lifetimes,
 * deliberately not merged.
 */
export function ArcadePassIcon() {
  const hasPass = useArcadePass();

  if (!hasPass) return null;

  return (
    <div className="relative">
      <img
        src="/assets/items/tickets/arcade-ticket.png"
        alt="Arcade Pass"
        className="w-8 h-8 sm:w-10 sm:h-10 drop-shadow-lg animate-pulse"
        title="You have an active Arcade Pass!"
      />
    </div>
  );
}
