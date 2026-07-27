import React, { useState, useCallback, useEffect } from 'react';
import { useAccessoryManagement } from './hooks/useAccessoryManagement';
import { generateAccessoryUrl } from './lib/accessory-utils';
import { cn } from '@/lib/utils';
import { accessoryImagePath } from '@/lib/asset-paths';
import { REAR_VIEW_HIDDEN_SLOTS, type EquipmentConfig } from './lib/accessory-types';

interface AccessoryOverlayProps {
  className?: string;
  /** Whether this is a static display (non-interactive) */
  isStatic?: boolean;
  /**
   * Which way the character is turned. `"back"` drops the face-only accessory
   * slots (see {@link REAR_VIEW_HIDDEN_SLOTS}) so a rear-facing Blobbi does not
   * wear its sunglasses on the back of its head.
   */
  facing?: 'front' | 'back';
  /** Size multiplier for accessories relative to the blobbi */
  sizeMultiplier?: number;
  /** Pending updates to apply to accessories (for position syncing during editing) */
  pendingUpdates?: Record<string, Partial<EquipmentConfig>>;
  /** Container ref for drag calculations */
  containerRef?: React.RefObject<HTMLDivElement>;
  /** Selected accessory for editing */
  selectedAccessory?: EquipmentConfig | null;
  /** Callback when accessory is selected */
  onAccessorySelect?: (accessory: EquipmentConfig) => void;
  /** Callback when accessory is updated */
  onAccessoryUpdate?: (accessoryCode: string, updates: Partial<EquipmentConfig>) => void;
}

interface AccessoryItemProps {
  config: EquipmentConfig;
  containerRef?: React.RefObject<HTMLDivElement>;
  isStatic: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<EquipmentConfig>) => void;
  sizeMultiplier: number;
}

function AccessoryItem({
  config,
  containerRef,
  isStatic,
  isSelected,
  onSelect,
  onUpdate,
  sizeMultiplier
}: AccessoryItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isStatic) return;
    
    e.preventDefault();
    e.stopPropagation();

    if (!containerRef?.current) return;

    // Select this accessory
    onSelect();

    const rect = containerRef.current.getBoundingClientRect();
    const accessoryX = (config.x / 100) * rect.width;
    const accessoryY = (config.y / 100) * rect.height;

    setDragOffset({
      x: e.clientX - rect.left - accessoryX,
      y: e.clientY - rect.top - accessoryY,
    });

    setIsDragging(true);
  }, [config.x, config.y, containerRef, onSelect, isStatic]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef?.current || isStatic) return;

    const rect = containerRef.current.getBoundingClientRect();
    const newX = ((e.clientX - rect.left - dragOffset.x) / rect.width) * 100;
    const newY = ((e.clientY - rect.top - dragOffset.y) / rect.height) * 100;

    // Constrain to container bounds
    const constrainedX = Math.max(5, Math.min(95, newX));
    const constrainedY = Math.max(5, Math.min(95, newY));

    onUpdate({ x: constrainedX, y: constrainedY });
  }, [isDragging, dragOffset, containerRef, onUpdate, isStatic]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isStatic || !isSelected) return;

    e.preventDefault();

    if (e.shiftKey) {
      // Shift + wheel = rotation
      const delta = e.deltaY > 0 ? 5 : -5;
      const newRotation = Math.max(-45, Math.min(45, config.rot + delta));
      onUpdate({ rot: newRotation });
    } else {
      // Regular wheel = scale
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      const newScale = Math.max(0.25, Math.min(2.0, config.scale + delta));
      onUpdate({ scale: newScale });
    }
  }, [isSelected, config.rot, config.scale, onUpdate, isStatic]);

  // Global mouse event listeners
  useEffect(() => {
    if (isDragging && !isStatic) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp, isStatic]);

  const imageUrl = config.url || generateAccessoryUrl(config.code) || '';

  // Calculate the size based on the multiplier
  const baseSize = 60 * sizeMultiplier;

  return (
    <div
      className={cn(
        "absolute select-none transition-all duration-200",
        !isStatic && "z-20 cursor-move pointer-events-auto", // Enable pointer events for interactive mode
        isDragging && !isStatic && "opacity-80 scale-105",
        isSelected && !isStatic && "ring-2 ring-blue-500 ring-offset-2"
      )}
      style={{
        left: `${config.x}%`,
        top: `${config.y}%`,
        transform: `translate(-50%, -50%) scale(${config.scale}) rotate(${config.rot}deg) ${config.flipX ? 'scaleX(-1)' : ''}`,
        transformOrigin: 'center',
      }}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      title={isStatic ? config.code : `${config.code} - Click to select, drag to move, scroll to scale, shift+scroll to rotate`}
    >
      <img
        src={imageUrl}
        alt={config.code}
        className="max-w-none" // Remove pointer-events-none for interactivity
        style={{
          width: `${baseSize}px`,
          height: `${baseSize}px`,
          objectFit: 'contain',
        }}
        draggable={false}
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          const slot = config.slot;

          // Fallback chain for missing images: .webp -> .png -> hide.
          const webpPath = accessoryImagePath(slot, config.code, 'webp');
          const pngPath = accessoryImagePath(slot, config.code, 'png');

          if (!target.src.includes(webpPath)) {
            target.src = webpPath;
          } else if (!target.src.includes(pngPath)) {
            target.src = pngPath;
          } else {
            // All fallbacks failed, hide the image
            target.style.display = 'none';
          }
        }}
      />
    </div>
  );
}

export function AccessoryOverlay({
  className,
  isStatic = true,
  facing = 'front',
  sizeMultiplier = 1,
  pendingUpdates = {},
  containerRef,
  selectedAccessory,
  onAccessorySelect,
  onAccessoryUpdate
}: AccessoryOverlayProps) {
  const { equipment } = useAccessoryManagement();

  // Always define useCallbacks to avoid conditional hook calls
  const handleAccessoryUpdate = useCallback((accessoryCode: string, updates: Partial<EquipmentConfig>) => {
    if (!isStatic) {
      onAccessoryUpdate?.(accessoryCode, updates);
    }
  }, [onAccessoryUpdate, isStatic]);

  const handleAccessorySelect = useCallback((accessory: EquipmentConfig) => {
    if (!isStatic) {
      onAccessorySelect?.(accessory);
    }
  }, [onAccessorySelect, isStatic]);

  const visibleEquipment = (equipment ?? []).filter(
    (accessory) => facing !== 'back' || !REAR_VIEW_HIDDEN_SLOTS.has(accessory.slot),
  );

  if (visibleEquipment.length === 0) {
    return null;
  }

  return (
    <div className={cn("absolute inset-0", className)}>
      {visibleEquipment.map((accessory) => {
        // Apply pending updates to sync positions during editing
        const updates = pendingUpdates[accessory.code] || {};
        const currentConfig = { ...accessory, ...updates };

        return (
          <AccessoryItem
            key={accessory.code}
            config={currentConfig}
            containerRef={containerRef}
            isStatic={isStatic}
            isSelected={selectedAccessory?.code === accessory.code}
            onSelect={() => handleAccessorySelect(accessory)}
            onUpdate={(updates) => handleAccessoryUpdate(accessory.code, updates)}
            sizeMultiplier={sizeMultiplier}
          />
        );
      })}
    </div>
  );
}