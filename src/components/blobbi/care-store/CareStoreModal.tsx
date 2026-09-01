import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { ItemTile } from '@/components/ui/item-tile';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { CoinAmount } from '../CoinAmount';
import {
  CARE_STORE_CATEGORIES,
  CARE_STORE_CATEGORY_BLURBS,
  CARE_STORE_CATEGORY_LABELS,
  careStoreProductsFor,
  getQuantity,
  primaryItemImageUrl,
  useBatchPurchase,
  useIslandInventory,
  useItemCatalog,
  type CareStoreCategory,
  type CareStoreProduct,
} from '@/inventory';
import { useCoinBalance } from '@/inventory/useCoinWallet';
import { careItemPurpose } from './care-item-purpose';

/**
 * The Care Store's shop window.
 *
 * ## One item, one button — and why that is not the food shop
 *
 * The mall kiosk is a basket: a stepper per item and one confirmation at the
 * end, because a grocery run is many things at once. A care shop is not — you
 * come in because a Blobbi is dirty or hurt, you buy the one thing, you leave.
 * So every card carries its own Buy button and its own state, and there is no
 * cart to reconcile. That is a UX choice, not an architectural one: underneath,
 * a click is a one-line cart handed to the SAME {@link useBatchPurchase}, which
 * is what makes the Coin debit and the item grant land in one kind:31633 event.
 *
 * ## What this component is not allowed to do
 *
 * It resolves no prices (the purchase hook prices from the item's address), it
 * publishes nothing, it holds no ownership state, and it patches no balance. The
 * numbers on screen come from the shared inventory query, so a confirmed
 * purchase updates them because the shared cache updated — not because this
 * component wrote to itself. Every displayed price and total is presentation;
 * spendable truth is read inside the mutation boundary.
 */

interface CareStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** What a single card's Buy control is currently saying. */
type CardState =
  | 'buy'
  | 'purchasing'
  | 'purchased'
  | 'unaffordable'
  | 'at-limit'
  | 'unavailable'
  | 'logged-out';

