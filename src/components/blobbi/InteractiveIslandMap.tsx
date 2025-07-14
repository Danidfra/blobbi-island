/**
 * Interactive Blobbi Island Map Component
 *
 * Displays the main island with clickable location overlays.
 * Each location has hover effects and is positioned absolutely over the island image.
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';

// Location data with positioning coordinates (as percentages of the island image)
interface Location {
  id: string;
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
    position: { x: 64, y: 38 }, // Left side, middle area
    size: { width: 80, height: 80 }
  },
  {
    id: 'beach',
    name: 'Beach',
    image: '/assets/beach.png',
    position: { x: 58, y: 85 }, // Bottom left
    size: { width: 65, height: 65 }
  },
  {
    id: 'mine',
    name: 'Mine',
    image: '/assets/mine.png',
    position: { x: 24, y: 78 }, // Top right
    size: { width: 120, height: 120 }
  },
  {
    id: 'nostr-station',
    name: 'Nostr Station',
    image: '/assets/nostr-station.png',
    position: { x: 80, y: 66 }, // Bottom right
    size: { width: 100, height: 100 }
  },
  {
    id: 'plaza',
    name: 'Plaza',
    image: '/assets/plaza.png',
    position: { x: 47, y: 46 }, // Center
    size: { width: 120, height: 120 }
  },
  {
    id: 'town',
    name: 'Town',
    image: '/assets/town.png',
    position: { x: 33, y: 25 }, // Top center-right
    size: { width: 140, height: 140 }
  }
];

interface InteractiveIslandMapProps {
  onLocationClick?: (locationId: string) => void;
  className?: string;
}

export function InteractiveIslandMap({ onLocationClick, className }: InteractiveIslandMapProps) {
  const [hoveredLocation, setHoveredLocation] = useState<string | null>(null);

  const handleLocationClick = (locationId: string) => {
    console.log(`Clicked location: ${locationId}`);
    onLocationClick?.(locationId);
  };

  return (
    <div className={cn("relative w-full h-full flex items-center justify-center p-4", className)}>
      {/* Main Island Image Container */}
      <div className="relative max-w-full max-h-full">
        {/* Island Background */}
        <img
          src="/assets/blobbi-island.png"
          alt="Blobbi Island"
          className="max-w-full max-h-full object-contain drop-shadow-2xl"
          style={{
            maxWidth: 'min(90vw, 90vh)',
            maxHeight: 'min(90vw, 90vh)',
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
              "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-lg",
              "active:scale-95",
              hoveredLocation === location.id && "scale-110 drop-shadow-2xl z-20"
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
              draggable={false}
            />

            {/* Location Label (appears on hover) */}
            <div
              className={cn(
                "absolute left-1/2 transform -translate-x-1/2",
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
            </div>
          </button>
        ))}
      </div>

      {/* Instructions */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10">
        <div className="bg-white/95 backdrop-blur-sm border border-border rounded-full px-6 py-3 shadow-xl">
          <p className="text-sm text-muted-foreground text-center font-medium">
            🏝️ Click on a location to explore the island
          </p>
        </div>
      </div>
    </div>
  );
}

// Location-specific components for future use
export function LocationModal({ locationId, onClose }: { locationId: string; onClose: () => void }) {
  const location = LOCATIONS.find(loc => loc.id === locationId);

  if (!location) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-foreground">{location.name}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="text-center space-y-6">
          <div className="bg-gradient-to-br from-blue-50 to-green-50 rounded-xl p-6">
            <img
              src={location.image}
              alt={location.name}
              className="w-32 h-32 mx-auto object-contain drop-shadow-lg"
            />
          </div>
          <div className="space-y-3">
            <p className="text-lg text-muted-foreground">
              Welcome to <span className="font-semibold text-primary">{location.name}</span>!
            </p>
            <p className="text-sm text-muted-foreground">
              This area is coming soon... Stay tuned for exciting adventures!
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-full bg-primary text-primary-foreground py-3 px-6 rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Explore More
          </button>
        </div>
      </div>
    </div>
  );
}