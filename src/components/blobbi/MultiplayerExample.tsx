/**
 * Example component demonstrating the multiplayer system
 * This shows how to integrate the MultiplayerLayer into a game view
 */

import React, { useRef, useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { MultiplayerLayer } from './MultiplayerLayer';
import { PlaceBackground } from './PlaceBackground';
import { MovableBlobbi, type MovableBlobbiRef } from './MovableBlobbi';
import { locationBoundaries } from '@/lib/location-boundaries';
import type { Position } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function MultiplayerExample() {
  const { user } = useCurrentUser();
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);
  
  const [myPosition, setMyPosition] = useState<Position>({ x: 50, y: 75 });
  
  // Mock Blobbi data for demonstration
  const mockBlobbi = {
    id: 'demo-blobbi-001',
    name: 'Demo Blobbi',
  };
  
  const boundary = locationBoundaries['plaza-open.png'] || {
    shape: 'rectangle' as const,
    x: [5, 95] as [number, number],
    y: [56, 98] as [number, number],
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Multiplayer Demo</CardTitle>
            <CardDescription>
              Please log in to try the multiplayer system
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-200 to-green-200">
      <div className="container mx-auto p-4">
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Multiplayer Demo 
              <Badge variant="secondary">Kind 31950</Badge>
            </CardTitle>
            <CardDescription>
              Click anywhere to move your Blobbi. Other players will see your movement in real-time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <strong>Your Position:</strong> {Math.round(myPosition.x)}, {Math.round(myPosition.y)}
              </div>
              <div>
                <strong>Session:</strong> Active
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="relative h-96 rounded-lg overflow-hidden border">
          <PlaceBackground ref={containerRef}>
            {/* Your Blobbi */}
            <MovableBlobbi
              ref={blobbiRef}
              containerRef={containerRef}
              boundary={boundary}
              isVisible={true}
              initialPosition={myPosition}
              onMoveStart={setMyPosition}
              onMoveComplete={setMyPosition}
              size="lg"
              className="z-10"
            />

            {/* Multiplayer Layer - renders other players */}
            <MultiplayerLayer
              containerRef={containerRef}
              currentBlobbiD={mockBlobbi.id}
              startPosition={myPosition}
              onMyPositionChange={setMyPosition}
              islandId="demo-island"
            />

            {/* Instructions */}
            <div className="absolute bottom-4 left-4 right-4">
              <Card className="bg-black/75 text-white border-white/20">
                <CardContent className="p-3">
                  <p className="text-sm text-center">
                    🎮 Click anywhere to move • Other players will appear as they join
                  </p>
                </CardContent>
              </Card>
            </div>
          </PlaceBackground>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>• Uses <strong>Kind 31950</strong> Nostr events for real-time presence</p>
            <p>• Events expire after 35 seconds to prevent stale data</p>
            <p>• Movement destinations are validated against walkable boundaries</p>
            <p>• Position interpolation provides smooth movement animation</p>
            <p>• Blobbi visuals are fetched from Kind 31124 events</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}