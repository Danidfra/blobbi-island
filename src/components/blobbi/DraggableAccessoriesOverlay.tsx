import React, { useState, useCallback, useEffect } from 'react';
import { useAccessoryManagement } from './hooks/useAccessoryManagement';
import { generateAccessoryUrl } from './lib/accessory-utils';
import { cn } from '@/lib/utils';
import type { EquipmentConfig } from './lib/accessory-types';

interface DraggableAccessoriesOverlayProps {
  containerRef: React.RefObject<HTMLDivElement>;
  selectedAccessory: EquipmentConfig | null;
  onAccessorySelect?: (accessory: EquipmentConfig) => void;
  onAccessoryUpdate?: (accessoryCode: string, updates: Partial<EquipmentConfig>) => void;
  pendingUpdates: Record<string, Partial<EquipmentConfig>>;
  className?: string;
}

interface DraggableAccessoryProps {
  config: EquipmentConfig;
  containerRef: React.RefObject<HTMLDivElement>;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<EquipmentConfig>) => void;
}

function DraggableAccessory({
  config,
  containerRef,
  isSelected,
  onSelect,
  onUpdate
}: DraggableAccessoryProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!containerRef.current) return;

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
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const newX = ((e.clientX - rect.left - dragOffset.x) / rect.width) * 100;
    const newY = ((e.clientY - rect.top - dragOffset.y) / rect.height) * 100;

    // Constrain to container bounds
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
        "absolute cursor-move select-none transition-all duration-200 z-20",
        isDragging && "opacity-80 scale-105",
        isSelected && "ring-2 ring-blue-500 ring-offset-2"
      )}
      style={{
        left: `${config.x}%`,
        top: `${config.y}%`,
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
        className="max-w-none pointer-events-none"
        style={{
          width: '60px',
          height: '60px',
          objectFit: 'contain',
        }}
        draggable={false}
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          const slot = config.slot;

          // Fallback chain for missing images
          const webpPath = `/assets/accessories/${slot}/${config.code}.webp`;
          const pngPath = `/assets/accessories/${slot}/${config.code}.png`;
          const legacyWebpPath = `/assets/acessories/${slot}/${config.code}.webp`;
          const legacyPngPath = `/assets/acessories/${slot}/${config.code}.png`;

          if (!target.src.includes(webpPath)) {
            target.src = webpPath;
          } else if (!target.src.includes(pngPath)) {
            target.src = pngPath;
          } else if (!target.src.includes(legacyWebpPath)) {
            target.src = legacyWebpPath;
          } else if (!target.src.includes(legacyPngPath)) {
            target.src = legacyPngPath;
          } else {
            // All fallbacks failed, hide the image
            target.style.display = 'none';
          }
        }}
      />
    </div>
  );
}

export function DraggableAccessoriesOverlay({
  containerRef,
  selectedAccessory,
  onAccessorySelect,
  onAccessoryUpdate,
  pendingUpdates,
  className
}: DraggableAccessoriesOverlayProps) {
  const { equipment } = useAccessoryManagement();

  const handleAccessoryUpdate = useCallback((accessoryCode: string, updates: Partial<EquipmentConfig>) => {
    onAccessoryUpdate?.(accessoryCode, updates);
  }, [onAccessoryUpdate]);

  const handleAccessorySelect = useCallback((accessory: EquipmentConfig) => {
    onAccessorySelect?.(accessory);
  }, [onAccessorySelect]);

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      {equipment.map((accessory) => {
        const updates = pendingUpdates[accessory.code] || {};
        const currentConfig = { ...accessory, ...updates };

        return (
          <div key={accessory.code} className="pointer-events-auto">
            <DraggableAccessory
              config={currentConfig}
              containerRef={containerRef}
              isSelected={selectedAccessory?.code === accessory.code}
              onSelect={() => handleAccessorySelect(accessory)}
              onUpdate={(updates) => handleAccessoryUpdate(accessory.code, updates)}
            />
          </div>
        );
      })}
    </div>
  );
}