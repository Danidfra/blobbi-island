import React, { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { MovableBlobbiRef } from './MovableBlobbi';
import { MovementBlocker } from './MovementBlocker';
import { ArcadePassModal } from './ArcadePassModal';
import { ElevatorModal } from './ElevatorModal';
import { NoPassModal } from './NoPassModal';
import { GameModal } from './GameModal';
import { Button } from '@/components/ui/button';

interface InteractiveElementProps {
  src: string;
  alt: string;
  className?: string;
  animated?: boolean;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  effect?: 'scale' | 'opacity' | 'door' | 'slide';
  slideDirection?: 'right' | 'left' | 'up' | 'down';
  isHovered?: boolean;
}

function InteractiveElement({
  src,
  alt,
  className,
  animated = true,
  onClick,
  effect = 'scale',
  slideDirection = 'right',
  isHovered
}: InteractiveElementProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isSelfHovered, setIsSelfHovered] = useState(false);

  const finalIsHovered = isHovered !== undefined ? isHovered : isSelfHovered;

  const handleInteraction = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onClick) return;

    if (animated && effect !== 'door' && effect !== 'slide') {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 300);
    }

    onClick(event);
  };

  const getSlideTransform = () => {
    if (!finalIsHovered) return 'translate(0, 0)';
    switch (slideDirection) {
      case 'right':
        return 'translateX(100%)';
      case 'left':
        return 'translateX(-100%)';
      case 'up':
        return 'translateY(-100%)';
      case 'down':
        return 'translateY(100%)';
      default:
        return 'translate(0, 0)';
    }
  };

  if (effect === 'slide') {
    return (
      <div
        className={cn('cursor-pointer select-none', className)}
        onMouseEnter={() => setIsSelfHovered(true)}
        onMouseLeave={() => setIsSelfHovered(false)}
        onClick={handleInteraction}
      >
        <div
          className="transition-transform duration-300 ease-in-out"
          style={{ transform: getSlideTransform() }}
        >
          <img src={src} alt={alt} className="w-full h-full object-contain" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'cursor-pointer select-none',
        effect === 'scale' && animated && 'transition-all duration-300 ease-out hover:scale-110',
        effect === 'door' && 'opacity-0 hover:opacity-100',
        isAnimating && effect !== 'door' && 'animate-tap',
        className
      )}
      onClick={handleInteraction}
      onMouseEnter={() => setIsSelfHovered(true)}
      onMouseLeave={() => setIsSelfHovered(false)}
      onTouchStart={(e) => handleInteraction(e as unknown as React.MouseEvent<HTMLDivElement>)}
    >
      <img
        src={src}
        alt={alt}
        className={cn(
          'w-full h-full object-contain',
          effect === 'opacity' && 'opacity-0 hover:opacity-100 active:opacity-100'
        )}
      />
    </div>
  );
}

interface InteractiveElementsProps {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
}

