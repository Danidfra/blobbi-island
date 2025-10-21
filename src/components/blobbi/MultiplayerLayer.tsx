/**
 * Multiplayer Layer Component for Blobbi Island
 * Handles click-to-move and renders other players
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { useNostr } from '@nostrify/react';
// import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useIslandPresence } from '@/hooks/useIslandPresence';
import { useLocation } from '@/hooks/useLocation';
// import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import type { BlobbiVisual } from '@/lib/multiplayer';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { SimpleBlobbiDisplay } from './SimpleBlobbiDisplay';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface MultiplayerLayerProps {
  containerRef: React.RefObject<HTMLElement>;
  currentBlobbiD: string;
  startPosition: Position;
  islandId?: string;
  className?: string;
  onMyPositionChange?: (position: Position) => void;
  disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function MultiplayerLayer({
  containerRef,
  currentBlobbiD,
  startPosition,
  islandId = '1',
  className,
  onMyPositionChange,
  disabled = false,
}: MultiplayerLayerProps) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { currentLocation } = useLocation();

  const clickHandledRef = useRef(false);

  // ============================================================================
  // Blobbi Visual Fetching
  // ============================================================================

  const fetchBlobbi31124 = useCallback(async (pubkey: string, d: string): Promise<BlobbiVisual> => {
    const signal = AbortSignal.timeout(5000);
    const events = await nostr.query([{
      kinds: [31124],
      authors: [pubkey],
      '#d': [d],
      limit: 1,
    }], { signal });

    if (events.length === 0) {
      throw new Error('Blobbi not found');
    }

    // Validate event
    const event = events[0];
    if (event.pubkey !== pubkey || !event.tags.find(([name, value]) => name === 'd' && value === d)) {
      throw new Error('Invalid Blobbi event');
    }

    // Parse visual data (simplified)
    const name = event.content || 'Unnamed Blobbi';
    const baseColor = event.tags.find(([name]) => name === 'base_color')?.[1];
    const secondaryColor = event.tags.find(([name]) => name === 'secondary_color')?.[1];
    const pattern = event.tags.find(([name]) => name === 'pattern')?.[1];
    const eyeColor = event.tags.find(([name]) => name === 'eye_color')?.[1];
    const specialMark = event.tags.find(([name]) => name === 'special_mark')?.[1];

    return {
      name,
      baseColor,
      secondaryColor,
      pattern,
      eyeColor,
      specialMark,
    };
  }, [nostr]);

  // ============================================================================
  // Subscription Management
  // ============================================================================

  const subscribe = useCallback((filter: NostrFilter, onEvent: (event: NostrEvent) => void) => {
    const abortController = new AbortController();

    // Query for existing events
    nostr.query([filter], { signal: abortController.signal })
      .then(events => {
        events.forEach(onEvent);
      })
      .catch(error => {
        console.error('Failed to query events:', error);
      });

    // Set up real-time subscription with polling
    const intervalId = setInterval(async () => {
      try {
        const recentEvents = await nostr.query([{
          ...filter,
          since: Math.floor(Date.now() / 1000) - 60, // Last minute
        }], { signal: abortController.signal });

        recentEvents.forEach(onEvent);
      } catch {
        // Ignore errors in polling
      }
    }, 5000); // Poll every 5 seconds

    return {
      close: () => {
        abortController.abort();
        clearInterval(intervalId);
      }
    };
  }, [nostr]);

  // ============================================================================
  // Multiplayer Hook
  // ============================================================================

  const {
    sessionId,
    players,
    moveTo,
    myPosRef,
    isLoading,
    error,
  } = useIslandPresence({
    islandId,
    location: currentLocation,
    pubkey: user?.pubkey || '',
    blobbiD: currentBlobbiD,
    startPos: startPosition,
    publish: async (event: Record<string, unknown>) => {
      await publishEvent(event);
    },
    subscribe,
    fetch31124: fetchBlobbi31124,
  });

  // ============================================================================
  // Click Handling
  // ============================================================================

  const getPercentPosition = useCallback((pixelPos: Position): Position => {
    if (!containerRef.current) return { x: 50, y: 75 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (pixelPos.x / rect.width) * 100,
      y: (pixelPos.y / rect.height) * 100,
    };
  }, [containerRef]);

  const handleContainerClick = useCallback(async (event: MouseEvent | TouchEvent | PointerEvent) => {
    if (disabled || !user || clickHandledRef.current) {
      return;
    }

    console.debug('[blobbi] CLICK start');

    // Prevent handling the same click multiple times
    clickHandledRef.current = true;
    setTimeout(() => {
      clickHandledRef.current = false;
    }, 100);

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    let clientX: number, clientY: number;

    if (event instanceof MouseEvent || (window.PointerEvent && event instanceof PointerEvent)) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else {
      const touch = event.touches[0] || event.changedTouches[0];
      clientX = touch.clientX;
      clientY = touch.clientY;
    }

    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;
    const targetPos = getPercentPosition({ x: clickX, y: clickY });

    console.debug('[blobbi] CLICK coords', { clientX, clientY, clickX, clickY, targetPos });

    try {
      await moveTo(targetPos);
      console.debug('[blobbi] CLICK moveTo done, myPosRef=', myPosRef.current);
      onMyPositionChange?.(myPosRef.current);
    } catch (error) {
      console.error('Failed to move:', error);
    }
  }, [disabled, user, containerRef, getPercentPosition, moveTo, onMyPositionChange, myPosRef]);

  // ============================================================================
  // Event Listeners
  // ============================================================================

  useEffect(() => {
    const container = containerRef.current;
    if (!container || disabled || !user) return;

    const onPointerDown = (e: PointerEvent) => {
      handleContainerClick(e);
    };
    container.addEventListener('pointerdown', onPointerDown, { capture: true });

    return () => {
      container.removeEventListener('pointerdown', onPointerDown, { capture: true } as any);
    };
  }, [containerRef, disabled, user, handleContainerClick]);

  // ============================================================================
  // Render
  // ============================================================================

  if (!user || disabled) {
    return null;
  }

  if (error) {
    console.error('Multiplayer error:', error);
    return null;
  }

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      {/* Render other players */}
      {Array.from(players.values()).map((player) => (
        <div
          key={`${player.pubkey}:${player.sessionId}`}
          className="absolute pointer-events-none"
          style={{
            left: `${player.position.x}%`,
            top: `${player.position.y}%`,
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
          }}
        >
          <SimpleBlobbiDisplay
            size="lg"
            visual={player.visual}
            isMoving={player.isMoving}
            className={cn(
              "transition-all duration-200 ease-out",
              player.isMoving && "transition-none"
            )}
          />

          {/* Player name label */}
          {player.visual?.name && (
            <div className="absolute -top-8 left-1/2 transform -translate-x-1/2">
              <div className="bg-black/75 text-white text-xs px-2 py-1 rounded-full whitespace-nowrap">
                {player.visual.name}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Debug info (only in development) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute top-4 right-4 bg-black/75 text-white text-xs p-2 rounded">
          <div>Session: {sessionId.slice(0, 8)}...</div>
          <div>Players: {players.size}</div>
          <div>Loading: {isLoading ? 'Yes' : 'No'}</div>
          <div>My Pos: {Math.round(myPosRef.current.x)}, {Math.round(myPosRef.current.y)}</div>
        </div>
      )}
    </div>
  );
}