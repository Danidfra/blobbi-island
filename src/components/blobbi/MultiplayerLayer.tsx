/**
 * Multiplayer Layer Component for Blobbi Island
 * Handles click-to-move and renders other players
 */

import React, { useRef, useCallback, useEffect } from 'react';

// Debug flag for multiplayer logging
 const DEBUG_MP =
   import.meta.env.MODE === "development" && (
     localStorage.getItem("blobbiDebug") === "1" ||
     (globalThis as Record<string, unknown>).__BLOBBI_DEBUG === true
   );
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
import { CurrentBlobbiDisplay } from './CurrentBlobbiDisplay';
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
    const get = (n: string) => event.tags.find(([name]) => name === n)?.[1];
    const name = event.content || 'Unnamed Blobbi';
    const baseColor      = get('base_color')      || get('baseColor');
    const secondaryColor = get('secondary_color') || get('secondaryColor');
    const pattern        = get('pattern');
    const eyeColor       = get('eye_color')       || get('eyeColor');
    const specialMark    = get('special_mark')    || get('specialMark');

    if (!baseColor && !secondaryColor && !eyeColor) {
      console.warn('[blobbi][mp][visual] 31124 sem cores', { pubkey, d, tags: event.tags });
    }

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
    let closed = false;
    let subscription: AsyncIterableIterator<unknown> | { intervalId: NodeJS.Timeout; abortController: AbortController } | null = null;

    const processSubscription = async () => {
      if (closed) return;

      try {
        // Use streaming subscription via nostr.req
        if (DEBUG_MP) console.debug('[blobbi][mp][sub] streaming start', { filter });
        subscription = nostr.req([filter]) as AsyncIterableIterator<unknown>;

        for await (const msg of subscription) {
          if (closed) break;

          if (!Array.isArray(msg)) continue;

          const [type, , event] = msg;

          if (type === 'EVENT' && event && typeof event === 'object') {
            // Process the event
            onEvent(event as NostrEvent);
          } else if (type === 'EOSE') {
            // End of stored events, but subscription remains open for new events
            console.debug('[Multiplayer] EOSE received, waiting for new events');
          } else if (type === 'CLOSED') {
            // Subscription was closed
            break;
          }
        }
      } catch (error) {
        if (!closed && error.name !== 'AbortError') {
          if (DEBUG_MP) console.warn('[blobbi][mp][sub] streaming failed, fallback to polling', { reason: String(error) });

          // Fallback to low-latency polling if streaming fails
          let since: number | undefined = Math.floor(Date.now() / 1000) - 1;
          let intervalId: NodeJS.Timeout | null = null;
          const abortController = new AbortController();

          const pollEvents = async () => {
            if (closed) return;

            try {
              const events = await nostr.query([{
                ...filter,
                since,
              }], { signal: abortController.signal });

              if (closed) return;

              // Process only new events
              events
                .filter(event => event.created_at > (since || 0))
                .sort((a, b) => a.created_at - b.created_at)
                .forEach(onEvent);

              // Update since to the latest event timestamp
              if (events.length > 0) {
                since = Math.max(...events.map(e => e.created_at));
              }

              if (DEBUG_MP) console.debug('[blobbi][mp][sub] polling batch', { count: events.length, since });
            } catch (pollError) {
              if (!closed && pollError.name !== 'AbortError') {
                console.error('Polling error:', pollError);
              }
            }
          };

          // Initial poll
          await pollEvents();

          // Set up polling interval
          intervalId = setInterval(pollEvents, 150);

          // Store interval ID for cleanup
          subscription = { intervalId, abortController };
        }
      }
    };

    // Start processing subscription
    processSubscription().catch(error => {
      if (!closed) {
        console.error('Subscription processing error:', error);
      }
    });

    return {
      close: () => {
        closed = true;

        // Close streaming subscription if active
        if (subscription && typeof subscription === 'object' && 'return' in subscription && typeof subscription.return === 'function') {
          subscription.return();
        }

        // Close fallback polling if active
        if (subscription && 'intervalId' in subscription && typeof subscription.intervalId === 'number') {
          clearInterval(subscription.intervalId);
          if ('abortController' in subscription && subscription.abortController) {
            subscription.abortController.abort();
          }
        }
      }
    };
  }, [nostr]);

  // ============================================================================
  // Multiplayer Hook
  // ============================================================================

  const percentToPixel = useCallback((p: Position) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (p.x / 100) * rect.width, y: (p.y / 100) * rect.height };
  }, [containerRef]);

  const pixelToPercent = useCallback((p: {x:number; y:number}) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 75 };
    return { x: (p.x / rect.width) * 100, y: (p.y / rect.height) * 100 };
  }, [containerRef]);

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
    percentToPixel,
    pixelToPercent
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

    if (DEBUG_MP) console.debug('[blobbi][mp][ui] click', { targetPos, rect: { w: rect.width, h: rect.height } });

    try {
      await moveTo(targetPos);
      if (DEBUG_MP) console.debug('[blobbi][mp][ui] moved', { myPos: myPosRef.current });
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
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
    };
  }, [containerRef, disabled, user, handleContainerClick]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[blobbi][mp][render] players size', players.size);
    }
  }, [players.size]);

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
      {Array.from(players.values()).map((player, idx) => {
        if (DEBUG_MP && (idx % 8 === 0)) {
          console.debug('[blobbi][mp][render] remote', {
            key: `${player.pubkey}:${player.sessionId}`,
            hasVisual: !!player.visual,
            name: player.visual?.name,
            animPos: player.position,
            isMoving: player.isMoving
          });
        }
        return (
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
          <CurrentBlobbiDisplay
            size="lg"
            visualOverride={player.visual || {
              baseColor: '#4F46E5',
              secondaryColor: '#7C3AED',
              eyeColor: '#1F2937',
              stage: 'child',
            }}
            transparent={true}
            showAccessories={false}
            className="z-9"
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
        );
      })}

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