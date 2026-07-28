/**
 * React hook for Nostr multiplayer presence on Blobbi Island
 */
import { posAt } from '@/lib/multiplayer';
import { type PlayerAnimState } from '@/lib/multiplayer';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';

// Debug flag for multiplayer logging.
// Off by default; enable in development by setting localStorage['blobbi-debug-mp'] = '1'.
const DEBUG_MP =
  import.meta.env.MODE === 'development' &&
  typeof localStorage !== 'undefined' &&
  localStorage.getItem('blobbi-debug-mp') === '1';

// import { useQuery } from '@tanstack/react-query';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import {
  type PresenceContent,
  type PresenceOrder,
  type PlayerRenderState,
  type BlobbiVisual,
  type WalkableApi,
  makeSessionId,
  makeBlobbiAddr,
  publishPresenceLogin,
  publishMove,
  publishHeartbeat,
  publishHide,
  publishSit,
  publishActivity,
  parseSeatId,
  parseActivity,
  type PresenceActivity,
  validatePresenceEvent,
  isSupersededPresence,
  presenceOrderOf,
  nowSec,
  createWalkableApi,
  parseA,
  DEFAULT_SPEED_PX,
  HEARTBEAT_INTERVAL_MS,
  EXP_SECONDS,
} from '@/lib/multiplayer';
import { getBlobbiInitialPosition } from '@/lib/location-initial-position';
import { isOccupiableSeat } from '@/lib/theater-seats-config';

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
   * Current world scale: rendered-pixels-per-world-pixel
   * (`getBoundingClientRect().width / WORLD_WIDTH`). Used to normalize remote
   * walk speed so a fixed world-space speed (`DEFAULT_SPEED_PX`, expressed in
   * world px/s) takes the SAME wall-clock time on desktop and mobile, matching
   * the local player. Without this, remote players appear faster on smaller
   * (more scaled-down) screens because the rAF step is done in post-transform
   * pixels. Defaults to 1 when unavailable.
   */
  getWorldScale?: () => number;
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

/**
 * Outcome of a {@link UseIslandPresenceReturn.sitAt} call.
 *
 * The distinction that matters is PERMANENT vs TRANSIENT: a caller must retry
 * one and never the other. `'rejected'` will fail identically forever, so
 * retrying it is a publish loop with no possible success.
 */
export type SitResult =
  /** Presence carrying the seat was published. */
  | 'published'
  /** The id is not a seat a Blobbi may occupy. Permanent — do not retry. */
  | 'rejected'
  /** The publish itself failed (relay down, offline). Transient — retry. */
  | 'failed';

