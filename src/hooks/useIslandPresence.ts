/**
 * React hook for Nostr multiplayer presence on Blobbi Island
 */
import { buildPresence31950, EXP_SECONDS, explainPresenceEvent } from '@/lib/multiplayer';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Debug flag for multiplayer logging
 const DEBUG_MP =
   import.meta.env.MODE === "development" && (
     localStorage.getItem("blobbiDebug") === "1" ||
     (globalThis as any).__BLOBBI_DEBUG === true
   );
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
  ANIMATION_INTERVAL_MS,
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
  const myLastContentRef = useRef<PresenceContent | null>(null);
  const visualCacheRef = useRef<Map<string, BlobbiVisual>>(new Map());
  const fetchingVisualsRef = useRef<Set<string>>(new Set());
  const initRef = useRef(false);
  const lastLocationRef = useRef<LocationId>(location);
  const tickRef = useRef(0);

  // Memoized values
  const blobbiAddr = useMemo(() => makeBlobbiAddr(pubkey, blobbiD), [pubkey, blobbiD]);

  // ============================================================================
  // Visual Fetching
  // ============================================================================

  const fetchBlobbiVisual = useCallback(async (addr: string): Promise<BlobbiVisual | undefined> => {
    if (DEBUG_MP) console.debug('[blobbi][mp][visual] fetch', { addr, cached: visualCacheRef.current.has(addr) });

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
      if (DEBUG_MP) console.debug('[blobbi][mp][visual] fetched', { addr, ok: !!visual, visual });
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
    // hard guard contra históricos antigos
    const NOW = nowSec();
    // margem de segurança um pouco maior que EXP_SECONDS
    if (event.created_at < (NOW - (EXP_SECONDS * 2))) {
      if (DEBUG_MP) console.debug('[blobbi][mp] skip old event', {
        pk: event.pubkey, at: event.created_at, now: NOW
      });
      return;
    }
    const verdict = explainPresenceEvent(event);
    if (!verdict.ok) {
      if (DEBUG_MP) console.warn('[blobbi][mp] EVENT rejected:', verdict.reason, {
        pk: event.pubkey, at: event.created_at, tags: event.tags
      });
      return;
    }
    try {
      if (DEBUG_MP) console.debug('[blobbi][mp] EVENT raw', {
        kind: event.kind,
        pubkey: event.pubkey,
        created_at: event.created_at,
        tags: event.tags
      });

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

      if (DEBUG_MP) console.debug('[blobbi][mp] EVENT ok', {
        from: event.pubkey,
        sessionId: sessionIdFromTag,
        aTag,
        contentState: content.state,
        loc: content.location,
        anchor: content.anchor,
        goal: content.goal ? { from: content.goal.from, to: content.goal.to, v: content.goal.v, ts: content.goal.ts } : null
      });

      // Calculate initial position (will be updated by animation loop)
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
        lastContent: content, // Store full content for interpolation (required)
      };

      if (DEBUG_MP) console.debug('[blobbi][mp] players.set', {
        key: playerKey,
        pos: playerState.position,
        isMoving: playerState.isMoving,
        name: playerState.visual?.name
      });

      setPlayers(prev => {
        const updated = new Map(prev);
        const existing = prev.get(playerKey);

        if (existing && existing.lastContent?.goal && content.state === 'idle') {
          const g = existing.lastContent.goal;
          const dist = Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y);
          const endTs = g.ts + dist / g.v;
          if (nowSec() < endTs) {
            updated.set(playerKey, { ...existing, lastSeen: nowSec() });
            return updated;
          }
        }

        updated.set(playerKey, playerState);
        if (DEBUG_MP) console.debug('[blobbi][mp] players.set', {
          key: playerKey, total: updated.size, isMoving: playerState.isMoving
        });
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
      since: nowSec() - (EXP_SECONDS * 2),
    };

    if (DEBUG_MP) console.debug('[blobbi][mp][sub] start', { filter });
    subscriptionRef.current = subscribe(filter, processPresenceEvent);
  }, [islandId, location, subscribe, processPresenceEvent]);

  // ============================================================================
  // Position Updates and Interpolation
  // ============================================================================

  const updatePlayerPositions = useCallback(() => {
    const now = nowSec();
    const epsilon = 0.01; // Small epsilon for floating point comparison

    setPlayers(prev => {
      const updated = new Map();
      tickRef.current++;
      if (DEBUG_MP && (tickRef.current % 30 === 0)) {
        console.debug('[blobbi][mp][tick] update', { now, size: prev.size });
      }

      for (const [key, player] of prev) {
        // Remove expired players (40+ seconds old)
        if (now - player.lastSeen > 40) {
          if (DEBUG_MP && (tickRef.current % 10 === 0))
            console.debug('[blobbi][mp][tick] drop-expired', { key, lastSeen: player.lastSeen, now });
          continue;
        }

        const content = player.lastContent;
        let newPosition: Position;
        let isMoving: boolean;

        if (content.goal) {
          // Calculate interpolated position
          newPosition = posAt(content.goal, now);

          // Check if movement is complete using epsilon comparison
          const distanceToGoal = Math.sqrt(
            Math.pow(newPosition.x - content.goal.to.x, 2) +
            Math.pow(newPosition.y - content.goal.to.y, 2)
          );

          isMoving = distanceToGoal > epsilon;

          // If movement is complete, ensure we're at the exact destination
          if (!isMoving) {
            newPosition = { x: content.goal.to.x, y: content.goal.to.y };
          }
        } else {
          // No goal, stay at anchor position
          newPosition = { x: content.anchor.x, y: content.anchor.y };
          isMoving = false;
        }

        if (DEBUG_MP && (tickRef.current % 10 === 0)) console.debug('[blobbi][mp][tick] interp', {
          key,
          hadGoal: !!player.lastContent?.goal,
          from: player.position,
          to: player.lastContent?.goal?.to,
          newPosition,
          isMoving
        });

        // Update player state with new position and movement status
        updated.set(key, {
          ...player,
          position: newPosition,
          isMoving,
        });
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
      if (DEBUG_MP) console.debug('[blobbi][mp] moveTo', { from, destRaw, location });

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
      if (DEBUG_MP) console.debug('[blobbi][mp] moveTo published', { clampedDest });

      myLastContentRef.current = {
        state: 'moving',
        location,
        anchor: { x: from.x, y: from.y, ts: nowSec() },
        goal: {
          from: { x: from.x, y: from.y },
          to: { x: clampedDest.x, y: clampedDest.y },
          v: DEFAULT_SPEED_PX,
          ts: nowSec(),
        },
      };

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
       if (DEBUG_MP) console.debug('[blobbi][mp] login presence published', { startPos, location });
       if (!mounted) return;
       setIsLoading(false);

       // subscribe uma vez
       startSubscription();

       // timers únicos
       heartbeatIntervalRef.current = setInterval(() => {
         try {
           const last = myLastContentRef.current;
           let content: PresenceContent;
           if (last?.goal) {
             // ❸ Heartbeat mantém MOVING com mesmo goal e âncora interpolada
             const now = nowSec();
             const p = posAt(last.goal, now);
             const dist = Math.hypot(last.goal.to.x - last.goal.from.x, last.goal.to.y - last.goal.from.y);
             const endTs = last.goal.ts + dist / last.goal.v;
             if (now < endTs) {
               content = {
                 state: 'moving',
                 location,
                 anchor: { x: p.x, y: p.y, ts: now },
                 goal: last.goal,
               };
             } else {
               content = {
                 state: 'idle',
                 location,
                 anchor: { x: last.goal.to.x, y: last.goal.to.y, ts: now },
               };
               myPosRef.current = { x: last.goal.to.x, y: last.goal.to.y };
               myLastContentRef.current = content;
             }
           } else {
             content = {
               state: 'idle',
               location,
               anchor: { x: myPosRef.current.x, y: myPosRef.current.y, ts: nowSec() },
             };
           }
           const evt = buildPresence31950({ sessionId, islandId, location, blobbiAddr, content });
           publish(evt).catch(err => console.error('Failed to publish heartbeat:', err));
         } catch (err) {
           console.error('Heartbeat error:', err);
         }
       }, HEARTBEAT_INTERVAL_MS);

       gcIntervalRef.current = setInterval(updatePlayerPositions, ANIMATION_INTERVAL_MS);
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
  if (DEBUG_MP) console.debug('[blobbi][mp] location change', { prev: lastLocationRef.current, next: location });
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