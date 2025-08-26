import React, { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useToast } from '@/hooks/useToast';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import type { OwnerProfile } from '@/lib/blobbi-types';
import { X } from 'lucide-react';

interface FoodShopModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const shopItems = [
  {
    id: 'apple',
    name: 'Apple',
    imageUrl: '/assets/interactive/food/apple.png',
    price: 10,
  },
  {
    id: 'pizza',
    name: 'Pizza',
    imageUrl: '/assets/interactive/food/pizza.png',
    price: 30,
  },
  {
    id: 'burger',
    name: 'Burger',
    imageUrl: '/assets/interactive/food/burger.png',
    price: 25,
  },
  {
    id: 'cake',
    name: 'Cake',
    imageUrl: '/assets/interactive/food/cake.png',
    price: 20,
  },
  {
    id: 'sushi',
    name: 'Sushi',
    imageUrl: '/assets/interactive/food/sushi.png',
    price: 40,
  },
];

type DeliveryOption = 'home' | 'blobbi';

function useBlobbiEvents() {
  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  const useUpdateOwnerProfile = () => useMutation({
    mutationFn: async (updatedProfile: OwnerProfile) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      // Create owner profile tags preserving all existing data
      const ownerTags = [
        ['d', updatedProfile.id],
        ['name', updatedProfile.name],
        ['coins', updatedProfile.coins.toString()],
        ['pettingLevel', updatedProfile.pettingLevel.toString()],
        ['lifetimeBlobbis', updatedProfile.lifetimeBlobbis.toString()],
      ];

      // Add optional single-value tags
      if (updatedProfile.favoriteBlobbi) ownerTags.push(['favoriteBlobbi', updatedProfile.favoriteBlobbi]);
      if (updatedProfile.starterBlobbi) ownerTags.push(['starterBlobbi', updatedProfile.starterBlobbi]);
      if (updatedProfile.currentCompanion) ownerTags.push(['current_companion', updatedProfile.currentCompanion]);
      if (updatedProfile.style) ownerTags.push(['style', updatedProfile.style]);
      if (updatedProfile.background) ownerTags.push(['background', updatedProfile.background]);
      if (updatedProfile.title) ownerTags.push(['title', updatedProfile.title]);

      // Add multi-value tags
      updatedProfile.ownedPets.forEach(petId => ownerTags.push(['has', petId]));
      updatedProfile.achievements.forEach(achievement => ownerTags.push(['achievements', achievement]));
      updatedProfile.inventory.forEach(item => ownerTags.push(['storage', `${item.itemId}:${item.quantity}`]));

      // Always preserve the client tag as a convention
      if (updatedProfile.client) ownerTags.push(['client', updatedProfile.client]);

      createEvent({
        kind: 31125,
        content: `Owner profile: ${updatedProfile.name}`,
        tags: ownerTags,
      });

      return updatedProfile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-profile', user?.pubkey] });
      queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user?.pubkey] });
    },
  });

  const { mutateAsync: updateOwnerProfile } = useUpdateOwnerProfile();

  const publishOwnerProfile = (profile: OwnerProfile) => {
    return updateOwnerProfile(profile);
  };

  return { publishOwnerProfile };
}

