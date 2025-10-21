/**
 * React hook for Nostr multiplayer presence on Blobbi Island
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// import { useQuery } from '@tanstack/react-query';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import {
  type PresenceContent,
  type PlayerRenderState,
  type BlobbiVisual,
  type WalkableApi,
  makeSessionId,
  makeBlobbiAddr,
  publishPresenceLogin,
  publishMove,
  publishHeartbeat,
  validatePresenceEvent,
  posAt,
  nowSec,
  createWalkableApi,
  parseA,
  DEFAULT_SPEED_PX,
  HEARTBEAT_INTERVAL_MS,
  GC_INTERVAL_MS,
} from '@/lib/multiplayer';

// ============================================================================
// Types
// ============================================================================

interface UseIslandPresenceOptions {
  islandId: string;
  location: LocationId;
  pubkey: string;
  blobbiD: string;
  startPos: Position;
  publish: (event: Record<string, unknown>) => Promise<void>;
  subscribe: (filter: NostrFilter, onEvent: (event: NostrEvent) => void) => { close: () => void };
  fetch31124: (pubkey: string, d: string) => Promise<BlobbiVisual>;
  nav?: WalkableApi;
}

interface UseIslandPresenceReturn {
  sessionId: string;
  players: Map<string, PlayerRenderState>;
  moveTo: (destRaw: Position) => Promise<void>;
  myPosRef: React.MutableRefObject<Position>;
  isLoading: boolean;
  error?: string;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useIslandPresence(opts: UseIslandPresenceOptions): UseIslandPresenceReturn {
  const {
    islandId, 
    location,
    pubkey,
    blobbiD,
    startPos,
    publish,
    subscribe,
    fetch31124,
  } = opts;

  const navApi = useMemo(() => opts.nav ?? createWalkableApi(location), [opts.nav, location]);
  // State
  const [sessionId] = useState(() => makeSessionId());
  const [players, setPlayers] = useState<Map<string, PlayerRenderState>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  // Refs
  const myPosRef = useRef<Position>(startPos);
  const subscriptionRef = useRef<{ close: () => void } | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const gcIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const visualCacheRef = useRef<Map<string, BlobbiVisual>>(new Map());
  const fetchingVisualsRef = useRef<Set<string>>(new Set());
  const initRef = useRef(false);
  const lastLocationRef = useRef<LocationId>(location);

  // Memoized values
  const blobbiAddr = useMemo(() => makeBlobbiAddr(pubkey, blobbiD), [pubkey, blobbiD]);

  // ============================================================================
  // Visual Fetching
  // ============================================================================

  const fetchBlobbiVisual = useCallback(async (addr: string): Promise<BlobbiVisual | undefined> => {
    if (visualCacheRef.current.has(addr)) {
      return visualCacheRef.current.get(addr);
    }

    if (fetchingVisualsRef.current.has(addr)) {
      return undefined; // Already fetching
    }

    try {
      fetchingVisualsRef.current.add(addr);
      const { pubkey: targetPubkey, blobbi_d } = parseA(addr);
      const visual = await fetch31124(targetPubkey, blobbi_d);
      visualCacheRef.current.set(addr, visual);
      return visual;
    } catch (error) {
      console.error('Failed to fetch Blobbi visual:', error);
      return undefined;
    } finally {
      fetchingVisualsRef.current.delete(addr);
    }
  }, [fetch31124]);

  // ============================================================================
  // Event Processing
  // ============================================================================

  const processPresenceEvent = useCallback(async (event: NostrEvent) => {
    try {
      if (!validatePresenceEvent(event)) {
        return;
      }

      // Skip own events
      if (event.pubkey === pubkey) {
        return;
      }

      const content: PresenceContent = JSON.parse(event.content);
      const dTag = event.tags.find(([name]: string[]) => name === 'd')?.[1];
      const aTag = event.tags.find(([name]: string[]) => name === 'a')?.[1];

      if (!dTag?.startsWith('session:') || !aTag) {
        return;
      }

      const sessionIdFromTag = dTag.replace('session:', '');
      const playerKey = `${event.pubkey}:${sessionIdFromTag}`;

      // Calculate current position
      let currentPos: Position;
      if (content.goal) {
        currentPos = posAt(content.goal, nowSec());
      } else {
        currentPos = { x: content.anchor.x, y: content.anchor.y };
      }

      // Fetch visual if not cached
      let visual = visualCacheRef.current.get(aTag);
      if (!visual && !fetchingVisualsRef.current.has(aTag)) {
        visual = await fetchBlobbiVisual(aTag);
      }

      const playerState: PlayerRenderState = {
        pubkey: event.pubkey,
        sessionId: sessionIdFromTag,
        blobbiAddr: aTag,
        position: currentPos,
        isMoving: content.state === 'moving' && !!content.goal,
        lastSeen: nowSec(),
        visual,
      };

      setPlayers(prev => {
        const updated = new Map(prev);
        updated.set(playerKey, playerState);
        return updated;
      });
    } catch (error) {
      console.error('Error processing presence event:', error);
    }
  }, [pubkey, fetchBlobbiVisual]);

  // ============================================================================
  // Subscription Management
  // ============================================================================

  const startSubscription = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.close();
    }

    const filter = {
      kinds: [31950],
      '#t': ['blobbi:presence', `island:${islandId}`, `loc:${location}`],
    };

    subscriptionRef.current = subscribe(filter, processPresenceEvent);
  }, [islandId, location, subscribe, processPresenceEvent]);

  // ============================================================================
  // Position Updates and Interpolation
  // ============================================================================

  const updatePlayerPositions = useCallback(() => {
    const now = nowSec();
    setPlayers(prev => {
      const updated = new Map();

      for (const [key, player] of prev) {
        // Remove expired players (40+ seconds old)
        if (now - player.lastSeen > 40) {
          continue;
        }

        updated.set(key, player);
      }

      return updated;
    });
  }, []);

  // ============================================================================
  // Movement Function
  // ============================================================================

  const moveTo = useCallback(async (destRaw: Position): Promise<void> => {
    try {
      const from = myPosRef.current;
      console.debug('[blobbi] moveTo() input', { from, destRaw, location });

      const clampedDest = await publishMove(
        publish,
        {
          sessionId,
          islandId,
          location,
          blobbiAddr,
        },
        from,
        destRaw,
        DEFAULT_SPEED_PX,
        navApi
      );
      console.debug('[blobbi] moveTo() publishMove returned', { clampedDest });

      if (clampedDest.x !== myPosRef.current.x || clampedDest.y !== myPosRef.current.y) {
        myPosRef.current = clampedDest;
      }
    } catch (error) {
      console.error('Failed to publish movement:', error);
      setError('Failed to publish movement');
    }
  }, [publish, sessionId, islandId, location, blobbiAddr, navApi]);

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

 // One-shot init: login, subscribe e timers (StrictMode-safe)
 useEffect(() => {
   if (initRef.current) return;
   initRef.current = true;

   let mounted = true;

   const doLoginAndStart = async () => {
     try {
       await publishPresenceLogin(publish, {
         sessionId, islandId, location, blobbiAddr, startPos,
       });
       if (!mounted) return;
       setIsLoading(false);

       // subscribe uma vez
       startSubscription();

       // timers únicos
       heartbeatIntervalRef.current = setInterval(() => {
         publishHeartbeat(publish, { sessionId, islandId, location, blobbiAddr }, myPosRef.current)
           .catch(err => console.error('Failed to publish heartbeat:', err));
       }, HEARTBEAT_INTERVAL_MS);

       gcIntervalRef.current = setInterval(updatePlayerPositions, GC_INTERVAL_MS);
     } catch (err) {
       console.error('Failed to init presence:', err);
       if (mounted) { setError('Failed to init presence'); setIsLoading(false); }
     }
   };

   doLoginAndStart();

   return () => {
     mounted = false;
     if (subscriptionRef.current) subscriptionRef.current.close();
     if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
     if (gcIntervalRef.current) clearInterval(gcIntervalRef.current);
   };
  //  eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

  // Update myPosRef when startPos changes
  useEffect(() => {
    myPosRef.current = startPos;
  }, [startPos]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.close();
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (gcIntervalRef.current) {
        clearInterval(gcIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
  if (!initRef.current) return;
  if (lastLocationRef.current === location) return;
  lastLocationRef.current = location;

  publishPresenceLogin(publish, {
    sessionId, islandId, location, blobbiAddr, startPos: myPosRef.current,
  }).catch(err => console.error('Failed to publish presence on location change:', err));

  if (subscriptionRef.current) subscriptionRef.current.close();
  startSubscription();

  if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
  heartbeatIntervalRef.current = setInterval(() => {
    publishHeartbeat(
      publish,
      { sessionId, islandId, location, blobbiAddr },
      myPosRef.current
    ).catch(err => console.error('Failed to publish heartbeat:', err));
  }, HEARTBEAT_INTERVAL_MS);
}, [location, publish, sessionId, islandId, blobbiAddr, startSubscription]);

  return {
    sessionId,
    players,
    moveTo,
    myPosRef,
    isLoading,
    error,
  };
}