interface UseIslandPresenceReturn {
  sessionId: string;
  players: Map<string, PlayerRenderState>;
  moveTo: (destRaw: Position) => Promise<void>;
  /**
   * Publish that the local player has arrived at and is now hidden inside the
   * given hiding spot (e.g. a Town bush id). Remote clients suppress this
   * Blobbi's visual. Cleared automatically by the next {@link moveTo}.
   */
  hideAt: (hidingSpotId: string) => Promise<void>;
  /**
   * Clear the local hidden state (without publishing a move). Rarely needed
   * directly — {@link moveTo} clears it — but exposed for completeness.
   */
  clearHide: () => void;
  /**
   * Publish that the local player has ARRIVED at and is now sitting in the given
   * canonical theater seat. Remote clients snap this Blobbi to the seat's anchor
   * and draw it rear-facing. Cleared automatically by the next {@link moveTo}
   * and by a location change.
   *
   * Never throws. The outcome is returned so the caller can tell a PERMANENT
   * refusal from a TRANSIENT failure and retry only the second — see
   * {@link SitResult}.
   */
  sitAt: (seatId: string) => Promise<SitResult>;
  /**
   * Forget the local seat, WITHOUT publishing anything.
   *
   * This is bookkeeping only: it stops later heartbeats advertising a seat the
   * player has left. It is deliberately not a "stand up" message, because
   * standing up is already published by the action that causes it:
   *
   * | how the player leaves the seat | what clears it FOR OBSERVERS | clears the local ref |
   * | --- | --- | --- |
   * | walks away (floor click, another seat, walk-to-interact) | {@link moveTo}'s `moving` presence, which carries no `seatId` | `moveTo`, synchronously before publishing |
   * | leaves the room | the location-change `publishPresenceLogin`, which carries no `seatId` | the location-change effect |
   * | closes the tab / loses the network | nothing — the presence event expires (NIP-40) and remote GC drops the player | n/a |
   *
   * Every one of those paths already nulls the ref itself, so calling this is
   * normally REDUNDANT — `MultiplayerLayer` calls it when its `sittingIn` prop
   * goes null purely so the hook's copy cannot outlive the UI's copy if some
   * future caller clears the seat without moving. Adding a dedicated stand-up
   * publish here would create a second event that could arrive out of order with
   * the movement that already means the same thing.
   */
  clearSit: () => void;
  /**
   * Publish which shared activity the local player is participating in, as an
   * ADDRESS STRING and nothing else, or `null` to leave.
   *
   * Publishes once per transition (never per render), preserves the seat, and
   * is preserved by heartbeats. Never throws: presence is advisory, and a failed
   * publish is corrected by the next heartbeat.
   */
  setActivity: (sessionAddress: string | null) => Promise<void>;
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
  // The local player's current hiding-spot id (e.g. a Town bush id) or null.
  // Kept in a ref so heartbeats can preserve it without re-subscribing timers,
  // and so moveTo can clear it synchronously before publishing a move.
  const myHiddenInRef = useRef<string | null>(null);
  // The local player's current theater seat id, or null. Same reasoning as
  // myHiddenInRef: heartbeats must be able to preserve it without re-subscribing
  // timers, and moveTo must be able to clear it SYNCHRONOUSLY before publishing
  // a move — otherwise a heartbeat racing a walk could re-seat a Blobbi that is
  // already halfway down the aisle.
  const mySeatIdRef = useRef<string | null>(null);
  // The shared activity the local player is participating in (the session
  // ADDRESS STRING and nothing else), or null. Same reasoning as the two refs
  // above: heartbeats must preserve it without rebuilding their timer, and it
  // must be clearable synchronously so no publish can advertise a session the
  // player has already left.
  const myActivityRef = useRef<PresenceActivity | null>(null);
  const subscriptionRef = useRef<{ close: () => void } | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const gcIntervalRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const visualCacheRef = useRef<Map<string, BlobbiVisual>>(new Map());
  const fetchingVisualsRef = useRef<Set<string>>(new Set());
  const initRef = useRef(false);
  const lastLocationRef = useRef<LocationId>(location);
  const lastBlobbiAddrRef = useRef<string>(makeBlobbiAddr(pubkey, blobbiD));
  const playersAnimRef = useRef<Map<string, PlayerAnimState>>(new Map());
  // Newest presence ordering key ({createdAt, seq}) applied per player key.
  // Presence is an addressable event republished on every move/hide/heartbeat and
  // relays may deliver those out of order; without this an older event could
  // resurrect stale state (e.g. put a player back inside a bush they already
  // walked out of). `seq` resolves same-second races that `created_at` alone
  // cannot — see isSupersededPresence.
  const lastEventOrderRef = useRef<Map<string, PresenceOrder>>(new Map());
  // Monotonic publish counter for THIS session, stamped into every presence we
  // publish so remote clients can order our updates deterministically. Starts at
  // 0 and is pre-incremented, so the first published event carries seq 1.
  const seqRef = useRef(0);
  const lastUpdateTimeRef = useRef<number>(performance.now());
  const latestSessionByPubkeyRef = useRef<Map<string, {sessionId:string; seen:number}>>(new Map());
  const { isPositionBlocked } = useMovementBlocker();

  // Memoized values
  const blobbiAddr = useMemo(() => makeBlobbiAddr(pubkey, blobbiD), [pubkey, blobbiD]);

  /**
   * Take the next publish sequence number. Called at PUBLISH-INTENT time (before
   * any await), so the numbers reflect the order the player actually acted in —
   * e.g. arriving in a bush (hide) then immediately clicking elsewhere (move)
   * yields seq n then n+1 even when both land in the same wall-clock second and
   * reach a relay out of order.
   */
  const nextSeq = useCallback(() => {
    seqRef.current += 1;
    return seqRef.current;
  }, []);

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

