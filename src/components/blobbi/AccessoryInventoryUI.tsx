import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAccessoryInventoryUI } from './hooks/useAccessoryManagement';
import type { AccessoryItem } from './lib/accessory-types';

interface AccessoryInventoryUIProps {
  onAccessoryClick?: (accessory: AccessoryItem) => void;
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

// Helper function to resolve local asset URL
function resolveLocalAssetUrl(code: string, slot: string): string {
  if (slot === 'unknown') {
    return ''; // No asset path for unknown slots
  }

  // Try primary path first - PNG format for maximum compatibility
  return `/assets/accessories/${slot}/${code}.png`;
}

export function AccessoryInventoryUI({ onAccessoryClick, className }: AccessoryInventoryUIProps) {
  const { data: inventory, isLoading } = useAccessoryInventoryUI();

  // Filter inventory to only include accessories with quantity > 0 (already done in hook, but double-check)
  const availableAccessories = inventory?.filter(item => item.quantity > 0) || [];

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

  if (availableAccessories.length === 0) {
    return (
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
    );
  }

  return (
    <div className={`grid grid-cols-3 gap-3 content-start ${className || ''}`} style={{ contain: 'content' }}>
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
            onClick={() => onAccessoryClick?.(accessory)}
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
                    // Try legacy misspelled path first
                    const target = e.target as HTMLImageElement;
                    const currentSrc = target.src;
                    const legacyPath = `/assets/acessories/${accessory.slot}/${accessory.code}.png`;

                    if (!currentSrc.includes(legacyPath)) {
                      // Try legacy path
                      target.src = legacyPath;
                      target.onerror = () => {
                        // If legacy path also fails, show placeholder
                        target.style.display = 'none';
                        const placeholder = document.createElement('div');
                        placeholder.className = 'w-full h-full flex items-center justify-center text-3xl';
                        placeholder.textContent = getSlotEmoji(accessory.slot);
                        target.parentElement?.appendChild(placeholder);
                      };
                    } else {
                      // Already tried legacy path, show placeholder
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
  );
}