import React, { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import type { LocationId } from '@/lib/location-types';
import { X } from 'lucide-react';

// Location data with positioning coordinates (as percentages of the island image)
interface Location {
  id: LocationId;
  name: string;
  image: string;
  position: {
    x: number; // percentage from left (0-100)
    y: number; // percentage from top (0-100)
  };
  size?: {
    width: number; // pixels
    height: number; // pixels
  };
}

const LOCATIONS: Location[] = [
  {
    id: 'home',
    name: 'Home',
    image: '/assets/home.png',
    position: { x: 58, y: 42 },
    size: { width: 60, height: 60 }
  },
  {
    id: 'beach',
    name: 'Beach',
    image: '/assets/beach.png',
    position: { x: 55, y: 75 },
    size: { width: 60, height: 60 }
  },
  {
    id: 'mine',
    name: 'Mine',
    image: '/assets/mine.png',
    position: { x: 36, y: 69 },
    size: { width: 100, height: 100 }
  },
  {
    id: 'nostr-station',
    name: 'Nostr Station',
    image: '/assets/nostr-station.png',
    position: { x: 67, y: 61 },
    size: { width: 80, height: 80 }
  },
  {
    id: 'plaza',
    name: 'Plaza',
    image: '/assets/plaza.png',
    position: { x: 48, y: 47 },
    size: { width: 100, height: 100 }
  },
  {
    id: 'town',
    name: 'Town',
    image: '/assets/town.png',
    position: { x: 40, y: 34 },
    size: { width: 120, height: 120 }
  },
];



interface MapModalProps {
  className?: string;
}

export function MapModal({ className }: MapModalProps) {
  const { isMapModalOpen, setIsMapModalOpen, currentLocation, setCurrentLocation } = useLocation();
  const [hoveredLocation, setHoveredLocation] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  if (!isMapModalOpen) return null;

  const handleLocationClick = (locationId: LocationId) => {
    console.log(`Clicked location: ${locationId}`);

    // Set the new location and close modal for all locations
    setCurrentLocation(locationId);
    setIsMapModalOpen(false);
  };

  const handleCloseModal = () => {
    setIsMapModalOpen(false);
  };

  return (
    <div
      className={cn(
        "fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4",
        className
      )}
      onClick={handleCloseModal}
    >
      <div
        className="relative w-full h-full max-w-[98vw] max-h-[98vh] sm:max-w-[95vw] sm:max-h-[95vh] bg-transparent flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={handleCloseModal}
          className={cn(
            "absolute top-2 right-2 sm:top-4 sm:right-4 z-50",
            "bg-white/90 backdrop-blur-sm border border-border rounded-full",
            "p-2 sm:p-3 shadow-lg hover:shadow-xl",
            "transition-all duration-300 ease-out",
            "hover:scale-105 active:scale-95",
            "text-foreground hover:text-red-500"
          )}
          title="Close Map"
          aria-label="Close Map"
        >
          <X className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>



        {/* Map Container */}
        <div
          ref={mapContainerRef}
          className="relative w-full h-full flex items-center justify-center"
        >
          {/* Island Map Background */}
          <img
            src="/assets/blobbi-island.png"
            alt="Blobbi Village Map"
            className="max-w-full max-h-full object-contain drop-shadow-2xl transition-all duration-500 ease-in-out"
            style={{
              maxWidth: 'min(94vw, 94vh)',
              maxHeight: 'min(94vw, 94vh)',
              width: 'auto',
              height: 'auto'
            }}
          />

          {/* Location Overlays */}
          {LOCATIONS.map((location) => (
            <button
              key={location.id}
              onClick={() => handleLocationClick(location.id)}
              onMouseEnter={() => setHoveredLocation(location.id)}
              onMouseLeave={() => setHoveredLocation(null)}
              className={cn(
                "absolute transform -translate-x-1/2 -translate-y-1/2",
                "transition-all duration-300 ease-out",
                "cursor-pointer",
                "hover:z-20",
                "rounded-lg",
                "active:scale-95",
                hoveredLocation === location.id && "scale-110 drop-shadow-2xl z-20",
              )}
              style={{
                left: `${location.position.x}%`,
                top: `${location.position.y}%`,
                width: location.size?.width || 60,
                height: location.size?.height || 60,
              }}
              title={location.name}
              aria-label={`Go to ${location.name}`}
            >
              <img
                src={location.image}
                alt={location.name}
                className={cn(
                  "w-full h-full object-contain",
                  "transition-all duration-300 ease-out",
                  "drop-shadow-lg",
                  hoveredLocation === location.id && "brightness-110 contrast-110"
                )}
              />

              {/* Location Label (appears on hover) */}
              <div
                className={cn(
                  "absolute left-1/2 transform -translate-x-1/2 top-full mt-2",
                  "bg-black/90 text-white text-xs font-medium px-3 py-1.5 rounded-full",
                  "transition-all duration-300 ease-out",
                  "whitespace-nowrap border border-white/20",
                  "backdrop-blur-sm",
                  hoveredLocation === location.id
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-2"
                )}
              >
                {location.name}
                {currentLocation === location.id && " (Current)"}
              </div>
            </button>
          ))}


        </div>

        {/* Instructions */}
        <div className="absolute bottom-2 sm:bottom-6 left-1/2 transform -translate-x-1/2 z-10 px-2">
          <div className="bg-white/95 backdrop-blur-sm border border-border rounded-full px-3 sm:px-6 py-2 sm:py-3 shadow-xl max-w-[90vw]">
            <p className="text-xs sm:text-sm text-muted-foreground text-center font-medium">
              🏝️ Click on a location to travel there • Current location is {`${currentLocation}`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}