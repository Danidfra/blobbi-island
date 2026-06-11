/**
 * React hook for Nostr multiplayer presence on Blobbi Island
 */
import { posAt } from '@/lib/multiplayer';
import { type PlayerAnimState } from '@/lib/multiplayer';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';

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
  EXP_SECONDS,
} from '@/lib/multiplayer';
import { getBlobbiInitialPosition } from '@/lib/location-initial-position';

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
  /**
   * Optional shared map (player key -> current percent position) written every
   * animation frame from the rAF loop, BEFORE the throttled `setPlayers`. This
   * is the truly-live position source for gaze tracking: consumers (local or
   * remote watchers) can read a target's current position at ~60fps without
   * depending on a React re-render. Keyed identically to `players`
   * (`${pubkey}:${sessionId}`).
   */
  livePositionsRef?: React.MutableRefObject<Map<string, Position>>;
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
  const gcIntervalRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const visualCacheRef = useRef<Map<string, BlobbiVisual>>(new Map());
  const fetchingVisualsRef = useRef<Set<string>>(new Set());
  const initRef = useRef(false);
  const lastLocationRef = useRef<LocationId>(location);
  const playersAnimRef = useRef<Map<string, PlayerAnimState>>(new Map());
  const lastUpdateTimeRef = useRef<number>(performance.now());
  const latestSessionByPubkeyRef = useRef<Map<string, {sessionId:string; seen:number}>>(new Map());
  const { isPositionBlocked } = useMovementBlocker();

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

    // Check if the new position is walkable before clamping
    if (navApi.isWalkable(newPosPctRaw.x, newPosPctRaw.y) && !isPositionBlocked(newPosPctRaw.x, newPosPctRaw.y)) {
      // Position is walkable, use it as-is
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
    } else {
      // Position is not walkable, find the closest walkable point
      // Similar to MovableBlobbi's logic
      const currentPosPct = opts.pixelToPercent(posPx);

      // Calculate direction from current to target
      const dirX = newPosPctRaw.x - currentPosPct.x;
      const dirY = newPosPctRaw.y - currentPosPct.y;
      const dirDist = Math.sqrt(dirX * dirX + dirY * dirY);

      if (dirDist > 0) {
        // Step along the direction until we find a walkable point
        const stepX = dirX / dirDist;
        const stepY = dirY / dirDist;

        let foundWalkable = false;
        let lastWalkable = currentPosPct;

        // Check in small increments along the path
        const maxSteps = Math.ceil(dirDist * 2); // More granular checking
        for (let i = 1; i <= maxSteps; i++) {
          const checkX = currentPosPct.x + stepX * (i / 2);
          const checkY = currentPosPct.y + stepY * (i / 2);

          if (navApi.isWalkable(checkX, checkY) && !isPositionBlocked(checkX, checkY)) {
            lastWalkable = { x: checkX, y: checkY };
            foundWalkable = true;
          } else {
            // Found a non-walkable point, use the last walkable position
            break;
          }
        }

        const finalPos = navApi.clampToBounds(lastWalkable.x, lastWalkable.y);
        const newAnim = { ...anim, pos: finalPos, moving: foundWalkable, lastUpdate: now };
        updated.set(key, newAnim);

        if (
          Math.abs(finalPos.x - player.position.x) > 0.1 ||
          Math.abs(finalPos.y - player.position.y) > 0.1 ||
          foundWalkable !== player.isMoving
        ) {
          needsUpdate = true;
        }
      } else {
        // No meaningful movement direction, stay at current position
        const newAnim = { ...anim, pos: currentPosPct, moving: false, lastUpdate: now };
        updated.set(key, newAnim);
      }
    }
  }

  playersAnimRef.current = updated;

  // Mirror every animated position into the shared live-positions ref EACH
  // FRAME (~60fps), before the throttled setPlayers below. This is the live
  // gaze source: watchers read a target's current position here without waiting
  // for a React re-render, so eyes track moving targets smoothly. No re-render
  // is triggered by this write.
  const livePositions = opts.livePositionsRef?.current;
  if (livePositions) {
    for (const [key, anim] of updated) {
      livePositions.set(key, anim.pos);
    }
  }

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
}, [players, opts.percentToPixel, opts.pixelToPercent, opts.livePositionsRef, navApi, isPositionBlocked]);

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
      const isBrandNewForThisLocation =
        !playersAnimRef.current.has(playerKey) && !players.has(playerKey);
      const prev = latestSessionByPubkeyRef.current.get(event.pubkey);

      if (!prev || prev.sessionId !== sessionIdFromTag) {
        // mark this as latest
        latestSessionByPubkeyRef.current.set(event.pubkey, { sessionId: sessionIdFromTag, seen: nowSec() });
        // remove other sessions of the same pubkey
        setPlayers(prevMap => {
          const next = new Map(prevMap);
          for (const key of prevMap.keys()) {
            if (key.startsWith(`${event.pubkey}:`) && key !== playerKey) {
              next.delete(key);
            }
          }
          return next;
        });
        // also clean anim map
        const newAnimMap = new Map(playersAnimRef.current);
        for (const key of newAnimMap.keys()) {
          if (key.startsWith(`${event.pubkey}:`) && key !== playerKey) {
            newAnimMap.delete(key);
          }
        }
        playersAnimRef.current = newAnimMap;
      } else {
        // update last seen for the same latest session
        prev.seen = nowSec();
        latestSessionByPubkeyRef.current.set(event.pubkey, prev);
      }

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

      // Determine target position with walkable validation
      const rawTarget = content.goal ? content.goal.to : { x: content.anchor.x, y: content.anchor.y };

      // Check if target is walkable, if not find closest walkable point
      let targetPos = rawTarget;
      if (!navApi.isWalkable(rawTarget.x, rawTarget.y) || isPositionBlocked(rawTarget.x, rawTarget.y)) {
        // Find closest walkable point along the path
        const origin = content.goal ? content.goal.from : content.anchor;
        const dx = rawTarget.x - origin.x;
        const dy = rawTarget.y - origin.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
          const stepX = dx / distance;
          const stepY = dy / distance;

          // Step along the direction until we find a walkable point
          let currentX = origin.x;
          let currentY = origin.y;
          let lastWalkable = { x: origin.x, y: origin.y };

          const maxSteps = Math.ceil(distance);
          for (let i = 1; i <= maxSteps; i++) {
            currentX = origin.x + stepX * i;
            currentY = origin.y + stepY * i;

            if (navApi.isWalkable(currentX, currentY) && !isPositionBlocked(currentX, currentY)) {
              lastWalkable = { x: currentX, y: currentY };
            } else {
              break;
            }
          }

          targetPos = lastWalkable;
        }
      }

      // Final clamp to bounds
      targetPos = navApi.clampToBounds(targetPos.x, targetPos.y);

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

      const spawn = getBlobbiInitialPosition(location);
      const initialPos = isBrandNewForThisLocation ? spawn : posNow;

     const speed = content.goal?.v ?? DEFAULT_SPEED_PX;
     const existingAnimState = playersAnimRef.current.get(playerKey);
     const animState: PlayerAnimState = {
       pos: existingAnimState?.pos ?? initialPos,
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

      // Extract blobbiD from aTag for proper tracking
      let blobbiDFromATag: string | undefined;
      try {
        const { blobbi_d } = parseA(aTag);
        blobbiDFromATag = blobbi_d;
      } catch {
        // Invalid aTag format, skip this event
        if (DEBUG_MP) console.debug('[blobbi][mp] invalid aTag format, skipping', { aTag });
        return;
      }

      // Create player state
      const playerState: PlayerRenderState = {
        pubkey: event.pubkey,
        sessionId: sessionIdFromTag,
        blobbiAddr: aTag,
        position: animState.pos,
        isMoving: animState.moving,
        lastSeen: nowSec(),
        visual,
        lastContent: { ...content, blobbiD: blobbiDFromATag }, // Ensure blobbiD is in lastContent
        animState,
        blobbiD: blobbiDFromATag, // Add blobbiD directly to player state
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
  }, [pubkey, fetchBlobbiVisual, players, navApi, isPositionBlocked]);

  // ============================================================================
  // Subscription Management
  // ============================================================================

  const startSubscription = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.close();
    }

    const filter: NostrFilter = {
      kinds: [31950],
      '#t': ['blobbi:presence', `island:${islandId}`, `loc:${location}`],
      since: nowSec() - 5,
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
      // Don't treat movement publish failures as fatal - just log and continue
      console.warn('Movement publish failed but continuing:', error);
      // Only set error for non-movement publish failures
      if (!error.message?.includes('All relays failed')) {
        setError('Failed to publish movement');
      }
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

        startSubscription();

        heartbeatIntervalRef.current = setInterval(() => {
          if (DEBUG_MP) console.debug('[blobbi][mp] heartbeat', { pos: myPosRef.current, location });
          publishHeartbeat(publish, { sessionId, islandId, location, blobbiAddr }, myPosRef.current)
            .catch(err => {
              console.warn('Heartbeat publish failed but continuing:', err);
              // Don't treat heartbeat failures as fatal
            });
        }, HEARTBEAT_INTERVAL_MS);

        gcIntervalRef.current = window.setInterval(() => {
          const now = nowSec();
          const STALE = EXP_SECONDS + 5;
          let changed = false;

          // remove por lastSeen
          setPlayers(prev => {
            const next = new Map(prev);
            for (const [key, p] of prev) {
              if (now - p.lastSeen > STALE) {
                next.delete(key);
                playersAnimRef.current.delete(key);
                changed = true;
              }
            }
            return next;
          });

          if (changed) {
            const still = new Set<string>();
            for (const p of playersAnimRef.current.keys()) {
              // p = `${pubkey}:${session}`
              still.add(p.split(':',1)[0]);
            }
            for (const pk of latestSessionByPubkeyRef.current.keys()) {
              if (!still.has(pk)) latestSessionByPubkeyRef.current.delete(pk);
            }
          }
        }, 1000);
      } catch (err) {
        console.error('Failed to init presence:', err);
        if (mounted) {
          // Only set error for non-retryable failures
          if (!err.message?.includes('All relays failed')) {
            setError('Failed to init presence');
          }
          setIsLoading(false);
        }
      }
    };

    doLoginAndStart();

    return () => {
      mounted = false;
      if (subscriptionRef.current) subscriptionRef.current.close();
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (gcIntervalRef.current) clearInterval(gcIntervalRef.current);
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
      if (gcIntervalRef.current) clearInterval(gcIntervalRef.current);
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
  }).catch(err => {
      console.warn('Failed to publish presence on location change but continuing:', err);
      // Don't treat location change publish failures as fatal
    });

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

  if (gcIntervalRef.current) clearInterval(gcIntervalRef.current);
  gcIntervalRef.current = window.setInterval(() => {
    const now = nowSec();
    const STALE = EXP_SECONDS + 5;
    setPlayers(prev => {
      const next = new Map(prev);
      for (const [key, p] of prev) {
        if (now - p.lastSeen > STALE) {
          next.delete(key);
          playersAnimRef.current.delete(key);
        }
      }
      return next;
    });
  }, 1000);
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