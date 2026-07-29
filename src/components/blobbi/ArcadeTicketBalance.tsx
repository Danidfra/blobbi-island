import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  bundledFallbackDefinition,
  unknownItemDefinition,
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
 * By default the chip is hidden at zero, matching the Item Bag convention
 * (`quantity > 0`) — outside the arcade a permanent "0" would be a nag.
 *
 * Inside the arcade the games now award tickets, so the arcade HUD passes
 * `showZero` and the chip becomes a persistent counter with three DISTINCT
 * states, never a false zero:
 *
 *  - a number, including a genuine `0` — an empty inventory is an answer;
 *  - `…` while the first inventory read is still in flight;
 *  - `–` when the inventory could not be read at all, labelled "unavailable"
 *    for assistive tech, because "you have zero" and "we could not check" are
 *    different sentences.
 */

/** Canonical address of the Arcade Ticket, derived from issuer + `d`. */
const ARCADE_TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

interface ArcadeTicketBalanceProps {
  className?: string;
  /**
   * Keep the chip visible at a zero balance, with distinct loading and
   * unavailable states. The arcade HUD sets this; everywhere else keeps the
   * hide-at-zero bag convention.
   */
  showZero?: boolean;
}

export function ArcadeTicketBalance({ className, showZero = false }: ArcadeTicketBalanceProps) {
  const { data: inventory, isError } = useIslandInventory();
  const { data: catalog } = useItemCatalog();

  const ticket = useMemo(
    () =>
      toIslandEntries(inventory, catalog).find(
        (entry) => entry.address === ARCADE_TICKET_ADDRESS,
      ) ?? null,
    [inventory, catalog],
  );

  /**
   * A zero balance owns no inventory entry (`toIslandEntries` lists owned
   * items), so the persistent chip resolves the ticket's artwork the same way
   * the catalog would: published definition, bundled fallback, last-resort
   * placeholder.
   */
  const definition =
    ticket?.definition ??
    catalog?.byAddress.get(ARCADE_TICKET_ADDRESS) ??
    bundledFallbackDefinition(ARCADE_TICKET_ADDRESS) ??
    unknownItemDefinition(ARCADE_TICKET_ADDRESS);

  /**
   * The artwork is a REMOTE asset, so unlike the emoji it can fail to load
   * (asset host down, offline, blocked). The catalog's whole design is
   * "always degrade to something renderable", so a failed image degrades to the
   * emoji rather than leaving a broken-image glyph in the HUD.
   */
  const imageUrl = definition.image ?? null;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    // A different URL deserves a fresh attempt.
    setImageFailed(false);
  }, [imageUrl]);

  const loaded = Boolean(inventory);
  const quantity = ticket?.quantity ?? 0;

  if (!showZero && (!loaded || quantity <= 0)) return null;

  const state: 'ready' | 'loading' | 'unavailable' = loaded
    ? 'ready'
    : isError
      ? 'unavailable'
      : 'loading';
  const display = state === 'ready' ? String(quantity) : state === 'loading' ? '…' : '–';
  const label =
    state === 'ready'
      ? `${quantity} ${definition.name}${quantity === 1 ? '' : 's'}`
      : state === 'loading'
        ? `Loading your ${definition.name} balance`
        : `${definition.name} balance unavailable`;
  const showImage = Boolean(imageUrl) && !imageFailed;

  return (
    <div
      data-arcade-ticket-balance={state}
      title={label}
      aria-label={label}
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
        {display}
      </span>
    </div>
  );
}
