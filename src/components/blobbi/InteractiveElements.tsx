import { FoodShopModal } from './FoodShopModal';
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

// BackArrow component using SVG
function BackArrow({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <div
      className={cn(
        'cursor-pointer select-none transition-all duration-300 ease-out hover:scale-110 active:scale-95',
        className
      )}
      onClick={onClick}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <path
          d="M19 12H5M5 12L12 19M5 12L12 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

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
  const [isFoodShopModalOpen, setIsFoodShopModalOpen] = useState(false);


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
              backgroundFile === 'arcade-1.png' && 'top-[40.5%] w-[10%] ',
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
                <InteractiveElement
                  src="/assets/interactive/games/dance-machine.png"
                  alt="Dance Machine"
                  effect='scale'
                  className='absolute right-[18%] bottom-[36%]'
                  onClick={() => handleElementClick('dance-machine')}
                />

            {/* Wall decorations */}
             <>
              {/* Left */}
                <img src='/assets/scenario/arcade/arcade-minus1/yellow-guitar-neon.png' alt="ticket counter" className="absolute top-[34%] left-[15%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/pink-headset-neon.png' alt="ticket counter" className="absolute top-[27%] left-[10%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/yellow-mic-neon.png' alt="ticket counter" className="absolute top-[27%] left-[2%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/blue-mic-neon.png' alt="ticket counter" className="absolute top-[40%] left-[10%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/song-neon.png' alt="ticket counter" className="absolute top-[48%] left-[2%] w-[4%]" />

              {/* Middle */}
                <img src='/assets/scenario/arcade/arcade-minus1/blue-notes-neon.png' alt="ticket counter" className="absolute top-[32%] left-[28%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/cd-neon.png' alt="ticket counter" className="absolute top-[27%] left-[40%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/blue-wire-mic-neon.png' alt="ticket counter" className="absolute top-[27%] right-[30%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/yellow-note-up-neon.png' alt="ticket counter" className="absolute top-[27%] right-[40%] w-[4%]" />

              {/* Right */}
                <img src='/assets/scenario/arcade/arcade-minus1/notes-neon.png' alt="ticket counter" className="absolute top-[34%] right-[17%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/pink-note-neon.png' alt="ticket counter" className="absolute top-[27%] right-[10%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/yellow-headset-neon.png' alt="ticket counter" className="absolute top-[27%] right-[2%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/purple-note-neon.png' alt="ticket counter" className="absolute top-[40%] right-[10%] w-[4%]" />
                <img src='/assets/scenario/arcade/arcade-minus1/blue-note-neon.png' alt="ticket counter" className="absolute top-[48%] right-[2%] w-[4%]" />

              <img src='/assets/scenario/arcade/arcade-minus1/wall-art-pac-blobbi.png' alt="ticket counter" className="absolute top-[42%] left-[34%] w-[5%]" />
              <img src='/assets/scenario/arcade/arcade-minus1/wall-art-blobbi-kong.png' alt="ticket counter" className="absolute top-[42%] right-[34%] w-[5%]" />
             </>

            <div className='flex absolute bottom-[25%] left-[24%] w-[12.5%] gap-[20%]'>
              <InteractiveElement
                src="/assets/scenario/arcade/left-chair-arcade.png"
                alt="Left Chair"
                effect='scale'
                className='left-[18%] bottom-[36%] w-[40%] z-[25]'
                // onClick={() => handleElementClick('dance-machine')}
              />
              <InteractiveElement
                src="/assets/scenario/arcade/right-chair-arcade.png"
                alt="Right Chair"
                effect='scale'
                className='left-[30%] bottom-[36%] w-[40%] z-[25]'
                // onClick={() => handleElementClick('dance-machine')}
              />
              <img src='/assets/scenario/arcade/table-arcade.png' alt="ticket counter" className="absolute left-1/2 transform -translate-x-1/2 top-[20%] w-[60%] z-[26]" />
            </div>
            <div className='flex absolute bottom-[25%] right-[24%] w-[12.5%] gap-[20%]'>
              <InteractiveElement
                src="/assets/scenario/arcade/left-chair-arcade.png"
                alt="Left Chair"
                effect='scale'
                className='left-[18%] bottom-[36%] w-[40%] z-[25]'
                // onClick={() => handleElementClick('dance-machine')}
              />
              <InteractiveElement
                src="/assets/scenario/arcade/right-chair-arcade.png"
                alt="Right Chair"
                effect='scale'
                className='left-[30%] bottom-[36%] w-[40%] z-[25]'
                // onClick={() => handleElementClick('dance-machine')}
              />
              <img src='/assets/scenario/arcade/table-arcade.png' alt="ticket counter" className="absolute left-1/2 transform -translate-x-1/2 top-[20%] w-[60%] z-[26]" />
            </div>

            <div>
            <img src='/assets/scenario/arcade/arcade-minus1/arcade-tundra-stage.png' alt="ticket counter" className="absolute left-1/2 transform -translate-x-1/2 bottom-0 w-[50%]" />
              <InteractiveElement
                src="/assets/interactive/games/arcade-mic.png"
                alt="Right Chair"
                effect='scale'
                className='absolute left-1/2 transform -translate-x-1/2 bottom-[18%] w-[3%] z-[30]'
                // onClick={() => handleElementClick('dance-machine')}
              />
            </div>

            </>
          )}

          {/* Floor 1 */}
          {backgroundFile === 'arcade-1.png' && (
            <>
              <img src='/assets/scenario/arcade/arcade-1/trophy-neon.png' alt="ticket counter" className="absolute top-[32%] left-[14%] w-[6%]" />
              <img src='/assets/scenario/arcade/arcade-1/sword-neon.png' alt="ticket counter" className="absolute top-[26%] left-[6%] w-[5%] -rotate-12" />
              <img src='/assets/scenario/arcade/arcade-1/play-neon.png' alt="ticket counter" className="absolute top-[44%] left-[6%] w-[6%] -rotate-12" />

              <img src='/assets/scenario/arcade/arcade-1/wall-art-blobbizard.png' alt="ticket counter" className="absolute top-[42%] left-[34%] w-[5%]" />
              <img src='/assets/scenario/arcade/arcade-1/wall-art-blobbi-adventure.png' alt="ticket counter" className="absolute top-[42%] right-[34%] w-[6%]" />

              <img src='/assets/scenario/arcade/arcade-1/controller-neon.png' alt="ticket counter" className="absolute top-[32%] left-[26%] w-[7%] -rotate-12" />
              <img src='/assets/scenario/arcade/arcade-1/star-neon.png' alt="ticket counter" className="absolute left-1/2 transform -translate-x-1/2 top-[27%] w-[5%]" />
              <img src='/assets/scenario/arcade/arcade-1/dice-neon.png' alt="ticket counter" className="absolute top-[31%] right-[26%] w-[6%]" />

              <img src='/assets/scenario/arcade/arcade-1/pac-man-neon.png' alt="ticket counter" className="absolute top-[32%] right-[15%] w-[4.5%] rotate-12" />
              <img src='/assets/scenario/arcade/arcade-1/game-boy-neon.png' alt="ticket counter" className="absolute top-[28%] right-[4%] w-[4%] rotate-12" />
              <img src='/assets/scenario/arcade/arcade-1/retro-controller-neon.png' alt="ticket counter" className="absolute top-[44%] right-[6%] w-[6%] rotate-12" />

                {/* Left Arcade Machine */}
                  <InteractiveElement
                    src="/assets/interactive/games/arcade-machine-pink.png"
                    alt="Arcade Machine Pink"
                    effect='scale'
                    className='absolute left-[18%] w-[12%] bottom-[28%] z-[15]'
                    onClick={() => handleElementClick('dance-machine')}
                    />
                  <InteractiveElement
                    src="/assets/interactive/games/arcade-machine-black.png"
                    alt="Arcade Machine classic"
                    effect='scale'
                    className='absolute left-[11%] w-[12.5%] bottom-[22%] z-20'
                    onClick={() => handleElementClick('dance-machine')}
                    />
                  <InteractiveElement
                    src="/assets/interactive/games/arcade-machine-classic.png"
                    alt="Arcade Machine classic"
                    effect='scale'
                    className='absolute left-[4%] w-[12.5%] bottom-[16%] z-[25]'
                    onClick={() => handleElementClick('dance-machine')}
                    />

                  {/* Middle */}
                  <InteractiveElement
                    src="/assets/interactive/games/snooker.png"
                    alt="Arcade Machine Green"
                    effect='scale'
                    className='absolute left-[30%] w-[17.5%] bottom-[10%] z-30'
                    onClick={() => handleElementClick('dance-machine')}
                  />

                  <InteractiveElement
                    src="/assets/interactive/games/air-hockey.png"
                    alt="Arcade Air Hockey"
                    effect='scale'
                    className='absolute right-[30%] w-[17.5%] bottom-[10%] z-30'
                    onClick={() => handleElementClick('dance-machine')}
                  />

                  {/* Right Arcade Machine */}
                  <InteractiveElement
                    src="/assets/interactive/games/arcade-machine-green.png"
                    alt="Arcade Machine Green"
                    effect='scale'
                    className='absolute right-[18%] w-[12.5%] bottom-[28%] z-[15]'
                    onClick={() => handleElementClick('dance-machine')}
                  />
                  <InteractiveElement
                    src="/assets/interactive/games/arcade-machine-purple.png"
                    alt="Arcade Machine Purple"
                    effect='scale'
                    className='absolute right-[11%] w-[12.5%] bottom-[22%] z-20'
                    onClick={() => handleElementClick('dance-machine')}
                  />
                  <InteractiveElement
                    src="/assets/interactive/games/arcade-machine-red.png"
                    alt="Arcade Machine Red"
                    effect='scale'
                    className='absolute right-[4%] w-[12.5%] bottom-[16%] z-[25]'
                    onClick={() => handleElementClick('dance-machine')}
                  />
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

            <img src='/assets/scenario/arcade/arcade-ground/wall-art-super-blobbi.png' alt="ticket counter" className="absolute top-[6%] right-[10%] w-[20%]" />
            <img src='/assets/scenario/arcade/arcade-ground/wall-art-game-boy.png' alt="ticket counter" className="absolute top-[12%] left-[2%] w-[10%]" />
            <img src='/assets/scenario/arcade/arcade-ground/play-up-neon.png' alt="ticket counter" className="absolute top-[18%] left-[28%] w-[8%]" />
            <img src='/assets/scenario/arcade/arcade-ground/trophy-money-neon.png' alt="ticket counter" className="absolute top-[18%] right-[31%] w-[6%]" />

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


  if (backgroundFile === 'shop-open.png') {
    return (
      <>
        <div className="absolute inset-0 pointer-events-none">
          <img
            src="/assets/scenario/glass-barrier-bottom.png"
            alt="Glass Barrier"
            className="absolute w-full bottom-[35.3%] object-cover z-[20]"
          />
          <img
            src="/assets/scenario/glass-barrier-top.png"
            alt="Glass Barrier"
            className="absolute w-full top-[28.4%] object-cover z-[10]"
          />
          <img
            src="/assets/scenario/shop-stairs.png"
            alt="Glass Barrier"
            className="absolute w-[11.8%] bottom-[9.5%] left-0 z-[25]"
          />
          <img
            src="/assets/scenario/shop-stairs.png"
            alt="Glass Barrier"
            className="absolute w-[11.5%] bottom-[38.7%] right-0 scale-x-[-1] z-[15]"
          />
        </div>
        <BackArrow
          onClick={() => setCurrentLocation('town')}
          className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
        />

       <div>
         <img
          src="/assets/scenario/shop/belt-barrier.png"
          alt="Belt barrier"
          className='absolute bottom-[7%] right-[18%] w-[6%] z-[26]'
        />
        <img
          src="/assets/scenario/shop/belt-barrier.png"
          alt="Belt barrier"
          className='absolute bottom-[7%] right-[2%] w-[6%] z-[26]'
        />
       </div>

          {/* Coffee Shop */}
          <div className='absolute bottom-[12%] left-[28%] z-20 w-[22.5%]'>
            <img
              />
            <InteractiveElement
              src="/assets/scenario/shop/coffee-shop.png"
              alt="Shopping coffe shop"
              effect="scale"
              animated={false}
            />
          </div>

          {/* Badges Store */}
          <div className='absolute bottom-[38.5%] -left-[2.5%] z-15 w-[24.5%]'>
            <img
              src="/assets/scenario/shop/badges-store.png"
              alt="Shopping badges store"
              />
            <InteractiveElement
              src="/assets/interactive/doors/badges-store-door.png"
              alt="Badges store"
              effect="opacity"
              className="absolute -bottom-[5%] right-0 w-[29.4%]"
            />
          </div>

        {/* Plants */}
          <img
            className='absolute bottom-[38.5%] left-[26%] z-[15] w-[3%]'
            src="/assets/scenario/shop/plant-1.png"
            alt="Photo booth open"
          />

          <img
            className='absolute bottom-[38.5%] right-[26%] z-[15] w-[3%]'
            src="/assets/scenario/shop/plant-1.png"
            alt="Photo booth open"
          />
          <img
            className='absolute bottom-[10.5%] left-[20.4%] z-[15] w-[7%]'
            src="/assets/scenario/shop/plant-2.png"
            alt="Photo booth open"
          />

          <img
            className='absolute bottom-[10.5%] right-[20.4%] z-[15] w-[7%]'
            src="/assets/scenario/shop/plant-2.png"
            alt="Photo booth open"
          />
          <img
            className='absolute bottom-[66.5%] left-[16%] z-[9] w-[6%]'
            src="/assets/scenario/shop/plant-3.png"
            alt="Photo booth open"
          />

          <img
            className='absolute bottom-[66.5%] right-[16%] z-[9] w-[6%]'
            src="/assets/scenario/shop/plant-3.png"
            alt="Photo booth open"
          />


          {/* Photo Booth */}
          <div className='absolute bottom-[38.5%] left-[33.5%] z-[15] w-[8.5%]'>
            <img
              src="/assets/scenario/shop/photo-booth.png"
              alt="Photo booth open"
              />
            <InteractiveElement
              src="/assets/interactive/doors/photo-booth-door.png"
              alt="Photo booth open"
              effect="opacity"
              className="absolute bottom-[5.8%] right-[12.8%] w-[42.2%]"
            />
          </div>

          {/* Clothing Store */}
          <div className='absolute bottom-[38.5%] right-[25.5%] z-15 w-[24.5%]'>
            <img
              src="/assets/scenario/shop/clothing-store.png"
              alt="Shopping clothing store"
              />
            <InteractiveElement
              src="/assets/interactive/doors/clothing-store-door.png"
              alt="Clothing store"
              effect="opacity"
              className="absolute -bottom-[5%] left-[5%] w-[52.8%]"
            />
          </div>

          {/* Furniture Store */}
          <div className='absolute top-[7.4%] left-1/2 transform -translate-x-1/2 z-15 w-[30%]'>
            <img
              src="/assets/scenario/shop/furniture-store.png"
              alt="Shopping furniture store"
              />
            <InteractiveElement
              src="/assets/interactive/doors/furniture-store-door.png"
              alt="Furniture store door"
              effect="opacity"
              className="absolute bottom-0 left-[10%] w-[35.3%]"
            />
          </div>

        <div className='absolute flex bottom-[12%] right-[4%] z-10 gap-6'>
          <div>
            <img
              src="/assets/interactive/furniture/self-service-kiosk.png"
              alt="Self service kiosk"
              />
            <InteractiveElement
              src="/assets/interactive/furniture/self-service-kiosk-on.png"
              alt="Self service kiosk on"
              effect="opacity"
              className="absolute bottom-0"
              onClick={() => setIsFoodShopModalOpen(true)}
            />
          </div>
          <div>
            <img
              src="/assets/interactive/furniture/self-service-kiosk.png"
              alt="Self service kiosk"
              />
            <InteractiveElement
              src="/assets/interactive/furniture/self-service-kiosk-on.png"
              alt="Self service kiosk on"
              effect="opacity"
              className="absolute bottom-0"
              onClick={() => setIsFoodShopModalOpen(true)}
            />
          </div>
        </div>

        <FoodShopModal isOpen={isFoodShopModalOpen} onClose={() => setIsFoodShopModalOpen(false)} />

        <div>
          <div className='flex absolute bottom-[3%] right-[42%] w-[16.5%] gap-[30%]'>
            <img
              src="/assets/interactive/furniture/shop-table.png"
              alt="Shop table" className="absolute left-1/2 transform -translate-x-1/2 top-[20%] w-[50%] z-[28]" />
            <InteractiveElement
                src="/assets/interactive/furniture/shop-left-chair.png"
              alt="Shop left chair"
              effect='scale'
              className='left-[18%] bottom-[36%] w-[40%] z-[27]'
            />
            <InteractiveElement
                src="/assets/interactive/furniture/shop-right-chair.png"
              alt="Shop right chair"
              effect='scale'
              className='left-[30%] bottom-[36%] w-[40%] z-[27]'
            />
          </div>
          <div className='flex absolute bottom-[3%] right-[24%] w-[16.5%] gap-[30%]'>
            <img
              src="/assets/interactive/furniture/shop-table.png"
              alt="Shop table" className="absolute left-1/2 transform -translate-x-1/2 top-[20%] w-[50%] z-[28]" />
            <InteractiveElement
                src="/assets/interactive/furniture/shop-left-chair.png"
              alt="Shop left chair"
              effect='scale'
              className='left-[18%] bottom-[36%] w-[40%] z-[27]'
            />
            <InteractiveElement
                src="/assets/interactive/furniture/shop-right-chair.png"
              alt="Shop right chair"
              effect='scale'
              className='left-[30%] bottom-[36%] w-[40%] z-[27]'
            />
          </div>
        </div>
      </>
    );
  }

  // Town elements (when background is town-open.png)
  if (backgroundFile === 'town-open.png') {

    return (
      <div className='relative w-full h-full'>
        {/* Arcade - Left side */}
          <div className="absolute left-[18%] top-[25%] w-[21.1%] z-15">
            <img
              src="/assets/interactive/builds/arcade.png"
              alt="Arcade"
              className="w-full"
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
          <div className="absolute left-1/2 top-[22%] w-[27.6%] transform -translate-x-1/2 z-15">
            <img
              src="/assets/interactive/builds/stage.png"
              alt="Stage"
              className="w-full"
            />
            <InteractiveElement
              src="/assets/interactive/builds/stage-door.png"
              alt="Stage Door"
              animated={false}
              onClick={() => setCurrentLocation('stage')}
              effect="opacity"
              className="absolute bottom-0 -right-[1%]  w-[47%] z-15"
            />
          </div>

          {/* Shop - Right side */}
          <div className="absolute right-[18%] top-[25%] w-[20.5%] z-15">
            <img
              src="/assets/interactive/builds/shop.png"
              alt="Shop"
              className="w-full"
            />
            <InteractiveElement
              src="/assets/interactive/builds/shop-door.png"
              alt="Shop Door"
              animated={false}
              onClick={() => setCurrentLocation('shop')}
              effect="door"
              className="absolute bottom-0 left-0  w-[60%] z-15"
            />

          </div>

        {/* Bush 3 - Left side, slightly above bush-1 */}
          <InteractiveElement
            src="/assets/scenario/bush-3.png"
            alt="Bush 3"
            animated={false}
            onClick={() => handleElementClick('bush-3')}
            className="absolute left-0 top-[69%] z-[10]"
          />

        {/* Bush 4 - Right side, slightly above bush-2 */}
          <InteractiveElement
            src="/assets/scenario/bush-4.png"
            alt="Bush 4"
            animated={false}
            onClick={() => handleElementClick('bush-4')}
            className="absolute right-0 top-[69%] z-[10]"
          />

        {/* Bush 1 - Bottom left corner (highest z-index) */}
          <InteractiveElement
            src="/assets/scenario/bush-1.png"
            alt="Bush 1"
            animated={false}
            onClick={() => handleElementClick('bush-1')}
            className="absolute left-0 bottom-0 z-[20]"
          />

        {/* Bush 2 - Bottom right corner (highest z-index) */}
          <InteractiveElement
            src="/assets/scenario/bush-2.png"
            alt="Bush 2"
            animated={false}
            onClick={() => handleElementClick('bush-2')}
            className="absolute right-0 bottom-0 z-[20]"
          />

        {/* streetlight - left */}
          <InteractiveElement
            src="/assets/scenario/streetlight.png"
            alt="streetlight 1"
            animated={false}
            onClick={() => handleElementClick('bush-2')}
            className="absolute left-[6%] bottom-[10%] h-[35%] z-[15]"
          />
        <MovementBlocker id="town-buildings" x={8} y={86} width={4.5} height={4} />

        {/* streetlight -right */}
          <InteractiveElement
            src="/assets/scenario/streetlight.png"
            alt="streetlight 2"
            animated={false}
            onClick={() => handleElementClick('bush-2')}
            className="absolute right-[12%] bottom-[10%] h-[35%] z-[15]"
          />
        <MovementBlocker id="town-buildings" x={82.5} y={86} width={4.5} height={4} />
      </div>
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