export function FoodShopModal({ isOpen, onClose }: FoodShopModalProps) {
  const { status } = useOptimizedStatus();
  const { publishOwnerProfile } = useBlobbiEvents();
  const { toast } = useToast();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption>('home');

  const userCoins = status.owner?.coins ?? 0;
  const currentPetId = status.currentPet?.id;

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const totalCost = useMemo(() => {
    return Object.entries(quantities).reduce((total, [itemId, quantity]) => {
      const item = shopItems.find(i => i.id === itemId);
      return total + (item?.price ?? 0) * quantity;
    }, 0);
  }, [quantities]);

  const canAfford = userCoins >= totalCost;

  const handleQuantityChange = (itemId: string, value: string) => {
    const quantity = parseInt(value, 10);
    if (!isNaN(quantity) && quantity >= 0) {
      setQuantities(prev => ({ ...prev, [itemId]: quantity }));
    }
  };

  const handleConfirmPurchase = async () => {
    if (!status.owner) {
      toast({ title: 'Error', description: 'Owner profile not found.', variant: 'destructive' });
      return;
    }
    if (totalCost === 0) {
      toast({ title: 'Empty Cart', description: 'Please select items to buy.', variant: 'destructive' });
      return;
    }
    if (!canAfford) {
      toast({ title: 'Not Enough Coins', description: 'You cannot afford these items.', variant: 'destructive' });
      return;
    }

    const newCoins = userCoins - totalCost;
    const newInventory = [...status.owner.inventory];

    Object.entries(quantities).forEach(([itemId, quantity]) => {
      if (quantity > 0) {
        // Ensure item ID has the food_ prefix for storage
        const prefixedItemId = itemId.startsWith('food_') ? itemId : `food_${itemId}`;

        const existingItem = newInventory.find(item => item.itemId === prefixedItemId);
        if (existingItem) {
          existingItem.quantity += quantity;
        } else {
          newInventory.push({ itemId: prefixedItemId, quantity });
        }
      }
    });

    await publishOwnerProfile({
      ...status.owner,
      coins: newCoins,
      inventory: newInventory,
    });

    toast({
      title: 'Purchase Successful',
      description: `You spent ${totalCost} coins. Your items are in your inventory.`,
    });

    setQuantities({});
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="w-[95%] h-full max-w-lg blobbi-card-xl border-4 border-purple-300 dark:border-purple-600 rounded-lg shadow-lg theme-transition flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-purple-200/60 dark:border-purple-800/60 relative">
          <h2 className="text-2xl font-bold text-center bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
            🍎 Food Shop
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute top-2 right-2 h-8 w-8 rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 flex-1 overflow-y-hidden flex flex-col">
          <ScrollArea className="flex-1 -mr-4 pr-4">
            <div className="grid grid-cols-2 gap-4">
              {shopItems.map(item => (
                <Card key={item.id} className="overflow-hidden blobbi-card blobbi-hover h-full">
                 <div className='w-auto h-24'>
                  <CardHeader className="p-0 items-center justify-center h-full">
                    <img src={item.imageUrl} alt={item.name} className="object-cover" />
                  </CardHeader>
                 </div>
                  <CardContent className="p-3 text-center">
                    <p className="font-bold blobbi-text">{item.name}</p>
                    <p className="icon-yellow font-semibold">{item.price} coins</p>
                  </CardContent>
                  <CardFooter className="p-3">
                    <Input
                      type="number"
                      min="0"
                      value={quantities[item.id] || ''}
                      onChange={e => handleQuantityChange(item.id, e.target.value)}
                      placeholder="0"
                      className="w-full text-center blobbi-button border-purple-200 dark:border-purple-700"
                    />
                  </CardFooter>
                </Card>
              ))}
            </div>
          </ScrollArea>

          <div className="mt-4">
            <h3 className="font-bold text-lg mb-2 blobbi-text">Delivery Options</h3>
            <RadioGroup value={deliveryOption} onValueChange={(value: DeliveryOption) => setDeliveryOption(value)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="home" id="home" />
                <Label htmlFor="home" className="blobbi-text">Deliver to home</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="blobbi" id="blobbi" disabled={!currentPetId} />
                <Label htmlFor="blobbi" className="blobbi-text">Add to Blobbi inventory</Label>
              </div>
            </RadioGroup>
            {!currentPetId && <p className="text-xs blobbi-text-muted mt-1">Select a Blobbi to enable Blobbi inventory delivery.</p>}
          </div>

          <div className="mt-4 p-4 blobbi-card rounded-lg border-purple-200 dark:border-purple-700">
            <div className="flex justify-between items-center">
              <span className="font-bold text-lg blobbi-text">Total Cost:</span>
              <span className="font-bold text-lg icon-yellow">{totalCost} coins</span>
            </div>
            <div className="text-right text-sm blobbi-text-muted">
              Your balance: <span className="icon-yellow font-semibold">{userCoins} coins</span>
            </div>
            {!canAfford && <p className="text-red-500 dark:text-red-400 text-sm text-center mt-2">You don't have enough coins!</p>}
          </div>
        </div>

        <div className="p-4 border-t border-purple-200/60 dark:border-purple-800/60 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20">
            Cancel
          </Button>
          <Button
            onClick={handleConfirmPurchase}
            disabled={!canAfford || totalCost === 0}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 font-medium theme-transition"
          >
            Confirm Purchase
          </Button>
        </div>
      </div>
    </div>
  );
}