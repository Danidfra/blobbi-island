import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  useIslandInventory,
  useItemCatalog,
  toIslandEntries,
} from '@/inventory';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

/**
 * ArcadeTicketBalance — a read-only chip showing how many Arcade Tickets the
 * player holds.
 *
 * ## Why this is a separate component from `ArcadePassIcon`
 *
 * They look adjacent but they are different things, and merging them would
 * couple two unrelated lifetimes:
 *
 * | | Arcade **Pass** | Arcade **Ticket** |
 * | --- | --- | --- |
 * | what | temporary floor-ACCESS state | persistent reward CURRENCY |
 * | stored in | `sessionStorage` | kind:31633 inventory |
 * | lifetime | until you leave the arcade | until you spend it |
 * | quantity | boolean | integer |
 *
 * So `ArcadePassIcon` is left completely untouched, and this component owns the
 * balance. It reads the canonical inventory hook — it never polls
 * `sessionStorage`, and it never reads the pass.
 *
 * ## Read-only, and read-only on purpose
 *
 * Rendering a balance performs a relay READ (the shared `useIslandInventory`
 * query, deduplicated by TanStack Query with everything else that reads the
 * inventory). It publishes nothing. Granting tickets is a later phase.
 *
 * ## Zero-quantity behaviour
 *
 * Hidden at zero, matching the Item Bag convention (`quantity > 0`). Until the
 * arcade actually awards tickets nobody has any, so the chip is correctly
 * invisible rather than nagging every player with a permanent "0".
 */

/** Canonical address of the Arcade Ticket, derived from issuer + `d`. */
const ARCADE_TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

interface ArcadeTicketBalanceProps {
  className?: string;
}

export function ArcadeTicketBalance({ className }: ArcadeTicketBalanceProps) {
  const { data: inventory } = useIslandInventory();
  const { data: catalog } = useItemCatalog();

  const ticket = useMemo(
    () =>
      toIslandEntries(inventory, catalog).find(
        (entry) => entry.address === ARCADE_TICKET_ADDRESS,
      ) ?? null,
    [inventory, catalog],
  );

  /**
   * The artwork is a REMOTE asset, so unlike the emoji it can fail to load
   * (asset host down, offline, blocked). The catalog's whole design is
   * "always degrade to something renderable", so a failed image degrades to the
   * emoji rather than leaving a broken-image glyph in the HUD.
   */
  const imageUrl = ticket?.definition.image ?? null;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    // A different URL deserves a fresh attempt.
    setImageFailed(false);
  }, [imageUrl]);

  if (!ticket || ticket.quantity <= 0) return null;

  const { definition, quantity } = ticket;
  const showImage = Boolean(imageUrl) && !imageFailed;

  return (
    <div
      data-arcade-ticket-balance
      title={`${quantity} ${definition.name}${quantity === 1 ? '' : 's'}`}
      aria-label={`${quantity} ${definition.name}${quantity === 1 ? '' : 's'}`}
      className={cn(
        'flex items-center gap-1 rounded-full bg-white/80 px-2 h-9 shadow select-none',
        className,
      )}
      data-block-move
    >
      {/*
        Visual resolution order matches the catalog's: the `image` (from the
        published definition, or from the bundled fallback when relays are
        unreachable) wins, and the emoji is the last resort — including when the
        image itself fails to load.
      */}
      {showImage ? (
        <img
          src={imageUrl!}
          alt=""
          aria-hidden
          className="h-5 w-5 object-contain"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="text-lg leading-none" role="img" aria-hidden>
          {definition.emoji}
        </span>
      )}
      <span className="text-sm font-bold tabular-nums text-island-ink">
        {quantity}
      </span>
    </div>
  );
}
