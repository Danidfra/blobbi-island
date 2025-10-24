/**
 * Multiplayer Layer Component for Blobbi Island
 * Handles click-to-move and renders other players
 */

import React, { useRef, useCallback, useEffect, useMemo } from 'react';

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
import { nameFromDTag } from '@/lib/blobbi-name';
import { calculateBlobbiZIndex } from '@/lib/interactive-elements-config';
import { locationScalingConfig } from '@/lib/location-scaling-config';
import { createWalkableApi } from '@/lib/multiplayer';
import { locationBoundaries } from '@/lib/location-boundaries';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';

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
  const { isPositionBlocked } = useMovementBlocker();

  const clickHandledRef = useRef(false);

  // Create navigation API for walkable area checking
  const navApi = useMemo(() => {
    return createWalkableApi(currentLocation);
  }, [currentLocation]);

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
    const dTag = get('d');
    const name = nameFromDTag(dTag) || get('name') || 'Unnamed Blobbi';
    const baseColor      = get('base_color')      || get('baseColor');
    const secondaryColor = get('secondary_color') || get('secondaryColor');
    const pattern        = get('pattern');
    const eyeColor       = get('eye_color')       || get('eyeColor');
    const specialMark    = get('special_mark')    || get('specialMark');
    const stageRaw       = get('stage') || get('blobbi_stage');
    const stage = stageRaw === 'egg' || stageRaw === 'child' || stageRaw === 'adult'
      ? stageRaw
      : undefined;
    const adultType      = get('adult_type') || get('adultType') || get('blobbi_adult_type');

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
      stage,
      adultType,
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
    pixelToPercent,
    nav: navApi
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
    let targetPos = getPercentPosition({ x: clickX, y: clickY });

    const clamped = navApi.clampToBounds(targetPos.x, targetPos.y);
    targetPos = { x: clamped.x, y: clamped.y };

    if (isPositionBlocked(targetPos.x, targetPos.y)) {
      if (DEBUG_MP) console.debug('[blobbi][mp][ui] blocked click', { targetPos });
      return;
    }

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

  const visiblePlayers = React.useMemo(
    () => Array.from(players.values()).filter(p => p.lastContent?.location === currentLocation),
    [players, currentLocation]
  );

  // track last positions to infer heading (prevents weird flips on vertical moves)
  const lastPosRef = React.useRef(new Map<string, Position>());

  // Get background file for current location
  const backgroundFile = useMemo(() => {
    const locationToFile: Record<string, string> = {
      'town': 'town-open.png',
      'home': 'home-inside.png',
      'beach': 'beach-open.png',
      'mine': 'mine-open.png',
      'nostr-station': 'nostr-station-open.png',
      'nostr-station-inside': 'nostr-station-inside.png',
      'plaza': 'plaza-open.png',
      'plaza-inside': 'plaza-inside.png',
      'arcade': 'arcade-inside.png',
      'arcade-1': 'arcade-1.png',
      'arcade-minus1': 'arcade-minus1.png',
      'stage': 'stage-inside.png',
      'shop': 'shopping-mall-inside.png',
      'back-yard': 'back-yard-open.png',
      'cave-open': 'cave-inside.png',
      'clothing-store-inside': 'clothing-store-inside.png',
    };
    return locationToFile[currentLocation] || 'town-open.png';
  }, [currentLocation]);

  // Get boundary for current location
  const boundary = useMemo(() => {
    return locationBoundaries[backgroundFile];
  }, [backgroundFile]);

  // Helper functions for dynamic z-index and scaling (same as MovableBlobbi)
  const getDynamicZIndex = useCallback((currentPos: Position, sitOffset = 0): number => {
    if (!backgroundFile) return 20;
    return calculateBlobbiZIndex(currentPos.y, backgroundFile) + sitOffset;
  }, [backgroundFile]);

  const getDynamicScale = useCallback((currentPos: Position): number => {
    const scalingConfig = backgroundFile ? locationScalingConfig[backgroundFile] : undefined;

    if (!scalingConfig) {
      return 1;
    }

    const { initialScale, finalScale } = scalingConfig;

    // Get the Y boundaries for scaling calculation based on boundary shape
    let minY: number, maxY: number;

    if (boundary?.shape === 'rectangle') {
      minY = boundary.y[0]; // Top of allowed movement area
      maxY = boundary.y[1]; // Bottom of allowed movement area
    } else if (boundary?.shape === 'semicircle' || boundary?.shape === 'arch') {
      minY = boundary.top;
      maxY = boundary.bottom;
    } else if (boundary?.shape === 'composite') {
      // For composite boundaries, find the overall min/max Y values
      minY = Math.min(...boundary.areas.map(area => {
        if (area.type === 'rectangle') return area.y[0];
        if (area.type === 'circle') return area.cy - area.r;
        if (area.type === 'triangle') return Math.min(...area.points.map(p => p.y));
        return 100;
      }));
      maxY = Math.max(...boundary.areas.map(area => {
        if (area.type === 'rectangle') return area.y[1];
        if (area.type === 'circle') return area.cy + area.r;
        if (area.type === 'triangle') return Math.max(...area.points.map(p => p.y));
        return 0;
      }));
    } else {
      // Fallback to full screen height
      minY = 0;
      maxY = 100;
    }

    // Clamp the position within the boundary
    const clampedY = Math.max(minY, Math.min(maxY, currentPos.y));

    // Calculate the interpolation factor (0 = top, 1 = bottom)
    const factor = (maxY - minY) > 0 ? (clampedY - minY) / (maxY - minY) : 0;

    // Interpolate between finalScale (top) and initialScale (bottom)
    return finalScale + (initialScale - finalScale) * factor;
  }, [backgroundFile, boundary]);

  // ============================================================================
  // Render
  // ============================================================================

  if (!user || disabled) return null

  if (error) { console.error('Multiplayer error:', error); return null;  }

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      {/* Render other players */}
      {visiblePlayers.map((player, idx) => {
        if (DEBUG_MP && (idx % 8 === 0)) {
          console.debug('[blobbi][mp][render] remote', {
            key: `${player.pubkey}:${player.sessionId}`,
            hasVisual: !!player.visual,
            name: player.visual?.name,
            animPos: player.position,
            isMoving: player.isMoving
          });
        }

        // Calculate dynamic z-index and scale (same as MovableBlobbi)
        const dynamicZIndex = getDynamicZIndex(player.position);
        const dynamicScale = getDynamicScale(player.position);

        // Determine if character should be flipped based on movement direction
        const keyId = `${player.pubkey}:${player.sessionId}`;
        const last = lastPosRef.current.get(keyId) ?? player.position;
        const dx = player.position.x - last.x;
        const shouldFlip = Math.abs(dx) > 0.1 ? dx < 0 : false;
        lastPosRef.current.set(keyId, player.position);

        return (
          <div
            key={`${player.pubkey}:${player.sessionId}`}
            className="absolute pointer-events-auto group"
            style={{
              left: `${player.position.x}%`,
              top: `${player.position.y}%`,
              transform: `translate(-50%, -50%)`,  // ⬅️ no scale/flip here
              zIndex: dynamicZIndex,
              filter: 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.15))',
            }}
          >
            {/* SPRITE – hover target (peer) */}
            <div
              className="peer pointer-events-auto select-none"
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                transform: `scale(${dynamicScale}) ${shouldFlip ? 'scaleX(-1)' : ''}`,
                transformOrigin: 'center center',
              }}
            >
          <div className={cn(
            !player.isMoving && "animate-float",
            "transition-transform duration-1000 ease-in-out"
          )}>
            <CurrentBlobbiDisplay
              size="lg"
              visualOverride={player.visual || {
                baseColor: '#4F46E5',
                secondaryColor: '#7C3AED',
                eyeColor: '#1F2937',
                stage: 'child',
              }}
              transparent
              showAccessories={false}
              className={cn(player.isMoving && "scale-105")}
              idSuffix={`${player.pubkey}-${player.sessionId}`}
            />
          </div>
        </div>

          {/* Drop shadow/ellipse below Blobbi (same as MovableBlobbi) */}
          <div
            className={cn(
              "absolute top-full left-1/2 h-1.5 rounded-full",
              "w-6 md:w-8" // lg size equivalent
            )}
            style={{
              background: "radial-gradient(ellipse, rgba(0, 0, 0, 0.2) 0%, transparent 70%)",
              transform: `translateX(-50%) translateY(-8px) scale(${dynamicScale})`,
              transformOrigin: 'center center',
            }}
          />

          {/* Player name label (hidden until hover) */}
          {player.visual?.name && (
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 pointer-events-none">
              <div
                className="bg-black/75 text-white text-xs px-2 py-1 rounded-full whitespace-nowrap
                           opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                aria-label={player.visual.name}
                title={player.visual.name}
              >
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
          <div>Players (all): {players.size}</div>
          <div>Players (visible): {visiblePlayers.length}</div>
          <div>Loading: {isLoading ? 'Yes' : 'No'}</div>
          <div>My Pos: {Math.round(myPosRef.current.x)}, {Math.round(myPosRef.current.y)}</div>
        </div>
      )}
    </div>
  );
}