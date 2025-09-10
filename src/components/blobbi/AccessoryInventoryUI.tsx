import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useAccessoryInventory } from './hooks/useAccessoryManagement';
import { useAccessoryManagement } from './hooks/useAccessoryManagement';
import { AccessoryUsageModal } from './AccessoryUsageModal';
import { AccessoryRemovalModal } from './AccessoryRemovalModal';
import { generateAccessoryUrl } from './lib/accessory-utils';
import type { AccessoryItem, EquipmentConfig } from './lib/accessory-types';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AccessoryInventoryUIProps {
  onAccessoryClick?: (accessory: AccessoryItem) => void;
  onEquippedAccessoryClick?: (accessory: EquipmentConfig) => void;
  selectedAccessory?: EquipmentConfig | null;
  currentAccessory?: EquipmentConfig | null;
  hasUnsavedChanges?: boolean;
  onScaleChange?: (value: number[]) => void;
  onRotationChange?: (value: number[]) => void;
  onSaveChanges?: () => void;
  isUpdating?: boolean;
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

// Helper function to resolve local asset URL with proper fallback chain
function resolveLocalAssetUrl(code: string, slot: string): string {
  if (slot === 'unknown') {
    return ''; // No asset path for unknown slots
  }

  // Try .webp first (better compression), then .png (fallback)
  // For now, return .png as primary since that's what exists in assets
  // The onError handler will try webp first as fallback
  return `/assets/accessories/${slot}/${code}.png`;
}

export function AccessoryInventoryUI({
  onAccessoryClick,
  onEquippedAccessoryClick,
  selectedAccessory,
  currentAccessory,
  hasUnsavedChanges,
  onScaleChange,
  onRotationChange,
  onSaveChanges,
  isUpdating,
  className
}: AccessoryInventoryUIProps) {
  const { data: inventory, isLoading } = useAccessoryInventory();
  const { equipAccessory, isEquipping } = useAccessoryManagement();
  const [selectedInventoryAccessory, setSelectedInventoryAccessory] = useState<AccessoryItem | null>(null);
  const [showUsageModal, setShowUsageModal] = useState(false);

  // Filter inventory to only include accessories with quantity > 0 (already done in hook, but double-check)
  const availableAccessories = inventory?.filter(item => item.quantity > 0) || [];

  const handleAccessoryClick = (accessory: AccessoryItem) => {
    setSelectedInventoryAccessory(accessory);
    setShowUsageModal(true);
    // Also call the original click handler if provided
    onAccessoryClick?.(accessory);
  };

  const handleUseAccessory = async (accessory: AccessoryItem) => {
    // Generate proper URL for the accessory
    const url = generateAccessoryUrl(accessory.code) || '';

    // Create AccessoryEditData object that equipAccessory expects
    const editData = {
      code: accessory.code,
      x: 50,
      y: 50,
      scale: 1.0,
      rot: 0,
      flipX: false,
      refw: 100,
      refh: 100,
      form: 'default' as const,
      url, // Use the generated URL
    };

    try {
      console.log('Equipping accessory with data:', editData);
      // Call equipAccessory with the correct AccessoryEditData format
      await equipAccessory(editData);
      console.log('Successfully equipped accessory');
    } catch (error) {
      console.error('Failed to equip accessory:', error);
      // You might want to show an error message to the user here
      throw error; // Re-throw to let modal handle it
    }
  };

  const handleCloseUsageModal = () => {
    setShowUsageModal(false);
    setSelectedInventoryAccessory(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground text-sm">Loading inventory...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className || ''}`}>
      <Tabs defaultValue="equipped" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-purple-100/60 dark:bg-purple-900/60">
          <TabsTrigger
            value="equipped"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300"
          >
            🎭 Equipped
          </TabsTrigger>
          <TabsTrigger
            value="inventory"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300"
          >
            🎒 Inventory
          </TabsTrigger>
        </TabsList>

        <TabsContent value="equipped" className="mt-4 space-y-4">
          {/* Equipped Accessories Grid */}
          <EquippedAccessoriesGridInternal
            onAccessoryClick={onEquippedAccessoryClick}
            selectedAccessory={selectedAccessory}
          />

          {/* Controls for selected accessory */}
          {currentAccessory && (
            <div className="p-3 bg-blue-50/80 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Editing: {currentAccessory.code}
                </div>
                {hasUnsavedChanges && (
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                    <span className="text-xs text-orange-600 dark:text-orange-400">Unsaved</span>
                  </div>
                )}
              </div>

              {/* Position Info */}
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>Position: {Math.round(currentAccessory.x)}%, {Math.round(currentAccessory.y)}%</div>
                <div>Slot: {currentAccessory.slot}</div>
              </div>

              {/* Scale Control */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-blue-700 dark:text-blue-300">
                    Scale
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {currentAccessory.scale.toFixed(2)}x
                  </span>
                </div>
                <Slider
                  value={[currentAccessory.scale]}
                  onValueChange={onScaleChange}
                  min={0.25}
                  max={2.0}
                  step={0.05}
                  className="w-full"
                />
              </div>

              {/* Rotation Control */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-blue-700 dark:text-blue-300">
                    Rotation
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {currentAccessory.rot}°
                  </span>
                </div>
                <Slider
                  value={[currentAccessory.rot]}
                  onValueChange={onRotationChange}
                  min={-45}
                  max={45}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* Save Button */}
              <Button
                onClick={onSaveChanges}
                disabled={!hasUnsavedChanges || isUpdating}
                size="sm"
                className="w-full"
              >
                {isUpdating ? 'Saving...' : 'Save Changes'}
              </Button>

              <div className="text-xs text-muted-foreground opacity-75">
                💡 Drag to move • Use sliders or scroll to adjust scale/rotation
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          {availableAccessories.length === 0 ? (
            <Card className="border-dashed border-purple-200/60 dark:border-purple-800/60">
              <CardContent className="py-12 px-8 text-center">
                <div className="max-w-sm mx-auto space-y-4">
                  <div className="text-6xl">🎩</div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-purple-700 dark:text-purple-300">
                      No accessories yet
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      You don't own any accessories yet. Collect some to customize your Blobbi!
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-3 gap-3 content-start" style={{ contain: 'content' }}>
              {availableAccessories.map((accessory) => {
                // Resolve local asset URL - never use external URLs
                const imageUrl = resolveLocalAssetUrl(accessory.code, accessory.slot);

                return (
                  <Card
                    key={accessory.code}
                    className={`
                      group rounded-xl border bg-white/70 dark:bg-gray-800/70 backdrop-blur p-2
                      hover:shadow-md transition-all duration-200 hover:scale-105 cursor-pointer
                      focus-within:ring-2 focus-within:ring-purple-500 focus-within:ring-offset-1
                    `}
                    onClick={() => handleAccessoryClick(accessory)}
                  >
                    <CardContent className="p-0">
                      {/* Thumbnail */}
                      <div className="relative w-full aspect-[1/1] overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800 mb-2">
                        <img
                          src={imageUrl}
                          alt={`Accessory ${accessory.code}`}
                          className="w-full h-full object-contain transition-transform group-hover:scale-105"
                          decoding="async"
                          fetchPriority="low"
                          width="100"
                          height="100"
                          onError={(e) => {
                            // Implement fallback chain: .webp -> .png -> legacy misspelled path -> placeholder
                            const target = e.target as HTMLImageElement;
                            const currentSrc = target.src;
                            const webpPath = `/assets/accessories/${accessory.slot}/${accessory.code}.webp`;
                            const pngPath = `/assets/accessories/${accessory.slot}/${accessory.code}.png`;
                            const legacyWebpPath = `/assets/acessories/${accessory.slot}/${accessory.code}.webp`;
                            const legacyPngPath = `/assets/acessories/${accessory.slot}/${accessory.code}.png`;

                            if (!currentSrc.includes(webpPath)) {
                              // Try webp first
                              target.src = webpPath;
                              target.onerror = () => {
                                if (!currentSrc.includes(pngPath)) {
                                  // Then try png
                                  target.src = pngPath;
                                  target.onerror = () => {
                                    if (!currentSrc.includes(legacyWebpPath)) {
                                      // Then try legacy webp
                                      target.src = legacyWebpPath;
                                      target.onerror = () => {
                                        if (!currentSrc.includes(legacyPngPath)) {
                                          // Finally try legacy png
                                          target.src = legacyPngPath;
                                          target.onerror = () => {
                                            // If all fail, show placeholder
                                            target.style.display = 'none';
                                            const placeholder = document.createElement('div');
                                            placeholder.className = 'w-full h-full flex items-center justify-center text-3xl';
                                            placeholder.textContent = getSlotEmoji(accessory.slot);
                                            target.parentElement?.appendChild(placeholder);
                                          };
                                        };
                                      };
                                    };
                                  };
                                };
                              };
                            } else if (!currentSrc.includes(pngPath)) {
                              // Try png next
                              target.src = pngPath;
                              target.onerror = () => {
                                if (!currentSrc.includes(legacyWebpPath)) {
                                  // Then try legacy webp
                                  target.src = legacyWebpPath;
                                  target.onerror = () => {
                                    if (!currentSrc.includes(legacyPngPath)) {
                                      // Finally try legacy png
                                      target.src = legacyPngPath;
                                      target.onerror = () => {
                                        // If all fail, show placeholder
                                        target.style.display = 'none';
                                        const placeholder = document.createElement('div');
                                        placeholder.className = 'w-full h-full flex items-center justify-center text-3xl';
                                        placeholder.textContent = getSlotEmoji(accessory.slot);
                                        target.parentElement?.appendChild(placeholder);
                                      };
                                    };
                                  };
                                };
                              };
                            } else if (!currentSrc.includes(legacyWebpPath)) {
                              // Try legacy webp
                              target.src = legacyWebpPath;
                              target.onerror = () => {
                                if (!currentSrc.includes(legacyPngPath)) {
                                  // Finally try legacy png
                                  target.src = legacyPngPath;
                                  target.onerror = () => {
                                    // If all fail, show placeholder
                                    target.style.display = 'none';
                                    const placeholder = document.createElement('div');
                                    placeholder.className = 'w-full h-full flex items-center justify-center text-3xl';
                                    placeholder.textContent = getSlotEmoji(accessory.slot);
                                    target.parentElement?.appendChild(placeholder);
                                  };
                                };
                              };
                            } else if (!currentSrc.includes(legacyPngPath)) {
                              // Finally try legacy png
                              target.src = legacyPngPath;
                              target.onerror = () => {
                                // If all fail, show placeholder
                                target.style.display = 'none';
                                const placeholder = document.createElement('div');
                                placeholder.className = 'w-full h-full flex items-center justify-center text-3xl';
                                placeholder.textContent = getSlotEmoji(accessory.slot);
                                target.parentElement?.appendChild(placeholder);
                              };
                            } else {
                              // All paths tried, show placeholder
                              target.style.display = 'none';
                              const placeholder = document.createElement('div');
                              placeholder.className = 'w-full h-full flex items-center justify-center text-3xl';
                              placeholder.textContent = getSlotEmoji(accessory.slot);
                              target.parentElement?.appendChild(placeholder);
                            }
                          }}
                        />

                        {/* Quantity badge */}
                        <div className="absolute top-1 left-1">
                          <Badge variant="secondary" className="text-xs px-1.5 py-0.5 bg-black/70 text-white">
                            {accessory.quantity}
                          </Badge>
                        </div>
                      </div>

                      {/* Item Details */}
                      <div className="space-y-1">
                        <h4 className="line-clamp-1 text-xs font-medium text-neutral-800 dark:text-neutral-200">
                          {accessory.code}
                        </h4>
                        <Badge variant="outline" className="text-xs px-1 py-0">
                          {accessory.slot}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Accessory Usage Modal */}
      <AccessoryUsageModal
        isOpen={showUsageModal}
        onClose={handleCloseUsageModal}
        accessory={selectedInventoryAccessory}
        onUseAccessory={handleUseAccessory}
        isUsing={isEquipping}
      />
    </div>
  );
}

// Internal component for Equipped Accessories Grid
function EquippedAccessoriesGridInternal({
  onAccessoryClick,
  selectedAccessory,
  className
}: {
  onAccessoryClick?: (accessory: EquipmentConfig) => void;
  selectedAccessory?: EquipmentConfig | null;
  className?: string;
}) {
  const { equipment, unequipAccessory, isUnequipping } = useAccessoryManagement();
  const [selectedAccessoryForRemoval, setSelectedAccessoryForRemoval] = useState<EquipmentConfig | null>(null);
  const [showRemovalModal, setShowRemovalModal] = useState(false);

  const handleRemoveClick = (accessory: EquipmentConfig, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering card click
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
