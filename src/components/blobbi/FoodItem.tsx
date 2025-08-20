import React, { useState, useRef, useCallback } from 'react';
import { useDrag } from 'react-use-gesture';
import { cn } from '@/lib/utils';

export interface FoodPosition {
  x: number;
  y: number;
}

interface FoodItemProps {
  imageUrl: string;
  position: FoodPosition;
  onPositionChange: (position: FoodPosition) => void;
  containerRef: React.RefObject<HTMLElement>;
  shelves: number[]; // Array of shelf Y positions for snapping
  size?: number;
  className?: string;
  onClick?: () => void;
  quantity?: number;
}

export function FoodItem({
  imageUrl,
  position,
  onPositionChange,
  containerRef,
  shelves,
  size = 64,
  className,
  onClick,
  quantity,
}: FoodItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const foodRef = useRef<HTMLDivElement>(null);

  const snapToShelf = useCallback((yPosition: number): number => {
    if (!containerRef.current) return yPosition;

    const containerRect = containerRef.current.getBoundingClientRect();

    // Convert shelf positions to pixel coordinates
    const shelfPixelPositions = shelves.map(shelf => containerRect.height - shelf);

    // Always find the closest shelf (no threshold - always snap)
    let closestShelf = shelfPixelPositions[0];
    let minDistance = Infinity;

    for (const shelfY of shelfPixelPositions) {
      const distance = Math.abs(yPosition - shelfY);
      if (distance < minDistance) {
        minDistance = distance;
        closestShelf = shelfY;
      }
    }

    return closestShelf;
  }, [shelves, containerRef]);

  const bind = useDrag(
    ({ down, movement: [mx, my], memo, tap }) => {
      if (tap && onClick) {
        // Don't call onClick here - let the click handler handle it
        return;
      }

      setIsDragging(down);

      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const initialPos = memo || { x: position.x, y: position.y };

      let newX = initialPos.x + mx;
      let newY = initialPos.y + my;

      // Constrain to container bounds with some padding
      const halfSize = size / 2;
      const padding = 10;
      newX = Math.max(halfSize + padding, Math.min(containerRect.width - halfSize - padding, newX));
      newY = Math.max(halfSize + padding, Math.min(containerRect.height - halfSize - padding, newY));

      // Only snap to shelf when released (not while dragging)
      if (!down) {
        newY = snapToShelf(newY);
      }

      onPositionChange({ x: newX, y: newY });
      return initialPos;
    },
    { filterTaps: true }
  );

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (onClick) {
      onClick();
    }
  };

  return (
    <div
      {...bind()}
      ref={foodRef}
      className={cn(
        'absolute cursor-grab select-none transition-transform duration-200',
        isDragging && 'cursor-grabbing scale-110 z-50',
        className
      )}
      style={{
        left: position.x - size / 2,
        top: position.y - size / 2,
        width: size,
        height: size,
        touchAction: 'none',
        zIndex: isDragging ? 50 : 10,
      }}
      onClick={handleClick}
    >
      <img
        src={imageUrl}
        alt="Food item"
        className="w-full h-full object-contain pointer-events-none"
        draggable={false}
      />

      {/* Quantity badge */}
      {quantity !== undefined && quantity > 1 && (
        <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold shadow-lg">
          {quantity > 99 ? '99+' : quantity}
        </div>
      )}
    </div>
  );
}