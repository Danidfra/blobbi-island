
import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
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
import type { OwnerProfile, CreateOwnerProfileInput } from '@/lib/blobbi-types';

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
    mutationFn: async (updates: Partial<CreateOwnerProfileInput>) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      const existingProfile = queryClient.getQueryData(['owner-profile', user.pubkey]) as OwnerProfile | null;

      const mergedData: CreateOwnerProfileInput = {
        profileId: updates.profileId || existingProfile?.id || 'profile',
        name: updates.name !== undefined ? updates.name : (existingProfile?.name || ''),
        coins: updates.coins !== undefined ? updates.coins : existingProfile?.coins,
        inventory: updates.inventory !== undefined ? updates.inventory : existingProfile?.inventory,
      };

      const tags: string[][] = [
        ['d', mergedData.profileId],
        ['name', mergedData.name],
      ];
      if (mergedData.coins !== undefined) tags.push(['coins', mergedData.coins.toString()]);
      if (mergedData.inventory) {
        mergedData.inventory.forEach(item => tags.push(['storage', `${item.itemId}:${item.quantity}`]));
      }

      createEvent({
        kind: 31125,
        content: `Updated owner profile: ${mergedData.name}`,
        tags,
      });

      return mergedData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-profile', user?.pubkey] });
    },
  });

  const { mutateAsync: updateOwnerProfile } = useUpdateOwnerProfile();

  const publishOwnerProfile = (profile: OwnerProfile) => {
    const input: CreateOwnerProfileInput = {
      profileId: profile.id,
      name: profile.name,
      coins: profile.coins,
      inventory: profile.inventory,
    };
    return updateOwnerProfile(input);
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
        const existingItem = newInventory.find(item => item.itemId === itemId);
        if (existingItem) {
          existingItem.quantity += quantity;
        } else {
          newInventory.push({ itemId, quantity });
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-full bg-white/90 backdrop-blur-sm border-4 border-blue-300 rounded-lg shadow-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center text-blue-800">
            Food Shop
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[400px] pr-4">
          <div className="grid grid-cols-2 gap-4">
            {shopItems.map(item => (
              <Card key={item.id} className="overflow-hidden">
                <CardHeader className="p-0">
                  <img src={item.imageUrl} alt={item.name} className="w-full h-24 object-cover" />
                </CardHeader>
                <CardContent className="p-3 text-center">
                  <p className="font-bold">{item.name}</p>
                  <p className="text-yellow-600">{item.price} coins</p>
                </CardContent>
                <CardFooter className="p-3">
                  <Input
                    type="number"
                    min="0"
                    value={quantities[item.id] || ''}
                    onChange={e => handleQuantityChange(item.id, e.target.value)}
                    placeholder="0"
                    className="w-full text-center"
                  />
                </CardFooter>
              </Card>
            ))}
          </div>
        </ScrollArea>

        <div className="mt-4">
          <h3 className="font-bold text-lg mb-2">Delivery Options</h3>
          <RadioGroup value={deliveryOption} onValueChange={(value: DeliveryOption) => setDeliveryOption(value)}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="home" id="home" />
              <Label htmlFor="home">Deliver to home</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="blobbi" id="blobbi" disabled={!currentPetId} />
              <Label htmlFor="blobbi">Add to Blobbi inventory</Label>
            </div>
          </RadioGroup>
          {!currentPetId && <p className="text-xs text-muted-foreground mt-1">Select a Blobbi to enable Blobbi inventory delivery.</p>}
        </div>

        <div className="mt-4 p-4 bg-blue-50 rounded-lg">
          <div className="flex justify-between items-center">
            <span className="font-bold text-lg">Total Cost:</span>
            <span className="font-bold text-lg text-yellow-700">{totalCost} coins</span>
          </div>
          <div className="text-right text-sm">
            Your balance: {userCoins} coins
          </div>
          {!canAfford && <p className="text-red-500 text-sm text-center mt-2">You don't have enough coins!</p>}
        </div>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleConfirmPurchase} disabled={!canAfford || totalCost === 0}>
            Confirm Purchase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