export function InteractiveElements({ blobbiRef }: InteractiveElementsProps) {
  const { currentLocation, setIsMapModalOpen, setCurrentLocation } = useLocation();
  const backgroundFile = getBackgroundForLocation(currentLocation);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isArcadePassModalOpen, setIsArcadePassModalOpen] = useState(false);
  const [isElevatorModalOpen, setIsElevatorModalOpen] = useState(false);
  const [isNoPassModalOpen, setIsNoPassModalOpen] = useState(false);
  const [isGameModalOpen, setIsGameModalOpen] = useState(false);
  const [gameModalContent, setGameModalContent] = useState<{ title: string; content: React.ReactNode } | null>(null);


  const handleChairClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!blobbiRef.current) return;

    const chairElement = event.currentTarget;
    const container = chairElement.closest('.w-full.h-full.relative');

    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const chairRect = chairElement.getBoundingClientRect();

    // Calculate the center of the chair
    const chairCenterX = chairRect.left + chairRect.width / 2;
    // Position Blobbi at the top of the chair
    const chairTopY = chairRect.top;

    // Convert to percentage
    const targetX = ((chairCenterX - containerRect.left) / containerRect.width) * 100;
    const targetY = ((chairTopY - containerRect.top) / containerRect.height) * 100;

    blobbiRef.current.goTo({ x: targetX, y: targetY + 3 }); // Adjust Y to sit on top
  };

  const handleElementClick = (elementName: string) => {
    console.log(`Interactive element clicked: ${elementName} (location: ${currentLocation})`);
    // TODO: Add navigation or action logic here
    // This could trigger navigation to specific sub-locations,
    // open mini-games, or show specific UI components
    if (elementName === 'dance-machine') {
      setGameModalContent({
        title: 'Dance Dance Blobbi',
        content: (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-lg mb-4">Get ready to dance!</p>
            <Button>Start Game</Button>
          </div>
        ),
      });
      setIsGameModalOpen(true);
    }
  };

  const handleTicketPurchase = () => {
    setIsArcadePassModalOpen(true);
  };

  const handleElevatorClick = () => {
    const hasPass = sessionStorage.getItem('has-arcade-pass') === 'true';
    if (hasPass) {
      setIsElevatorModalOpen(true);
    } else {
      setIsNoPassModalOpen(true);
    }
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

  if (backgroundFile === 'arcade-open.png' || backgroundFile === 'arcade-1.png' || backgroundFile === 'arcade-minus1.png') {
    return (
      <>
        <div ref={containerRef} className="w-full h-full relative">
          {/* Elevator */}
          <div
            className={cn(
              'absolute flex left-1/2 -translate-x-1/2 overflow-hidden z-10',
              backgroundFile === 'arcade-open.png' && 'top-[16%] w-[17.5%] ',
              backgroundFile === 'arcade-1.png' && 'top-[42%] w-[11.5%] ',
              backgroundFile === 'arcade-minus1.png' && 'top-[41.4%] w-[7.8%] ',
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <InteractiveElement
              src="/assets/interactive/doors/elevator-door.png"
              alt="Elevator Door Left"
              effect="slide"
              slideDirection="right"
              className="scale-x-[-1]"
              onClick={handleElevatorClick}
              isHovered={isHovered}
            />
            <InteractiveElement
              src="/assets/interactive/doors/elevator-door.png"
              alt="Elevator Door Right"
              effect="slide"
              slideDirection="right"
              onClick={handleElevatorClick}
              isHovered={isHovered}
            />
          </div>

          {/* Floor -1 */}
          {backgroundFile === 'arcade-minus1.png' && (
            <>
              <div className='absolute right-[18%] bottom-[36%] transition-all duration-300 ease-out hover:scale-110'>
                <InteractiveElement
                  src="/assets/interactive/games/dance-machine.png"
                  alt="Dance Machine piece"
                  effect='scale'
                  animated={false}
                  className='relative'
                  onClick={() => handleElementClick('dance-machine')}
                />
                {/* <img src='/assets/interactive/games/dance-machine-piece.png' alt="ticket counter" className={cn(["absolute bottom-[17%] right-[35%] z-30", ])} /> */}
              </div>
            </>
          )}

          {/* Ticket Counter - Only on main floor */}
          {backgroundFile === 'arcade-open.png' && (
           <>
            <div className='relative left-[20%] top-[26%]'>
              <img src='/assets/interactive/furniture/ticket.png' alt="ticket counter"
                className="absolute" />
              <InteractiveElement
                src="/assets/interactive/furniture/ticket-out.png"
                alt="Purchase Arcade Pass"
                effect='opacity'
                className='absolute'
                onClick={handleTicketPurchase}
              />
            </div>
          {/* Prizes */}
          <div className='absolute right-[7%] top-[33%]'>
            <InteractiveElement
              src="/assets/interactive/furniture/prizes.png"
              alt="prizes"
              animated={false}
              effect='scale'
              onClick={() => handleElementClick('prizes')}
            />
          </div>
           </>
          )}

        </div>

        {/* Modals */}
        <ArcadePassModal
          isOpen={isArcadePassModalOpen}
          onClose={() => setIsArcadePassModalOpen(false)}
        />
        <ElevatorModal
          isOpen={isElevatorModalOpen}
          onClose={() => setIsElevatorModalOpen(false)}
        />
        <NoPassModal
          isOpen={isNoPassModalOpen}
          onClose={() => setIsNoPassModalOpen(false)}
        />
        {gameModalContent && (
          <GameModal
            isOpen={isGameModalOpen}
            onClose={() => setIsGameModalOpen(false)}
            title={gameModalContent.title}
          >
            {gameModalContent.content}
          </GameModal>
        )}
      </>
    );
  }

  if (backgroundFile === 'stage-open.png') {
    return (
      <div ref={containerRef} className="w-full h-full relative">
        <div
          className='absolute w-full h-[55%] top-[5%] overflow-hidden'
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <InteractiveElement
            src="/assets/interactive/curtain.png"
            alt="Curtain"
            effect="slide"
            slideDirection="up"
            className="w-[88%] h-auto absolute left-1/2 -translate-x-1/2 top-0"
            onClick={() => console.log('Curtain clicked')}
            isHovered={isHovered}
          />
          <img
            src="/assets/interactive/red-curtain.png"
            alt="Red curtain"
            className="w-[90%] h-auto relative left-[5%] top-0 pointer-events-none"
          />

        </div>
        <InteractiveElement
          src="/assets/interactive/stage-open-little-door.png"
          alt="Stage little door"
          effect="slide"
          slideDirection="right"
          className="w-[46px] absolute bottom-[22.8%] left-[45.4%]"
          onClick={handleChairClick}
        />

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
              onClick={handleChairClick}
            />
          ))}
        </div>

        {/* Row 2 (Middle) - Medium z-index */}
        <div className="absolute bottom-[5%] -left-[6%] flex items-center -space-x-4 z-20">
          {Array.from({ length: 5 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row2-${i}`}
              src="/assets/interactive/furniture/stage-chair-left.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={handleChairClick}
            />
          ))}
        </div>

        {/* Row 3 (Back) - Lowest z-index */}
        <div className="absolute bottom-[10%] -left-[2%] flex items-center -space-x-4 z-10">
          {Array.from({ length: 5 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row3-${i}`}
              src="/assets/interactive/furniture/stage-chair-left.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={handleChairClick}
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
              onClick={handleChairClick}
            />
          ))}
        </div>

        {/* Row 2 (Middle) - Medium z-index */}
        <div className="absolute bottom-[5%] -right-[6%] flex items-center -space-x-4 z-20">
          {Array.from({ length: 5 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row2-${i}`}
              src="/assets/interactive/furniture/stage-chair.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={handleChairClick}
            />
          ))}
        </div>

        {/* Row 3 (Back) - Lowest z-index */}
        <div className="absolute bottom-[10%] -right-[2%] flex items-center -space-x-4 z-10">
          {Array.from({ length: 5 }).map((_, i) => (
            <InteractiveElement
              key={`chair-row3-${i}`}
              src="/assets/interactive/furniture/stage-chair.png"
              alt="Stage Chair"
              effect="scale"
              className="w-28"
              onClick={handleChairClick}
            />
          ))}
        </div>
      </div>
    );
  }

  // Town elements (when background is town-open.png)
  if (backgroundFile === 'town-open.png') {
    return (
      <>
        {/* Arcade - Left side */}
        <div className="absolute left-[10%] sm:left-[18%] top-[30%] sm:top-[25%] z-15">
           <img
            src="/assets/interactive/builds/arcade.png"
            alt="Arcade"
            className="h-56 sm:h-60 md:h-64 lg:h-72"
          />
          <InteractiveElement
            src="/assets/interactive/builds/arcade-door.png"
            alt="Arcade Door"
            animated={false}
            onClick={() => setCurrentLocation('arcade')}
            effect="door"
            className="absolute bottom-0 right-0  w-[40%] z-15"
          />
        </div>

        {/* Stage - Center */}
        <div className="absolute left-1/2 top-[26%] sm:top-[21%] transform -translate-x-1/2 z-15">
          <img
            src="/assets/interactive/builds/stage.png"
            alt="Stage"
            className="size-56 sm:size-60 md:size-64 lg:size-72"
          />
          <InteractiveElement
            src="/assets/interactive/builds/stage-door.png"
            alt="Stage Door"
            animated={false}
            onClick={() => setCurrentLocation('stage')}
            effect="door"
            className="absolute bottom-0 -right-2  w-[50%] z-15"
          />
        </div>

        {/* Shop - Right side */}
        <div className="absolute right-[10%] sm:right-[18%] top-[30%] sm:top-[25%] z-15">
          <img
            src="/assets/interactive/builds/shop.png"
            alt="Shop"
            className="h-56 sm:h-60 md:h-64 lg:h-72"
          />
          <InteractiveElement
            src="/assets/interactive/builds/shop-door.png"
            alt="Shop Door"
            animated={false}
            onClick={() => handleElementClick('shop')}
            effect="door"
            className="absolute bottom-0 left-0  w-[60%] z-15"
          />

        </div>

        {/* Bush 3 - Left side, slightly above bush-1 */}
        <div className="absolute left-0 top-[69%] z-[10]">
          <InteractiveElement
            src="/assets/scenario/bush-3.png"
            alt="Bush 3"
            animated={false}
            onClick={() => handleElementClick('bush-3')}
            className="h-20 sm:h-24 md:h-28 lg:h-32"
          />
        </div>

        {/* Bush 4 - Right side, slightly above bush-2 */}
        <div className="absolute right-0 top-[69%] z-[10]">
          <InteractiveElement
            src="/assets/scenario/bush-4.png"
            alt="Bush 4"
            animated={false}
            onClick={() => handleElementClick('bush-4')}
            className="size-20 sm:size-24 md:size-28 lg:size-32"
          />
        </div>

        {/* Bush 1 - Bottom left corner (highest z-index) */}
        <div className="absolute left-0 bottom-0 z-[20]">
          <InteractiveElement
            src="/assets/scenario/bush-1.png"
            alt="Bush 1"
            animated={false}
            onClick={() => handleElementClick('bush-1')}
            className="size-20 sm:size-24 md:h-28 lg:size-32"
          />
        </div>

        {/* Bush 2 - Bottom right corner (highest z-index) */}
        <div className="absolute right-0 bottom-0 z-[20]">
          <InteractiveElement
            src="/assets/scenario/bush-2.png"
            alt="Bush 2"
            animated={false}
            onClick={() => handleElementClick('bush-2')}
            className="size-20 sm:size-24 md:size-28 lg:size-32"
          />
        </div>

        {/* streetlight - left */}
        <div className="absolute left-[6%] bottom-[10%] z-[15]">
          <InteractiveElement
            src="/assets/scenario/streetlight.png"
            alt="streetlight 1"
            animated={false}
            onClick={() => handleElementClick('bush-2')}
            className="h-48 sm:h-52 md:h-56 lg:h-60"
          />
        </div>
        <MovementBlocker id="town-buildings" x={8} y={86} width={4.5} height={4} />

        {/* streetlight -right */}
        <div className="absolute right-[12%] bottom-[10%] z-[15]">
          <InteractiveElement
            src="/assets/scenario/streetlight.png"
            alt="streetlight 2"
            animated={false}
            onClick={() => handleElementClick('bush-2')}
            className="h-48 sm:h-52 md:h-56 lg:h-60"
          />
        </div>
        <MovementBlocker id="town-buildings" x={82.5} y={86} width={4.5} height={4} />
      </>
    );
  }

  // Town elements (when background is town-open.png)
if (backgroundFile === 'nostr-station-open.png') {
  return (
    <>
      {/* Nostr Station */}
      <div className="absolute w-full h-full z-15">
        <div className="absolute top-[6%] right-[5%] w-[20%] h-auto">
          {/* Build container - relative */}
          <img
            src="/assets/interactive/builds/nostr-station-build.png"
            alt="Nostr Station"
            className="w-full h-auto"
          />
          {/* Door inside the build */}
          <InteractiveElement
            src="/assets/interactive/builds/nostr-station-door.png"
            alt="Nostr Station Door"
            animated={false}
            onClick={() => handleElementClick('arcade')}
            effect="door"
            className="absolute bottom-0 left-[10%] w-[31%] z-15"
          />
        </div>
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
            onClick={() => setCurrentLocation('cave-open')}
            effect="opacity"
            className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 lg:size-[214px]"
          />
        </div>
      </>
    );
  }

  if (backgroundFile === 'cave-open.png') {
    return (
      <>
        {/* Cave - Center, transparent by default */}
        <div className="absolute left-[10%] top-[64%] z-20">
          <InteractiveElement
            src="/assets/interactive/sign.png"
            alt="Cave"
            animated={false}
            onClick={() => setCurrentLocation('mine')}
            effect="scale"
            className="w-[80%]"
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
      <div className="absolute inset-x-0 top-0 flex items-center justify-center z-10">
        <div className="relative">
          <img
            src="/assets/interactive/builds/plaza-build.png"
            alt="Plaza building"
            className="max-w-full max-h-full"
          />
          <InteractiveElement
            src="/assets/interactive/builds/plaza-door.png"
            alt="Plaza Door"
            animated={false}
            onClick={() => handleElementClick('plaza-door')}
            effect="door"
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[10.5%] z-11"
          />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-10 sm:bottom-28 flex items-center justify-center z-10">
      <img src="/assets/scenario/floor.png" alt="Floor" className="max-w-full max-h-full" />
      </div>
    </>
  );
}

  // No interactive elements for other backgrounds
  return null;
}
