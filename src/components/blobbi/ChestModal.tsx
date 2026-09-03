import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useDrag } from '@use-gesture/react';
import { cn } from '@/lib/utils';
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
} from '@/inventory';

interface ChestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Local image overrides for known toy items. */
const TOY_IMAGES: Record<string, string> = {
  toy_ball: '/assets/items/toys/ball.png',
  toy_teddy: '/assets/items/toys/bear.png',
};

interface ChestItemData {
  id: string;
  imageUrl?: string;
  emoji: string;
  position: { x: number; y: number };
  quantity: number;
}

interface ChestItemProps {
  item: ChestItemData;
  containerBounds: { x: number; y: number; width: number; height: number };
  onPositionChange: (id: string, position: { x: number; y: number }) => void;
  onClick: (id: string) => void;
}

function ChestItem({ item, containerBounds, onPositionChange, onClick }: ChestItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const constrainPosition = useCallback((x: number, y: number) => {
    const itemSize = 64;
    const minX = containerBounds.x;
    const maxX = containerBounds.x + containerBounds.width - itemSize;
    const minY = containerBounds.y;
    const maxY = containerBounds.y + containerBounds.height - itemSize;

    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y))
    };
  }, [containerBounds]);

  const bind = useDrag(
    ({ down, movement: [mx, my], memo, tap }) => {
      if (tap && !isDragging) {
        return;
      }

      if (!down && !memo) return;

      setIsDragging(down);

      const initialPos = memo || item.position;
      const newPos = constrainPosition(
        initialPos.x + mx,
        initialPos.y + my
      );

      onPositionChange(item.id, newPos);
      return initialPos;
    },
    {
      filterTaps: true,
      rubberband: true,
      threshold: 5
    }
  );

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (onClick && !isDragging) {
      onClick(item.id);
    }
  };

  return (
    <div
      {...bind()}
      ref={itemRef}
      className={cn(
        'absolute cursor-pointer select-none transition-transform duration-200',
        isDragging ? 'scale-110 z-50' : 'hover:scale-105'
      )}
      style={{
        left: item.position.x,
        top: item.position.y,
        width: 64,
        height: 64,
        touchAction: 'none',
      }}
      onClick={handleClick}
    >
      {item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt={item.id}
          className="w-full h-full object-contain pointer-events-none"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center pointer-events-none text-5xl">
          <span role="img" aria-label={item.id}>{item.emoji}</span>
        </div>
      )}
      {/* Quantity badge */}
      {item.quantity > 1 && (
        <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold shadow-lg">
          {item.quantity}
        </div>
      )}
    </div>
  );
}

