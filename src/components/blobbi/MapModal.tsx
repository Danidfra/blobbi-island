import React, { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import type { LocationId } from '@/lib/location-types';
import { IconX } from '@tabler/icons-react';

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
    position: { x: 64, y: 38 },
    size: { width: 60, height: 60 }
  },
  {
    id: 'beach',
    name: 'Beach',
    image: '/assets/beach.png',
    position: { x: 60, y: 87 },
    size: { width: 60, height: 60 }
  },
  {
    id: 'mine',
    name: 'Mine',
    image: '/assets/mine.png',
    position: { x: 24, y: 79 },
    size: { width: 100, height: 100 }
  },
  {
    id: 'nostr-station',
    name: 'Nostr Station',
    image: '/assets/nostr-station.png',
    position: { x: 80, y: 67 },
    size: { width: 80, height: 80 }
  },
  {
    id: 'plaza',
    name: 'Plaza',
    image: '/assets/plaza.png',
    position: { x: 47.5, y: 47 },
    size: { width: 100, height: 100 }
  },
  {
    id: 'town',
    name: 'Town',
    image: '/assets/town.png',
    position: { x: 33, y: 26 },
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
        "absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2",
        className
      )}
      onClick={(e) => {
        // Close modal when clicking on backdrop
        if (e.target === e.currentTarget) {
          handleCloseModal();
        }
      }}
    >
      <div
        className="relative w-full h-full max-w-[95%] max-h-[95%] bg-transparent flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={handleCloseModal}
          className={cn(
            "absolute top-2 right-2 z-50",
            "bg-white/80 hover:bg-white/90 backdrop-blur-sm rounded-full",
            "h-8 w-8 shadow-lg hover:shadow-xl",
            "transition-all duration-200 ease-out",
            "hover:scale-105 active:scale-95",
            "text-foreground hover:text-red-500",
            "flex items-center justify-center"
          )}
          title="Close Map"
          aria-label="Close Map"
        >
          <IconX className="w-3 h-3" />
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
              maxWidth: '100%',
              maxHeight: '100%',
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
        <div className="absolute top-2 left-1 transform z-10 px-2">
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