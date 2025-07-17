import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';

interface InteractiveElementProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
  hoverEffect?: 'scale' | 'opacity';
}

function InteractiveElement({
  src,
  alt,
  className,
  onClick,
  hoverEffect = 'scale'
}: InteractiveElementProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  const handleInteraction = () => {
    if (onClick) {
      setIsAnimating(true);
      onClick();
      // Reset animation after it completes
      setTimeout(() => setIsAnimating(false), 300);
    }
  };

  return (
    <div
      className={cn(
        "cursor-pointer select-none transition-transform duration-200 ease-out",
        // Hover effects
        hoverEffect === 'scale' && "hover:scale-110",
        // Click animation - custom tap effect
        isAnimating && "animate-tap",
        className
      )}
      onClick={handleInteraction}
      onTouchStart={handleInteraction}
    >
      <img
        src={src}
        alt={alt}
        className={cn(
          "w-full h-full object-contain",
          // Opacity hover effect for cave
          hoverEffect === 'opacity' && "opacity-0 hover:opacity-100 active:opacity-100"
        )}
        draggable={false}
      />
    </div>
  );
}

export function InteractiveElements() {
  const { currentLocation } = useLocation();
  const backgroundFile = getBackgroundForLocation(currentLocation);

  const handleElementClick = (elementName: string) => {
    console.log(`Interactive element clicked: ${elementName} (location: ${currentLocation})`);
    // TODO: Add navigation or action logic here
    // This could trigger navigation to specific sub-locations,
    // open mini-games, or show specific UI components
  };

  // Town elements (when background is town-open.png)
  if (backgroundFile === 'town-open.png') {
    return (
      <>
        {/* Arcade - Left side */}
        <div className="absolute left-[10%] sm:left-[18%] top-[35%] sm:top-[30%] z-15">
          <InteractiveElement
            src="/assets/interactive/arcade.png"
            alt="Arcade"
            onClick={() => handleElementClick('arcade')}
            className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 lg:size-60"
          />
        </div>

        {/* Stage - Center */}
        <div className="absolute left-1/2 top-[30%] sm:top-[26%] transform -translate-x-1/2 z-15">
          <InteractiveElement
            src="/assets/interactive/stage.png"
            alt="Stage"
            onClick={() => handleElementClick('stage')}
            className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 lg:size-60"
          />
        </div>

        {/* Shop - Right side */}
        <div className="absolute right-[10%] sm:right-[18%] top-[35%] sm:top-[30%] z-15">
          <InteractiveElement
            src="/assets/interactive/shop.png"
            alt="Shop"
            onClick={() => handleElementClick('shop')}
            className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 lg:size-60"
          />
        </div>
      </>
    );
  }

  // Mine elements (when background is mine-open.png)
  if (backgroundFile === 'mine-open.png') {
    return (
      <>
        {/* Cave - Center, transparent by default */}
        <div className="absolute left-1/2 top-[40%] sm:top-[42%] transform -translate-x-1/2 z-15">
          <InteractiveElement
            src="/assets/interactive/cave.png"
            alt="Cave"
            onClick={() => handleElementClick('cave')}
            hoverEffect="opacity"
            className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 lg:size-[214px]"
          />
        </div>
      </>
    );
  }

  // Beach elements (when background is beach.png or beach-open.png)
  if (backgroundFile === 'beach-open.png' || backgroundFile === 'beach.png') {
    return (
      <>
        {/* Boat - Center */}
        <div className="absolute left-1/4 top-[34%] sm:top-[39%] transform -translate-x-1/2 z-15">
          <InteractiveElement
            src="/assets/interactive/boat.png"
            alt="Boat"
            onClick={() => handleElementClick('boat')}
            className="size-24 sm:size-28 md:size-32 lg:size-36"
          />
        </div>
      </>
    );
  }

  // No interactive elements for other backgrounds
  return null;
}