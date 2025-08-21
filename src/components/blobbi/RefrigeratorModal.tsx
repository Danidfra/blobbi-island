
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { FoodItem, FoodPosition } from './FoodItem';
import { ConsumeItemModal } from './ConsumeItemModal';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useBlobbonautInventory } from '@/hooks/useBlobbonautProfile';
import { useBlobbiFeedAction } from '@/hooks/useBlobbiFeedAction';
import { useToast } from '@/hooks/useToast';

interface RefrigeratorModalProps {
  isOpen: boolean;
  onClose: () => void;
}



export function RefrigeratorModal({ isOpen, onClose }: RefrigeratorModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);
  const [optimisticInventory, setOptimisticInventory] = useState<typeof inventory | null>(null);

  const { status } = useOptimizedStatus();
  const { data: inventory, isLoading: isInventoryLoading, refetch: refetchInventory } = useBlobbonautInventory();
  const { mutate: feedBlobbi, isPending: isFeeding } = useBlobbiFeedAction();
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

  // Shelf positions from bottom of modal (in pixels)
  const shelves = useMemo(() => [250, 365, 505], []);

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

  // Generate food items based on current inventory data (optimistic or real)
  const foodItems = useMemo(() => {
    if (!currentInventory || currentInventory.length === 0) return [];

    // Filter inventory to only include food items that we have images for
    const foodInInventory = currentInventory.filter(item =>
      item.quantity > 0 && availableFoodItems[item.itemId as keyof typeof availableFoodItems]
    );

    return foodInInventory.map((item) => ({
      id: item.itemId,
      imageUrl: availableFoodItems[item.itemId as keyof typeof availableFoodItems],
      position: { x: 0, y: 0 }, // Will be set properly in useEffect
      quantity: item.quantity,
    }));
  }, [currentInventory, availableFoodItems]);

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
    // Normalize the item ID to match the format expected by ConsumeItemModal
    // Remove the 'food_' prefix if it exists
    const normalizedId = id.startsWith('food_') ? id.replace('food_', '') : id;
    setSelectedItemId(normalizedId);
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

    // Apply optimistic inventory update immediately
    if (currentInventory) {
      const updatedInventory = currentInventory.map(item => {
        // Find the item that matches (handle both prefixed and non-prefixed)
        const isMatch = item.itemId === itemId ||
                       item.itemId === `food_${itemId}` ||
                       item.itemId === itemId.replace('food_', '');

        if (isMatch) {
          return {
            ...item,
            quantity: Math.max(0, item.quantity - quantity)
          };
        }
        return item;
      }).filter(item => item.quantity > 0); // Remove items with 0 quantity

      setOptimisticInventory(updatedInventory);
    }

    // Use the new Blobbi feed action that creates proper Nostr events
    feedBlobbi(
      {
        petId: status.currentPet.id,
        itemId,
        quantity,
      },
      {
        onSuccess: (result) => {
          const itemDisplayName = itemId.replace('food_', '').replace('_', ' ');
          toast({
            title: "Feeding Successful! 🍽️",
            description: `Fed ${quantity} ${itemDisplayName}(s) to ${status.currentPet?.name}! Gained ${result.experienceGained} XP.`,
          });
          setIsConsumeModalOpen(false);
          setSelectedItemId(null);
        },
        onError: (error) => {
          // Revert optimistic update on error
          setOptimisticInventory(null);
          toast({
            title: "Feeding Failed",
            description: error.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  const getItemQuantity = (itemId: string): number => {
    if (!currentInventory) return 0;

    // Try to find the item with the exact ID first
    let inventoryItem = currentInventory.find(item => item.itemId === itemId);

    // If not found and the itemId doesn't have the food_ prefix, try with the prefix
    if (!inventoryItem && !itemId.startsWith('food_')) {
      inventoryItem = currentInventory.find(item => item.itemId === `food_${itemId}`);
    }

    // If not found and the itemId has the food_ prefix, try without the prefix
    if (!inventoryItem && itemId.startsWith('food_')) {
      const unprefixedId = itemId.replace('food_', '');
      inventoryItem = currentInventory.find(item => item.itemId === unprefixedId);
    }

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

            {/* Invisible shelves for debugging (remove these in production) */}
            {/* {process.env.NODE_ENV === 'development' && (
              <>
                {shelves.map((shelf, index) => (
                  <div
                    key={index}
                    className="absolute left-1/2 transform -translate-x-1/2 w-[60%] border-t-2 border-red-500 opacity-30"
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
          isLoading={isFeeding}
        />
      )}
    </>
  );
}
