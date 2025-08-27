import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@/hooks/useNostr';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useQuery } from '@tanstack/react-query';
import { parseInvTags, parseEquipTags, updateInvTags, updateEquipTags, inferSlotFromCode, generateAccessoryUrl, updateInventoryQuantity } from './lib/accessory-utils';
import { Plus, Minus, Trash2, Settings, Save } from 'lucide-react';
import type { EquipmentConfig, AccessoryForm } from './lib/accessory-types';

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development';

interface DebugAccessoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Available accessory codes for quick selection
const ACCESSORY_CODES = [
  'headwear-1', 'headwear-2', 'headwear-3',
  'eyewear-2', 'eyewear-3', 'eyewear-4',
  'back-1', 'neckwear-1', 'handheld-1',
  'face-mark-1', 'aura-1', 'color-overlay-1'
];

const FORMS = ['default', 'baby', 'teen', 'adult'] as const;

function DebugInventoryTab() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutate: createEvent } = useNostrPublish();

  // Fetch current inventory
  const { data: inventory, refetch: refetchInventory } = useQuery({
    queryKey: ['debug-inventory', user?.pubkey],
    queryFn: async () => {
      if (!user?.pubkey) return [];

      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1,
      }]);

      if (events.length === 0) return [];
      return parseInvTags(events[0].tags);
    },
    enabled: !!user?.pubkey,
  });

  const [newCode, setNewCode] = useState('');
  const [newQty, setNewQty] = useState('1');

  const handleAddInventory = async () => {
    if (!user?.pubkey || !newCode || !newQty) return;

    try {
      const qty = parseInt(newQty);
      if (isNaN(qty) || qty <= 0) return;

      // Get current event
      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1,
      }]);

      let currentTags: string[][] = [];
      let content = '';

      if (events.length > 0) {
        currentTags = events[0].tags;
        content = events[0].content;
      }

      // Parse current inventory
      const currentInventory = parseInvTags(currentTags);

      // Update or add the item

      const updatedInventory = updateInventoryQuantity(currentInventory, newCode, qty);

      // Create new event
      const newTags = updateInvTags(currentTags, updatedInventory);

      createEvent({
        kind: 31125,
        content,
        tags: newTags,
      });

      // Refresh and reset
      refetchInventory();
      setNewCode('');
      setNewQty('1');
    } catch (error) {
      console.error('Failed to add inventory:', error);
    }
  };

  const handleUpdateQty = async (code: string, delta: number) => {
    if (!user?.pubkey) return;

    try {
      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1,
      }]);

      if (events.length === 0) return;

      const currentTags = events[0].tags;
      const currentInventory = parseInvTags(currentTags);
      const updatedInventory = updateInventoryQuantity(currentInventory, code, delta);

      const newTags = updateInvTags(currentTags, updatedInventory);

      createEvent({
        kind: 31125,
        content: events[0].content,
        tags: newTags,
      });

      refetchInventory();
    } catch (error) {
      console.error('Failed to update inventory:', error);
    }
  };

  const handleRemove = async (code: string) => {
    if (!user?.pubkey) return;

    try {
      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1,
      }]);

      if (events.length === 0) return;

      const currentTags = events[0].tags;
      const currentInventory = parseInvTags(currentTags);
      const updatedInventory = currentInventory.filter(item => item.code !== code);

      const newTags = updateInvTags(currentTags, updatedInventory);

      createEvent({
        kind: 31125,
        content: events[0].content,
        tags: newTags,
      });

      refetchInventory();
    } catch (error) {
      console.error('Failed to remove inventory:', error);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add new inventory item */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Add Inventory Item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="code" className="text-xs">Code</Label>
              <Select value={newCode} onValueChange={setNewCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Select code" />
                </SelectTrigger>
                <SelectContent>
                  {ACCESSORY_CODES.map(code => (
                    <SelectItem key={code} value={code}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="qty" className="text-xs">Quantity</Label>
              <Input
                id="qty"
                type="number"
                min="1"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                className="h-8"
              />
            </div>
          </div>
          <Button onClick={handleAddInventory} size="sm" className="w-full">
            <Plus className="h-3 w-3 mr-1" />
            Add to Inventory
          </Button>
        </CardContent>
      </Card>

      {/* Current inventory */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Current Inventory (31125)</CardTitle>
        </CardHeader>
        <CardContent>
          {inventory && inventory.length > 0 ? (
            <div className="space-y-2">
              {inventory.map((item) => (
                <div key={item.code} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{item.code}</Badge>
                    <Badge variant="secondary" className="text-xs">Qty: {item.quantity}</Badge>
                    <Badge variant="outline" className="text-xs">{item.slot}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUpdateQty(item.code, 1)}
                      className="h-6 w-6 p-0"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUpdateQty(item.code, -1)}
                      className="h-6 w-6 p-0"
                      disabled={item.quantity <= 1}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleRemove(item.code)}
                      className="h-6 w-6 p-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No inventory items found</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DebugEquipTab() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutate: createEvent } = useNostrPublish();

  // Fetch current companion from kind 31125 to determine which Blobbi's 31124 to modify
  const [currentCompanion, setCurrentCompanion] = useState<string | null>(null);

  // Fetch current companion from user's kind 31125
  const { data: companionData } = useQuery({
    queryKey: ['current-companion', user?.pubkey],
    queryFn: async () => {
      if (!user?.pubkey) return null;

      const events = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1,
      }]);

      if (events.length === 0) return null;

      // Find current_companion tag
      const companionTag = events[0].tags.find(([name]) => name === 'current_companion');
      return companionTag ? companionTag[1] : null;
    },
    enabled: !!user?.pubkey,
  });

  // Update current companion when data changes
  useEffect(() => {
    if (companionData) {
      setCurrentCompanion(companionData);
    }
  }, [companionData]);

  const { data: equipment, refetch: refetchEquipment } = useQuery({
    queryKey: ['debug-equipment', user?.pubkey, currentCompanion],
    queryFn: async () => {
      if (!user?.pubkey || !currentCompanion) return [];

      const events = await nostr.query([{
        kinds: [31124],
        authors: [user.pubkey],
        '#d': [currentCompanion],
        limit: 1,
      }]);

      if (events.length === 0) return [];
      return parseEquipTags(events[0].tags);
    },
    enabled: !!user?.pubkey && !!currentCompanion,
  });

  const [newEquipCode, setNewEquipCode] = useState('');
  const [equipForm, setEquipForm] = useState<AccessoryForm>('default');

  const handleEquip = async () => {
    if (!user?.pubkey || !newEquipCode || !currentCompanion) return;

    try {
      // Get existing 31124 event for current companion
      const events = await nostr.query([{
        kinds: [31124],
        authors: [user.pubkey],
        '#d': [currentCompanion],
        limit: 1,
      }]);

      if (events.length === 0) {
        console.warn('No 31124 event found for companion:', currentCompanion);
        return;
      }

      const existingEvent = events[0];
      const currentTags = existingEvent.tags;
      const content = existingEvent.content;

      // Create new equipment config
      const url = generateAccessoryUrl(newEquipCode) || '';
      const slot = inferSlotFromCode(newEquipCode);
      const newConfig: EquipmentConfig = {
        code: newEquipCode,
        x: 50,
        y: 50,
        scale: 1.0,
        rot: 0,
        flipX: false,
        refw: 100,
        refh: 100,
        form: equipForm,
        url,
        slot,
      };

      // Remove existing equipment in same slot and add new
      const currentEquipment = parseEquipTags(currentTags);
      const filteredEquipment = currentEquipment.filter(eq => eq.slot !== slot);
      const updatedEquipment = [...filteredEquipment, newConfig];

      // Update only equip tags, preserve all other tags and content
      const newTags = updateEquipTags(currentTags, updatedEquipment);

      // Publish updated event as replacement (same d tag)
      createEvent({
        kind: 31124,
        content, // Keep original content unchanged
        tags: newTags,
        d: currentCompanion, // Use same d tag as original
      });

      // Also decrement inventory
      const inventoryEvents = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1,
      }]);

      if (inventoryEvents.length > 0) {
        const inventoryTags = inventoryEvents[0].tags;
        const currentInventory = parseInvTags(inventoryTags);
        const updatedInventory = updateInventoryQuantity(currentInventory, newEquipCode, -1);

        const newInventoryTags = updateInvTags(inventoryTags, updatedInventory);

        createEvent({
          kind: 31125,
          content: inventoryEvents[0].content,
          tags: newInventoryTags,
        });
      }

      // Refresh and reset
      refetchEquipment();
      setNewEquipCode('');
      setEquipForm('default');
    } catch (error) {
      console.error('Failed to equip item:', error);
    }
  };

  const handleUnequip = async (code: string) => {
    if (!user?.pubkey || !currentCompanion) return;

    try {
      // Get existing 31124 event for current companion
      const events = await nostr.query([{
        kinds: [31124],
        authors: [user.pubkey],
        '#d': [currentCompanion],
        limit: 1,
      }]);

      if (events.length === 0) {
        console.warn('No 31124 event found for companion:', currentCompanion);
        return;
      }

      const existingEvent = events[0];
      const currentTags = existingEvent.tags;
      const currentEquipment = parseEquipTags(currentTags);
      const updatedEquipment = currentEquipment.filter(eq => eq.code !== code);

      // Update only equip tags, preserve all other tags and content
      const newTags = updateEquipTags(currentTags, updatedEquipment);

      // Publish updated event as replacement (same d tag)
      createEvent({
        kind: 31124,
        content: existingEvent.content, // Keep original content unchanged
        tags: newTags,
        d: currentCompanion, // Use same d tag as original
      });

      // Also increment inventory
      const inventoryEvents = await nostr.query([{
        kinds: [31125],
        authors: [user.pubkey],
        limit: 1,
      }]);

      if (inventoryEvents.length > 0) {
        const inventoryTags = inventoryEvents[0].tags;
        const currentInventory = parseInvTags(inventoryTags);
        const updatedInventory = updateInventoryQuantity(currentInventory, code, 1);

        const newInventoryTags = updateInvTags(inventoryTags, updatedInventory);

        createEvent({
          kind: 31125,
          content: inventoryEvents[0].content,
          tags: newInventoryTags,
        });
      }

      refetchEquipment();
    } catch (error) {
      console.error('Failed to unequip item:', error);
    }
  };

  return (
    <div className="space-y-4">
      {/* Current Companion Info */}
      {currentCompanion && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Current Companion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              Editing 31124 event for: <code className="bg-muted px-1 py-0.5 rounded text-xs">{currentCompanion}</code>
            </div>
          </CardContent>
        </Card>
      )}

      {!currentCompanion && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground text-center">
              No current companion found. Please set a current companion in kind 31125.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Equip new item */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Equip Item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Code</Label>
              <Select value={newEquipCode} onValueChange={setNewEquipCode} disabled={!currentCompanion}>
                <SelectTrigger>
                  <SelectValue placeholder="Select code" />
                </SelectTrigger>
                <SelectContent>
                  {ACCESSORY_CODES.map(code => (
                    <SelectItem key={code} value={code}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Form</Label>
              <Select value={equipForm} onValueChange={(value: AccessoryForm) => setEquipForm(value)} disabled={!currentCompanion}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMS.map(form => (
                    <SelectItem key={form} value={form}>{form}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleEquip} size="sm" className="w-full" disabled={!currentCompanion || !newEquipCode}>
            <Save className="h-3 w-3 mr-1" />
            Equip Item
          </Button>
        </CardContent>
      </Card>

      {/* Current equipment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Current Equipment (31124)</CardTitle>
        </CardHeader>
        <CardContent>
          {equipment && equipment.length > 0 ? (
            <div className="space-y-2">
              {equipment.map((item) => (
                <div key={item.code} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{item.code}</Badge>
                    <Badge variant="secondary" className="text-xs">{item.slot}</Badge>
                    <Badge variant="outline" className="text-xs">{item.form}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {item.x},{item.y} scale:{item.scale}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleUnequip(item.code)}
                    className="h-6 w-6 p-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No equipment found</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function DebugAccessoriesModal({ isOpen, onClose }: DebugAccessoriesModalProps) {
  if (!isDevelopment) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Debug Accessories (Development Only)
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <Tabs defaultValue="inventory" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="inventory">Inventory (31125)</TabsTrigger>
              <TabsTrigger value="equip">Equipment (31124)</TabsTrigger>
            </TabsList>

            <TabsContent value="inventory" className="mt-4">
              <DebugInventoryTab />
            </TabsContent>

            <TabsContent value="equip" className="mt-4">
              <DebugEquipTab />
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}