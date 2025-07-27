import React, { useRef, useState } from 'react';
import { PlaceBackground } from './PlaceBackground';
import { MapButton } from './MapButton';
import { MovableBlobbi, MovableBlobbiRef } from './MovableBlobbi';
import { LocationIndicator } from './LocationIndicator';
import { CurrentBlobbiDisplay } from './CurrentBlobbiDisplay';
import { InteractiveElements } from './InteractiveElements';
import { useLocation } from '@/hooks/useLocation';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import type { Blobbi } from '@/hooks/useBlobbis';
import { Furniture } from './Furniture';
import { Position } from '@/lib/types';
import { RefrigeratorModal } from './RefrigeratorModal';
import { ChestModal } from './ChestModal';
import { getBlobbiSizeForLocation } from '@/lib/location-blobbi-sizes';
import { BoundaryVisualizer } from './BoundaryVisualizer';
import { MiningGame } from './MiningGame';

interface PlayingViewProps {
  selectedBlobbi: Blobbi | null;
  onSwitchBlobbi: () => void;
}

export function PlayingView({ selectedBlobbi, onSwitchBlobbi }: PlayingViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);
  const { currentLocation } = useLocation();
  const [bedPosition, setBedPosition] = useState<Position>({ x: 75, y: 70 });
  const [isRefrigeratorOpen, setIsRefrigeratorOpen] = useState(false);
  const [isChestOpen, setIsChestOpen] = useState(false);

  // Adjusted position for sleeping Blobbi (slightly higher on the bed)
  const sleepingPosition = { x: bedPosition.x, y: bedPosition.y - 5 };
  const [isSleeping, setIsSleeping] = useState(false);
  const [isAttachedToBed, setIsAttachedToBed] = useState(false);

  const background = getBackgroundForLocation(currentLocation);
  const blobbiSize = getBlobbiSizeForLocation(currentLocation);
  const boundary = locationBoundaries[background] || {
    shape: 'rectangle',
    x: [0, 100],
    y: [60, 100],
  };

  const handleBedClick = () => {
    if (blobbiRef.current) {
      // Move to the sleeping position (slightly higher on the bed)
      blobbiRef.current.goTo(sleepingPosition);
    }
  };

  const handleMoveComplete = (position: Position) => {
    // Check if Blobbi reached the sleeping position with tighter tolerance
    if (
      Math.abs(position.x - sleepingPosition.x) < 2 &&
      Math.abs(position.y - sleepingPosition.y) < 2
    ) {
      setIsSleeping(true);
      setIsAttachedToBed(true);
    }
  };

  const handleWakeUp = () => {
    setIsSleeping(false);
    setIsAttachedToBed(false);
  };

  const handleMoveStart = (_destination: Position) => {
    // If starting to move while sleeping, wake up and detach from bed
    if (isSleeping || isAttachedToBed) {
      setIsSleeping(false);
      setIsAttachedToBed(false);
    }
  };

  const handleBedPositionChange = (newPosition: Position) => {
    setBedPosition(newPosition);
    // If Blobbi is attached to bed, move it with the bed immediately (no animation)
    // Use the adjusted sleeping position (slightly higher)
    if (isAttachedToBed && blobbiRef.current) {
      const newSleepingPosition = { x: newPosition.x, y: newPosition.y - 5 };
      blobbiRef.current.goTo(newSleepingPosition, true);
    }
  };

  return (
    <PlaceBackground ref={containerRef}>
      <BoundaryVisualizer boundary={boundary} />
      {/* Interactive Elements - Background specific */}
      <InteractiveElements blobbiRef={blobbiRef} />

      {/* Furniture */}
      {background === 'home-open.png' && (
        <>
          <Furniture
            id="refrigerator"
            containerRef={containerRef}
            initialPosition={{ x: 20, y: 70 }}
            boundary={boundary}
            imageUrl="/assets/interactive/furniture/refrigerator.png"
            hoverEffectImageUrl="/assets/interactive/furniture/refrigerator-door.png"
            size={{ width: 111, height: 173 }}
            backgroundFile={background}
            onClick={() => setIsRefrigeratorOpen(true)}
          />
          <Furniture
            id="chest"
            containerRef={containerRef}
            position={{ x: 40, y: 70 }}
            boundary={boundary}
            imageUrl="/assets/interactive/furniture/chest.png"
            hoverEffectImageUrl="/assets/interactive/furniture/chest-lid-open.png"
            size={{ width: 130, height: 130 }}
            backgroundFile={background}
            onClick={() => setIsChestOpen(true)}
          />
          <Furniture
            id="bed"
            containerRef={containerRef}
            position={bedPosition}
            onPositionChange={handleBedPositionChange}
            boundary={boundary}
            imageUrl="/assets/interactive/furniture/bed.png"
            size={{ width: 100, height: 100 }}
            backgroundFile={background}
            onClick={handleBedClick}
          />
          <RefrigeratorModal
            isOpen={isRefrigeratorOpen}
            onClose={() => setIsRefrigeratorOpen(false)}
          />
          <ChestModal
            isOpen={isChestOpen}
            onClose={() => setIsChestOpen(false)}
          />
        </>
      )}

      {background === 'cave-open.png' && <MiningGame />}

      {/* Movable Blobbi Character */}
      <MovableBlobbi
        ref={blobbiRef}
        key={currentLocation}
        containerRef={containerRef}
        boundary={boundary}
        isVisible={!!selectedBlobbi}
        initialPosition={{ x: 50, y: 80 }}
        backgroundFile={background}
        onMoveStart={handleMoveStart}
        onMoveComplete={handleMoveComplete}
        onWakeUp={handleWakeUp}
        isSleeping={isSleeping}
        isAttachedToBed={isAttachedToBed}
        size={blobbiSize}
        scaleByYPosition={true}
      />

      {/* Map Button - Top Right */}
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-20">
        <MapButton />
      </div>

      {/* Current Location Indicator - Top Center */}
      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 sm:top-4 z-20">
        <LocationIndicator />
      </div>

      {/* Current Blobbi Info - Top Left */}
      <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-20">
        <div className="bg-white/90 backdrop-blur-sm border border-border rounded-lg p-2 sm:p-3 shadow-lg">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <CurrentBlobbiDisplay
              size="sm"
              className="border-2 border-primary/30"
              showFallback={true}
              interactive={true}
              onClick={onSwitchBlobbi}
              isSleeping={isSleeping}
            />
            <div className="text-left">
              <p className="text-xs sm:text-sm font-medium text-foreground">
                {selectedBlobbi?.name || selectedBlobbi?.id}
              </p>
              <button
                onClick={onSwitchBlobbi}
                className="text-xs text-primary hover:underline"
              >
                Switch Blobbi
              </button>
            </div>
          </div>
        </div>
      </div>
    </PlaceBackground>
  );
}
