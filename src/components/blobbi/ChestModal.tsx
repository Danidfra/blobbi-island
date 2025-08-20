import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog';
import { useDrag } from '@use-gesture/react';
import { cn } from '@/lib/utils';
import { ConsumeItemModal } from './ConsumeItemModal';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useToast } from '@/hooks/useToast';

interface ChestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ChestItemData {
  id: string;
  imageUrl: string;
  position: { x: number; y: number }; // Pixel positions
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
    const itemSize = 64; // 64x64px items
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
        // Don't handle click here - let the click handler handle it
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
      threshold: 5 // Minimum movement before drag starts
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
      <img
        src={item.imageUrl}
        alt={item.id}
        className="w-full h-full object-contain pointer-events-none"
        draggable={false}
      />
    </div>
  );
}

export function ChestModal({ isOpen, onClose }: ChestModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);
  const [containerBounds, setContainerBounds] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const { status, updatePetStats } = useOptimizedStatus();
  const { toast } = useToast();

  // Initial chest items with random positions (will be set in useEffect)
  const [chestItems, setChestItems] = useState<ChestItemData[]>([
    {
      id: 'ball',
      imageUrl: '/assets/interactive/toys/ball.png',
      position: { x: 0, y: 0 }, // Will be set randomly in useEffect
    },
    {
      id: 'bear',
      imageUrl: '/assets/interactive/toys/bear.png',
      position: { x: 0, y: 0 }, // Will be set randomly in useEffect
    },
  ]);

  // Set up container bounds and random positions when modal opens
  useEffect(() => {
    if (isOpen) {
      const initializeChest = () => {
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;

          // Only proceed if we have valid dimensions
          if (containerWidth > 0 && containerHeight > 0) {
            // Define the invisible container bounds inside the chest
            // These values represent the interior space of the chest image
            const bounds = {
              x: containerWidth * 0.14, // 15% from left edge
              y: containerHeight * 0.52, // 35% from top edge
              width: containerWidth * 0.73, // 70% of total width
              height: containerHeight * 0.42, // 45% of total height
            };

            setContainerBounds(bounds);

            // Generate random positions for items within the bounds
            setChestItems(prevItems => prevItems.map((item) => {
              const itemSize = 64;
              const maxX = bounds.width - itemSize;
              const maxY = bounds.height - itemSize;

              const randomX = bounds.x + Math.random() * maxX;
              const randomY = bounds.y + Math.random() * maxY;

              return {
                ...item,
                position: { x: randomX, y: randomY }
              };
            }));
          }
        }
      };

      // Try immediate initialization
      initializeChest();

      // Also try with a delay to ensure image is loaded
      const timer = setTimeout(initializeChest, 100);

      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const updateItemPosition = (id: string, newPosition: { x: number; y: number }) => {
    setChestItems(prevItems =>
      prevItems.map(item =>
        item.id === id ? { ...item, position: newPosition } : item
      )
    );
  };

  const handleItemClick = (id: string) => {
    setSelectedItemId(id);
    setIsConsumeModalOpen(true);
  };

  const handleUseItem = (itemId: string, quantity: number) => {
    if (!status.currentPet) {
      toast({
        title: "No Pet Selected",
        description: "Please select a pet to use items with first.",
        variant: "destructive",
      });
      return;
    }

    // Get current inventory quantity for this item
    const inventoryItem = status.owner?.inventory.find(item => item.itemId === itemId);
    const currentQuantity = inventoryItem?.quantity || 0;

    if (currentQuantity < quantity) {
      toast({
        title: "Not Enough Items",
        description: `You only have ${currentQuantity} of this item.`,
        variant: "destructive",
      });
      return;
    }

    // Apply item effects to pet (toy effects for chest items)
    const effectMap: Record<string, Partial<{ hunger: number; energy: number; hygiene: number; happiness: number; health: number }>> = {
      ball: { happiness: 25 * quantity, energy: 15 * quantity },
      bear: { happiness: 30 * quantity, hygiene: 10 * quantity },
    };

    const effects = effectMap[itemId];
    if (effects && status.currentPet) {
      // Calculate new stats (capped at 100)
      const currentStats = {
        hunger: status.currentPet.hunger,
        energy: status.currentPet.energy,
        hygiene: status.currentPet.hygiene,
        happiness: status.currentPet.happiness,
        health: status.currentPet.health,
      };

      const newStats: Partial<{ hunger: number; energy: number; hygiene: number; happiness: number; health: number }> = {};
      Object.entries(effects).forEach(([stat, increase]) => {
        if (increase && stat in currentStats) {
          newStats[stat] = Math.min(100, currentStats[stat as keyof typeof currentStats] + increase);
        }
      });

      // Apply optimistic updates
      updatePetStats(status.currentPet.id, newStats);

      // TODO: Update inventory by reducing item quantity
      // This would normally be done through a Nostr event

      toast({
        title: "Toy Used Successfully",
        description: `Played with ${quantity} ${itemId}(s) with ${status.currentPet.name}!`,
      });
    }

    setIsConsumeModalOpen(false);
    setSelectedItemId(null);
  };

  const getItemQuantity = (itemId: string): number => {
    const inventoryItem = status.owner?.inventory.find(item => item.itemId === itemId);

    // For demo purposes, provide mock quantities if no real inventory data exists
    if (!inventoryItem && !status.owner?.inventory.length) {
      const mockQuantities: Record<string, number> = {
        ball: 5,
        bear: 3,
      };
      return mockQuantities[itemId] || 0;
    }

    return inventoryItem?.quantity || 0;
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="p-0 bg-transparent border-none max-w-lg w-full">
          <div ref={containerRef} className="relative">
            <img
              src="/assets/interactive/furniture/chest-open.png"
              alt="Chest open"
              className="w-full h-auto scale-125"
            />

            {/* Invisible container bounds for debugging (remove in production) */}
            {/* {process.env.NODE_ENV === 'development' && containerBounds.width > 0 && (
              <div
                className="absolute border-2 border-red-500 opacity-30 pointer-events-none"
                style={{
                  left: containerBounds.x,
                  top: containerBounds.y,
                  width: containerBounds.width,
                  height: containerBounds.height,
                }}
              />
            )} */}

            {/* Chest items - only render when modal is open and bounds are set */}
            {isOpen && containerBounds.width > 0 && chestItems.map((item) => (
              <ChestItem
                key={item.id}
                item={item}
                containerBounds={containerBounds}
                onPositionChange={updateItemPosition}
                onClick={handleItemClick}
              />
            ))}

            <DialogClose asChild />
          </div>
        </DialogContent>
      </Dialog>

      {/* Consume Item Modal - rendered separately outside the main dialog */}
      {selectedItemId && (
        <ConsumeItemModal
          isOpen={isConsumeModalOpen}
          onClose={() => {
            setIsConsumeModalOpen(false);
            setSelectedItemId(null);
          }}
          itemId={selectedItemId}
          maxQuantity={getItemQuantity(selectedItemId)}
          onUseItem={handleUseItem}
        />
      )}
    </>
  );
}