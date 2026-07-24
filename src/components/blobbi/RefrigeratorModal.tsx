
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { FoodItem, FoodPosition } from './FoodItem';
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

interface RefrigeratorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Local image overrides for known food items (visual step: image before emoji). */
const FOOD_IMAGES: Record<string, string> = {
  food_apple: '/assets/interactive/food/apple.png',
  food_pizza: '/assets/interactive/food/pizza.png',
  food_burger: '/assets/interactive/food/burger.png',
  food_cake: '/assets/interactive/food/cake.png',
  food_sushi: '/assets/interactive/food/sushi.png',
};

export function RefrigeratorModal({ isOpen, onClose }: RefrigeratorModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedEntry, setSelectedEntry] = useState<IslandInventoryEntry | null>(null);
  const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);

  const { status } = useOptimizedStatus();
  const { data: inventory, isLoading: isInventoryLoading, refetch: refetchInventory } = useIslandInventory();
  const { data: catalog } = useItemCatalog();
  const { mutate: consumeItem, isPending: isFeeding } = useUseItem();
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      refetchInventory();
    }
  }, [isOpen, refetchInventory]);

  // Shelf positions from bottom of modal (in pixels)
  const shelves = useMemo(() => [250, 365, 505], []);

  // Food entries (category food) with quantity > 0.
  const foodEntries = useMemo(() => {
    const entries = toIslandEntries(inventory, catalog);
    return entries.filter(
      (e) => e.quantity > 0 && e.definition.category === 'food',
    );
  }, [inventory, catalog]);

  const foodItems = useMemo(
    () =>
      foodEntries.map((entry) => ({
        id: entry.address,
        entry,
        imageUrl: entry.itemId ? FOOD_IMAGES[entry.itemId] : undefined,
        emoji: entry.definition.emoji,
        position: { x: 0, y: 0 },
        quantity: entry.quantity,
      })),
    [foodEntries],
  );

  const [foodItemPositions, setFoodItemPositions] = useState<Record<string, FoodPosition>>({});

  useEffect(() => {
    if (isOpen && foodItems.length > 0) {
      const initializePositions = () => {
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;

          if (containerWidth > 0 && containerHeight > 0) {
            const newPositions: Record<string, FoodPosition> = {};

            foodItems.forEach((item, index) => {
              const shelfIndex = index % shelves.length;
              const itemsPerShelf = Math.ceil(foodItems.length / shelves.length);
              const positionOnShelf = Math.floor(index / shelves.length);

              const totalItemsOnShelf = Math.min(itemsPerShelf, foodItems.length - (shelfIndex * itemsPerShelf));
              const xPercentage = totalItemsOnShelf === 1
                ? 0.5
                : 0.2 + (positionOnShelf * 0.6 / (totalItemsOnShelf - 1));

              const xPosition = containerWidth * xPercentage;
              const yPosition = containerHeight - shelves[shelfIndex];

              newPositions[item.id] = { x: xPosition, y: yPosition };
            });

            setFoodItemPositions(newPositions);
          }
        }
      };

      initializePositions();
      const timer = setTimeout(initializePositions, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, foodItems, shelves]);

  const updateFoodPosition = (id: string, newPosition: FoodPosition) => {
    setFoodItemPositions(prev => ({
      ...prev,
      [id]: newPosition
    }));
  };

  const handleFoodClick = (address: string) => {
    const entry = foodEntries.find((e) => e.address === address);
    if (!entry) return;
    setSelectedEntry(entry);
    setIsConsumeModalOpen(true);
  };

  const handleUseItem = (entry: IslandInventoryEntry, quantity: number) => {
    if (!status.currentPet) {
      toast({
        title: 'No Pet Selected',
        description: 'Please select a pet to feed first.',
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
            title: 'Feeding Successful! 🍽️',
            description: `Fed ${quantity} ${entry.definition.name}(s) to ${status.currentPet ? getBlobbiDisplayName(status.currentPet) : 'your Blobbi'}!${result.experienceGained ? ` Gained ${result.experienceGained} XP.` : ''}${result.warning ? ` (${result.warning})` : ''}`,
          });
          setIsConsumeModalOpen(false);
          setSelectedEntry(null);
        },
        onError: (error) => {
          toast({
            title: 'Feeding Failed',
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
        <div className="w-[70%] p-0 flex flex-col relative shadow-2xl max-w-sm">
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
              src="/assets/interactive/furniture/refrigerator-open.png"
              alt="Refrigerator open"
              className="w-full h-auto"
            />

            {/* Food items */}
            {isOpen && !isInventoryLoading && foodItems.map((food) => {
              const position = foodItemPositions[food.id] || { x: 0, y: 0 };
              return (
                <FoodItem
                  key={food.id}
                  imageUrl={food.imageUrl}
                  emoji={food.emoji}
                  position={position}
                  onPositionChange={(newPosition) => updateFoodPosition(food.id, newPosition)}
                  containerRef={containerRef}
                  shelves={shelves}
                  size={64}
                  onClick={() => handleFoodClick(food.id)}
                  quantity={food.quantity}
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
            {isOpen && !isInventoryLoading && foodItems.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-white text-sm text-center">
                  <p>Your fridge is empty!</p>
                  <p className="text-xs opacity-75 mt-1">Get some food from the shop</p>
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
          maxQuantity={selectedEntry.quantity}
          onUseItem={(quantity) => handleUseItem(selectedEntry, quantity)}
          isLoading={isFeeding}
          loadingText="Feeding..."
        />
      )}
    </>
  );
}
