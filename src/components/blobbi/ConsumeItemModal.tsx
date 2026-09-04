import { useState, useMemo, useEffect } from 'react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus, Heart, Zap, Sparkles, Droplets, Sprout } from 'lucide-react';
import {
  primaryItemImageUrl,
  type ItemAction,
  type ResolvedBlobbiItemDefinition,
} from '@/inventory';

// Effect icons mapping
const EFFECT_ICONS = {
  hunger: Heart,
  energy: Zap,
  hygiene: Droplets,
  happiness: Sparkles,
  health: Heart,
} as const;

/**
 * What the primary button says, by what the item DOES. "Use" is the honest
 * fallback for an action without a better verb; a feed is the one a player
 * performs most, and "Feed Blobbi" says what is about to happen to whom.
 */
const ACTION_LABELS: Readonly<Record<ItemAction, string>> = {
  feed: 'Feed Blobbi',
  play: 'Play together',
  clean: 'Clean up',
  medicine: 'Give medicine',
  boost: 'Use',
};

/** The primary button's label for a definition's action. */
export function consumeActionLabel(action: ItemAction | null | undefined): string {
  return (action && ACTION_LABELS[action]) || 'Use';
}

interface ConsumeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolved catalog definition (fetched 31632 or bundled fallback). */
  definition: ResolvedBlobbiItemDefinition;
  /**
   * How many the player HAS, the number shown as "Available". For an item in
   * another game's inventory this is the live effective quantity, and it may
   * change while the dialog is open.
   */
  availableQuantity: number;
  /**
   * The most that may be SELECTED in this one operation. Defaults to
   * `availableQuantity`; a caller enforcing a per-operation cap passes less.
   * Never confused with what the player has.
   */
  maxQuantity?: number;
  onUseItem: (quantity: number) => void;
  isLoading?: boolean;
  loadingText?: string;
  /**
   * Where the item came from, when it came from another game: the product
   * name, "Nostr Farm". Rendered as "From Nostr Farm" beside the item so the
   * player sees that what they grew there is what they are about to use
   * here. Omitted for this game's own items, which need no provenance.
   */
  provenance?: string;
}

export function ConsumeItemModal({
  isOpen,
  onClose,
  definition,
  availableQuantity,
  maxQuantity: maxQuantityProp,
  onUseItem,
  isLoading = false,
  loadingText = 'Using...',
  provenance,
}: ConsumeItemModalProps) {
  const maxQuantity = Math.max(0, Math.min(maxQuantityProp ?? availableQuantity, availableQuantity));
  const [quantity, setQuantity] = useState(1);

  // A new operation starts at 1. Every caller today unmounts this dialog
  // between operations, but the selection must not depend on that: opening
  // it, or opening it for another item, resets what a previous item left.
  useEffect(() => {
    if (isOpen) setQuantity(1);
  }, [isOpen, definition.address]);

  // The available quantity is LIVE (another game's inventory can settle or
  // be spent elsewhere while this is open): never let the selection exceed
  // what can currently be used.
  useEffect(() => {
    setQuantity((current) => Math.max(1, Math.min(current, Math.max(1, maxQuantity))));
  }, [maxQuantity]);

  // An item-detail header is an unposed, compact context, so it shows the
  // item's PRIMARY image and never a pose-specific view.
  const imageUrl = primaryItemImageUrl(definition);

  // Calculate total effects based on quantity
  const totalEffects = useMemo(() => {
    const effects: Record<string, number> = {};
    Object.entries(definition.effects).forEach(([key, value]) => {
      if (typeof value === 'number') effects[key] = value * quantity;
    });
    return effects;
  }, [definition, quantity]);

  const handleQuantityChange = (newQuantity: number) => {
    setQuantity(Math.max(1, Math.min(maxQuantity, newQuantity)));
  };

  const handleUse = () => {
    onUseItem(quantity);
    onClose();
  };

  const handleClose = () => {
    setQuantity(1);
    onClose();
  };

  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && handleClose()}
      presentation="in-frame"
      size="sm"
      title="Use item"
      description={`How many ${definition.name} should your Blobbi have?`}
      icon={
        imageUrl ? (
          <img src={imageUrl} alt="" className="size-7 object-contain" />
        ) : (
          <span>{definition.emoji}</span>
        )
      }
      footer={
        <>
          <Button variant="soft" onClick={handleClose} className="min-h-[44px]">
            Cancel
          </Button>
          <Button
            variant="accent"
            onClick={handleUse}
            disabled={isLoading || maxQuantity < 1}
            className="min-h-[44px]"
          >
            {isLoading ? loadingText : consumeActionLabel(definition.action)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-panel border border-island-wood/20 bg-island-cream-2/60 p-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-island-wood/25 bg-island-cream text-3xl"
            >
              {imageUrl ? (
                <img src={imageUrl} alt="" className="size-11 object-contain" />
              ) : (
                definition.emoji
              )}
            </span>
            <div className="min-w-0">
              <h3 className="truncate font-bold text-island-ink">{definition.name}</h3>
              <p className="text-xs text-island-ink-soft" data-testid="consume-available">
                Available: {availableQuantity}
              </p>
              {provenance ? (
                <p
                  data-testid="consume-provenance"
                  className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-island-grass-dark/30 bg-island-grass-dark/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-island-grass-dark"
                >
                  <Sprout aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">From {provenance}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
            Quantity
          </h4>
          <div className="flex items-center gap-2">
            <Button
              variant="soft"
              size="icon"
              onClick={() => handleQuantityChange(quantity - 1)}
              disabled={quantity <= 1}
              className="size-11 shrink-0"
              aria-label="Decrease quantity"
            >
              <Minus className="size-4" />
            </Button>
            <Input
              type="number"
              value={quantity}
              onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
              min={1}
              max={maxQuantity}
              aria-label="Quantity"
              className="h-11 min-w-0 flex-1 rounded-xl border-island-wood/25 bg-island-cream-2/60 text-center text-base font-bold"
            />
            <Button
              variant="soft"
              size="icon"
              onClick={() => handleQuantityChange(quantity + 1)}
              disabled={quantity >= maxQuantity}
              className="size-11 shrink-0"
              aria-label="Increase quantity"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        {/*
          Two effect readouts, unchanged in meaning: what this many will do,
          and what one does. The totals lead because that is the number the
          player is actually choosing.
        */}
        <div className="space-y-2">
          <h4 className="text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
            Effect of {quantity}
          </h4>
          <div className="grid grid-cols-2 gap-1.5 rounded-panel border border-island-wood/20 bg-island-cream-2/60 p-3">
            {Object.entries(totalEffects).map(([effect, value]) => {
              const Icon = EFFECT_ICONS[effect as keyof typeof EFFECT_ICONS];
              return (
                <div key={effect} className="flex items-center gap-2">
                  {Icon && <Icon aria-hidden className="size-4 shrink-0 text-island-purple" />}
                  <span className="truncate text-sm font-semibold capitalize text-island-ink">
                    {value > 0 ? '+' : ''}
                    {value} {effect}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <details className="group rounded-panel border border-island-wood/20 bg-island-cream-2/40">
          <summary className="cursor-pointer list-none px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft marker:content-none">
            Per item
          </summary>
          <div className="space-y-1.5 px-3 pb-3">
            {Object.entries(definition.effects).map(([effect, value]) => {
              const Icon = EFFECT_ICONS[effect as keyof typeof EFFECT_ICONS];
              return (
                <div key={effect} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm text-island-ink-soft">
                    {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
                    <span className="capitalize">{effect}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-island-ink">
                    {value > 0 ? '+' : ''}
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </BlobbiModal>
  );
}
