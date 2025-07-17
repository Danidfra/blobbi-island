import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';

interface InteractiveElementProps {
  src: string;
  alt: string;
  className?: string;
  animated?: boolean;
  onClick?: () => void;
  effect?: 'scale' | 'opacity' | 'door';
}

function InteractiveElement({
  src,
  alt,
  className,
  animated = true,
  onClick,
  effect = 'scale'
}: InteractiveElementProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  const handleInteraction = () => {
    if (!onClick) return;

    if (animated && effect !== 'door') {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 300);
    }

    onClick();
  };

  return (
    <div
      className={cn(
        "cursor-pointer select-none transition-all duration-300 ease-out",
        // Hover effects
        effect === 'scale' && "hover:scale-110",
        effect === 'door' && "opacity-0 hover:opacity-100",
        // Click animation - custom tap effect
        isAnimating && effect !== 'door' && "animate-tap",
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
          effect === 'opacity' && "opacity-0 hover:opacity-100 active:opacity-100"
        )}
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

        {/* Bush 3 - Left side, slightly above bush-1 */}
        <div className="absolute left-0 top-[68%] sm:top-[63%] z-[25]">
          <InteractiveElement
            src="/assets/scenario/bush-3.png"
            alt="Bush 3"
            animated={false}
            onClick={() => handleElementClick('bush-3')}
            className="h-20 sm:h-24 md:h-28 lg:h-32"
          />
        </div>

        {/* Bush 4 - Right side, slightly above bush-2 */}
        <div className="absolute right-0 top-[74%] sm:top-[69%] z-[25]">
          <InteractiveElement
            src="/assets/scenario/bush-4.png"
            alt="Bush 4"
            animated={false}
            onClick={() => handleElementClick('bush-4')}
            className="size-20 sm:size-24 md:size-28 lg:size-32"
          />
        </div>

        {/* Bush 1 - Bottom left corner (highest z-index) */}
        <div className="absolute left-0 bottom-0 z-[25]">
          <InteractiveElement
            src="/assets/scenario/bush-1.png"
            alt="Bush 1"
            animated={false}
            onClick={() => handleElementClick('bush-1')}
            className="size-20 sm:size-24 md:size-28 lg:size-32"
          />
        </div>

        {/* Bush 2 - Bottom right corner (highest z-index) */}
        <div className="absolute right-0 bottom-0 z-[25]">
          <InteractiveElement
            src="/assets/scenario/bush-2.png"
            alt="Bush 2"
            animated={false}
            onClick={() => handleElementClick('bush-2')}
            className="size-20 sm:size-24 md:size-28 lg:size-32"
          />
        </div>

        {/* streetlight - left */}
        <div className="absolute left-[6%] bottom-[10%] z-[25]">
          <InteractiveElement
            src="/assets/scenario/streetlight.png"
            alt="streetlight 1"
            animated={false}
            onClick={() => handleElementClick('bush-2')}
            className="h-48 sm:h-52 md:h-56 lg:h-60"
          />
        </div>

        {/* streetlight -right */}
        <div className="absolute right-[12%] bottom-[10%] z-[25]">
          <InteractiveElement
            src="/assets/scenario/streetlight.png"
            alt="streetlight 2"
            animated={false}
            onClick={() => handleElementClick('bush-2')}
            className="h-48 sm:h-52 md:h-56 lg:h-60"
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
            animated={false}
            onClick={() => handleElementClick('cave')}
            effect="opacity"
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
            animated={false}
            onClick={() => handleElementClick('boat')}
            className="size-24 sm:size-28 md:size-32 lg:size-36"
          />
        </div>
      </>
    );
  }
// Plaza elements (when background is plaza-open.png)
if (backgroundFile === 'plaza-open.png') {
  return (
    <>
      <div className="absolute inset-x-0 top-0 flex items-center justify-center z-20">
        <div className="relative">
          <img
            src="/assets/interactive/plaza-build.png"
            alt="Plaza building"
            className="max-w-full max-h-full"
          />
          <InteractiveElement
            src="/assets/interactive/plaza-door.png"
            alt="Plaza Door"
            animated={false}
            onClick={() => handleElementClick('plaza-door')}
            effect="door"
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[10%] z-30"
          />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-10 sm:bottom-28 flex items-center justify-center z-20">
      <img src="/assets/scenario/floor.png" alt="Floor" className="max-w-full max-h-full" />
      </div>
    </>
  );
}

  // No interactive elements for other backgrounds
  return null;
}