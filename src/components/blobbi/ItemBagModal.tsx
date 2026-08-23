import { useMemo, useState } from 'react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { ItemTile } from '@/components/ui/item-tile';
import { StateCard } from '@/components/ui/state-card';
import { ConsumeItemModal } from './ConsumeItemModal';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useToast } from '@/hooks/useToast';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import {
  useIslandInventory,
  useItemCatalog,
  primaryItemImageUrl,
  toIslandEntries,
  useUseItem,
  type IslandInventoryEntry,
  type ItemCategory,
} from '@/inventory';

interface ItemBagModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * An item's visual, following the catalog's documented resolution order:
 * definition PRIMARY image → `emoji`.
 *
 * "Primary" is load-bearing now that a definition may publish several `image`
 * tags: a bag row is a compact, unposed list cell, so it always wants the
 * item's default picture and never a pose-specific view — a hat's `side-left`
 * artwork in an inventory grid would misrepresent the item. See
 * `docs/game-item-image-views.md`.
 *
 * Generic on purpose — it takes a resolved definition and knows nothing about
 * which item it is drawing, so every current and future item with artwork gets
 * the same treatment. Today only the Arcade Ticket has an `image`, and the 19
 * consumables keep rendering exactly the emoji they rendered before.
 *
 * The image is a REMOTE asset, so it can fail (host down, offline, blocked). A
 * failed load falls back to the emoji rather than leaving a broken-image glyph,
 * matching how the rest of the catalog always degrades to something renderable.
 */
function ItemVisual({ definition }: { definition: IslandInventoryEntry['definition'] }) {
  const [imageFailed, setImageFailed] = useState(false);
  const url = primaryItemImageUrl(definition);

  if (url && !imageFailed) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        className="h-8 w-8 object-contain"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span className="text-3xl" role="img" aria-label={definition.name}>
      {definition.emoji}
    </span>
  );
}

interface CategorySection {
  category: ItemCategory;
  label: string;
  /**
   * Read-only sections are DISPLAY ONLY: they render a plain tile with no click
   * target, so there is no path from them into `ConsumeItemModal` or
   * `useUseItem`. Currency is read-only because it has no gameplay action —
   * `useUseItem` would reject it anyway, but offering the affordance at all
   * would be a lie.
   */
  readOnly?: boolean;
}

/**
 * Categories shown in the bag, in display order, with section labels.
 *
 * Currency comes FIRST: it is a balance, not a thing you rummage past the
 * sandwiches to find. Everything below it is a consumable care item.
 */
const CATEGORY_SECTIONS: CategorySection[] = [
  { category: 'currency', label: 'Currency', readOnly: true },
  { category: 'food', label: 'Food' },
  { category: 'toy', label: 'Toys' },
  { category: 'medicine', label: 'Medicine' },
  { category: 'hygiene', label: 'Hygiene' },
  { category: 'energy', label: 'Energy' },
];

/**
 * A generic "item bag" that lists ALL owned inventory (kind:31633) grouped by
 * category and lets the player use any item via the shared consume modal.
 *
 * This provides a reachable UI path for medicine, hygiene, and energy items,
 * which have no dedicated furniture (unlike food -> fridge, toys -> chest).
 */
export function ItemBagModal({ isOpen, onClose }: ItemBagModalProps) {
  const { status } = useOptimizedStatus();
  const { data: inventory, isLoading } = useIslandInventory();
  const { data: catalog } = useItemCatalog();
  const { mutate: consumeItem, isPending } = useUseItem();
  const { toast } = useToast();

  const [selectedEntry, setSelectedEntry] = useState<IslandInventoryEntry | null>(null);
  const [isConsumeOpen, setIsConsumeOpen] = useState(false);

  const entries = useMemo(
    () => toIslandEntries(inventory, catalog).filter((e) => e.quantity > 0),
    [inventory, catalog],
  );

  const byCategory = useMemo(() => {
    const map = new Map<ItemCategory, IslandInventoryEntry[]>();
    for (const section of CATEGORY_SECTIONS) map.set(section.category, []);
    for (const entry of entries) {
      const cat = entry.definition.category;
      if (cat !== 'unknown' && map.has(cat)) {
        map.get(cat)!.push(entry);
      }
    }
    return map;
  }, [entries]);

  const handleUse = (entry: IslandInventoryEntry, quantity: number) => {
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
          setIsConsumeOpen(false);
          setSelectedEntry(null);
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

  const isEmpty = entries.length === 0;

  return (
    <>
      <BlobbiModal
        open={isOpen}
        onOpenChange={(open) => !open && onClose()}
        presentation="in-frame"
        size="md"
        title="Item Bag"
        description="Tap an item to use it on your Blobbi. Currency is shown for reference only."
        icon="🎒"
      >
        {isLoading && <StateCard kind="loading" compact title="Opening your bag…" />}

        {!isLoading && isEmpty && (
          <StateCard
            kind="empty"
            compact
            title="Your bag is empty"
            message="Buy something from the shop and it will show up here."
          />
        )}

        {!isLoading && !isEmpty && (
          <div className="space-y-4">
            {CATEGORY_SECTIONS.map((section) => {
              const items = byCategory.get(section.category) ?? [];
              if (items.length === 0) return null;
              return (
                <section key={section.category} data-bag-section={section.category}>
                  <h3 className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
                    {section.label}
                  </h3>
                  <div className="grid grid-cols-3 gap-2.5">
                    {items.map((entry) => (
                      /*
                        One tile for both kinds. `onClick` is what makes it a
                        button, so a read-only section renders a plain <div>
                        with no handler and no consume flow — the same
                        distinction the two hand-written tiles used to draw,
                        minus the two different badge colours they drew it in.
                      */
                      <ItemTile
                        key={entry.address}
                        {...(section.readOnly
                          ? { 'data-readonly-item': entry.address }
                          : {
                              onClick: () => {
                                setSelectedEntry(entry);
                                setIsConsumeOpen(true);
                              },
                            })}
                        name={entry.definition.name}
                        quantity={entry.quantity}
                        art={<ItemVisual definition={entry.definition} />}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </BlobbiModal>

      {selectedEntry && (
        <ConsumeItemModal
          isOpen={isConsumeOpen}
          onClose={() => {
            setIsConsumeOpen(false);
            setSelectedEntry(null);
          }}
          definition={selectedEntry.definition}
          maxQuantity={selectedEntry.quantity}
          onUseItem={(quantity) => handleUse(selectedEntry, quantity)}
          isLoading={isPending}
          loadingText="Using..."
        />
      )}
    </>
  );
}