  // Rendered-pixels-per-world-pixel. `anim.speedPx` is a world-space speed
  // (px/s against the 1046×697 world); multiplying by worldScale converts the
  // per-frame step into the SAME on-screen pixels a constant world distance
  // maps to — so remote walk speed matches the (scale-corrected) local player
  // and feels identical on desktop and mobile instead of faster on mobile.
  const worldScale = opts.getWorldScale?.() ?? 1;

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
      const step = anim.speedPx * worldScale * dt;  // world px/s * scale * sec = rendered px
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
}, [players, opts.percentToPixel, opts.pixelToPercent, opts.getWorldScale, opts.livePositionsRef, navApi, isPositionBlocked]);

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

      // Drop out-of-order / already-superseded presence before it can influence
      // any state. Ordering uses the publisher's monotonic `seq` when available
      // (so a delayed hide can never override a newer move published in the SAME
      // second) and falls back to `created_at` for clients that don't send it.
      const guardSession = dTag?.startsWith('session:')
        ? dTag.slice('session:'.length)
        : null;
      if (!guardSession) return;
      const guardKey = `${event.pubkey}:${guardSession}`;
      const incomingOrder = presenceOrderOf(content, event.created_at);
      const knownOrder = lastEventOrderRef.current.get(guardKey);
      if (isSupersededPresence(knownOrder, incomingOrder)) {
        if (DEBUG_MP) console.debug('[blobbi][mp] EVENT superseded, ignoring', {
          key: guardKey, incoming: incomingOrder, known: knownOrder,
        });
        return;
      }
      lastEventOrderRef.current.set(guardKey, incomingOrder);

      if (tagLocation !== location || content.location !== location) {
        const dTag = event.tags.find(([n]: string[]) => n === 'd')?.[1];
        const sessionIdFromTag = dTag?.replace('session:', '');
        if (sessionIdFromTag) {
          const playerKey = `${event.pubkey}:${sessionIdFromTag}`;

          if (playersAnimRef.current.has(playerKey) || players.has(playerKey)) {
            if (DEBUG_MP) console.debug('[blobbi][mp] remove player (location mismatch)', {
              key: playerKey, eventLoc: content.location, tagLoc: tagLocation, currentLoc: location
            });

            // Drop the animation state too, so a returning player can't reuse a
            // stale movement target/goal (e.g. the old walk-to-door target) the
            // next time they appear in this location.
            const updatedAnim = new Map(playersAnimRef.current);
            updatedAnim.delete(playerKey);
            playersAnimRef.current = updatedAnim;

            // Forget the cached live position so gaze tracking doesn't keep the
            // player parked at their last (door) position after they leave.
            opts.livePositionsRef?.current?.delete(playerKey);

            // Forget the latest-session bookkeeping for this session so that
            // when the player returns they are treated as brand-new for this
            // location (spawn at entry) instead of resuming stale state.
            const latest = latestSessionByPubkeyRef.current.get(event.pubkey);
            if (latest?.sessionId === sessionIdFromTag) {
              latestSessionByPubkeyRef.current.delete(event.pubkey);
            }

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
     // A real, in-progress walk only exists when the event explicitly says so
     // AND carries a goal. Otherwise this is an idle login/heartbeat and MUST
     // NOT reuse a stale movement target (e.g. an old walk-to-door target left
     // over from before the player changed location and came back).
     const hasActiveGoal = content.state === 'moving' && !!content.goal;
     const animState: PlayerAnimState = hasActiveGoal
       ? {
           // Walk from where the sprite currently is toward the new goal.
           pos: existingAnimState?.pos ?? initialPos,
           target: targetPos,
           speedPx: speed,
           lastUpdate: performance.now(),
           moving: true,
         }
       : {
           // Idle: snap target to the current anchor so the animation loop has
           // nothing stale to walk toward. Anchor it at the freshly-resolved
           // position rather than the previous (possibly door-parked) pos.
           pos: initialPos,
           target: initialPos,
           speedPx: speed,
           lastUpdate: performance.now(),
           moving: false,
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
        // Explicit, position-independent hiding state (e.g. "town-bush-1").
        // Absent on clients that don't publish it and on every presence that
        // isn't a hide, which is exactly how leaving a hiding spot clears it.
        hiddenIn: content.hiddenIn,
        // Explicit, position-independent seating claim (e.g. "theater-seat-a4").
        // Sanitized here to a non-empty string or undefined; whether it names a
        // real, occupiable, uncontested seat is decided by the renderer and the
        // occupancy resolver, which is where seat geometry belongs. Absent on
        // every `moving` presence, which is how standing up clears it.
        seatId: parseSeatId(content.seatId),
        // Which shared activity this player says they are in. A reference, not
        // a state: what is playing comes from the session event alone.
        activity: parseActivity(content.activity),
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
      // Load the full window of still-valid presence (not just the last few
      // seconds). On any (re)subscribe — e.g. location change — this restores
      // currently-active remote players immediately, instead of leaving them
      // invisible until their next movement/heartbeat.
      since: nowSec() - (EXP_SECONDS + 5),
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

      // Starting to move ALWAYS clears any hiding state. The published `moving`
      // presence below carries no `hiddenIn`, so remotes reveal the Blobbi as
      // soon as it leaves a hiding spot.
      myHiddenInRef.current = null;

      // ...and any seat. The `moving` presence below carries no `seatId`, which
      // is exactly what stands this Blobbi up on every remote client. Clearing
      // the ref FIRST means no heartbeat can slip a stale seat back in, and no
      // observer ever sees the contradictory "seated while walking somewhere
      // else" state.
      mySeatIdRef.current = null;

      // ...but NOT the shared activity. Participation belongs to being in the
      // room, not to a chair: standing up, crossing the theater and moving to
      // another seat all keep the watch session, and the `moving` presence
      // carries `activity` through so nobody blinks out of the participant list
      // mid-walk. Only an explicit leave, or leaving the location, clears it.
      //
      // This also means no cleanup event follows a stand-up at all — which is
      // what keeps the movement canonical. An `idle` clear published a moment
      // after the walk would carry a higher `seq` and no `goal`, and every
      // remote client would correctly treat it as the newest word and freeze the
      // Blobbi mid-aisle.

      const clampedDest = await publishMove(
        publish,
        {
          sessionId,
          islandId,
          location,
          blobbiAddr,
          seq: nextSeq(),
        },
        from,
        destRaw,
        DEFAULT_SPEED_PX,
        navApi,
        // Participation in a shared activity survives walking: it is not a
        // claim about standing still, so only leaving clears it.
        myActivityRef.current ?? undefined
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
  }, [publish, sessionId, islandId, location, blobbiAddr, navApi, nextSeq]);

  const hideAt = useCallback(async (hidingSpotId: string): Promise<void> => {
    try {
      // Idempotent by content: re-hiding in the same spot publishes the same
      // state, and presence is addressable (one event per session), so the
      // newest simply replaces the previous one — a repeated arrival can never
      // leave observers with a half-applied state.
      myHiddenInRef.current = hidingSpotId;
      if (DEBUG_MP) console.debug('[blobbi][mp] hideAt', { pos: myPosRef.current, hidingSpotId });
      await publishHide(
        publish,
        { sessionId, islandId, location, blobbiAddr, seq: nextSeq() },
        myPosRef.current,
        hidingSpotId
      );
    } catch (error) {
      console.warn('Hide publish failed but continuing:', error);
    }
  }, [publish, sessionId, islandId, location, blobbiAddr, nextSeq]);

  const clearHide = useCallback((): void => {
    myHiddenInRef.current = null;
  }, []);

  const sitAt = useCallback(async (seatId: string): Promise<SitResult> => {
    // OUTBOUND VALIDATION. `publishSit` will serialize whatever string it is
    // given, and `NIP.md` promises the wire only ever carries a canonical,
    // occupiable seat id — so the promise has to be enforced somewhere, and this
    // is the boundary where presence meets the theater. Doing it here (rather
    // than in `parseSeatId`, which must stay geometry-free, or only in the UI)
    // means no future caller can publish a decorative chair or a typo by
    // invoking the hook incorrectly.
    //
    // It also protects the local ref: refusing WITHOUT setting `mySeatIdRef`
    // stops a bad id leaking into every subsequent heartbeat.
    if (!isOccupiableSeat(seatId)) {
      if (import.meta.env.MODE === 'development') {
        console.warn('[blobbi][mp] refusing to publish a non-occupiable seat id', { seatId });
      }
      return 'rejected';
    }

    try {
      // Idempotent by content, like hideAt: presence is addressable, so
      // re-publishing the same seat simply replaces the previous event. A
      // repeated arrival can never leave observers half-seated.
      mySeatIdRef.current = seatId;
      if (DEBUG_MP) console.debug('[blobbi][mp] sitAt', { pos: myPosRef.current, seatId });
      await publishSit(
        publish,
        { sessionId, islandId, location, blobbiAddr, seq: nextSeq() },
        myPosRef.current,
        seatId,
        myActivityRef.current ?? undefined
      );
      return 'published';
    } catch (error) {
      // NOT fatal and NOT silent. The local ref stays set on purpose, so the
      // next heartbeat still advertises the seat — that is the backstop. But the
      // caller is told, so it can retry sooner than a whole heartbeat interval.
      console.warn('Sit publish failed but continuing:', error);
      return 'failed';
    }
  }, [publish, sessionId, islandId, location, blobbiAddr, nextSeq]);

  const clearSit = useCallback((): void => {
    mySeatIdRef.current = null;
  }, []);

  const setActivity = useCallback(
    async (sessionAddress: string | null): Promise<void> => {
      const next: PresenceActivity | null = sessionAddress
        ? { type: 'shared-playback', session: sessionAddress }
        : null;

      // Transitions only — publishing on every render would be a flood, and
      // publishing on nothing would leave observers 25 s behind.
      //
      // This guard is also LOAD-BEARING for movement: when a stand-up already
      // cleared the activity inside `moveTo`, the React cleanup that arrives a
      // moment later asks for the same clear again and must publish nothing. A
      // second, newer `idle` presence would carry no `goal` and would supersede
      // the movement on every remote client.
      if (myActivityRef.current?.session === next?.session) return;

      // Set the ref FIRST so any heartbeat that fires during the publish already
      // agrees with it — and, on a clear, so no heartbeat can re-advertise a
      // session the player has left.
      myActivityRef.current = next;

      try {
        if (DEBUG_MP) console.debug('[blobbi][mp] setActivity', { session: next?.session ?? null });
        await publishActivity(
          publish,
          { sessionId, islandId, location, blobbiAddr, seq: nextSeq() },
          myPosRef.current,
          next,
          mySeatIdRef.current ?? undefined,
        );
      } catch (error) {
        // Not fatal: the ref is already correct, so the next heartbeat carries
        // the right answer. Presence is advisory and self-healing by design.
        console.warn('Activity publish failed but continuing:', error);
      }
    },
    [publish, sessionId, islandId, location, blobbiAddr, nextSeq],
  );

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
          sessionId, islandId, location, blobbiAddr, startPos, seq: nextSeq(),
        });
        if (DEBUG_MP) console.debug('[blobbi][mp] login presence published', { startPos, location });
        if (!mounted) return;
        setIsLoading(false);

        startSubscription();

        heartbeatIntervalRef.current = setInterval(() => {
          if (DEBUG_MP) console.debug('[blobbi][mp] heartbeat', { pos: myPosRef.current, location });
          publishHeartbeat(publish, { sessionId, islandId, location, blobbiAddr, seq: nextSeq() }, myPosRef.current, myHiddenInRef.current ?? undefined, mySeatIdRef.current ?? undefined, myActivityRef.current ?? undefined)
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
                lastEventOrderRef.current.delete(key);
                opts.livePositionsRef?.current?.delete(key);
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

  // Active-Blobbi switch (in place): when the local player swaps their current
  // Blobbi without leaving the world, the world layer stays MOUNTED and only
  // `blobbiAddr` changes. Republish presence with the new identity AT THE
  // CURRENT POSITION (not spawn) so observers see the new Blobbi immediately
  // and the player isn't teleported. The heartbeat closure captured the old
  // addr, so rebuild it to broadcast the new identity going forward.
  useEffect(() => {
    if (!initRef.current) return;
    if (lastBlobbiAddrRef.current === blobbiAddr) return;
    if (DEBUG_MP) console.debug('[blobbi][mp] blobbi switch', { prev: lastBlobbiAddrRef.current, next: blobbiAddr });
    lastBlobbiAddrRef.current = blobbiAddr;

    publishPresenceLogin(publish, {
      sessionId, islandId, location, blobbiAddr, startPos: myPosRef.current, seq: nextSeq(),
    }).then(() => {
      // Swapping your Blobbi does not get you out of your chair. The login
      // presence above carries no `seatId` (by design — it is the "here I am"
      // event), so on its own it would stand a seated player up on every remote
      // screen until the next heartbeat ~25 s later. Re-assert the seat
      // immediately, with a HIGHER seq so it cannot be reordered behind the
      // login. The ref only ever holds an id `sitAt` already validated.
      const seatId = mySeatIdRef.current;
      if (!seatId) return;
      return publishSit(
        publish,
        { sessionId, islandId, location, blobbiAddr, seq: nextSeq() },
        myPosRef.current,
        seatId,
      );
    }).catch(err => {
      console.warn('Failed to publish presence on Blobbi switch but continuing:', err);
    });

    if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    heartbeatIntervalRef.current = setInterval(() => {
      publishHeartbeat(
        publish,
        { sessionId, islandId, location, blobbiAddr, seq: nextSeq() },
        myPosRef.current,
        myHiddenInRef.current ?? undefined,
        mySeatIdRef.current ?? undefined,
        myActivityRef.current ?? undefined
      ).catch(err => console.error('Failed to publish heartbeat:', err));
    }, HEARTBEAT_INTERVAL_MS);
  }, [blobbiAddr, publish, sessionId, islandId, location, nextSeq]);

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

  // The local player left for a new location. Drop ALL remote players and
  // their animation/goal state from the previous location so none of it is
  // reused when re-entering (no stale walk-to-door targets, no parked sprites).
  // The fresh subscription below restores whoever is actually present now.
  playersAnimRef.current = new Map();
  latestSessionByPubkeyRef.current.clear();
  lastEventOrderRef.current.clear();
  opts.livePositionsRef?.current?.clear();
  setPlayers(new Map());

  // Leaving the location abandons any hiding spot, so the presence published
  // below (and every following heartbeat) must not advertise it any more.
  myHiddenInRef.current = null;
  // ...and any seat: walking out of the theater must not leave a ghost sitting
  // in a chair there.
  mySeatIdRef.current = null;
  // ...and any shared activity. A player who walked out of the theater is not
  // in its watch session, and presence must never point at one they left.
  myActivityRef.current = null;

  publishPresenceLogin(publish, {
    sessionId, islandId, location, blobbiAddr, startPos: myPosRef.current, seq: nextSeq(),
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
      { sessionId, islandId, location, blobbiAddr, seq: nextSeq() },
      myPosRef.current,
      myHiddenInRef.current ?? undefined,
      // Read at CALL time, not capture time. This interval is REBUILT on every
      // location change, and entering the theater IS a location change — so a
      // heartbeat that forgot the seat here would eject every player from their
      // chair ~25 s after they sat down. (Caught in a real browser; jsdom never
      // saw it because it needs location-change → sit → heartbeat in that order.)
      mySeatIdRef.current ?? undefined,
      // Same story for the watch session: it is read at CALL time so a session
      // joined after this interval was built is still advertised.
      myActivityRef.current ?? undefined
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
          lastEventOrderRef.current.delete(key);
          opts.livePositionsRef?.current?.delete(key);
        }
      }
      return next;
    });
  }, 1000);
}, [location, publish, sessionId, islandId, blobbiAddr, startSubscription, nextSeq]);

  return {
    sessionId,
    players,
    moveTo,
    hideAt,
    clearHide,
    sitAt,
    clearSit,
    setActivity,
    myPosRef,
    isLoading,
    error,
  };
}