export function ChestModal({ isOpen, onClose }: ChestModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedEntry, setSelectedEntry] = useState<IslandInventoryEntry | null>(null);
  const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);
  const [containerBounds, setContainerBounds] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const { status } = useOptimizedStatus();
  const { data: inventory, isLoading: isInventoryLoading, refetch: refetchInventory } = useIslandInventory();
  const { data: catalog } = useItemCatalog();
  const { mutate: consumeItem, isPending: isPlaying } = useUseItem();
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      refetchInventory();
    }
  }, [isOpen, refetchInventory]);

  // Toy entries (category toy) with quantity > 0.
  const toyEntries = useMemo(() => {
    const entries = toIslandEntries(inventory, catalog);
    return entries.filter(
      (e) => e.quantity > 0 && e.definition.category === 'toy',
    );
  }, [inventory, catalog]);

  const toyItems = useMemo(
    () =>
      toyEntries.map((entry) => ({
        id: entry.address,
        entry,
        imageUrl: entry.itemId ? TOY_IMAGES[entry.itemId] : undefined,
        emoji: entry.definition.emoji,
        position: { x: 0, y: 0 },
        quantity: entry.quantity,
      })),
    [toyEntries],
  );

  const [toyItemPositions, setToyItemPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [isChestInitialized, setIsChestInitialized] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const initializeChestBounds = () => {
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;

          if (containerWidth > 0 && containerHeight > 0) {
            const bounds = {
              x: containerWidth * 0.14,
              y: containerHeight * 0.52,
              width: containerWidth * 0.73,
              height: containerWidth * 0.42,
            };

            setContainerBounds(bounds);
            setIsChestInitialized(true);
          }
        }
      };

      initializeChestBounds();
      const timer = setTimeout(initializeChestBounds, 100);
      return () => clearTimeout(timer);
    } else {
      setIsChestInitialized(false);
      setToyItemPositions({});
    }
  }, [isOpen]);

  useEffect(() => {
    if (isChestInitialized && containerBounds.width > 0 && toyItems.length > 0) {
      setToyItemPositions(prevPositions => {
        const newPositions = { ...prevPositions };

        toyItems.forEach((item) => {
          if (!newPositions[item.id]) {
            const itemSize = 64;
            const maxX = containerBounds.width - itemSize;
            const maxY = containerBounds.height - itemSize;

            const randomX = containerBounds.x + Math.random() * maxX;
            const randomY = containerBounds.y + Math.random() * maxY;

            newPositions[item.id] = { x: randomX, y: randomY };
          }
        });

        const currentItemIds = new Set(toyItems.map(item => item.id));
        Object.keys(newPositions).forEach(itemId => {
          if (!currentItemIds.has(itemId)) {
            delete newPositions[itemId];
          }
        });

        return newPositions;
      });
    }
  }, [isChestInitialized, containerBounds, toyItems]);

  const updateItemPosition = (id: string, newPosition: { x: number; y: number }) => {
    setToyItemPositions(prev => ({
      ...prev,
      [id]: newPosition
    }));
  };

  const handleItemClick = (address: string) => {
    const entry = toyEntries.find((e) => e.address === address);
    if (!entry) return;
    setSelectedEntry(entry);
    setIsConsumeModalOpen(true);
  };

  const handleUseItem = (entry: IslandInventoryEntry, quantity: number) => {
    if (!status.currentPet) {
      toast({
        title: 'No Pet Selected',
        description: 'Please select a pet to play with first.',
        variant: 'destructive',
      });
      return;
    }

    if (entry.quantity < quantity) {
      toast({
        title: 'Not Enough Items',
        description: `You only have ${entry.quantity} of this item.`,
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
            title: 'Playing Successful! 🎾',
            description: `Played with ${quantity} ${entry.definition.name}(s) with ${status.currentPet ? getBlobbiDisplayName(status.currentPet) : 'your Blobbi'}!${result.experienceGained ? ` Gained ${result.experienceGained} XP.` : ''}${result.warning ? ` (${result.warning})` : ''}`,
          });
          setIsConsumeModalOpen(false);
          setSelectedEntry(null);
        },
        onError: (error) => {
          toast({
            title: 'Playing Failed',
            description: error.message,
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && isOpen) {
      onClose();
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={handleBackdropClick}
      >
        <div className="w-[70%] p-0 flex flex-col relative shadow-2xl max-w-md">
          <div ref={containerRef} className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="absolute top-2 right-2 h-8 w-8 rounded-full z-10 bg-black/50 hover:bg-black/70 text-white"
            >
              <X className="h-4 w-4" />
            </Button>

            <img
              src="/assets/locations/home/chest-open.png"
              alt="Chest open"
              className="w-full h-auto scale-125"
            />

            {/* Toy items */}
            {isOpen && !isInventoryLoading && toyItems.map((toy) => {
              const position = toyItemPositions[toy.id] || { x: 0, y: 0 };
              return (
                <ChestItem
                  key={toy.id}
                  item={{
                    id: toy.id,
                    imageUrl: toy.imageUrl,
                    emoji: toy.emoji,
                    quantity: toy.quantity,
                    position
                  }}
                  containerBounds={containerBounds}
                  onPositionChange={updateItemPosition}
                  onClick={handleItemClick}
                />
              );
            })}

            {/* Loading state */}
            {isOpen && isInventoryLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-white text-sm">Loading inventory...</div>
              </div>
            )}

            {/* Empty state */}
            {isOpen && !isInventoryLoading && toyItems.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-white text-sm text-center">
                  <p>Your toy chest is empty!</p>
                  <p className="text-xs opacity-75 mt-1">Get some toys from the shop</p>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Consume Item Modal */}
      {selectedEntry && (
        <ConsumeItemModal
          isOpen={isConsumeModalOpen}
          onClose={() => {
            setIsConsumeModalOpen(false);
            setSelectedEntry(null);
          }}
          definition={selectedEntry.definition}
          availableQuantity={selectedEntry.quantity}
          onUseItem={(quantity) => handleUseItem(selectedEntry, quantity)}
          isLoading={isPlaying}
          loadingText="Playing..."
        />
      )}
    </>
  );
}
