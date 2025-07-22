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
        effect !== 'door' && "cursor-pointer select-none transition-all duration-300 ease-out",
        // Hover effects
        effect === 'scale' && "hover:scale-110",
        effect === 'door' && "cursor-pointer select-none opacity-0 hover:opacity-100",
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
  const { currentLocation, setCurrentLocation, setIsMapModalOpen } = useLocation();
  const backgroundFile = getBackgroundForLocation(currentLocation);

  const handleElementClick = (elementName: string) => {
    console.log(`Interactive element clicked: ${elementName} (location: ${currentLocation})`);
    // TODO: Add navigation or action logic here
    // This could trigger navigation to specific sub-locations,
    // open mini-games, or show specific UI components
  };

  // Town elements (when background is town-open.png)
  if (backgroundFile === 'home-open.png') {
    return (
      <>
      <InteractiveElement
            src="/assets/interactive/home-door-front.png"
            alt="Arcade Door"
            animated={false}
            onClick={() => setIsMapModalOpen(true)}
            effect="door"
            className="absolute bottom-[22.5%] left-[16.3%]  w-[18.8%] z-15"
      />
      <InteractiveElement
            src="/assets/interactive/home-door-back.png"
            alt="back-yard-door"
            animated={false}
            onClick={() => setCurrentLocation('back-yard')}
            effect="door"
            className="absolute bottom-[22.8%] right-[16.5%]  w-[18%] z-15"
      />
      </>)
  }

  if (backgroundFile === 'back-yard-open.png') {
    return (
      <InteractiveElement
        src="/assets/interactive/back-yard-door.png"
        alt="Go back to home"
        animated={false}
        onClick={() => setCurrentLocation('home')}
        effect="door"
        className="absolute bottom-[22.8%] right-[16.5%] w-[18%] z-15"
      />
    );
  }

  if (backgroundFile === 'stage-open.png') {
    return (
      <>
        {/* <InteractiveElement
          src="/assets/interactive/stage-exit-door.png"
          alt="Go back to town"
          animated={false}
          onClick={() => setCurrentLocation('town')}
          effect="door"
          className="absolute bottom-[10%] left-[5%] w-[15%] z-15"
        /> */}

      {/* Left side */}
        {/* Row 1 (Front) - Highest z-index */}
        <div className="absolute bottom-0 left-0 flex items-center -space-x-4 z-30">
          {Array.from({ length: 4 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row1-${i}`}
              src="/assets/interactive/furniture/stage-chair-left.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={() => handleElementClick(`chair-row1-${i}`)}
            />
          ))}
        </div>

        {/* Row 2 (Middle) - Medium z-index */}
        <div className="absolute bottom-[5%] left-[4%] flex items-center -space-x-4 z-20">
          {Array.from({ length: 4 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row2-${i}`}
              src="/assets/interactive/furniture/stage-chair-left.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={() => handleElementClick(`chair-row2-${i}`)}
            />
          ))}
        </div>

        {/* Row 3 (Back) - Lowest z-index */}
        <div className="absolute bottom-[10%] left-[8%] flex items-center -space-x-4 z-10">
          {Array.from({ length: 4 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row3-${i}`}
              src="/assets/interactive/furniture/stage-chair-left.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={() => handleElementClick(`chair-row3-${i}`)}
            />
          ))}
        </div>

      {/* Right side */}
        {/* Row 1 (Front) - Highest z-index */}
        <div className="absolute bottom-0 right-0 flex items-center -space-x-4 z-30">
          {Array.from({ length: 4 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row1-${i}`}
              src="/assets/interactive/furniture/stage-chair.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={() => handleElementClick(`chair-row1-${i}`)}
            />
          ))}
        </div>

        {/* Row 2 (Middle) - Medium z-index */}
        <div className="absolute bottom-[5%] right-[4%] flex items-center -space-x-4 z-20">
          {Array.from({ length: 4 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row2-${i}`}
              src="/assets/interactive/furniture/stage-chair.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={() => handleElementClick(`chair-row2-${i}`)}
            />
          ))}
        </div>

        {/* Row 3 (Back) - Lowest z-index */}
        <div className="absolute bottom-[10%] right-[8%] flex items-center -space-x-4 z-10">
          {Array.from({ length: 4 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row3-${i}`}
              src="/assets/interactive/furniture/stage-chair.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={() => handleElementClick(`chair-row3-${i}`)}
            />
          ))}
        </div>
      </>
    );
  }

  // Town elements (when background is town-open.png)
  if (backgroundFile === 'town-open.png') {
    return (
      <>
        {/* Arcade - Left side */}
        <div className="absolute left-[10%] sm:left-[18%] top-[30%] sm:top-[25%] z-15">
           <img
            src="/assets/interactive/arcade.png"
            alt="Arcade"
            className="h-56 sm:h-60 md:h-64 lg:h-72"
          />
          <InteractiveElement
            src="/assets/interactive/arcade-door.png"
            alt="Arcade Door"
            animated={false}
            onClick={() => handleElementClick('arcade')}
            effect="door"
            className="absolute bottom-0 right-0  w-[40%] z-30"
          />
        </div>

        {/* Stage - Center */}
        <div className="absolute left-1/2 top-[26%] sm:top-[21%] transform -translate-x-1/2 z-15">
          <img
            src="/assets/interactive/stage.png"
            alt="Stage"
            className="size-56 sm:size-60 md:size-64 lg:size-72"
          />
          <InteractiveElement
            src="/assets/interactive/stage-door.png"
            alt="Stage Door"
            animated={false}
            onClick={() => setCurrentLocation('stage')}
            effect="door"
            className="absolute bottom-0 -right-2  w-[50%] z-30"
          />
        </div>

        {/* Shop - Right side */}
        <div className="absolute right-[10%] sm:right-[18%] top-[30%] sm:top-[25%] z-15">
          <img
            src="/assets/interactive/shop.png"
            alt="Shop"
            className="h-56 sm:h-60 md:h-64 lg:h-72"
          />
          <InteractiveElement
            src="/assets/interactive/shop-door.png"
            alt="Shop Door"
            animated={false}
            onClick={() => handleElementClick('shop')}
            effect="door"
            className="absolute bottom-0 left-0  w-[60%] z-30"
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
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[10.5%] z-30"
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