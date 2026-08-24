import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Coins, Cookie, HeartPulse, PackageOpen, Shirt, ToyBrick } from 'lucide-react';
import type { AccessorySlot } from '@blobbi/react';

import { Button } from '@/components/ui/button';
import { ItemTile } from '@/components/ui/item-tile';
import { Slider } from '@/components/ui/slider';
import { StateCard } from '@/components/ui/state-card';
import { cn } from '@/lib/utils';
import { explainUnavailable } from '@/placement/useEquippableCosmetics';
import type { PlacementTransformPatch } from '@/placement/useEquipmentMutation';

import { useToast } from '@/hooks/useToast';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useUseItem } from '@/inventory';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';

import { ConsumeItemModal } from '../ConsumeItemModal';
import { CollectionGrid } from './CollectionGrid';
import { ItemArt } from './ItemArt';
import {
  CATEGORY_LABELS,
  useInventoryCollection,
  type CollectionCategory,
  type CollectionEntry,
} from './useInventoryCollection';

/**
 * InventoryBrowser — the island's collection of things, and the one place to
 * look at them.
 *
 * ## What this replaced, and why
 *
 * Two stacked panels — `Wearables` over `Items` — each with its own header,
 * its own nested tabs, its own empty state and its own idea of what a tile
 * looks like. It worked, and it read like an admin screen: a player scrolled
 * past a wardrobe to reach a sandwich, every tile carried a name, a slot, a
 * count and a badge, and the transform sliders sat permanently under a list
 * whether or not anything was selected.
 *
 * The reference study (`docs/blobbi-inventory-design.md`) pointed at the same
 * answer from four different games: **art-first tiles in one grid, categories
 * as a filter, and detail on selection.** That is what this is.
 *
 * ```
 *   [ Wearables · Food · Toys · Care · Coins ]     ← filter, not sections
 *   ┌──────────────────────────┬───────────────┐
 *   │  ▣ ▣ ▣ ▣                 │  selected     │  ← desktop
 *   │  ▣ ▣ ▣ ▣                 │  art, name,   │
 *   │                          │  one action   │
 *   └──────────────────────────┴───────────────┘
 * ```
 *
 * On a phone the detail panel moves beneath the grid rather than being squeezed
 * into a sidebar, which is the one place a desktop-first classic would have got
 * it wrong.
 *
 * ## One collection language, two verbs
 *
 * Cosmetics and consumables look alike and behave differently. That is the
 * point: they are all *my things*, and what changes is the verb — **Wear** /
 * **Take off** versus **Use**. The verb lives in the detail panel, where there
 * is room to say what it will do, rather than on every tile.
 *
 * ## What this does NOT decide
 *
 * Nothing. Which cosmetics may be worn is `placement/policy.ts`' answer via
 * `useEquippableCosmetics`; using an item is `useUseItem`'s; equipping is the
 * caller's `onEquip`. This component publishes nothing and grants nothing — it
 * is a view over `useInventoryCollection` with a selection on top.
 */

const CATEGORY_ICONS: Readonly<Record<CollectionCategory, React.ElementType>> = {
  wearable: Shirt,
  food: Cookie,
  toy: ToyBrick,
  care: HeartPulse,
  currency: Coins,
};

export interface InventoryBrowserProps {
  characterId: string | undefined;
  /**
   * Which categories this browser is responsible for.
   *
   * The window shows wearables in the WARDROBE and everything else in ITEMS,
   * because wearing a hat and eating a sandwich are not the same activity —
   * one is customization with the Blobbi as feedback, the other is care. One
   * collection model still backs both (`useInventoryCollection`); this is the
   * lens each surface looks at it through.
   */
  categories?: readonly CollectionCategory[];
  /** Hide the chip strip when the surface has only one category to show. */
  hideCategoryStrip?: boolean;
  /** Copy for the empty state, when the surface's own wording fits better. */
  emptyTitle?: string;
  emptyMessage?: string;
  /** Current Blobbi form/stage; gates form-restricted cosmetics. */
  form?: string | undefined;
  /** Blobbi id, for the consume flow. */
  petId?: string | undefined;
  /** Slot selected for transform editing, shared with the stage overlay. */
  selectedSlot?: AccessorySlot | null;
  onSelectSlot?: (slot: AccessorySlot | null) => void;
  pendingUpdates?: Record<string, PlacementTransformPatch>;
  onTransformChange?: (slot: AccessorySlot, patch: PlacementTransformPatch) => void;
  onSaveTransforms?: () => void;
  onEquip: (address: string, slot: AccessorySlot) => void;
  onUnequip: (slot: AccessorySlot) => void;
  /** A publish that failed, surfaced rather than swallowed. */
  publishError?: string | null;
  isPublishing?: boolean;
  className?: string;
}

