
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog';
import { FoodItem, FoodPosition } from './FoodItem';
import { ConsumeItemModal } from './ConsumeItemModal';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useToast } from '@/hooks/useToast';

interface RefrigeratorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FoodItemData {
  id: string;
  imageUrl: string;
  position: FoodPosition;
}

export function RefrigeratorModal({ isOpen, onClose }: RefrigeratorModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);

  const { status, updatePetStats } = useOptimizedStatus();
  const { toast } = useToast();

  // Shelf positions from bottom of modal (in pixels)
  const shelves = useMemo(() => [290, 430, 580], []); // Bottom shelf at 170px, middle at 270px, top at 370px

  // Initial food items with their starting positions
  const [foodItems, setFoodItems] = useState<FoodItemData[]>([
    // Top shelf (370px from bottom)
    {
      id: 'apple',
      imageUrl: '/assets/interactive/food/apple.png',
      position: { x: 150, y: 0 }, // Will be set properly in useEffect
    },
    {
      id: 'pizza',
      imageUrl: '/assets/interactive/food/pizza.png',
      position: { x: 300, y: 0 }, // Will be set properly in useEffect
    },
    // Middle shelf (270px from bottom)
    {
      id: 'burger',
      imageUrl: '/assets/interactive/food/burger.png',
      position: { x: 150, y: 0 }, // Will be set properly in useEffect
    },
    {
      id: 'cake',
      imageUrl: '/assets/interactive/food/cake.png',
      position: { x: 300, y: 0 }, // Will be set properly in useEffect
    },
    // Bottom shelf (170px from bottom)
    {
      id: 'sushi',
      imageUrl: '/assets/interactive/food/sushi.png',
      position: { x: 225, y: 0 }, // Will be set properly in useEffect
    },
  ]);

  // Set initial positions based on container size when modal opens
  useEffect(() => {
    if (isOpen) {
      const initializePositions = () => {
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;

          // Only set positions if we have valid dimensions
          if (containerWidth > 0 && containerHeight > 0) {
            setFoodItems(prevItems => prevItems.map((item) => {
              let shelfIndex: number;
              let xPercentage: number; // Use percentage for better responsiveness

              // Determine which shelf and position based on the item
              switch (item.id) {
                case 'sushi':
                  shelfIndex = 2; // Top shelf
                  xPercentage = 0.35; // 35% from left
                  break;
                case 'pizza':
                  shelfIndex = 2; // Top shelf
                  xPercentage = 0.65; // 65% from left
                  break;
                case 'burger':
                  shelfIndex = 1; // Middle shelf
                  xPercentage = 0.35; // 35% from left
                  break;
                case 'cake':
                  shelfIndex = 1; // Middle shelf
                  xPercentage = 0.65; // 65% from left
                  break;
                case 'apple':
                  shelfIndex = 0; // Bottom shelf
                  xPercentage = 0.5; // 50% from left (centered)
                  break;
                default:
                  shelfIndex = 0;
                  xPercentage = 0.5;
              }

              const xPosition = containerWidth * xPercentage;
              const yPosition = containerHeight - shelves[shelfIndex];

              return {
                ...item,
                position: { x: xPosition, y: yPosition }
              };
            }));
          }
        }
      };

      // Try immediate initialization
      initializePositions();

      // Also try with a delay to ensure image is loaded
      const timer = setTimeout(initializePositions, 100);

      return () => clearTimeout(timer);
    }
  }, [isOpen, shelves]);

  const updateFoodPosition = (id: string, newPosition: FoodPosition) => {
    setFoodItems(prevItems =>
      prevItems.map(item =>
        item.id === id ? { ...item, position: newPosition } : item
      )
    );
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
    const inventoryItem = status.owner?.inventory.find(item => item.itemId === itemId);

    // For demo purposes, provide mock quantities if no real inventory data exists
    if (!inventoryItem && !status.owner?.inventory.length) {
      const mockQuantities: Record<string, number> = {
        apple: 5,
        pizza: 3,
        burger: 2,
        cake: 1,
        sushi: 4,
      };
      return mockQuantities[itemId] || 0;
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

          {/* Food items - only render when modal is open */}
          {isOpen && foodItems.map((food) => (
            <FoodItem
              key={food.id}
              imageUrl={food.imageUrl}
              position={food.position}
              onPositionChange={(newPosition) => updateFoodPosition(food.id, newPosition)}
              containerRef={containerRef}
              shelves={shelves}
              size={64}
              onClick={() => handleFoodClick(food.id)}
            />
          ))}

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
