
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog';
import { FoodItem, FoodPosition } from './FoodItem';
import { ConsumeItemModal } from './ConsumeItemModal';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useBlobbonautInventory } from '@/hooks/useBlobbonautProfile';
import { useToast } from '@/hooks/useToast';

interface RefrigeratorModalProps {
  isOpen: boolean;
  onClose: () => void;
}



export function RefrigeratorModal({ isOpen, onClose }: RefrigeratorModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);

  const { status, updatePetStats } = useOptimizedStatus();
  const { data: inventory, isLoading: isInventoryLoading } = useBlobbonautInventory();
  const { toast } = useToast();

  // Shelf positions from bottom of modal (in pixels)
  const shelves = useMemo(() => [290, 430, 580], []); // Bottom shelf at 170px, middle at 270px, top at 370px

  // Map of available food items with their image paths
  // Maps both prefixed and non-prefixed item IDs to their image paths
  const availableFoodItems = useMemo(() => ({
    // Non-prefixed versions (legacy support)
    apple: '/assets/interactive/food/apple.png',
    pizza: '/assets/interactive/food/pizza.png',
    burger: '/assets/interactive/food/burger.png',
    cake: '/assets/interactive/food/cake.png',
    sushi: '/assets/interactive/food/sushi.png',
    // Prefixed versions (current format)
    food_apple: '/assets/interactive/food/apple.png',
    food_pizza: '/assets/interactive/food/pizza.png',
    food_burger: '/assets/interactive/food/burger.png',
    food_cake: '/assets/interactive/food/cake.png',
    food_sushi: '/assets/interactive/food/sushi.png',
  }), []);

  // Generate food items based on inventory data
  const foodItems = useMemo(() => {
    if (!inventory || inventory.length === 0) return [];

    // Filter inventory to only include food items that we have images for
    const foodInInventory = inventory.filter(item =>
      item.quantity > 0 && availableFoodItems[item.itemId as keyof typeof availableFoodItems]
    );

    return foodInInventory.map((item) => ({
      id: item.itemId,
      imageUrl: availableFoodItems[item.itemId as keyof typeof availableFoodItems],
      position: { x: 0, y: 0 }, // Will be set properly in useEffect
      quantity: item.quantity,
    }));
  }, [inventory, availableFoodItems]);

  // State for tracking food item positions
  const [foodItemPositions, setFoodItemPositions] = useState<Record<string, FoodPosition>>({});

  // Set initial positions based on container size when modal opens
  useEffect(() => {
    if (isOpen && foodItems.length > 0) {
      const initializePositions = () => {
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;

          // Only set positions if we have valid dimensions
          if (containerWidth > 0 && containerHeight > 0) {
            const newPositions: Record<string, FoodPosition> = {};

            foodItems.forEach((item, index) => {
              // Distribute items across shelves
              const shelfIndex = index % shelves.length;
              const itemsPerShelf = Math.ceil(foodItems.length / shelves.length);
              const positionOnShelf = Math.floor(index / shelves.length);

              // Calculate x position based on how many items are on this shelf
              const totalItemsOnShelf = Math.min(itemsPerShelf, foodItems.length - (shelfIndex * itemsPerShelf));
              const xPercentage = totalItemsOnShelf === 1
                ? 0.5 // Center single items
                : 0.2 + (positionOnShelf * 0.6 / (totalItemsOnShelf - 1)); // Distribute multiple items

              const xPosition = containerWidth * xPercentage;
              const yPosition = containerHeight - shelves[shelfIndex];

              newPositions[item.id] = { x: xPosition, y: yPosition };
            });

            setFoodItemPositions(newPositions);
          }
        }
      };

      // Try immediate initialization
      initializePositions();

      // Also try with a delay to ensure image is loaded
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

  const handleFoodClick = (id: string) => {
    setSelectedItemId(id);
    setIsConsumeModalOpen(true);
  };

  const handleUseItem = (itemId: string, quantity: number) => {
    if (!status.currentPet) {
      toast({
        title: "No Pet Selected",
        description: "Please select a pet to feed first.",
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

    // Apply item effects to pet (simplified effects for demo)
    const effectMap: Record<string, Partial<{ hunger: number; energy: number; hygiene: number; happiness: number; health: number }>> = {
      apple: { hunger: 15 * quantity, energy: 5 * quantity, hygiene: 2 * quantity },
      pizza: { hunger: 35 * quantity, happiness: 10 * quantity, energy: 8 * quantity },
      burger: { hunger: 30 * quantity, happiness: 8 * quantity, energy: 12 * quantity },
      cake: { hunger: 20 * quantity, happiness: 25 * quantity, energy: 15 * quantity },
      sushi: { hunger: 25 * quantity, health: 10 * quantity, hygiene: 5 * quantity },
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
        title: "Item Used Successfully",
        description: `Fed ${quantity} ${itemId}(s) to ${status.currentPet.name}!`,
      });
    }

    setIsConsumeModalOpen(false);
    setSelectedItemId(null);
  };

  const getItemQuantity = (itemId: string): number => {
    // Try to find the item with the exact ID first
    let inventoryItem = inventory.find(item => item.itemId === itemId);

    // If not found and the itemId doesn't have the food_ prefix, try with the prefix
    if (!inventoryItem && !itemId.startsWith('food_')) {
      inventoryItem = inventory.find(item => item.itemId === `food_${itemId}`);
    }

    // If not found and the itemId has the food_ prefix, try without the prefix
    if (!inventoryItem && itemId.startsWith('food_')) {
      const unprefixedId = itemId.replace('food_', '');
      inventoryItem = inventory.find(item => item.itemId === unprefixedId);
    }

    return inventoryItem?.quantity || 0;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="p-0 bg-transparent border-none max-w-md w-full">
        <div ref={containerRef} className="relative">
          <img
            src="/assets/interactive/furniture/refrigerator-open.png"
            alt="Refrigerator open"
            className="w-full h-auto"
          />

          {/* Invisible shelves for debugging (remove these in production) */}
          {/* {process.env.NODE_ENV === 'development' && (
            <>
              {shelves.map((shelf, index) => (
                <div
                  key={index}
                  className="absolute right-1/2 translate-x-1/2 tran w-[60%] border-t-2 border-red-500 opacity-30"
                  style={{
                    bottom: `${shelf}px`,
                  }}
                />
              ))}
            </>
          )} */}

          {/* Food items - only render when modal is open and we have inventory data */}
          {isOpen && !isInventoryLoading && foodItems.map((food) => {
            const position = foodItemPositions[food.id] || { x: 0, y: 0 };
            return (
              <FoodItem
                key={food.id}
                imageUrl={food.imageUrl}
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

          <DialogClose asChild />
        </div>

        {/* Consume Item Modal */}
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
      </DialogContent>
    </Dialog>
  );
}
