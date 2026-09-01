import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { ItemTile } from '@/components/ui/item-tile';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { CoinAmount } from '../CoinAmount';
import {
  CLOTHING_STORE_PRODUCTS,
  OFFICIAL_WEARABLES,
  getQuantity,
  primaryItemImageUrl,
  useBatchPurchase,
  useIslandInventory,
  useItemCatalog,
  type ClothingStoreProduct,
} from '@/inventory';
import { useCoinBalance } from '@/inventory/useCoinWallet';
import { isEquippableSlot } from '@/placement/policy';

/**
 * The Clothing Store's shop window.
 *
 * Architecturally the Care Store's twin — one card, one Buy button, one line
 * handed to the shared {@link useBatchPurchase}, so the Coin debit and the item
 * grant land in ONE kind:31633 event. What differs is the merchandise, and the
 * merchandise changes two things:
 *
 *  1. **Wearables are unique.** Every official cosmetic publishes `max_stack: 1`,
 *     so a bought item shows `Owned` and can never be bought again. The button
 *     is only the polite half of that: the binding guard is a wallet
 *     PRECONDITION evaluated against the fresh authoritative inventory inside
 *     the lock, so a stale card cannot spend a second time.
 *  2. **Buying is not wearing.** Ownership is kind:31633; equipping is
 *     kind:31634. This modal writes only the first, and says so — the player
 *     dresses their Blobbi from the wardrobe afterwards, through exactly the
 *     path an Arcade prize already uses.
 *
 * ## The empty shelf is honest, not broken
 *
 * No official wearable has a Coin price yet: three are Arcade Prize Counter
 * items priced in Tickets and the fourth is reserved by its own definition. So
 * the shop shows what the store is FOR — the real wearables, resolved from the
 * canonical registry — and states plainly that they are not on sale here. That
 * is the shape the Prize Counter used while its own redemption was being
 * prepared, and it is better than a blank room or an invented price.
 */

interface ClothingStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** What a single card's Buy control is currently saying. */
type CardState =
  | 'buy'
  | 'purchasing'
  | 'owned'
  | 'unaffordable'
  | 'unavailable'
  | 'logged-out';

/** Human labels for the renderer's equipment slots. */
const SLOT_LABELS: Record<string, string> = {
  headwear: 'Headwear',
  eyewear: 'Eyewear',
  neckwear: 'Neckwear',
  back: 'Back',
  handheld: 'Handheld',
  'face-mark': 'Face marks',
  aura: 'Auras',
  'color-overlay': 'Overlays',
};

const ALL = 'all';

