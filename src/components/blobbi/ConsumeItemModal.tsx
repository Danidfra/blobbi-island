import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus, Heart, Zap, Sparkles, Droplets } from 'lucide-react';
import { cn } from '@/lib/utils';

// Food item data with effects
interface FoodItemData {
  id: string;
  name: string;
  imageUrl: string;
  effects: {
    hunger?: number;
    energy?: number;
    hygiene?: number;
    happiness?: number;
    health?: number;
  };
}

// Food items database
const FOOD_ITEMS: Record<string, FoodItemData> = {
  apple: {
    id: 'apple',
    name: 'Apple',
    imageUrl: '/assets/interactive/food/apple.png',
    effects: {
      hunger: 15,
      energy: 5,
      hygiene: 2,
    },
  },
  pizza: {
    id: 'pizza',
    name: 'Pizza',
    imageUrl: '/assets/interactive/food/pizza.png',
    effects: {
      hunger: 35,
      happiness: 10,
      energy: 8,
    },
  },
  burger: {
    id: 'burger',
    name: 'Burger',
    imageUrl: '/assets/interactive/food/burger.png',
    effects: {
      hunger: 30,
      happiness: 8,
      energy: 12,
    },
  },
  cake: {
    id: 'cake',
    name: 'Cake',
    imageUrl: '/assets/interactive/food/cake.png',
    effects: {
      hunger: 20,
      happiness: 25,
      energy: 15,
    },
  },
  sushi: {
    id: 'sushi',
    name: 'Sushi',
    imageUrl: '/assets/interactive/food/sushi.png',
    effects: {
      hunger: 25,
      health: 10,
      hygiene: 5,
    },
  },
};

// Effect icons mapping
const EFFECT_ICONS = {
  hunger: Heart,
  energy: Zap,
  hygiene: Droplets,
  happiness: Sparkles,
  health: Heart,
} as const;

interface ConsumeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemId: string;
  maxQuantity: number;
  onUseItem: (itemId: string, quantity: number) => void;
}

export function ConsumeItemModal({
  isOpen,
  onClose,
  itemId,
  maxQuantity,
  onUseItem,
}: ConsumeItemModalProps) {
  const [quantity, setQuantity] = useState(1);

  const foodItem = FOOD_ITEMS[itemId];

  // Calculate total effects based on quantity
  const totalEffects = useMemo(() => {
    if (!foodItem) return {};

    const effects: Record<string, number> = {};
    Object.entries(foodItem.effects).forEach(([key, value]) => {
      effects[key] = value * quantity;
    });
    return effects;
  }, [foodItem, quantity]);

  const handleQuantityChange = (newQuantity: number) => {
    setQuantity(Math.max(1, Math.min(maxQuantity, newQuantity)));
  };

  const handleUse = () => {
    onUseItem(itemId, quantity);
    onClose();
  };

  const handleClose = () => {
    setQuantity(1);
    onClose();
  };

  if (!foodItem) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="p-0 bg-transparent border-none max-w-sm w-full">
        <DialogTitle className="sr-only">Consume Item Modal</DialogTitle>
        <DialogDescription className="sr-only">Select quantity and confirm usage</DialogDescription>
        <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-700/50">
          {/* Decorative gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-pink-500/10 rounded-3xl pointer-events-none" />

          {/* Content */}
          <div className="relative space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-white">Use Item</h2>
              <p className="text-slate-300 text-sm">Select quantity and confirm usage</p>
            </div>

            {/* Selected Item Section */}
            <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-600/30">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 bg-slate-700/50 rounded-xl flex items-center justify-center border border-slate-600/30">
                  <img
                    src={foodItem.imageUrl}
                    alt={foodItem.name}
                    className="w-12 h-12 object-contain"
                  />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">{foodItem.name}</h3>
                </div>
              </div>
            </div>

            {/* Quantity Selector */}
            <div className="space-y-3">
              <h4 className="text-white font-medium">Quantity:</h4>
              <div className="flex items-center space-x-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuantityChange(quantity - 1)}
                  disabled={quantity <= 1}
                  className="w-10 h-10 p-0 bg-slate-700/50 border-slate-600/50 hover:bg-slate-600/50 text-white"
                  aria-label="Decrease quantity"
                >
                  <Minus className="w-4 h-4" />
                </Button>

                <div className="flex-1 relative">
                  <Input
                    type="number"
                    value={quantity}
                    onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
                    min={1}
                    max={maxQuantity}
                    className="text-center bg-slate-700/50 border-slate-600/50 text-white placeholder-slate-400 focus:border-blue-400/50"
                  />
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuantityChange(quantity + 1)}
                  disabled={quantity >= maxQuantity}
                  className="w-10 h-10 p-0 bg-slate-700/50 border-slate-600/50 hover:bg-slate-600/50 text-white"
                  aria-label="Increase quantity"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-slate-400 text-center">Max: {maxQuantity}</p>
            </div>

            {/* Total Effects Preview */}
            <div className="space-y-3">
              <h4 className="text-white font-medium">Item Effects (total):</h4>
              <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-600/30">
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(totalEffects).map(([effect, value]) => {
                    const Icon = EFFECT_ICONS[effect as keyof typeof EFFECT_ICONS];
                    return (
                      <div key={effect} className="flex items-center space-x-2">
                        <Icon className="w-4 h-4 text-blue-400" />
                        <span className="text-sm text-white capitalize">
                          +{value} {effect}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Per Item Effects */}
            <div className="space-y-3">
              <h4 className="text-white font-medium">Item Effects (per item):</h4>
              <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-600/30">
                <div className="space-y-2">
                  {Object.entries(foodItem.effects).map(([effect, value]) => {
                    const Icon = EFFECT_ICONS[effect as keyof typeof EFFECT_ICONS];
                    return (
                      <div key={effect} className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Icon className="w-4 h-4 text-slate-400" />
                          <span className="text-sm text-slate-300 capitalize">{effect}:</span>
                        </div>
                        <span className="text-sm text-white">+{value}</span>
                      </div>
                    );
                  })}
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
                onClick={handleUse}
                className={cn(
                  "flex-1 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700",
                  "text-white font-medium shadow-lg hover:shadow-xl transition-all duration-200",
                  "border-0"
                )}
              >
                Use
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}