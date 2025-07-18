
import React, { useState, useRef, useCallback } from 'react';
import { useDrag } from 'react-use-gesture';
import { cn } from '@/lib/utils';
import { Position } from '@/lib/types';
import { Boundary, constrainPosition } from '@/lib/boundaries';
import { calculateBlobbiZIndex } from '@/lib/interactive-elements-config';

interface FurnitureProps {
  containerRef: React.RefObject<HTMLElement>;
  initialPosition?: Position;
  boundary: Boundary;
  imageUrl: string;
  hoverEffectImageUrl?: string;
  size: { width: number; height: number };
  backgroundFile?: string;
  className?: string;
}

export function Furniture({
  containerRef,
  initialPosition = { x: 50, y: 75 },
  boundary,
  imageUrl,
  hoverEffectImageUrl,
  size,
  backgroundFile,
  className,
}: FurnitureProps) {
  const [position, setPosition] = useState<Position>(initialPosition);
  const [isHovered, setIsHovered] = useState(false);
  const furnitureRef = useRef<HTMLDivElement>(null);

  const getPixelPosition = useCallback((percentPos: Position): Position => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (percentPos.x / 100) * rect.width,
      y: (percentPos.y / 100) * rect.height,
    };
  }, [containerRef]);

  const getPercentPosition = useCallback((pixelPos: Position): Position => {
    if (!containerRef.current) return { x: 50, y: 75 };
    const rect = containerRef.current.getBoundingClientRect();
    const percentPos = {
      x: (pixelPos.x / rect.width) * 100,
      y: (pixelPos.y / rect.height) * 100,
    };
    return constrainPosition(percentPos, boundary);
  }, [containerRef, boundary]);

  const bind = useDrag(({ down: _down, movement: [mx, my], memo }) => {
    const initialPixelPos = memo || getPixelPosition(position);
    const newPixelPos = {
      x: initialPixelPos.x + mx,
      y: initialPixelPos.y + my,
    };
    const newPercentPos = getPercentPosition(newPixelPos);
    setPosition(newPercentPos);
    return initialPixelPos;
  });

  const getDynamicZIndex = useCallback((currentPos: Position): number => {
    if (!backgroundFile) return 20;
    return calculateBlobbiZIndex(currentPos.y, backgroundFile);
  }, [backgroundFile]);

  return (
    <div
      {...bind()}
      ref={furnitureRef}
      className={cn(
        'absolute',
        'cursor-pointer',
        className
      )}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        transform: 'translate(-50%, -50%)',
        zIndex: getDynamicZIndex(position),
        touchAction: 'none',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <img
        src={imageUrl}
        alt="Furniture"
        className="w-full h-full object-contain"
        style={{ pointerEvents: 'none' }}
      />
      {hoverEffectImageUrl && (
        <img
          src={hoverEffectImageUrl}
          alt="Hover Effect"
          className={cn(
            'absolute top-0 left-0 w-full h-full object-contain transition-opacity duration-200',
            isHovered ? 'opacity-100' : 'opacity-0'
          )}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}
