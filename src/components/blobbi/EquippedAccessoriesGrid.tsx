import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useAccessoryManagement } from './hooks/useAccessoryManagement';
import { AccessoryRemovalModal } from './AccessoryRemovalModal';
import { generateAccessoryUrl } from './lib/accessory-utils';
import { cn } from '@/lib/utils';
import type { EquipmentConfig } from './lib/accessory-types';

interface EquippedAccessoriesGridProps {
  onAccessoryClick?: (accessory: EquipmentConfig) => void;
  selectedAccessory?: EquipmentConfig | null;
  className?: string;
}

// Helper function to get placeholder emoji based on slot
function getSlotEmoji(slot: string): string {
  switch (slot) {
    case 'headwear': return '🎩';
    case 'eyewear': return '🕶️';
    case 'back': return '🎒';
    case 'neckwear': return '📿';
    case 'handheld': return '🎮';
    case 'face-mark': return '🎨';
    case 'aura': return '✨';
    case 'color-overlay': return '🌈';
    default: return '📦';
  }
}

export function EquippedAccessoriesGrid({ 
  onAccessoryClick, 
  selectedAccessory, 
  className 
}: EquippedAccessoriesGridProps) {
  const { equipment, unequipAccessory, isUnequipping } = useAccessoryManagement();
  const [selectedAccessoryForRemoval, setSelectedAccessoryForRemoval] = useState<EquipmentConfig | null>(null);
  const [showRemovalModal, setShowRemovalModal] = useState(false);

  const handleRemoveClick = (accessory: EquipmentConfig, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the card click
    setSelectedAccessoryForRemoval(accessory);
    setShowRemovalModal(true);
  };

  const handleRemoveAccessory = async (accessory: EquipmentConfig) => {
    try {
      await unequipAccessory(accessory.code);
    } catch (error) {
      console.error('Failed to remove accessory:', error);
      throw error;
    }
  };

  const handleCloseRemovalModal = () => {
    setShowRemovalModal(false);
    setSelectedAccessoryForRemoval(null);
  };

  if (equipment.length === 0) {
    return (
      <Card className="border-dashed border-purple-200/60 dark:border-purple-800/60">
        <CardContent className="py-8 px-6 text-center">
          <div className="max-w-sm mx-auto space-y-3">
            <div className="text-4xl">👕</div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-purple-700 dark:text-purple-300">
                No accessories equipped
              </h3>
              <p className="text-xs text-muted-foreground">
                Your Blobbi isn't wearing any accessories yet. Equip some from your inventory!
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="text-sm font-medium text-purple-700 dark:text-purple-300 px-1">
        Equipped Accessories ({equipment.length})
      </div>
      
      {/* Grid */}
      <div className="grid grid-cols-3 gap-2">
        {equipment.map((accessory) => {
          const isSelected = selectedAccessory?.code === accessory.code;
          const imageUrl = accessory.url || generateAccessoryUrl(accessory.code) || '';

          return (
            <Card
              key={accessory.code}
              className={cn(
                "group rounded-lg border bg-white/70 dark:bg-gray-800/70 backdrop-blur p-2",
                "hover:shadow-md transition-all duration-200 hover:scale-105 cursor-pointer",
                "focus-within:ring-2 focus-within:ring-purple-500 focus-within:ring-offset-1",
                isSelected && "ring-2 ring-blue-500 ring-offset-1 bg-blue-50/80 dark:bg-blue-900/20"
              )}
              onClick={() => onAccessoryClick?.(accessory)}
            >
              <CardContent className="p-0">
                {/* Thumbnail */}
                <div className="relative w-full aspect-[1/1] overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800 mb-2">
                  <img
                    src={imageUrl}
                    alt={`Accessory ${accessory.code}`}
                    className="w-full h-full object-contain transition-transform group-hover:scale-105"
                    decoding="async"
                    fetchPriority="low"
                    width="100"
                    height="100"
                    onError={(e) => {
                      // Implement fallback chain
                      const target = e.target as HTMLImageElement;
                      const currentSrc = target.src;
                      const webpPath = `/assets/accessories/${accessory.slot}/${accessory.code}.webp`;
                      const pngPath = `/assets/accessories/${accessory.slot}/${accessory.code}.png`;
                      const legacyWebpPath = `/assets/acessories/${accessory.slot}/${accessory.code}.webp`;
                      const legacyPngPath = `/assets/acessories/${accessory.slot}/${accessory.code}.png`;

                      if (!currentSrc.includes(webpPath)) {
                        target.src = webpPath;
                      } else if (!currentSrc.includes(pngPath)) {
                        target.src = pngPath;
                      } else if (!currentSrc.includes(legacyWebpPath)) {
                        target.src = legacyWebpPath;
                      } else if (!currentSrc.includes(legacyPngPath)) {
                        target.src = legacyPngPath;
                      } else {
                        // All fallbacks failed, show placeholder
                        target.style.display = 'none';
                        const placeholder = document.createElement('div');
                        placeholder.className = 'w-full h-full flex items-center justify-center text-2xl';
                        placeholder.textContent = getSlotEmoji(accessory.slot);
                        target.parentElement?.appendChild(placeholder);
                      }
                    }}
                  />

                  {/* Remove button */}
                  <button
                    onClick={(e) => handleRemoveClick(accessory, e)}
                    className="absolute top-1 left-1 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center opacity-90 group-hover:opacity-100 transition-all duration-200 shadow-lg hover:shadow-md border border-red-600"
                    title="Remove accessory"
                  >
                    <X className="w-3 h-3" />
                  </button>

                  {/* Position indicator */}
                  <div className="absolute top-1 right-1">
                    <Badge variant="secondary" className="text-xs px-1 py-0 bg-black/70 text-white">
                      {Math.round(accessory.x)},{Math.round(accessory.y)}
                    </Badge>
                  </div>

                  {/* Selection indicator */}
                  {isSelected && (
                    <div className="absolute inset-0 border-2 border-blue-500 rounded-md pointer-events-none" />
                  )}
                </div>

                {/* Item Details */}
                <div className="space-y-1">
                  <h4 className="line-clamp-1 text-xs font-medium text-neutral-800 dark:text-neutral-200">
                    {accessory.code}
                  </h4>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs px-1 py-0">
                      {accessory.slot}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      {accessory.scale.toFixed(1)}x
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Instructions */}
      <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 mt-3">
        💡 Click on an accessory to edit its position, scale, and rotation in the simulator above.
        <br />
        <span className="text-orange-600 dark:text-orange-400">🗑️ Hover over an accessory and click the red X to remove it.</span>
      </div>

      {/* Accessory Removal Modal */}
      <AccessoryRemovalModal
        isOpen={showRemovalModal}
        onClose={handleCloseRemovalModal}
        accessory={selectedAccessoryForRemoval}
        onRemoveAccessory={handleRemoveAccessory}
        isRemoving={isUnequipping}
      />
    </div>
  );
}