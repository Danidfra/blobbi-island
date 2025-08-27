import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useAccessoryManagement } from './hooks/useAccessoryManagement';
import { X, Save, Trash2 } from 'lucide-react';
import type { AccessoryItem, AccessoryForm } from './lib/accessory-types';
import { generateAccessoryUrl } from './lib/accessory-utils';

interface AccessoryEditPanelProps {
  accessory: AccessoryItem;
  onClose: () => void;
}

export function AccessoryEditPanel({ accessory, onClose }: AccessoryEditPanelProps) {
  const { equipment, equipAccessory, unequipAccessory, isEquipping, isUnequipping } = useAccessoryManagement();

  // Find current equipment for this accessory or same slot
  const currentEquipment = equipment.find(eq => eq.code === accessory.code);
  const slotEquipment = equipment.find(eq => eq.slot === accessory.slot);

  // Initialize form data
  const [formData, setFormData] = useState(() => {
    const defaults = {
      x: 50,
      y: 50,
      scale: 1.0,
      rot: 0,
      flipX: false,
      form: 'default' as const,
      refw: 100,
      refh: 100,
      url: generateAccessoryUrl(accessory.code) || '',
    };

    if (currentEquipment) {
      return {
        x: currentEquipment.x,
        y: currentEquipment.y,
        scale: currentEquipment.scale,
        rot: currentEquipment.rot,
        flipX: currentEquipment.flipX,
        form: currentEquipment.form,
        refw: currentEquipment.refw,
        refh: currentEquipment.refh,
        url: currentEquipment.url || '',
      };
    }

    return defaults;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleInputChange = (field: keyof typeof formData, value: string | number | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));

    // Clear error when user changes the value
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (formData.x < 0 || formData.x > 100) {
      newErrors.x = 'X must be between 0 and 100';
    }
    if (formData.y < 0 || formData.y > 100) {
      newErrors.y = 'Y must be between 0 and 100';
    }
    if (formData.scale < 0.25 || formData.scale > 2.0) {
      newErrors.scale = 'Scale must be between 0.25 and 2.0';
    }
    if (formData.rot < -45 || formData.rot > 45) {
      newErrors.rot = 'Rotation must be between -45 and 45';
    }
    if (formData.refw <= 0) {
      newErrors.refw = 'Reference width must be positive';
    }
    if (formData.refh <= 0) {
      newErrors.refh = 'Reference height must be positive';
    }
    if (!formData.url.trim()) {
      newErrors.url = 'URL is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      await equipAccessory({
        code: accessory.code,
        ...formData,
        url: formData.url || '', // Ensure URL is not null
      });
      onClose();
    } catch (error) {
      console.error('Failed to equip accessory:', error);
      // You could add error state handling here
    }
  };

  const handleRemove = async () => {
    if (!currentEquipment) {
      return; // Can't remove if not equipped
    }

    try {
      await unequipAccessory(accessory.code);
      onClose();
    } catch (error) {
      console.error('Failed to unequip accessory:', error);
      // You could add error state handling here
    }
  };

  const isEquipped = !!currentEquipment;
  const hasDifferentSlotEquipment = slotEquipment && slotEquipment.code !== accessory.code;

  return (
    <Card className="w-full max-w-md border-l-4 border-l-purple-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Edit Accessory</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isEquipped ? 'default' : 'secondary'}>
            {accessory.code}
          </Badge>
          <Badge variant="outline">
            {accessory.slot}
          </Badge>
          {isEquipped && (
            <Badge variant="default" className="bg-green-600">
              Equipped
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Preview */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-lg bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
            <img
              src={formData.url}
              alt={`Preview ${accessory.code}`}
              className="w-full h-full object-contain"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                target.parentElement!.innerHTML = `
                  <div class="w-full h-full flex items-center justify-center text-2xl">
                    ${accessory.slot === 'headwear' ? '🎩' : '🕶️'}
                  </div>
                `;
              }}
            />
          </div>
        </div>

        {/* Position Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="x" className="text-xs">X Position (0-100)</Label>
            <Input
              id="x"
              type="number"
              min="0"
              max="100"
              value={formData.x}
              onChange={(e) => handleInputChange('x', parseInt(e.target.value) || 0)}
              className={errors.x ? 'border-red-500' : ''}
            />
            {errors.x && <p className="text-xs text-red-500">{errors.x}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="y" className="text-xs">Y Position (0-100)</Label>
            <Input
              id="y"
              type="number"
              min="0"
              max="100"
              value={formData.y}
              onChange={(e) => handleInputChange('y', parseInt(e.target.value) || 0)}
              className={errors.y ? 'border-red-500' : ''}
            />
            {errors.y && <p className="text-xs text-red-500">{errors.y}</p>}
          </div>
        </div>

        {/* Scale and Rotation */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="scale" className="text-xs">Scale (0.25-2.0)</Label>
            <Input
              id="scale"
              type="number"
              step="0.1"
              min="0.25"
              max="2.0"
              value={formData.scale}
              onChange={(e) => handleInputChange('scale', parseFloat(e.target.value) || 1.0)}
              className={errors.scale ? 'border-red-500' : ''}
            />
            {errors.scale && <p className="text-xs text-red-500">{errors.scale}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="rot" className="text-xs">Rotation (-45 to 45)</Label>
            <Input
              id="rot"
              type="number"
              min="-45"
              max="45"
              value={formData.rot}
              onChange={(e) => handleInputChange('rot', parseInt(e.target.value) || 0)}
              className={errors.rot ? 'border-red-500' : ''}
            />
            {errors.rot && <p className="text-xs text-red-500">{errors.rot}</p>}
          </div>
        </div>

        {/* Flip X */}
        <div className="flex items-center justify-between">
          <Label htmlFor="flipX" className="text-xs">Flip Horizontal</Label>
          <Switch
            id="flipX"
            checked={formData.flipX}
            onCheckedChange={(checked) => handleInputChange('flipX', checked)}
          />
        </div>

        {/* Form Selection */}
        <div className="space-y-1">
          <Label htmlFor="form" className="text-xs">Form</Label>
          <Select value={formData.form} onValueChange={(value: AccessoryForm) => handleInputChange('form', value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="baby">Baby</SelectItem>
              <SelectItem value="teen">Teen</SelectItem>
              <SelectItem value="adult">Adult</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Reference Size */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="refw" className="text-xs">Ref Width</Label>
            <Input
              id="refw"
              type="number"
              min="1"
              value={formData.refw}
              onChange={(e) => handleInputChange('refw', parseInt(e.target.value) || 100)}
              className={errors.refw ? 'border-red-500' : ''}
            />
            {errors.refw && <p className="text-xs text-red-500">{errors.refw}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="refh" className="text-xs">Ref Height</Label>
            <Input
              id="refh"
              type="number"
              min="1"
              value={formData.refh}
              onChange={(e) => handleInputChange('refh', parseInt(e.target.value) || 100)}
              className={errors.refh ? 'border-red-500' : ''}
            />
            {errors.refh && <p className="text-xs text-red-500">{errors.refh}</p>}
          </div>
        </div>

        {/* URL */}
        <div className="space-y-1">
          <Label htmlFor="url" className="text-xs">Image URL</Label>
          <Input
            id="url"
            value={formData.url || ''}
            onChange={(e) => handleInputChange('url', e.target.value || '')}
            className={errors.url ? 'border-red-500' : ''}
          />
          {errors.url && <p className="text-xs text-red-500">{errors.url}</p>}
        </div>

        {/* Warning about slot replacement */}
        {hasDifferentSlotEquipment && (
          <div className="p-3 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
            <p className="text-xs text-yellow-800 dark:text-yellow-200">
              Warning: This will replace the currently equipped {slotEquipment?.code} in the {accessory.slot} slot.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSave}
            disabled={isEquipping}
            className="flex-1"
            size="sm"
          >
            <Save className="h-4 w-4 mr-1" />
            {isEquipping ? 'Saving...' : (isEquipped ? 'Update' : 'Equip')}
          </Button>

          {isEquipped && (
            <Button
              onClick={handleRemove}
              disabled={isUnequipping}
              variant="destructive"
              size="sm"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {isUnequipping ? 'Removing...' : 'Unequip'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}