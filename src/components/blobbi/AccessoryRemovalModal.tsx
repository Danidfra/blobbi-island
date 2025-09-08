import React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveAccessoryImageUrl } from './lib/accessory-utils';
import type { EquipmentConfig } from './lib/accessory-types';

interface AccessoryRemovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessory: EquipmentConfig | null;
  onRemoveAccessory?: (accessory: EquipmentConfig) => Promise<void>;
  isRemoving?: boolean;
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

export function AccessoryRemovalModal({ isOpen, onClose, accessory, onRemoveAccessory, isRemoving = false }: AccessoryRemovalModalProps) {
  if (!accessory) {
    return null;
  }

  // Resolve image URL from local assets first
  const imageUrl = resolveAccessoryImageUrl(accessory.code, accessory.slot, accessory.url);

  const handleRemove = async () => {
    try {
      // Call the provided onRemoveAccessory function
      await onRemoveAccessory?.(accessory);
      onClose();
    } catch (error) {
      console.error('Failed to remove accessory:', error);
    }
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="p-0 bg-transparent border-none max-w-sm w-full">
        <DialogTitle className="sr-only">Remove Accessory Modal</DialogTitle>
        <DialogDescription className="sr-only">Confirm accessory removal</DialogDescription>
        <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-700/50">
          {/* Decorative gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 via-red-500/5 to-pink-500/10 rounded-3xl pointer-events-none" />

          {/* Content */}
          <div className="relative space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-white">Remove Accessory</h2>
              <p className="text-slate-300 text-sm">Store this accessory back in your inventory</p>
            </div>

            {/* Selected Accessory Section */}
            <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-600/30">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 bg-slate-700/50 rounded-xl flex items-center justify-center border border-slate-600/30">
                  <img
                    src={imageUrl}
                    alt={`Accessory ${accessory.code}`}
                    className="w-12 h-12 object-contain"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const placeholder = document.createElement('div');
                      placeholder.className = 'w-full h-full flex items-center justify-center text-2xl';
                      placeholder.textContent = getSlotEmoji(accessory.slot);
                      target.parentElement?.appendChild(placeholder);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white">{accessory.code}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
                      {accessory.slot}
                    </Badge>
                    <Badge variant="secondary" className="text-xs bg-slate-700 text-slate-300">
                      {accessory.scale.toFixed(1)}x
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Removal Effect Preview */}
            <div className="space-y-3">
              <h4 className="text-white font-medium flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-400" />
                What will happen:
              </h4>
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/30 space-y-3">
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs text-red-400">−</span>
                    </div>
                    <div>
                      <p className="text-sm text-slate-300">Unequip from Blobbi</p>
                      <p className="text-xs text-slate-400">This accessory will be removed from your current Blobbi</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs text-green-400">+</span>
                    </div>
                    <div>
                      <p className="text-sm text-slate-300">Add to inventory</p>
                      <p className="text-xs text-slate-400">The accessory will be available in your inventory again</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Package className="w-3 h-3 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm text-slate-300">Quantity increases</p>
                      <p className="text-xs text-slate-400">Your inventory count for this accessory will increase by 1</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Technical Details */}
            <div className="space-y-3">
              <h4 className="text-white font-medium">Technical Details:</h4>
              <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-600/30">
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Remove tag from:</span>
                    <code className="bg-slate-700 px-2 py-1 rounded text-slate-300">
                      kind 31124
                    </code>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Add tag:</span>
                    <code className="bg-slate-700 px-2 py-1 rounded text-slate-300">
                      inv {accessory.code}
                    </code>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-2">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1 bg-slate-700/50 border-slate-600/50 hover:bg-slate-600/50 text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={handleRemove}
                disabled={isRemoving}
                className={cn(
                  "flex-1 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700",
                  "text-white font-medium shadow-lg hover:shadow-xl transition-all duration-200",
                  "border-0 disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {isRemoving ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    Removing...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Remove it
                  </div>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
