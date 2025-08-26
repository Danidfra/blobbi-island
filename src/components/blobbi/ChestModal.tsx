import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useDrag } from '@use-gesture/react';
import { cn } from '@/lib/utils';
import { ConsumeItemModal } from './ConsumeItemModal';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useBlobbonautInventory } from '@/hooks/useBlobbonautProfile';
import { useBlobbiPlayAction } from '@/hooks/useBlobbiPlayAction';
import { useToast } from '@/hooks/useToast';

interface ChestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ChestItemData {
  id: string;
  imageUrl: string;
  position: { x: number; y: number }; // Pixel positions
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
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);
  const [containerBounds, setContainerBounds] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [optimisticInventory, setOptimisticInventory] = useState<typeof inventory | null>(null);

  const { status } = useOptimizedStatus();
  const { data: inventory, isLoading: isInventoryLoading, refetch: refetchInventory } = useBlobbonautInventory();
  const { mutate: playWithBlobbi, isPending: isPlaying } = useBlobbiPlayAction();
  const { toast } = useToast();

  // Use optimistic inventory if available, otherwise use real inventory
  const currentInventory = optimisticInventory ?? inventory;

  // Reset optimistic inventory and refetch when modal opens
  useEffect(() => {
    if (isOpen) {
      setOptimisticInventory(null);
      refetchInventory();
    }
  }, [isOpen, refetchInventory]);

  // Map of available toy items with their image paths (only prefixed versions exist)
  const availableToyItems = useMemo(() => ({
    toy_ball: '/assets/interactive/toys/ball.png',
    toy_teddy: '/assets/interactive/toys/bear.png',
  }), []);

  // Generate toy items based on current inventory data (optimistic or real)
  const toyItems = useMemo(() => {
    if (!currentInventory || currentInventory.length === 0) return [];

    // Filter inventory to only include toy items that we have images for
    const toysInInventory = currentInventory.filter(item =>
      item.quantity > 0 && availableToyItems[item.itemId as keyof typeof availableToyItems]
    );

    return toysInInventory.map((item) => ({
      id: item.itemId,
      imageUrl: availableToyItems[item.itemId as keyof typeof availableToyItems],
      position: { x: 0, y: 0 }, // Will be set properly in useEffect
      quantity: item.quantity,
    }));
  }, [currentInventory, availableToyItems]);

  // State for tracking toy item positions
  const [toyItemPositions, setToyItemPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [isChestInitialized, setIsChestInitialized] = useState(false);

  // Set up container bounds when modal opens
  useEffect(() => {
    if (isOpen) {
      const initializeChestBounds = () => {
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;

          // Only proceed if we have valid dimensions
          if (containerWidth > 0 && containerHeight > 0) {
            // Define the invisible container bounds inside the chest
            // These values represent the interior space of the chest image
            const bounds = {
              x: containerWidth * 0.14, // 14% from left edge
              y: containerHeight * 0.52, // 52% from top edge
              width: containerWidth * 0.73, // 73% of total width
              height: containerWidth * 0.42, // 42% of total height
            };

            setContainerBounds(bounds);
            setIsChestInitialized(true);
          }
        }
      };

      // Try immediate initialization
      initializeChestBounds();

      // Also try with a delay to ensure image is loaded
      const timer = setTimeout(initializeChestBounds, 100);

      return () => clearTimeout(timer);
    } else {
      // Reset when modal closes
      setIsChestInitialized(false);
      setToyItemPositions({});
    }
  }, [isOpen]);

  // Generate positions for new items when inventory changes
  useEffect(() => {
    if (isChestInitialized && containerBounds.width > 0 && toyItems.length > 0) {
      setToyItemPositions(prevPositions => {
        const newPositions = { ...prevPositions };

        toyItems.forEach((item) => {
          // Only generate position if this item doesn't already have one
          if (!newPositions[item.id]) {
            const itemSize = 64;
            const maxX = containerBounds.width - itemSize;
            const maxY = containerBounds.height - itemSize;

            const randomX = containerBounds.x + Math.random() * maxX;
            const randomY = containerBounds.y + Math.random() * maxY;

            newPositions[item.id] = { x: randomX, y: randomY };
          }
        });

        // Remove positions for items that no longer exist
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

  const handleItemClick = (id: string) => {
    // Normalize the item ID to match the format expected by ConsumeItemModal
    // Remove the 'toy_' prefix if it exists
    let normalizedId = id.startsWith('toy_') ? id.replace('toy_', '') : id;
    // Handle teddy bear mapping
    if (normalizedId === 'teddy') {
      normalizedId = 'teddy'; // Keep as teddy since we added it to ConsumeItemModal
    }
    setSelectedItemId(normalizedId);
    setIsConsumeModalOpen(true);
  };

  const handleUseItem = (itemId: string, quantity: number) => {
    if (!status.currentPet) {
      toast({
        title: "No Pet Selected",
        description: "Please select a pet to play with first.",
        variant: "destructive",
      });
      return;
    }

    // Get current inventory quantity for this item (handle both prefixed and non-prefixed)
    const currentQuantity = getItemQuantity(itemId);

    if (currentQuantity < quantity) {
      toast({
        title: "Not Enough Items",
        description: `You only have ${currentQuantity} of this item.`,
        variant: "destructive",
      });
      return;
    }

    // Apply optimistic inventory update immediately
    if (currentInventory) {
      const prefixedItemId = itemId.startsWith('toy_') ? itemId : `toy_${itemId}`;
      const updatedInventory = currentInventory.map(item => {
        if (item.itemId === prefixedItemId) {
          return {
            ...item,
            quantity: Math.max(0, item.quantity - quantity)
          };
        }
        return item;
      }).filter(item => item.quantity > 0); // Remove items with 0 quantity

      setOptimisticInventory(updatedInventory);
    }

    // Use the new Blobbi play action that creates proper Nostr events
    playWithBlobbi(
      {
        petId: status.currentPet.id,
        itemId,
        quantity,
      },
      {
        onSuccess: (result) => {
          const itemDisplayName = itemId.replace('toy_', '').replace('_', ' ');
          toast({
            title: "Playing Successful! 🎾",
            description: `Played with ${quantity} ${itemDisplayName}(s) with ${status.currentPet?.name}! Gained ${result.experienceGained} XP.`,
          });
          setIsConsumeModalOpen(false);
          setSelectedItemId(null);
        },
        onError: (error) => {
          // Revert optimistic update on error
          setOptimisticInventory(null);
          toast({
            title: "Playing Failed",
            description: error.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  const getItemQuantity = (itemId: string): number => {
    if (!currentInventory) return 0;

    // Inventory items have prefixes, so convert to prefixed version
    const prefixedItemId = itemId.startsWith('toy_') ? itemId : `toy_${itemId}`;
    const inventoryItem = currentInventory.find(item => item.itemId === prefixedItemId);

    return inventoryItem?.quantity || 0;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && isOpen) {
      onClose();
    }
  };

  // Handle escape key
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

            {/* Toy items - only render when modal is open and we have inventory data */}
            {isOpen && !isInventoryLoading && toyItems.map((toy) => {
              const position = toyItemPositions[toy.id] || { x: 0, y: 0 };
              return (
                <ChestItem
                  key={toy.id}
                  item={{
                    ...toy,
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
          onUseItem={(itemId, quantity) => handleUseItem(itemId, quantity)}
          isLoading={isPlaying}
          loadingText="Playing..."
        />
      )}
    </>
  );
}