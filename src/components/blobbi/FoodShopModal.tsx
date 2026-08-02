import React, { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCoinBalance } from '@/inventory/useCoinWallet';
import { CoinAmount } from './CoinAmount';
import { useToast } from '@/hooks/useToast';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Minus, Plus } from 'lucide-react';
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



  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

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

  // Selected cart lines (quantity > 0), used both for the confirmation summary
  // and for the single batch purchase call.
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

  const handleConfirmPurchase = async () => {
    if (userCoins === null) {
      toast({
        title: 'Balance unavailable',
        description: 'Your Coin balance has not loaded yet.',
        variant: 'destructive',
      });
      return;
    }
    if (isPending) {
      // Guard against rapid double-submit.
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
    try {
      const result = await purchaseBatch({
        lines: selectedLines.map(({ address, quantity, unitPrice }) => ({
          address,
          quantity,
          unitPrice,
        })),
      });

      toast(
        result.outcome === 'applied'
          ? {
              title: 'Purchase Successful',
              description: `Spent ${result.totalCost} Blobbi Coins. Your items are in your inventory.`,
            }
          : {
              title: 'Purchase Not Confirmed',
              description:
                'The purchase could not be confirmed. It will be reconciled — nothing will be charged twice. Check your balance in a moment.',
              variant: 'destructive',
            },
      );
    } catch (err) {
      toast({
        title: 'Purchase Failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'destructive',
      });
      return;
    }

    setQuantities({});
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-2"
      onClick={handleBackdropClick}
      onPointerDown={(e) => e.stopPropagation()}
      data-overlay
      data-block-move
    >
      <div className="w-[95%] h-full max-w-lg blobbi-card-xl border-4 border-island-wood/30 rounded-lg shadow-lg theme-transition flex flex-col max-h-[85%]"
        role="dialog"
        aria-modal="true"
        data-block-move
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-island-wood/20 relative">
          <h2 className="text-xl sm:text-2xl font-bold text-center text-island-ink">
            🛒 Shop
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 h-8 w-8 rounded-full"
            data-block-move
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-3 pb-2 sm:p-4 sm:pb-2 flex-1 overflow-y-hidden flex flex-col">
          <ScrollArea className="flex-1 -mr-4 pr-4">
            <div className="space-y-4">

              {CATEGORY_ORDER.map(({ key, label }) => {

                const items = shopItems.filter((item) => item.category === key);

                if (items.length === 0) {

                  return null;

                }

                return (

                  <div key={key}>

                    <h3 className="font-bold text-sm mb-2 blobbi-text">

                      {label}

                    </h3>

                    <div className="grid grid-cols-2 gap-3">

                      {items.map((item) => (

                        <Card

                          key={item.address}

                          className="overflow-hidden blobbi-card blobbi-hover h-full"

                        >

                          <div className="w-auto h-20">

                            <CardHeader className="p-0 items-center justify-center h-full">

                              {item.imageUrl ? (

                                <img

                                  src={item.imageUrl}

                                  alt={item.name}

                                  className="object-cover"

                                />

                              ) : (

                                <span

                                  className="text-5xl"

                                  role="img"

                                  aria-label={item.name}

                                >

                                  {item.emoji}

                                </span>

                              )}

                            </CardHeader>

                          </div>

                          <CardContent className="p-2 pt-1 text-center">

                            <p className="font-bold blobbi-text">{item.name}</p>

                            <p className="icon-yellow font-semibold">

                              {item.price} coins

                            </p>

                          </CardContent>

                          <CardFooter className="p-2 pt-0">

                            <div className="flex items-center w-full gap-1">

                              <Button

                                variant="outline"

                                size="icon"

                                onClick={() => decrementQuantity(item.address)}

                                disabled={(quantities[item.address] ?? 0) <= 0}

                                className="h-9 w-9 min-w-[36px] shrink-0 blobbi-button border-island-wood/30 hover:bg-island-cream-2"

                                aria-label={`Decrease ${item.name} quantity`}

                              >

                                <Minus className="h-4 w-4" />

                              </Button>

                              <Input

                                type="number"

                                min="0"

                                value={quantities[item.address] || ''}

                                onChange={(event) =>

                                  handleQuantityChange(item.address, event.target.value)

                                }

                                placeholder="0"

                                className="flex-1 min-w-0 text-center blobbi-button border-island-wood/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"

                              />

                              <Button

                                variant="outline"

                                size="icon"

                                onClick={() => incrementQuantity(item.address)}

                                className="h-9 w-9 min-w-[36px] shrink-0 blobbi-button border-island-wood/30 hover:bg-island-cream-2"

                                aria-label={`Increase ${item.name} quantity`}

                              >

                                <Plus className="h-4 w-4" />

                              </Button>

                            </div>

                          </CardFooter>

                        </Card>

                      ))}

                    </div>

                  </div>

                );

              })}

            </div>
          </ScrollArea>

          <div className="mt-2 p-2 blobbi-card rounded-lg border-island-wood/30">
            {selectedLines.length > 0 && (
              <div className="mb-2 space-y-1 max-h-24 overflow-y-auto" data-testid="cart-summary">
                {selectedLines.map((line) => (
                  <div
                    key={line.address}
                    className="flex justify-between items-center text-sm blobbi-text"
                  >
                    <span className="truncate mr-2">
                      {line.name} <span className="blobbi-text-muted">× {line.quantity}</span>
                    </span>
                    <span className="icon-yellow font-semibold whitespace-nowrap">
                      {line.lineCost} coins
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="font-bold text-lg blobbi-text">Total Cost:</span>
              <span className="font-bold text-lg icon-yellow">{totalCost} coins</span>
            </div>
            <div className="text-right text-sm blobbi-text-muted">
              Your balance:{' '}
              <CoinAmount
                amount={userCoins}
                loading={balanceLoading}
                className="icon-yellow font-semibold"
              />
            </div>
            {!canAfford && <p className="text-island-danger text-sm text-center mt-2">You don't have enough coins!</p>}
          </div>
        </div>

        <div className="py-2 px-3 border-t border-island-wood/20 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="blobbi-button border-island-wood/40 hover:bg-island-cream-2">
            Cancel
          </Button>
          <Button
            onClick={handleConfirmPurchase}
            disabled={!canAfford || totalCost === 0 || isPending}
            className="bg-island-purple hover:bg-island-purple/90 text-white border-0 font-medium shadow-cozy-soft theme-transition"
          >
            {isPending ? 'Purchasing...' : 'Confirm Purchase'}
          </Button>
        </div>
      </div>
    </div>
  );
}
