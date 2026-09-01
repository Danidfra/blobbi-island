import React, { useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCoinBalance } from '@/inventory/useCoinWallet';
import { CoinAmount } from './CoinAmount';
import { useToast } from '@/hooks/useToast';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { ItemTile, PriceTag } from '@/components/ui/item-tile';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Minus, Plus } from 'lucide-react';
import {
  SHOP_ENTRIES,
  primaryItemImageUrl,
  useItemCatalog,
  useBatchPurchase,
} from '@/inventory';
import {
  ITEM_CATEGORIES,
  type ItemCategoryName,
} from '@/protocol/event-registry';

interface FoodShopModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Section titles for shop categories. */
const CATEGORY_LABELS: Record<ItemCategoryName, string> = {
  food: 'Food',
  toy: 'Toys',
  medicine: 'Medicine',
  hygiene: 'Hygiene',
  energy: 'Energy',
  currency: 'Currency',
};

/**
 * Bundled artwork for the five food items, used when their definitions carry no
 * `image` tag of their own — which is the case for all 20 published official
 * definitions today.
 *
 * These are INFERRED local paths, not published facts, so a definition's own
 * primary image outranks them (see `docs/game-item-image-views.md`). Every other
 * category has no bundled artwork and renders its emoji.
 */
const FOOD_IMAGES: Record<string, string> = {
  food_apple: '/assets/items/food/apple.png',
  food_pizza: '/assets/items/food/pizza.png',
  food_burger: '/assets/items/food/burger.png',
  food_cake: '/assets/items/food/cake.png',
  food_sushi: '/assets/items/food/sushi.png',
};