export function CareStoreModal({ isOpen, onClose }: CareStoreModalProps) {
  const { user } = useCurrentUser();
  const { balance, isLoading: balanceLoading } = useCoinBalance();
  const { data: catalog } = useItemCatalog();
  const inventory = useIslandInventory();
  const { mutateAsync: purchase } = useBatchPurchase();

  /** The address currently being bought, or null. Drives every card's state. */
  const [purchasingAddress, setPurchasingAddress] = useState<string | null>(null);
  const [purchasedAddress, setPurchasedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The synchronous double-submit gate (the Food Shop / Arcade Pass pattern).
   *
   * `purchasingAddress` is React state and only takes effect after a re-render,
   * so two clicks in the same tick would both pass it. This ref flips before the
   * first `await` and is therefore the real guard; the disabled buttons are a
   * courtesy on top of it. It is first-line protection only — one-debit-per-
   * purchase is the spend intent's job inside `useBatchPurchase`.
   */
  const inFlightRef = useRef(false);

  /**
   * Which shelf is showing.
   *
   * Tabs rather than one long scroll, and for a reason the Prize Counter found
   * first: a shop cell that carries a name, a price, a purpose line and its own
   * Buy button is tall, and stacking two full categories pushes the second one
   * below a fold the player has no reason to expect. One shelf at a time keeps
   * every card reachable at every viewport, and matches how someone shops here —
   * they came for soap or they came for a bandage.
   */
  const [shelf, setShelf] = useState<CareStoreCategory>(CARE_STORE_CATEGORIES[0]);

  const products = useMemo(() => careStoreProductsFor(shelf), [shelf]);

  /** Owned count for an item, or null while the inventory is unknown. */
  const ownedOf = (address: string): number | null =>
    inventory.data ? getQuantity(inventory.data, address) : null;

  const cardState = (product: CareStoreProduct, owned: number | null): CardState => {
    if (!catalog?.byAddress.get(product.address)) return 'unavailable';
    if (!user) return 'logged-out';
    if (purchasingAddress === product.address) return 'purchasing';
    if (purchasedAddress === product.address) return 'purchased';
    if (
      product.stackLimit !== null &&
      owned !== null &&
      owned >= product.stackLimit
    ) {
      return 'at-limit';
    }
    // A null balance is UNKNOWN, not zero: the card stays buyable-looking and
    // the wallet re-validates on spend. An unavailable balance must never be
    // rendered as "you cannot afford this".
    if (balance !== null && balance < product.price) return 'unaffordable';
    return 'buy';
  };

  const handleBuy = async (product: CareStoreProduct, owned: number | null) => {
    if (inFlightRef.current) return;
    if (!user) {
      setError('Sign in to shop at the Care Store.');
      return;
    }
    if (
      product.stackLimit !== null &&
      owned !== null &&
      owned >= product.stackLimit
    ) {
      return;
    }
    if (balance !== null && balance < product.price) {
      setError(`You need ${product.price - balance} more Coins for ${product.name}.`);
      return;
    }

    inFlightRef.current = true;
    setError(null);
    setPurchasedAddress(null);
    setPurchasingAddress(product.address);
    try {
      // WHAT and HOW MANY only: the price is the purchase layer's to resolve
      // from the item's address. See the pricing boundary in useBatchPurchase.
      const result = await purchase({
        lines: [{ address: product.address, quantity: 1 }],
      });
      if (result.outcome === 'applied') {
        setPurchasedAddress(product.address);
      } else if (result.outcome === 'blocked') {
        setError(
          `An earlier ${product.name} purchase is still being verified — nothing new was charged. Try again in a moment.`,
        );
      } else {
        setError(
          `That purchase could not be confirmed yet. Buying ${product.name} again checks this attempt first, so you cannot be charged twice for it.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      // Released on EVERY outcome, so a deliberate retry is always possible —
      // that retry is how an unresolved operation reconciles without a second
      // debit.
      inFlightRef.current = false;
      setPurchasingAddress(null);
    }
  };

  if (!isOpen) return null;

  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="lg"
      title="Care Store"
      description="Soap, bandages, and something to play with."
      icon="🩺"
      bodyClassName="flex min-h-0 flex-col gap-3 p-3 sm:p-4"
      footer={
        <Button variant="soft" onClick={onClose} className="min-h-[44px]">
          Done
        </Button>
      }
    >
      <div
        className="flex shrink-0 items-center justify-between gap-2 rounded-panel border border-island-wood/25 bg-island-cream-2/60 px-3 py-2"
        data-care-store-balance
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
          Sign in to buy care items.
        </p>
      )}

      {error && (
        <p
          role="status"
          data-care-store-error
          className="shrink-0 rounded-panel bg-island-danger/10 px-3 py-2 text-center text-sm text-island-danger"
        >
          {error}
        </p>
      )}

      {/* The two shelves. A radiogroup, not tablist: this picks WHICH set of
          cards is on show, it does not switch between panels of unrelated UI. */}
      <div
        role="radiogroup"
        aria-label="Care Store shelf"
        className="flex shrink-0 gap-1.5 overflow-x-auto [scrollbar-width:thin]"
      >
        {CARE_STORE_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            role="radio"
            aria-checked={shelf === category}
            data-care-store-shelf-tab={category}
            onClick={() => setShelf(category)}
            className={cn(
              'min-h-[44px] shrink-0 rounded-full border-2 px-3 text-xs font-bold',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
              shelf === category
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-island-wood/30 bg-island-cream/70 text-island-ink',
            )}
          >
            {CARE_STORE_CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>

      {/*
        A plain overflow container rather than `ScrollArea`, matching the Prize
        Counter's shelf: the Radix viewport needs a definite height to scroll,
        and inside this frame it grows to its content instead (the mall kiosk
        clips the same way today).
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section data-care-store-shelf={shelf}>
          <p className="mb-2 text-xs text-island-ink-soft">
            {CARE_STORE_CATEGORY_BLURBS[shelf]}
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {products.map((product) => {
                  const definition = catalog?.byAddress.get(product.address);
                  const owned = ownedOf(product.address);
                  const state = cardState(product, owned);
                  const imageUrl = primaryItemImageUrl(definition);
                  const purpose = careItemPurpose(
                    definition?.description,
                    definition?.effects ?? {},
                  );

                  return (
                    <ItemTile
                      key={product.address}
                      data-care-store-item={product.address}
                      name={definition?.name ?? product.name}
                      price={product.price}
                      affordable={balance === null || product.price <= balance}
                      quantity={owned ?? undefined}
                      selected={state === 'purchased'}
                      art={
                        imageUrl ? (
                          <img src={imageUrl} alt="" />
                        ) : (
                          <span>{definition?.emoji ?? '🧴'}</span>
                        )
                      }
                      footnote={purpose}
                    >
                      <Button
                        variant={state === 'purchased' ? 'soft' : 'accent'}
                        onClick={() => void handleBuy(product, owned)}
                        // Every card's button goes dead while ANY purchase is in
                        // flight: the wallet takes one operation at a time, and a
                        // second click during the first is never what was meant.
                        disabled={
                          purchasingAddress !== null ||
                          state === 'unaffordable' ||
                          state === 'at-limit' ||
                          state === 'unavailable' ||
                          state === 'logged-out'
                        }
                        className={cn('mt-1 min-h-[36px] w-full text-xs')}
                        data-care-store-buy={product.address}
                        data-state={state}
                      >
                        {state === 'purchasing'
                          ? 'Purchasing…'
                          : state === 'purchased'
                            ? 'Purchased ✓'
                            : state === 'unaffordable'
                              ? 'Not enough Coins'
                              : state === 'at-limit'
                                ? 'Max owned'
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
        </section>
      </div>

      <p className="shrink-0 text-center text-[0.6875rem] text-island-ink-soft">
        Everything you buy goes straight into your inventory.
      </p>
    </BlobbiModal>
  );
}
