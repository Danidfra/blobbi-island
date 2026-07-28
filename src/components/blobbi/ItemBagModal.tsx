import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ConsumeItemModal } from './ConsumeItemModal';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useToast } from '@/hooks/useToast';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import {
  useIslandInventory,
  useItemCatalog,
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
 * definition `image` → `emoji`.
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
  const url = definition.image;

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
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>🎒 Item Bag</DialogTitle>
            <DialogDescription>
              Use food, toys, medicine, hygiene, and energy items on your Blobbi.
              Currency is shown for reference and cannot be used on a Blobbi.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] pr-3">
            {isLoading && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Loading inventory...
              </p>
            )}

            {!isLoading && isEmpty && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Your bag is empty. Buy items from the shop!
              </p>
            )}

            {!isLoading && !isEmpty && (
              <div className="space-y-4">
                {CATEGORY_SECTIONS.map((section) => {
                  const items = byCategory.get(section.category) ?? [];
                  if (items.length === 0) return null;
                  return (
                    <div key={section.category} data-bag-section={section.category}>
                      <h3 className="text-sm font-semibold mb-2">{section.label}</h3>
                      <div className="grid grid-cols-3 gap-2">
                        {items.map((entry) =>
                          section.readOnly ? (
                            // Display-only tile: a <div>, not a <Button>. No
                            // handler, no consume modal, no "Use".
                            <div
                              key={entry.address}
                              data-readonly-item={entry.address}
                              className="h-auto flex flex-col items-center gap-1 py-2 px-2 relative rounded-md border border-input bg-background"
                            >
                              <ItemVisual definition={entry.definition} />
                              <span className="text-xs truncate w-full text-center">
                                {entry.definition.name}
                              </span>
                              <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1">
                                {entry.quantity}
                              </span>
                            </div>
                          ) : (
                            <Button
                              key={entry.address}
                              variant="outline"
                              onClick={() => {
                                setSelectedEntry(entry);
                                setIsConsumeOpen(true);
                              }}
                              className="h-auto flex flex-col items-center gap-1 py-2 relative"
                            >
                              <ItemVisual definition={entry.definition} />
                              <span className="text-xs truncate w-full text-center">
                                {entry.definition.name}
                              </span>
                              <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1">
                                {entry.quantity}
                              </span>
                            </Button>
                          ),
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

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
