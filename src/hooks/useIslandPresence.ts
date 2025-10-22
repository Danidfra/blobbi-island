/**
 * React hook for Nostr multiplayer presence on Blobbi Island
 */
import { posAt } from '@/lib/multiplayer';
import { type PlayerAnimState } from '@/lib/multiplayer';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Debug flag for multiplayer logging
const DEBUG_MP = true;

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
  nowSec,
  createWalkableApi,
  parseA,
  DEFAULT_SPEED_PX,
  HEARTBEAT_INTERVAL_MS,
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
  percentToPixel: (p: Position) => { x:number; y:number };
  pixelToPercent: (p: {x:number; y:number}) => Position;
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
  const animationFrameRef = useRef<number | null>(null);
  const visualCacheRef = useRef<Map<string, BlobbiVisual>>(new Map());
  const fetchingVisualsRef = useRef<Set<string>>(new Set());
  const initRef = useRef(false);
  const lastLocationRef = useRef<LocationId>(location);
  const playersAnimRef = useRef<Map<string, PlayerAnimState>>(new Map());
  const lastUpdateTimeRef = useRef<number>(performance.now());

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
  // Animation Loop (like MovableBlobbi)
  // ============================================================================

const animatePlayers = useCallback(() => {
  const now = performance.now();
  const dt = (now - lastUpdateTimeRef.current) / 1000;
  lastUpdateTimeRef.current = now;

  let needsUpdate = false;
  const updated = new Map(playersAnimRef.current);

  for (const [key, anim] of playersAnimRef.current) {
    const player = players.get(key);
    if (!player) continue;

    const posPx    = opts.percentToPixel(anim.pos);
    const targetPx = opts.percentToPixel(anim.target);

    const dx = targetPx.x - posPx.x;
    const dy = targetPx.y - posPx.y;
    const distPx = Math.hypot(dx, dy);

    let newPosPx = { ...posPx };
    let moving = false;

    if (distPx > 2) {
      const step = anim.speedPx * dt;         // px/sec * sec = px
      const ux = dx / distPx, uy = dy / distPx;
      newPosPx.x += ux * step;
      newPosPx.y += uy * step;
      moving = true;
    } else {
      newPosPx = targetPx;
    }

    const newPosPctRaw = opts.pixelToPercent(newPosPx);
    const clamped = navApi.clampToBounds(newPosPctRaw.x, newPosPctRaw.y);

    const newAnim = { ...anim, pos: clamped, moving, lastUpdate: now };
    updated.set(key, newAnim);

    if (
      Math.abs(clamped.x - player.position.x) > 0.1 ||
      Math.abs(clamped.y - player.position.y) > 0.1 ||
      moving !== player.isMoving
    ) {
      needsUpdate = true;
    }
  }

  playersAnimRef.current = updated;

  if (needsUpdate) {
    setPlayers(prev => {
      const next = new Map(prev);
      for (const [key, anim] of updated) {
        const p = prev.get(key);
        if (p) next.set(key, { ...p, position: anim.pos, isMoving: anim.moving });
      }
      return next;
    });
  }

  animationFrameRef.current = requestAnimationFrame(animatePlayers);
}, [players, opts.percentToPixel, opts.pixelToPercent, navApi]);

  // Start animation loop
  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(animatePlayers);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [animatePlayers]);

  // ============================================================================
  // Event Processing
  // ============================================================================

  const processPresenceEvent = useCallback(async (event: NostrEvent) => {
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
      const locTag = event.tags.find(([n, v]: string[]) => n === 't' && v?.startsWith('loc:'))?.[1];
      const tagLocation = (locTag?.split(':')[1] ?? content.location) as LocationId;

      if (tagLocation !== location || content.location !== location) {
        const dTag = event.tags.find(([n]: string[]) => n === 'd')?.[1];
        const sessionIdFromTag = dTag?.replace('session:', '');
        if (sessionIdFromTag) {
          const playerKey = `${event.pubkey}:${sessionIdFromTag}`;

          if (playersAnimRef.current.has(playerKey) || players.has(playerKey)) {
            if (DEBUG_MP) console.debug('[blobbi][mp] remove player (location mismatch)', {
              key: playerKey, eventLoc: content.location, tagLoc: tagLocation, currentLoc: location
            });

            const updatedAnim = new Map(playersAnimRef.current);
            updatedAnim.delete(playerKey);
            playersAnimRef.current = updatedAnim;

            setPlayers(prev => {
              const next = new Map(prev);
              next.delete(playerKey);
              return next;
            });
          }
        }
        return;
      }

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

      // Fetch visual if not cached
      let visual = visualCacheRef.current.get(aTag);
      if (!visual && !fetchingVisualsRef.current.has(aTag)) {
        visual = await fetchBlobbiVisual(aTag);
      }

      // Determine target position
      const rawTarget = content.goal ? content.goal.to : { x: content.anchor.x, y: content.anchor.y };
      const targetPos = navApi.clampToBounds(rawTarget.x, rawTarget.y);

      // Posição "agora" baseada no goal do emissor (interpolação), com clamp local
      let posNow = content.goal
        ? posAt(
            {
              from: content.goal.from,
              to: content.goal.to,
              v: content.goal.v,
              ts: content.goal.ts,
            },
            nowSec()
          )
        : { x: content.anchor.x, y: content.anchor.y };
      posNow = navApi.clampToBounds(posNow.x, posNow.y);

     const speed = content.goal?.v ?? DEFAULT_SPEED_PX;
     const existingAnimState = playersAnimRef.current.get(playerKey);
     const animState: PlayerAnimState = {
       pos: existingAnimState?.pos ?? posNow,
       target: targetPos,
       speedPx: speed,
       lastUpdate: performance.now(),
       moving: content.state === 'moving' && !!content.goal,
     };

      // Update animation state
      const newAnimStates = new Map(playersAnimRef.current);
      newAnimStates.set(playerKey, animState);
      playersAnimRef.current = newAnimStates;

      if (DEBUG_MP) console.debug('[blobbi][mp] remote:set-target', {
        key: playerKey,
        fromNow: posNow,
        target: targetPos,
        v: speed,
        moving: animState.moving
      });

      // Create player state
      const playerState: PlayerRenderState = {
        pubkey: event.pubkey,
        sessionId: sessionIdFromTag,
        blobbiAddr: aTag,
        position: animState.pos,
        isMoving: animState.moving,
        lastSeen: nowSec(),
        visual,
        lastContent: content,
        animState,
      };

      if (DEBUG_MP) console.debug('[blobbi][mp] players.set', {
        key: playerKey,
        pos: playerState.position,
        isMoving: playerState.isMoving,
        name: playerState.visual?.name
      });

      setPlayers(prev => {
        const updated = new Map(prev);
        updated.set(playerKey, playerState);
        return updated;
      });
    } catch (error) {
      console.error('Error processing presence event:', error);
    }
  }, [pubkey, fetchBlobbiVisual, players, navApi]);

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

    if (DEBUG_MP) console.debug('[blobbi][mp][sub] start', { filter });
    subscriptionRef.current = subscribe(filter, processPresenceEvent);
  }, [islandId, location, subscribe, processPresenceEvent]);

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
          if (DEBUG_MP) console.debug('[blobbi][mp] heartbeat', { pos: myPosRef.current, location });
          publishHeartbeat(publish, { sessionId, islandId, location, blobbiAddr }, myPosRef.current)
            .catch(err => console.error('Failed to publish heartbeat:', err));
        }, HEARTBEAT_INTERVAL_MS);
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
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
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
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
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