export function FoodShopModal({ isOpen, onClose }: FoodShopModalProps) {
  const { balance: userCoins, isLoading: balanceLoading } = useCoinBalance();
  const { data: catalog } = useItemCatalog();
  const { mutateAsync: purchaseBatch, isPending } = useBatchPurchase();
  const { toast } = useToast();

  const [quantities, setQuantities] = useState<Record<string, number>>({});



  /*
    Escape is BlobbiModal's (Radix's) job now, and it closes only the topmost
    surface. The `document`-level listener that used to be here fired even
    while the confirm dialog was on top of the shop.
  */

  // General store: sell all official items, grouped by category. Kept minimal —
  // food keeps its images; other categories use their emoji.
  //
  // A shop card is a compact, unposed cell, so it asks for the definition's
  // PRIMARY image and never a pose-specific view: a `back` marker exists to
  // dress a Blobbi seen from behind, not to sell an item. Published artwork
  // outranks the bundled local path below it.
  const shopItems = useMemo(() => {
    return SHOP_ENTRIES.map((entry) => {
      const def = catalog?.byAddress.get(entry.address);
      return {
        address: entry.address,
        itemId: entry.itemId,
        name: def?.name ?? entry.itemId,
        emoji: def?.emoji ?? '📦',
        category: def?.category ?? 'unknown',
        imageUrl: primaryItemImageUrl(def) ?? FOOD_IMAGES[entry.itemId],
        price: entry.price,
      };
    });
  }, [catalog]);

  /**
   * Display order for shop sections.
   *
   * Derived from the canonical category list so a category added to the
   * registry can never be silently DROPPED from the shop: an unlabelled
   * category still gets a section (titled by its own name) rather than
   * disappearing. In practice the shop only ever contains purchasable items —
   * `SHOP_ENTRIES` excludes anything with no coin price, so currency never
   * appears here and its section renders as nothing.
   */
  const CATEGORY_ORDER: { key: string; label: string }[] = useMemo(
    () =>
      ITEM_CATEGORIES.map((key) => ({
        key,
        label: CATEGORY_LABELS[key],
      })),
    [],
  );

  const totalCost = useMemo(() => {
    return Object.entries(quantities).reduce((total, [address, quantity]) => {
      const item = shopItems.find(i => i.address === address);
      return total + (item?.price ?? 0) * quantity;
    }, 0);
  }, [quantities, shopItems]);

  // Selected cart lines (quantity > 0).
  //
  // `unitPrice`/`lineCost` here are for the on-screen summary ONLY. They come
  // from the same canonical catalog the purchase hook prices against, so the
  // numbers agree — but the hook resolves its own prices from the item
  // addresses and never accepts these. Display value is not spendable truth.
  const selectedLines = useMemo(() => {
    return Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([address, quantity]) => {
        const item = shopItems.find(i => i.address === address);
        const unitPrice = item?.price ?? 0;
        return {
          address,
          name: item?.name ?? address,
          quantity,
          unitPrice,
          lineCost: unitPrice * quantity,
        };
      });
  }, [quantities, shopItems]);

  // A null balance is UNKNOWN, not zero: purchases stay disabled until the
  // canonical inventory balance loads. The wallet re-validates on spend
  // anyway — this is presentation-side honesty, not the guard.
  const canAfford = userCoins !== null && userCoins >= totalCost;

  const handleQuantityChange = (address: string, value: string) => {
    const quantity = parseInt(value, 10);
    if (!isNaN(quantity) && quantity >= 0) {
      setQuantities(prev => ({ ...prev, [address]: quantity }));
    }
  };

  const incrementQuantity = (address: string) => {
    setQuantities(prev => ({ ...prev, [address]: (prev[address] ?? 0) + 1 }));
  };

  const decrementQuantity = (address: string) => {
    setQuantities(prev => {
      const current = prev[address] ?? 0;
      if (current <= 0) return prev;
      return { ...prev, [address]: current - 1 };
    });
  };

  /**
   * Synchronous double-submit guard (the ArcadePassModal pattern).
   *
   * `isPending` only becomes true after React re-renders, so two confirms
   * landing in the same tick both pass it and both start a purchase. The ref
   * flips synchronously before the first `await` and is therefore the actual
   * gate; the disabled button and `isPending` are UI courtesies on top of it.
   * It is FIRST-LINE protection only — financial retry safety (one debit per
   * logical purchase) is the spend intent's job, not this ref's.
   */
  const inFlightRef = useRef(false);

  const handleConfirmPurchase = async () => {
    if (inFlightRef.current) return;
    if (userCoins === null) {
      toast({
        title: 'Balance unavailable',
        description: 'Your Coin balance has not loaded yet.',
        variant: 'destructive',
      });
      return;
    }
    if (isPending) {
      // UI-state courtesy on top of the synchronous ref above.
      return;
    }
    if (selectedLines.length === 0 || totalCost === 0) {
      toast({ title: 'Empty Cart', description: 'Please select items to buy.', variant: 'destructive' });
      return;
    }
    if (!canAfford) {
      toast({ title: 'Not Enough Coins', description: 'You cannot afford these items.', variant: 'destructive' });
      return;
    }

    // ONE true multi-item purchase: a single canonical inventory event
    // carrying the total Coin deduction AND every item grant — atomic since
    // the Coin cutover.
    inFlightRef.current = true;
    try {
      // Only what the purchase layer should trust: WHAT and HOW MANY. The
      // price of each item is the hook's to resolve from the catalog.
      const result = await purchaseBatch({
        lines: selectedLines.map(({ address, quantity }) => ({ address, quantity })),
      });

      toast(
        result.outcome === 'applied'
          ? {
              title: 'Purchase Successful',
              description: `Spent ${result.totalCost} Blobbi Coins. Your items are in your inventory.`,
            }
          : result.outcome === 'stock-limit'
            ? {
                title: 'Already at the Limit',
                description:
                  'One of these items is already at its maximum — nothing was charged.',
                variant: 'destructive',
              }
            : result.outcome === 'blocked'
            ? {
                title: 'Previous Purchase Still Unresolved',
                description:
                  'Your earlier attempt at this purchase is still being verified — nothing new was charged. Try again in a moment.',
                variant: 'destructive',
              }
            : {
                title: 'Purchase Not Confirmed',
                description:
                  'The purchase could not be confirmed yet. Confirming the same basket again checks this attempt first, so you cannot be charged twice for it.',
                variant: 'destructive',
              },
      );
      if (result.outcome !== 'applied') {
        // Keep the basket: confirming it again is the safe retry that reuses
        // the same operation. Only a definitive purchase clears it.
        return;
      }
    } catch (err) {
      toast({
        title: 'Purchase Failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'destructive',
      });
      return;
    } finally {
      // Released on EVERY outcome — success, ambiguous/blocked, failure —
      // because a deliberate later confirm must always be possible: that
      // retry is exactly how the spend intent reconciles an unresolved
      // operation without a second debit.
      inFlightRef.current = false;
    }

    setQuantities({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="lg"
      title="Shop"
      description="Tap − and + to build a basket, then confirm."
      icon="🛒"
      bodyClassName="flex min-h-0 flex-col gap-3 p-3 sm:p-4"
      footer={
        <>
          <Button variant="soft" onClick={onClose} className="min-h-[44px]">
            Cancel
          </Button>
          <Button
            variant="accent"
            onClick={handleConfirmPurchase}
            disabled={!canAfford || totalCost === 0 || isPending}
            className="min-h-[44px]"
          >
            {isPending ? 'Purchasing…' : 'Confirm Purchase'}
          </Button>
        </>
      }
    >
      <ScrollArea className="-mr-3 min-h-0 flex-1 pr-3">
        <div className="space-y-4">
          {CATEGORY_ORDER.map(({ key, label }) => {
            const items = shopItems.filter((item) => item.category === key);
            if (items.length === 0) return null;
            return (
              <section key={key}>
                <h3 className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
                  {label}
                </h3>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {items.map((item) => {
                    const quantity = quantities[item.address] ?? 0;
                    return (
                      <ItemTile
                        key={item.address}
                        name={item.name}
                        price={item.price}
                        affordable={userCoins === null || item.price <= userCoins}
                        selected={quantity > 0}
                        quantity={quantity}
                        art={
                          item.imageUrl ? (
                            <img src={item.imageUrl} alt="" />
                          ) : (
                            <span>{item.emoji}</span>
                          )
                        }
                      >
                        {/* The stepper lives INSIDE the tile rather than the
                            tile being a button: a shop cell has two controls,
                            so making the whole cell clickable would nest them. */}
                        <div className="mt-1 flex w-full items-center gap-1">
                          <Button
                            variant="soft"
                            size="icon"
                            onClick={() => decrementQuantity(item.address)}
                            disabled={quantity <= 0}
                            className="size-9 shrink-0"
                            aria-label={`Decrease ${item.name} quantity`}
                          >
                            <Minus className="size-4" />
                          </Button>
                          <Input
                            type="number"
                            min="0"
                            value={quantities[item.address] || ''}
                            onChange={(event) =>
                              handleQuantityChange(item.address, event.target.value)
                            }
                            placeholder="0"
                            aria-label={`${item.name} quantity`}
                            className="h-9 min-w-0 flex-1 rounded-lg border-island-wood/25 bg-island-cream-2/60 text-center text-sm font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <Button
                            variant="soft"
                            size="icon"
                            onClick={() => incrementQuantity(item.address)}
                            className="size-9 shrink-0"
                            aria-label={`Increase ${item.name} quantity`}
                          >
                            <Plus className="size-4" />
                          </Button>
                        </div>
                      </ItemTile>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </ScrollArea>

      {/* The basket. Sticks below the scroller so the running total is always
          visible while the player is still adding things. */}
      <div className="shrink-0 rounded-panel border border-island-wood/25 bg-island-cream-2/60 p-3">
        {selectedLines.length > 0 && (
          <div className="mb-2 max-h-24 space-y-1 overflow-y-auto" data-testid="cart-summary">
            {selectedLines.map((line) => (
              <div
                key={line.address}
                className="flex items-center justify-between text-sm text-island-ink"
              >
                <span className="mr-2 truncate">
                  {line.name} <span className="text-island-ink-soft">× {line.quantity}</span>
                </span>
                <PriceTag amount={line.lineCost} className="whitespace-nowrap" />
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-island-wood/20 pt-2">
          <span className="text-sm font-bold text-island-ink">Total</span>
          <PriceTag amount={totalCost} affordable={canAfford} className="text-base" />
        </div>
        <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-island-ink-soft">
          Your balance:
          <CoinAmount
            amount={userCoins}
            loading={balanceLoading}
            className="font-semibold text-island-warn"
          />
        </div>
        {!canAfford && (
          <p role="status" className="mt-2 text-center text-sm text-island-danger">
            You don&apos;t have enough coins.
          </p>
        )}
      </div>
    </BlobbiModal>
  );
}
