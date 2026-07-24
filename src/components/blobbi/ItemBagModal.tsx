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

/** Categories shown in the bag, in display order, with section labels. */
const CATEGORY_SECTIONS: { category: ItemCategory; label: string }[] = [
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
                    <div key={section.category}>
                      <h3 className="text-sm font-semibold mb-2">{section.label}</h3>
                      <div className="grid grid-cols-3 gap-2">
                        {items.map((entry) => (
                          <Button
                            key={entry.address}
                            variant="outline"
                            onClick={() => {
                              setSelectedEntry(entry);
                              setIsConsumeOpen(true);
                            }}
                            className="h-auto flex flex-col items-center gap-1 py-2 relative"
                          >
                            <span className="text-3xl" role="img" aria-label={entry.definition.name}>
                              {entry.definition.emoji}
                            </span>
                            <span className="text-xs truncate w-full text-center">
                              {entry.definition.name}
                            </span>
                            <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1">
                              {entry.quantity}
                            </span>
                          </Button>
                        ))}
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
