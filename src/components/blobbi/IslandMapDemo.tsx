/**
 * Demo component to showcase the Interactive Island Map
 * This can be used for testing or as a standalone demo
 */

import React, { useState } from 'react';
import { BlobbiGameContainer } from './BlobbiGameContainer';
import { InteractiveIslandMap, LocationModal } from './InteractiveIslandMap';

export function IslandMapDemo() {
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  const handleLocationClick = (locationId: string) => {
    console.log(`Demo: Clicked location ${locationId}`);
    setSelectedLocation(locationId);
  };

  const handleCloseLocationModal = () => {
    setSelectedLocation(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 to-green-100 p-8">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-primary mb-2">🏝️ Blobbi Island Map Demo</h1>
        <p className="text-lg text-muted-foreground">
          Interactive island map with hover effects and clickable locations
        </p>
      </div>

      <div className="flex justify-center">
        <BlobbiGameContainer>
          <div className="relative w-full h-full bg-gradient-to-b from-sky-200 to-blue-300">
            <InteractiveIslandMap onLocationClick={handleLocationClick} />
          </div>
        </BlobbiGameContainer>
      </div>

      <div className="text-center mt-8 space-y-4">
        <div className="bg-white/80 backdrop-blur-sm border border-border rounded-lg p-4 max-w-2xl mx-auto">
          <h3 className="font-semibold mb-2">Features Demonstrated:</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>✅ Island image loaded in center of 1046×697 container</li>
            <li>✅ Six location overlays positioned absolutely on the map</li>
            <li>✅ Hover effects: cursor pointer + scale animation</li>
            <li>✅ Fully responsive design</li>
            <li>✅ Interactive location selection with modal</li>
            <li>✅ Smooth animations and visual feedback</li>
          </ul>
        </div>

        <div className="text-xs text-muted-foreground">
          <p>
            Locations: Home, Beach, Mine, Nostr Station, Plaza, Town
          </p>
        </div>
      </div>

      {/* Location Modal */}
      {selectedLocation && (
        <LocationModal
          locationId={selectedLocation}
          onClose={handleCloseLocationModal}
        />
      )}
    </div>
  );
}