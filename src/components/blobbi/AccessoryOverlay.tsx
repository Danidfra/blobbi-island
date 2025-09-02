import React from 'react';
import { useAccessoryManagement } from './hooks/useAccessoryManagement';
import { generateAccessoryUrl } from './lib/accessory-utils';
import { cn } from '@/lib/utils';
import type { EquipmentConfig } from './lib/accessory-types';

interface AccessoryOverlayProps {
  className?: string;
  /** Whether this is a static display (non-interactive) */
  isStatic?: boolean;
  /** Size multiplier for accessories relative to the blobbi */
  sizeMultiplier?: number;
}

interface AccessoryItemProps {
  config: EquipmentConfig;
  isStatic: boolean;
  sizeMultiplier: number;
}

function AccessoryItem({ config, isStatic, sizeMultiplier }: AccessoryItemProps) {
  const imageUrl = config.url || generateAccessoryUrl(config.code) || '';

  // Calculate the size based on the multiplier
  const baseSize = 60 * sizeMultiplier;

  return (
    <div
      className={cn(
        "absolute select-none transition-all duration-200",
        !isStatic && "z-20"
      )}
      style={{
        left: `${config.x}%`,
        top: `${config.y}%`,
        transform: `translate(-50%, -50%) scale(${config.scale}) rotate(${config.rot}deg) ${config.flipX ? 'scaleX(-1)' : ''}`,
        transformOrigin: 'center',
      }}
      title={config.code}
    >
      <img
        src={imageUrl}
        alt={config.code}
        className="max-w-none pointer-events-none"
        style={{
          width: `${baseSize}px`,
          height: `${baseSize}px`,
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

export function AccessoryOverlay({ 
  className, 
  isStatic = true, 
  sizeMultiplier = 1 
}: AccessoryOverlayProps) {
  const { equipment } = useAccessoryManagement();

  if (!equipment || equipment.length === 0) {
    return null;
  }

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      {equipment.map((accessory) => (
        <AccessoryItem
          key={accessory.code}
          config={accessory}
          isStatic={isStatic}
          sizeMultiplier={sizeMultiplier}
        />
      ))}
    </div>
  );
}