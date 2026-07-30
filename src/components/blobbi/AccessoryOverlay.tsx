/**
 * AccessoryOverlay — the INTERACTIVE accessory editing surface.
 *
 * Static (in-world / preview) accessory rendering now lives in the pure
 * `AccessoryLayerView` inside `BlobbiRendererView`; this component is only
 * mounted by the accessory editor (BlobbiInfoModal's inventory tab), layered
 * over the preview's renderer box.
 *
 * Coordinate contract (docs/blobbi-renderer-contract.md): `containerRef` must
 * wrap exactly the canonical renderer box, so the drag math's percentages are
 * percentages OF THAT BOX — the same space the world renderer uses. Accessory
 * size is the same box-relative fraction the static renderer uses
 * (`ACCESSORY_BASE_PERCENT` × the accessory's own scale), so a placement looks
 * materially the same while editing and in the world.
 *
 * Editing inputs remain mouse-based (drag / wheel / shift+wheel). Converting
 * to pointer events for touch is deliberately out of Phase 1 scope — see the
 * contract doc's "not solved in Phase 1" list.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useAccessoryManagement } from './hooks/useAccessoryManagement';
import { generateAccessoryUrl } from './lib/accessory-utils';
import { cn } from '@/lib/utils';
import { accessoryImagePath } from '@/lib/asset-paths';
import { ACCESSORY_BASE_PERCENT, normalizeAccessoryPlacements } from '@blobbi/react';
import { type EquipmentConfig } from './lib/accessory-types';

interface AccessoryOverlayProps {
  className?: string;
  /**
   * Which way the character is turned. `"back"` drops the face-only accessory
   * slots so a rear-facing Blobbi does not wear its sunglasses on the back of
   * its head.
   */
  facing?: 'front' | 'back';
  /** Pending updates to apply to accessories (for position syncing during editing) */
  pendingUpdates?: Record<string, Partial<EquipmentConfig>>;
  /** Ref to the element that IS the canonical renderer box (drag coordinate space). */
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
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<EquipmentConfig>) => void;
}

function AccessoryItem({
  config,
  containerRef,
  isSelected,
  onSelect,
  onUpdate,
}: AccessoryItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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
  }, [config.x, config.y, containerRef, onSelect]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef?.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const newX = ((e.clientX - rect.left - dragOffset.x) / rect.width) * 100;
    const newY = ((e.clientY - rect.top - dragOffset.y) / rect.height) * 100;

    // Constrain to container bounds. Decimal precision is preserved end-to-end
    // (parse/serialize keep decimals — see accessory-utils).
    const constrainedX = Math.max(5, Math.min(95, newX));
    const constrainedY = Math.max(5, Math.min(95, newY));

    onUpdate({ x: constrainedX, y: constrainedY });
  }, [isDragging, dragOffset, containerRef, onUpdate]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!isSelected) return;

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
  }, [isSelected, config.rot, config.scale, onUpdate]);

  // Global mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const imageUrl = config.url || generateAccessoryUrl(config.code) || '';

  return (
    <div
      className={cn(
        "absolute select-none transition-all duration-200 z-20 cursor-move pointer-events-auto",
        isDragging && "opacity-80 scale-105",
        isSelected && "ring-2 ring-blue-500 ring-offset-2"
      )}
      style={{
        left: `${config.x}%`,
        top: `${config.y}%`,
        // Same box-relative sizing as the static renderer (the container IS
        // the renderer box, and it is square, so width==height stays square).
        width: ACCESSORY_BASE_PERCENT,
        height: ACCESSORY_BASE_PERCENT,
        transform: `translate(-50%, -50%) scale(${config.scale}) rotate(${config.rot}deg) ${config.flipX ? 'scaleX(-1)' : ''}`,
        transformOrigin: 'center',
      }}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      title={`${config.code} - Click to select, drag to move, scroll to scale, shift+scroll to rotate`}
    >
      <img
        src={imageUrl}
        alt={config.code}
        className="h-full w-full max-w-none object-contain"
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
  facing = 'front',
  pendingUpdates = {},
  containerRef,
  selectedAccessory,
  onAccessorySelect,
  onAccessoryUpdate
}: AccessoryOverlayProps) {
  const { equipment } = useAccessoryManagement();

  const handleAccessoryUpdate = useCallback((accessoryCode: string, updates: Partial<EquipmentConfig>) => {
    onAccessoryUpdate?.(accessoryCode, updates);
  }, [onAccessoryUpdate]);

  const handleAccessorySelect = useCallback((accessory: EquipmentConfig) => {
    onAccessorySelect?.(accessory);
  }, [onAccessorySelect]);

  // Reuse the normalizer for its deterministic (layerRank, code) ordering and
  // rear-view filtering, so the editor stacks accessories in the same order as
  // the world. The editor manipulates raw EquipmentConfig values, so map the
  // normalized order back onto the raw configs.
  const configByCode = new Map((equipment ?? []).map((item) => [item.code, item] as const));
  const orderedEquipment = normalizeAccessoryPlacements(equipment ?? [], { facing })
    .map((placement) => configByCode.get(placement.code))
    .filter((item): item is EquipmentConfig => item !== undefined);

  if (orderedEquipment.length === 0) {
    return null;
  }

  return (
    <div className={cn("absolute inset-0", className)}>
      {orderedEquipment.map((accessory) => {
        // Apply pending updates to sync positions during editing
        const updates = pendingUpdates[accessory.code] || {};
        const currentConfig = { ...accessory, ...updates };

        return (
          <AccessoryItem
            key={accessory.code}
            config={currentConfig}
            containerRef={containerRef}
            isSelected={selectedAccessory?.code === accessory.code}
            onSelect={() => handleAccessorySelect(accessory)}
            onUpdate={(updates) => handleAccessoryUpdate(accessory.code, updates)}
          />
        );
      })}
    </div>
  );
}