export function InventoryBrowser({
  characterId,
  form,
  categories: allowed,
  hideCategoryStrip = false,
  emptyTitle,
  emptyMessage,
  selectedSlot,
  onSelectSlot,
  pendingUpdates = {},
  onTransformChange,
  onSaveTransforms,
  onEquip,
  onUnequip,
  publishError,
  isPublishing = false,
  className,
}: InventoryBrowserProps) {
  const full = useInventoryCollection({ characterId, form });
  // The collection, narrowed to what this surface is responsible for.
  const collection = useMemo(() => {
    if (!allowed) return full;
    const entries = full.entries.filter((e) => allowed.includes(e.category));
    return {
      ...full,
      entries,
      categories: full.categories.filter((c) => allowed.includes(c)),
      // The wearables surface owns the cosmetic diagnostics; the items surface
      // has nothing to say about a hat it does not show.
      unavailable: allowed.includes('wearable') ? full.unavailable : [],
      warnings: allowed.includes('wearable') ? full.warnings : [],
    };
  }, [full, allowed]);

  const [category, setCategory] = useState<CollectionCategory | 'all'>('all');
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [consumeOpen, setConsumeOpen] = useState(false);

  const { status } = useOptimizedStatus();
  const { mutate: consumeItem, isPending: isConsuming } = useUseItem();
  const { toast } = useToast();

  const visible = useMemo(
    () =>
      category === 'all'
        ? collection.entries
        : collection.entries.filter((e) => e.category === category),
    [collection.entries, category],
  );

  const selected = useMemo(
    () => collection.entries.find((e) => e.address === selectedAddress) ?? null,
    [collection.entries, selectedAddress],
  );

  /** What the grid and its page controls are called, for assistive tech. */
  const gridLabel =
    category === 'all' ? 'your items' : CATEGORY_LABELS[category].toLowerCase();

  // Everything the player might want explained, counted once.
  const issueCount = collection.unavailable.length + collection.warnings.length;

  /*
    Keep the selection honest.

    An item can leave the collection while it is selected — the last one is
    used up, a cosmetic stops fitting after a life stage change, a filter hides
    it. Holding a stale selection would leave the detail panel describing
    something the player no longer has.
  */
  useEffect(() => {
    if (selectedAddress && !collection.entries.some((e) => e.address === selectedAddress)) {
      setSelectedAddress(null);
    }
  }, [collection.entries, selectedAddress]);

  useEffect(() => {
    if (selected && category !== 'all' && selected.category !== category) {
      setSelectedAddress(null);
    }
  }, [category, selected]);

  /*
    Selecting shows an item; ADJUSTING arms its slot.

    The armed slot drives the stage's drag handles and the transform sliders,
    and it used to be armed by mere selection — so looking at a worn hat put the
    editor on screen and 120px of controls into the layout. Now the detail
    panel offers "Adjust", and only that arms it. Selecting anything else
    disarms, because the overlay must never keep handles on an item nobody is
    looking at.
  */
  const select = (entry: CollectionEntry) => {
    setSelectedAddress(entry.address === selectedAddress ? null : entry.address);
    onSelectSlot?.(null);
  };

  /**
   * Use a consumable. Lifted verbatim from the panel this replaced — the
   * redesign changes where the action is offered, never what it does.
   */
  const handleUse = (entry: CollectionEntry, quantity: number) => {
    if (!status.currentPet) {
      toast({
        title: 'No Blobbi Selected',
        description: 'Please select a Blobbi first.',
        variant: 'destructive',
      });
      return;
    }
    consumeItem(
      {
        address: entry.address,
        definition: entry.definition,
        petId: status.currentPet.id,
        quantity,
      },
      {
        onSuccess: (result) => {
          toast({
            title: 'Item Used',
            description: `Used ${quantity} ${entry.definition.name}(s) on ${
              status.currentPet ? getBlobbiDisplayName(status.currentPet) : 'your Blobbi'
            }.${result.warning ? ` (${result.warning})` : ''}`,
          });
          setConsumeOpen(false);
        },
        onError: (error) => {
          toast({
            title: 'Could Not Use Item',
            description: error.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  /*
    `isLoading` is deliberately NOT an early return.

    Three queries feed this browser — the catalog, the placement document and
    the inventory — and blanking the whole tab until the slowest settles hides
    the diagnostics below, which are the honest explanation for why a cosmetic
    is missing. The spinner belongs where the grid goes, and nowhere else.
  */
  const isEmpty = collection.entries.length === 0;

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)} data-testid="inventory-panel">
      {publishError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-island-danger/30 bg-island-danger/10 p-2.5 text-xs"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-island-danger" />
          <div>
            <p className="font-semibold text-island-danger">Could not save</p>
            <p className="text-island-ink-soft">{publishError}</p>
          </div>
        </div>
      )}

      {collection.isLoading && isEmpty ? (
        <StateCard kind="loading" compact title="Opening your things…" />
      ) : isEmpty ? (
        <StateCard
          kind="empty"
          compact
          title={
            emptyTitle ??
            (collection.catalogIsEmpty ? 'Nothing to collect yet' : 'Your bag is empty')
          }
          message={
            emptyMessage ??
            (collection.catalogIsEmpty
              ? 'Items appear here once the official issuer publishes them — nothing is shown from local data.'
              : 'Buy something from the shop and it will show up here.')
          }
        />
      ) : (
        <>
          {/* ── Category strip ─────────────────────────────────────────────
              A filter over one grid, not headings over stacked sections. A
              category with nothing in it is not offered, and a surface with
              only one category does not need a filter at all. */}
          {!hideCategoryStrip && collection.categories.length > 1 && (
          <div
            role="tablist"
            aria-label="Item categories"
            className="-mx-0.5 flex shrink-0 gap-1.5 overflow-x-auto px-0.5 pb-1 scrollbar-thin"
          >
            <CategoryChip
              active={category === 'all'}
              onClick={() => setCategory('all')}
              icon={PackageOpen}
              label="All"
              count={collection.entries.length}
            />
            {collection.categories.map((key) => (
              <CategoryChip
                key={key}
                active={category === key}
                onClick={() => setCategory(key)}
                icon={CATEGORY_ICONS[key]}
                label={CATEGORY_LABELS[key]}
                count={collection.entries.filter((e) => e.category === key).length}
              />
            ))}
          </div>
          )}

          <div className="flex min-h-0 flex-col gap-3 lg:flex-row lg:items-start">
            {/* ── The grid ──────────────────────────────────────────────────
                BOUNDED and paged. Owning more hats must not make the window
                taller — the window is a character card, not a document. See
                `CollectionGrid` for where the page size comes from. */}
            <CollectionGrid
              className="min-w-0 flex-1"
              items={visible}
              keyOf={(entry) => entry.address}
              resetKey={category}
              label={gridLabel}
              renderItem={(entry) => (
                <ItemTile
                  role="option"
                  aria-selected={entry.address === selectedAddress}
                  data-testid={`item-${entry.address}`}
                  {...(entry.equipped ? { 'data-equipped': entry.slot } : {})}
                  {...(entry.category === 'currency'
                    ? { 'data-readonly-item': entry.address }
                    : {})}
                  name={entry.definition.name}
                  quantity={entry.quantity}
                  selected={entry.address === selectedAddress}
                  onClick={() => select(entry)}
                  art={<ItemArt definition={entry.definition} />}
                  className={cn(
                    /* Rarity as a RIM, never a fill: a saturated card
                       background would fight every theme and drown the art the
                       tile exists to show. */
                    entry.definition.rarity === 'legendary' && 'ring-1 ring-island-warn/60',
                    entry.definition.rarity === 'epic' && 'ring-1 ring-island-purple/50',
                    entry.equipped && 'border-island-grass-dark/50',
                  )}
                  footnote={
                    entry.equipped ? (
                      <span className="font-semibold text-island-grass-dark">Worn</span>
                    ) : undefined
                  }
                />
              )}
            />

            {/* ── Detail ────────────────────────────────────────────────────
                Beneath the grid on a phone, beside it from `lg` up. A squeezed
                sidebar on a 375px sheet is the one thing the desktop-first
                classics got wrong for touch.

                RESERVED HEIGHT. The prompt and the panel occupy the same box,
                so choosing an item swaps its contents rather than making the
                tab 150px taller — which on a phone is the difference between
                fitting and scrolling. */}
            <div className="min-h-[7.5rem] shrink-0 lg:min-h-0 lg:w-[15rem] xl:w-[17rem]">
              {selected ? (
                <ItemDetail
                  entry={selected}
                  isPublishing={isPublishing}
                  adjusting={!!selected.slot && selectedSlot === selected.slot}
                  onAdjust={(slot) => onSelectSlot?.(slot)}
                  pendingUpdates={pendingUpdates}
                  onTransformChange={onTransformChange}
                  onSaveTransforms={onSaveTransforms}
                  onEquip={onEquip}
                  onUnequip={onUnequip}
                  onUse={() => setConsumeOpen(true)}
                />
              ) : (
                <p className="rounded-panel border border-dashed border-island-wood/30 p-4 text-center text-xs text-island-ink-soft">
                  Pick something to see what it does.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Diagnostics ──────────────────────────────────────────────────────
          ONE line when there is anything to say, and zero height when there is
          not. It used to be two stacked blocks, each with its own summary, each
          costing vertical space in the common case where a player has no
          problems at all. Opening it is the escape hatch the scroll policy
          allows: the disclosure itself may scroll, the tab may not. */}
      {issueCount > 0 && (
        <details
          data-testid="inventory-diagnostics"
          className="shrink-0 rounded-panel border border-island-warn/40 bg-island-warn/10 text-xs"
        >
          <summary className="cursor-pointer px-2.5 py-1.5 font-medium text-island-ink">
            <AlertTriangle aria-hidden className="mr-1 inline size-3.5 text-island-warn" />
            {issueCount} item {issueCount === 1 ? 'issue' : 'issues'}
          </summary>
          <div className="max-h-40 overflow-y-auto border-t border-island-warn/30 px-2.5 py-2">
            {collection.unavailable.length > 0 && (
              <ul className="space-y-1">
                {collection.unavailable.map((item) => (
                  <li key={item.address} className="text-island-ink-soft">
                    <span className="font-medium text-island-ink">
                      {item.definition?.name ?? item.address}
                    </span>{' '}
                    — {explainUnavailable(item.reason)}
                  </li>
                ))}
              </ul>
            )}
            {collection.warnings.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-island-ink-soft">
                {collection.warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`}>
                    <code>{w.code}</code> — {w.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}

      {selected?.islandEntry && selected.action === 'use' && (
        <ConsumeItemModal
          isOpen={consumeOpen}
          onClose={() => setConsumeOpen(false)}
          definition={selected.definition}
          maxQuantity={selected.quantity}
          onUseItem={(quantity) => handleUse(selected, quantity)}
          isLoading={isConsuming}
          loadingText="Using..."
        />
      )}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5',
        'text-xs font-semibold transition-colors duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        active
          ? 'border-island-purple bg-island-purple text-island-cream shadow-cozy-soft'
          : 'border-island-wood/25 bg-island-cream text-island-ink-soft hover:border-island-wood/45',
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
      <span className={cn('tabular-nums', active ? 'opacity-80' : 'opacity-60')}>{count}</span>
    </button>
  );
}

function ItemDetail({
  entry,
  isPublishing,
  adjusting,
  onAdjust,
  pendingUpdates,
  onTransformChange,
  onSaveTransforms,
  onEquip,
  onUnequip,
  onUse,
}: {
  entry: CollectionEntry;
  isPublishing: boolean;
  /** True while this item's transform controls are open. */
  adjusting: boolean;
  onAdjust: (slot: AccessorySlot | null) => void;
  pendingUpdates: Record<string, PlacementTransformPatch>;
  onTransformChange?: (slot: AccessorySlot, patch: PlacementTransformPatch) => void;
  onSaveTransforms?: () => void;
  onEquip: (address: string, slot: AccessorySlot) => void;
  onUnequip: (slot: AccessorySlot) => void;
  onUse: () => void;
}) {
  const { definition } = entry;
  const patch = entry.slot ? (pendingUpdates[entry.slot] ?? {}) : {};
  const hasPendingEdits = Object.keys(pendingUpdates).length > 0;

  const scale = patch.scale ?? entry.placement?.scale?.x ?? 1;
  const rotation =
    patch.rot ??
    (entry.placement?.rotation?.type === 'euler' && typeof entry.placement.rotation.z === 'number'
      ? entry.placement.rotation.z
      : 0);

  return (
    <div
      data-testid="item-detail"
      className="space-y-2.5 rounded-panel border border-island-wood/20 bg-island-cream-2/70 p-3 shadow-cozy-soft"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-island-wood/20 bg-island-cream text-2xl [&_img]:max-h-full [&_img]:w-auto [&_img]:object-contain"
        >
          <ItemArt definition={definition} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight text-island-ink">{definition.name}</p>
          <p className="mt-0.5 text-[0.6875rem] text-island-ink-soft">
            {entry.slot ? `${entry.slot} · ` : ''}
            {entry.quantity > 0 ? `${entry.quantity} owned` : ''}
            {definition.rarity ? ` · ${definition.rarity}` : ''}
          </p>
        </div>
      </div>

      {definition.description && (
        <p className="text-xs leading-snug text-island-ink-soft">{definition.description}</p>
      )}

      {/* One primary action, named for what it does. */}
      {entry.action === 'wear' && entry.slot && (
        <Button
          className="w-full"
          size="sm"
          disabled={isPublishing}
          data-testid={`equip-${entry.address}`}
          onClick={() => onEquip(entry.address, entry.slot!)}
        >
          {isPublishing ? 'Saving…' : 'Wear it'}
        </Button>
      )}

      {entry.action === 'take-off' && entry.slot && !adjusting && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-island-grass-dark">Worn right now</p>
          <div className="flex gap-1.5">
            <Button
              className="flex-1"
              size="sm"
              variant="outline"
              disabled={isPublishing}
              data-testid={`unequip-${entry.slot}`}
              onClick={() => onUnequip(entry.slot!)}
            >
              Take it off
            </Button>
            {/* PROGRESSIVE DISCLOSURE. The transform controls are three
                controls and a paragraph — around 120px — and a player who is
                not adjusting anything should not pay that height. */}
            <Button
              className="flex-1"
              size="sm"
              variant="secondary"
              data-testid={`adjust-${entry.slot}`}
              onClick={() => onAdjust(entry.slot!)}
            >
              Adjust
            </Button>
          </div>
        </div>
      )}

      {entry.action === 'take-off' && entry.slot && adjusting && (
        <div
          data-testid={`select-${entry.slot}`}
          className="space-y-2 rounded-lg border border-island-wood/20 bg-island-cream p-2"
        >
          <LabelledSlider
            label="Size"
            value={scale}
            min={0.25}
            max={2}
            step={0.05}
            onChange={(v) => onTransformChange?.(entry.slot!, { scale: v })}
          />
          <LabelledSlider
            label="Tilt"
            value={rotation}
            min={-45}
            max={45}
            step={1}
            onChange={(v) => onTransformChange?.(entry.slot!, { rot: v })}
          />
          <p className="text-[0.6875rem] text-island-ink-soft">
            Drag it on the Blobbi to move it.
          </p>
          <div className="flex gap-1.5">
            <Button
              className="flex-1"
              size="sm"
              variant="outline"
              data-testid="done-adjusting"
              onClick={() => onAdjust(null)}
            >
              Done
            </Button>
            {hasPendingEdits && (
              <Button
                className="flex-1"
                size="sm"
                disabled={isPublishing}
                data-testid="save-transforms"
                onClick={onSaveTransforms}
              >
                {isPublishing ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        </div>
      )}

      {entry.action === 'use' && (
        <Button
          className="w-full"
          size="sm"
          data-testid={`use-${entry.address}`}
          onClick={onUse}
        >
          Use it
        </Button>
      )}

      {entry.action === 'none' && (
        <p className="text-xs text-island-ink-soft">
          Spend it in the shop, it is not something your Blobbi can use directly.
        </p>
      )}
    </div>
  );
}

function LabelledSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[0.6875rem] text-island-ink-soft">
        <span>{label}</span>
        <span className="tabular-nums">{value.toFixed(2)}</span>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => v !== undefined && onChange(v)}
      />
    </div>
  );
}
