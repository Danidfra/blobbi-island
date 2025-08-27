import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAccessoryManagement } from './hooks/useAccessoryManagement';
import type { AccessoryItem } from './lib/accessory-types';

interface AccessoryInventoryGridProps {
  onAccessoryClick: (accessory: AccessoryItem) => void;
  className?: string;
}

export function AccessoryInventoryGrid({ onAccessoryClick, className }: AccessoryInventoryGridProps) {
  const { inventory, equipment } = useAccessoryManagement();

  // Filter inventory to only include accessories with quantity > 0
  const availableAccessories = inventory.filter(item => item.quantity > 0);

  // Create a set of equipped accessory codes for quick lookup
  const equippedCodes = new Set(equipment.map(eq => eq.code));

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
        const isEquipped = equippedCodes.has(accessory.code);
        
        return (
          <Card
            key={accessory.code}
            className={`
              group rounded-xl border bg-white/70 dark:bg-gray-800/70 backdrop-blur p-2 
              hover:shadow-md transition-all duration-200 hover:scale-105 cursor-pointer
              focus-within:ring-2 focus-within:ring-purple-500 focus-within:ring-offset-1
              ${isEquipped ? 'ring-2 ring-purple-500/50' : ''}
            `}
            onClick={() => onAccessoryClick(accessory)}
          >
            <CardContent className="p-0">
              {/* Thumbnail */}
              <div className="relative w-full aspect-[1/1] overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800 mb-2">
                <img
                  src={accessory.url}
                  alt={`Accessory ${accessory.code}`}
                  className="w-full h-full object-contain transition-transform group-hover:scale-105"
                  decoding="async"
                  fetchPriority="low"
                  width="100"
                  height="100"
                  onError={(e) => {
                    // Fallback to placeholder if image fails to load
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    target.parentElement!.innerHTML = `
                      <div class="w-full h-full flex items-center justify-center text-3xl">
                        ${accessory.slot === 'headwear' ? '🎩' : '🕶️'}
                      </div>
                    `;
                  }}
                />
                
                {/* Quantity badge */}
                <div className="absolute top-1 left-1">
                  <Badge variant="secondary" className="text-xs px-1.5 py-0.5 bg-black/70 text-white">
                    {accessory.quantity}
                  </Badge>
                </div>
                
                {/* Equipped indicator */}
                {isEquipped && (
                  <div className="absolute top-1 right-1">
                    <Badge variant="default" className="text-xs px-1.5 py-0.5 bg-purple-600">
                      ✓
                    </Badge>
                  </div>
                )}
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