export function ClothingStoreModal({ isOpen, onClose }: ClothingStoreModalProps) {
  const { user } = useCurrentUser();
  const { balance, isLoading: balanceLoading } = useCoinBalance();
  const { data: catalog } = useItemCatalog();
  const inventory = useIslandInventory();
  const { mutateAsync: purchase } = useBatchPurchase();

  const [purchasingAddress, setPurchasingAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<string>(ALL);

  /**
   * The synchronous double-submit gate (the Care Store / Food Shop pattern).
   * `purchasingAddress` is state and only lands after a re-render, so two
   * clicks in one tick would both pass it; this ref flips before the first
   * `await`. It is first-line protection only — one debit per logical purchase
   * is the spend intent's job, and never buying a unique item twice is the
   * wallet precondition's.
   */
  const inFlightRef = useRef(false);

  /** Owned count for an item, or null while the inventory is unknown. */
  const ownedOf = (address: string): number | null =>
    inventory.data ? getQuantity(inventory.data, address) : null;

  /**
   * Which slot each product goes in, read from the resolved DEFINITION.
   *
   * Never from this file: `content.visual.slot` is the issuer's statement about
   * where a wearable belongs, and `placement/policy.ts` is what validates it
   * against the slots this renderer can actually draw. An item whose issuer
   * declared no usable slot is simply unsorted — it still sells, it just has no
   * category chip, which is honest about what the definition does and does not
   * say.
   */
  const slotByAddress = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of CLOTHING_STORE_PRODUCTS) {
      const declared = catalog?.byAddress.get(product.address)?.slot ?? undefined;
      if (isEquippableSlot(declared)) map.set(product.address, declared);
    }
    return map;
  }, [catalog]);

  const slots = useMemo(
    () => [...new Set(slotByAddress.values())],
    [slotByAddress],
  );

  const visible = useMemo(
    () =>
      slot === ALL
        ? CLOTHING_STORE_PRODUCTS
        : CLOTHING_STORE_PRODUCTS.filter(
            (p) => slotByAddress.get(p.address) === slot,
          ),
    [slot, slotByAddress],
  );

  const cardState = (
    product: ClothingStoreProduct,
    owned: number | null,
  ): CardState => {
    if (!catalog?.byAddress.get(product.address)) return 'unavailable';
    if (!user) return 'logged-out';
    if (purchasingAddress === product.address) return 'purchasing';
    if (owned !== null && owned >= product.maxStack) return 'owned';
    // A null balance is UNKNOWN, not zero: the card stays buyable-looking and
    // the wallet re-validates on spend.
    if (balance !== null && balance < product.price) return 'unaffordable';
    return 'buy';
  };

  const handleBuy = async (product: ClothingStoreProduct, owned: number | null) => {
    if (inFlightRef.current) return;
    if (!user) {
      setError('Sign in to shop at the Clothing Store.');
      return;
    }
    if (owned !== null && owned >= product.maxStack) return;
    if (balance !== null && balance < product.price) {
      setError(`You need ${product.price - balance} more Coins for ${product.name}.`);
      return;
    }

    inFlightRef.current = true;
    setError(null);
    setPurchasingAddress(product.address);
    try {
      const result = await purchase({
        lines: [{ address: product.address, quantity: 1 }],
      });
      if (result.outcome === 'stock-limit') {
        // The wallet refused on the fresh inventory: it is already owned, and
        // nothing was charged. Say the true thing rather than "failed".
        setError(`You already own ${product.name} — nothing was charged.`);
      } else if (result.outcome === 'blocked') {
        setError(
          `An earlier ${product.name} purchase is still being verified — nothing new was charged. Try again in a moment.`,
        );
      } else if (result.outcome === 'ambiguous') {
        setError(
          `That purchase could not be confirmed yet. Buying ${product.name} again checks this attempt first, so you cannot be charged twice for it.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      inFlightRef.current = false;
      setPurchasingAddress(null);
    }
  };

  if (!isOpen) return null;

  const shelfIsEmpty = CLOTHING_STORE_PRODUCTS.length === 0;

  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="lg"
      title="Clothing Store"
      description="Dress up your Blobbi."
      icon="👗"
      bodyClassName="flex min-h-0 flex-col gap-3 p-3 sm:p-4"
      footer={
        <Button variant="soft" onClick={onClose} className="min-h-[44px]">
          Done
        </Button>
      }
    >
      <div
        className="flex shrink-0 items-center justify-between gap-2 rounded-panel border border-island-wood/25 bg-island-cream-2/60 px-3 py-2"
        data-clothing-store-balance
      >
        <span className="text-xs font-bold uppercase tracking-wider text-island-ink-soft">
          Your Coins
        </span>
        <CoinAmount
          amount={balance}
          loading={balanceLoading}
          className="font-semibold text-island-warn"
        />
      </div>

      {!user && (
        <p role="status" className="shrink-0 text-center text-sm text-island-ink-soft">
          Sign in to buy clothing.
        </p>
      )}

      {error && (
        <p
          role="status"
          data-clothing-store-error
          className="shrink-0 rounded-panel bg-island-danger/10 px-3 py-2 text-center text-sm text-island-danger"
        >
          {error}
        </p>
      )}

      {slots.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Clothing type"
          className="flex shrink-0 gap-1.5 overflow-x-auto [scrollbar-width:thin]"
        >
          {[ALL, ...slots].map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={slot === key}
              data-clothing-store-slot-tab={key}
              onClick={() => setSlot(key)}
              className={cn(
                'min-h-[44px] shrink-0 rounded-full border-2 px-3 text-xs font-bold',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                slot === key
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-island-wood/30 bg-island-cream/70 text-island-ink',
              )}
            >
              {key === ALL ? 'All' : (SLOT_LABELS[key] ?? key)}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shelfIsEmpty ? (
          /*
            Nothing is priced in Coins yet. Rather than an empty box, show the
            real wearables this store is about and be explicit about why they
            are not on the shelf — the same honesty the Prize Counter showed
            while its redemption was being prepared.
          */
          <div data-clothing-store-empty className="space-y-3">
            <p
              role="status"
              className="rounded-2xl border-2 border-dashed border-island-wood/30 p-4 text-center text-sm text-island-ink-soft"
            >
              The rails are still being stocked — no clothing is on sale here
              yet. These are the wearables your Blobbi can own today.
            </p>
            <ul className="grid list-none grid-cols-2 gap-2.5 sm:grid-cols-3">
              {OFFICIAL_WEARABLES.map((wearable) => {
                const owned = ownedOf(wearable.address);
                return (
                  <li key={wearable.address} className="min-w-0">
                    <ItemTile
                      data-clothing-store-preview={wearable.address}
                      name={wearable.name}
                      quantity={owned ?? undefined}
                      art={
                        wearable.primaryImage ? (
                          <img src={wearable.primaryImage} alt="" />
                        ) : (
                          <span>{wearable.symbol}</span>
                        )
                      }
                      footnote={owned ? 'Owned' : 'Not for sale here yet'}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {visible.map((product) => {
              const definition = catalog?.byAddress.get(product.address);
              const owned = ownedOf(product.address);
              const state = cardState(product, owned);
              const imageUrl =
                primaryItemImageUrl(definition) ?? product.primaryImage ?? undefined;
              const itemSlot = slotByAddress.get(product.address);

              return (
                <ItemTile
                  key={product.address}
                  data-clothing-store-item={product.address}
                  name={definition?.name ?? product.name}
                  price={product.price}
                  affordable={balance === null || product.price <= balance}
                  quantity={owned ?? undefined}
                  selected={state === 'owned'}
                  art={
                    imageUrl ? (
                      <img src={imageUrl} alt="" />
                    ) : (
                      <span>{product.symbol}</span>
                    )
                  }
                  footnote={itemSlot ? (SLOT_LABELS[itemSlot] ?? itemSlot) : undefined}
                >
                  <Button
                    variant={state === 'owned' ? 'soft' : 'accent'}
                    onClick={() => void handleBuy(product, owned)}
                    // Every card goes dead while ANY purchase is in flight: the
                    // wallet takes one operation at a time.
                    disabled={
                      purchasingAddress !== null ||
                      state === 'owned' ||
                      state === 'unaffordable' ||
                      state === 'unavailable' ||
                      state === 'logged-out'
                    }
                    className="mt-1 min-h-[36px] w-full text-xs"
                    data-clothing-store-buy={product.address}
                    data-state={state}
                  >
                    {state === 'purchasing'
                      ? 'Purchasing…'
                      : state === 'owned'
                        ? 'Owned'
                        : state === 'unaffordable'
                          ? 'Not enough Coins'
                          : state === 'unavailable'
                            ? 'Unavailable'
                            : state === 'logged-out'
                              ? 'Sign in to buy'
                              : `Buy — ${product.price}`}
                  </Button>
                </ItemTile>
              );
            })}
          </div>
        )}
      </div>

      <p className="shrink-0 text-center text-[0.6875rem] text-island-ink-soft">
        Bought clothing goes to your inventory. Put it on from My Blobbi.
      </p>
    </BlobbiModal>
  );
}
