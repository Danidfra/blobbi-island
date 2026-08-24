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
import {
  resolveAttention,
  emptyAttention,
  attentionTargetPosition,
  LOCAL_GAZE_KEY,
  type LocalActiveState,
  type GazeCandidate,
  type AttentionState,
} from '@/lib/gaze';
import type { BlobbiVisual } from '@/lib/multiplayer';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { BlobbiRendererView, DEFAULT_STAGE } from '@blobbi/react';
import { BlobbiActor } from './BlobbiActor';
import { actorVisualFocusPoint } from '@/lib/blobbi-ground';
import { useIdleGaze } from '@/hooks/useIdleGaze';
import { cn } from '@/lib/utils';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import { getBlobbiSizeForLocation } from '@/lib/location-blobbi-sizes';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { resolveBlobbiScale } from '@/lib/blobbi-world-render';
import { resolveActorRender, type BlobbiActorPose } from '@/lib/blobbi-pose';
import { resolveRemoteSeatOccupancy, occupiedSeatIds, type RemoteSeatClaim } from '@/lib/theater-occupancy';
import { createWalkableApi } from '@/lib/multiplayer';
import { locationBoundaries } from '@/lib/location-boundaries';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';
import { useDebugOverlays } from '@/contexts/DebugOverlaysContext';
import { WORLD_WIDTH } from '@/lib/world-coordinates';
import { shouldTriggerWorldMove } from '@/lib/world-input';
import { DOCK_EVENTS, type PresenceMoveDetail } from '@/components/shell/dock-events';
import { ChatBubblesLayer } from '@/components/ChatBubblesLayer';
import { useChatBubbles } from '@/hooks/useChatBubbles';
import { CHAT_KIND, CHAT_EVICT_MS } from '@/lib/chat-config';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';
import { DEFAULT_ISLAND_ID } from '@/lib/multiplayer';
import { admitChatMessage, useIslandSafetyPolicy } from '@/safety';
import {
  clearRecentMessages,
  forgetMessagesFrom,
  isCommunicationSilenced,
  rememberMessage,
  subscribeRelationships,
} from '@/player-safety';
import {
  SEND_COOLDOWN_MS,
  buildMessagePayload,
  createInboundThrottle,
  messageAltText,
  parseIslandChatPayload,
  renderMessage,
  bubbleTextEquivalent,
  type IslandMessage,
  type IslandMessageClass,
} from '@/communication';

type PlayerLike = {
  pubkey: string;
  sessionId: string;
  position: Position;
  isMoving: boolean;
  visual?: BlobbiVisual;
  lastContent?: { blobbiD?: unknown; location?: unknown };
  blobbiD?: unknown;
};

type GazeOffset = { x: number; y: number };

/**
 * Total attempts at the arrival "I am sitting here" presence — one immediate,
 * then up to two retries. Small on purpose: this is a latency optimization over
 * a backstop that already exists (the heartbeat), not a delivery guarantee.
 */
const MAX_SIT_PUBLISH_ATTEMPTS = 3;
/** Gap between those attempts. Well under HEARTBEAT_INTERVAL_MS (25 s). */
const SIT_PUBLISH_RETRY_MS = 1200;

// Local Blobbi's reserved key in the shared maps (re-exported alias for the
// shared constant, used by both RemoteBlobbiSprite and MultiplayerLayer).
const LOCAL_ATTENTION_KEY = LOCAL_GAZE_KEY;

/**
 * Renders a single remote player's Blobbi with eye gaze.
 *
 * Extracted into its own component so it can call the `useIdleGaze` hook
 * per-player (hooks can't run inside the render `.map()`). Gaze priority:
 *   1. nearbyOffset  — glance toward a nearby moving Blobbi
 *   2. movementOffset — look where it's walking
 *   3. idle gaze      — subtle micro-movements while standing still
 *
 * Self-sufficient by design: the sprite resolves its own gaze on every render
 * by reading shared refs (nearby target + heading), so its built-in
 * `useIdleGaze` re-renders are enough to keep the eyes alive *after stopping*,
 * with no dependency on the parent re-rendering each frame.
 */
function RemoteBlobbiSprite({
  visual,
  isMoving,
  position,
  playerKey,
  nearbyGazeRef,
  livePositionsRef,
  headingRef,
  idSuffix,
  facing = 'front',
  size,
  scale = 1,
  scaleAt = () => 1,
}: {
  visual?: BlobbiVisual;
  isMoving: boolean;
  /** Current position (percent). Only changes while moving, which already re-renders. */
  position: Position;
  playerKey: string;
  /** Shared map of attention *decisions* (target identity), refreshed by a throttled timer. */
  nearbyGazeRef: React.MutableRefObject<Map<string, AttentionState>>;
  /** Shared map of live positions (percent) per key, kept fresh in render. */
  livePositionsRef: React.MutableRefObject<Map<string, Position>>;
  /** Shared map of last movement headings (normalized) per player. */
  headingRef: React.MutableRefObject<Map<string, GazeOffset>>;
  idSuffix: string;
  /**
   * Which way this Blobbi is turned. `'back'` for a seated theater-goer, whose
   * rear-facing markup has no face at all — `CurrentBlobbiDisplay` drops the
   * pupils, so the gaze resolved below is simply unused rather than specially
   * suppressed here. Identical to the local seated path.
   */
  facing?: 'front' | 'back';
  /**
   * Sprite size for the CURRENT ROOM — the same `getBlobbiSizeForLocation`
   * value `MovableBlobbi` uses for the local player.
   *
   * This used to be hardcoded to `"lg"`, which drew every remote Blobbi a size
   * step smaller than its owner saw it in the four `xl` rooms (including the
   * theater). Seated, that gap is the difference between a Blobbi visible above
   * the chair back and one completely hidden behind it: the seat looked empty on
   * every screen but the sitter's own.
   */
  size: 'sm' | 'md' | 'lg' | 'xl';
  /** This actor's current combined visual scale (for gaze focus points). */
  scale?: number;
  /** Depth scale at an arbitrary ground point (for the gaze target's focus). */
  scaleAt?: (pos: Position) => number;
}) {
  // Idle gaze is active whenever the Blobbi is standing still. While idle it
  // drives ~60fps re-renders of *this* sprite only, and each render re-reads
  // the shared refs below — so a stationary Blobbi keeps reacting to passers.
  const idleGaze = useIdleGaze(!isMoving);

  // Resolve gaze priority on every render (self-intent first), identical to the
  // local Blobbi in MovableBlobbi:
  //   1. own movement → look where it is walking (heading)
  //   2. attention     → look at the selected active target (identity from the
  //      throttled decision in nearbyGazeRef; live position from livePositionsRef)
  //   3. idle          → organic idle gaze
  // The attention *decision* (which Blobbi) is throttled to 400ms, but the
  // target's *live* position is resolved here each render, so the eyes track a
  // moving target continuously.
  let eyeOffset: GazeOffset = idleGaze;

  if (isMoving) {
    const heading = headingRef.current.get(playerKey);
    if (heading && (Math.abs(heading.x) > 0.01 || Math.abs(heading.y) > 0.01)) {
      eyeOffset = heading;
    }
  } else {
    const attention = nearbyGazeRef.current.get(playerKey);
    const attentionTarget = attention
      ? attentionTargetPosition(attention, livePositionsRef.current, LOCAL_ATTENTION_KEY)
      : null;
    if (attentionTarget) {
      // Ground anchors → visual body centers before deriving the vector, so
      // eyes meet bodies rather than feet (identical rule to MovableBlobbi).
      const myFocus = actorVisualFocusPoint(position, size, scale);
      const targetFocus = actorVisualFocusPoint(attentionTarget, size, scaleAt(attentionTarget));
      const tx = targetFocus.x - myFocus.x;
      const ty = targetFocus.y - myFocus.y;
      const len = Math.sqrt(tx * tx + ty * ty) || 1;
      eyeOffset = { x: tx / len, y: ty / len };
    }
  }

  // Remote players render through the PURE renderer with explicit visual
  // props: no local-player hooks (useBlobbis / useBlobbonautProfile /
  // useAccessoryManagement) run for someone else's Blobbi. Accessories stay
  // off for remotes (`accessories` defaults to none), matching the previous
  // showAccessories={false} behavior.
  const remoteVisual = visual || {
    name: undefined,
    baseColor: '#4F46E5',
    secondaryColor: '#7C3AED',
    eyeColor: '#1F2937',
    stage: 'baby' as const,
  };

  // Legacy behavior preserved: a known visual that has no colors yet (presence
  // arrived before the 31124 refinement) renders nothing rather than a
  // default-colored impostor.
  if (!remoteVisual.baseColor && !remoteVisual.secondaryColor) return null;

  return (
    <BlobbiRendererView
      visual={remoteVisual}
      instanceId={idSuffix}
      size={size}
      transparent
      className={cn(isMoving && "scale-105")}
      eyeOffset={eyeOffset}
      facing={facing}
      title={`${remoteVisual.name || 'Remote Blobbi'} - ${remoteVisual.stage || DEFAULT_STAGE} stage`}
    />
  );
}


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
  /**
   * Filled with the send entry point for every message class, so the
   * composition surface can publish without owning a relay connection.
   */
  sendMessageRef?: React.MutableRefObject<((message: IslandMessage) => Promise<boolean>) | null>;
  myAnchorId?: string;
  onOtherBlobbiClick?: (
    playerPubkey: string,
    blobbiD: string | undefined,
    blobbiVisual: BlobbiVisual
  ) => void;
  /**
   * Shared ref holding the local Blobbi's attention *decision* (target
   * identity), written here by the throttled gaze pass. MovableBlobbi reads it
   * together with {@link livePositionsRef} to resolve the target's *live*
   * position each frame, so the local Blobbi tracks a moving target smoothly —
   * the same mechanism RemoteBlobbiSprite uses.
   */
  localAttentionRef?: React.MutableRefObject<AttentionState>;
  /**
   * Optional shared map (key -> current percent position) for every gaze
   * candidate, including the local Blobbi under the reserved local key. Kept
   * fresh in render so gaze can track moving targets without the 400ms snapshot
   * lag. Shared with MovableBlobbi for the local Blobbi's own gaze.
   */
  livePositionsRef?: React.MutableRefObject<Map<string, Position>>;
  /**
   * Optional shared ref carrying the local Blobbi's current position and
   * activity (written by MovableBlobbi each frame). MultiplayerLayer reads it
   * during the throttled gaze pass so remote Blobbis can treat the local
   * player as a nearby *active* gaze target (e.g. look at it while it walks).
   * null while the local Blobbi isn't mounted/visible.
   */
  localActiveRef?: React.MutableRefObject<LocalActiveState | null>;
  /**
   * Id of the hiding spot the local player currently occupies (e.g. a Town bush
   * id like "town-bush-1"), or null when not hidden. Owned by PlayingView.
   *
   * Set → published as the optional `hiddenIn` field of the local player's
   * presence content so REMOTE clients stop rendering this Blobbi.
   * Back to null → the movement publish that caused it carries no `hiddenIn`,
   * which is what reveals the Blobbi again for everyone.
   */
  hiddenIn?: string | null;
  /**
   * Canonical id of the theater seat the local player currently occupies, or
   * null when not seated. Owned by PlayingView (`sittingIn`), set only on
   * CONFIRMED ARRIVAL.
   *
   * Set → published as the optional `seatId` field of the local player's
   * presence content, so REMOTE clients snap this Blobbi to the seat's canonical
   * anchor and draw it rear-facing.
   * Back to null → the movement publish that caused it carries no `seatId`,
   * which is what stands the Blobbi up again for everyone.
   */
  sittingIn?: string | null;
  /**
   * Reports which theater seats are visually occupied (remote winners plus the
   * local player's own seat), so the chairs can show it.
   *
   * A callback rather than a context because occupancy is DERIVED, not owned:
   * this layer holds the live presence map, PlayingView owns `sittingIn`, and
   * the seats need the union. Deriving it here and lifting the result keeps one
   * answer in the app instead of two components guessing separately.
   */
  onOccupiedSeatsChange?: (seatIds: Set<string>) => void;
  /**
   * Address of the shared watch session the local player is participating in,
   * or null. Owned by PlayingView, which gets it from the theater.
   *
   * Published as presence `activity` — the ADDRESS STRING only, never any
   * playback state (`docs/protocol/shared-playback-session.md` §14.2). It
   * answers "who is watching this together?" and nothing else.
   */
  activitySession?: string | null;
  /**
   * Reports how many VISIBLE players presence says are in that session,
   * including the local one.
   *
   * Derived here for the same reason seat occupancy is: this layer holds the
   * live presence map. Advisory and self-expiring — the session event carries no
   * participant list by design (§14.1), so this is a count of who is in the room
   * and claiming the session, not an authoritative roster.
   */
  onSessionParticipantsChange?: (count: number) => void;
}

// ============================================================================
// Component
// ============================================================================

export function MultiplayerLayer({
  containerRef,
  currentBlobbiD,
  startPosition,
  islandId = DEFAULT_ISLAND_ID,
  className,
  onMyPositionChange,
  disabled = false,
  sendMessageRef,
  myAnchorId,
  onOtherBlobbiClick,
  hiddenIn = null,
  sittingIn = null,
  onOccupiedSeatsChange,
  activitySession = null,
  onSessionParticipantsChange,
  localAttentionRef: localAttentionRefProp,
  livePositionsRef: livePositionsRefProp,
  localActiveRef,
}: MultiplayerLayerProps) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  // Capability set for the current experience. A frozen singleton, so it is
  // referentially stable and safe to use directly as a hook dependency.
  const safetyPolicy = useIslandSafetyPolicy();
  const { currentLocation } = useLocation();
  const { isPositionBlocked } = useMovementBlocker();
  const { showDebugOverlays } = useDebugOverlays();

  // Live gaze position source (key -> current percent position), including the
  // local Blobbi under LOCAL_ATTENTION_KEY. Written every animation frame by the
  // presence rAF loop (remotes) and by the local Blobbi each frame — never via
  // React render — so watchers track moving targets smoothly with no extra
  // re-renders. Declared before useIslandPresence so the loop can write into it.
  const internalLivePositionsRef = React.useRef(new Map<string, Position>());
  const livePositionsRef = livePositionsRefProp ?? internalLivePositionsRef;
  // The local Blobbi's own attention decision (what the local Blobbi looks at).
  // Shared with MovableBlobbi when provided.
  const internalLocalAttentionRef = React.useRef<AttentionState>(emptyAttention());
  const localAttentionRef = localAttentionRefProp ?? internalLocalAttentionRef;

  const clickHandledRef = useRef(false);
  const lastPublishTimeRef = useRef<number>(0);
  const publishDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPublishingRef = useRef<boolean>(false);
  const pendingTargetRef = useRef<Position | null>(null);
  const consecutiveFailureCountRef = useRef<number>(0);
  const cooldownActiveRef = useRef<boolean>(false);
  /** Last send time per message class — the per-class cooldowns live in `@/communication`. */
  const lastSendAtRef = useRef<Partial<Record<IslandMessageClass, number>>>({});
  /**
   * Per-sender flood control for INBOUND messages.
   *
   * A send cooldown lives in the client the sender controls, so it protects
   * nobody; this is the half that bounds what a player is actually subjected to.
   * Held in a ref so it survives re-renders and keeps its memory of who has
   * spoken recently.
   */
  const inboundThrottleRef = useRef(createInboundThrottle());
  const anchorIndexRef = React.useRef(new Map<string, string>());

  const resolveBlobbiD = useCallback(
    async (player: PlayerLike): Promise<string | undefined> => {
      // 1) Presença atual (mais fresco)
      const direct = player.blobbiD;
      if (typeof direct === 'string' && direct.length > 0) {
        if (DEBUG_MP) {
          console.debug('[blobbi][mp][resolveBlobbiD] using direct blobbiD', {
            pubkey: player.pubkey, blobbiD: direct
          });
        }
        return direct;
      }

      // 2) Último conteúdo cacheado na presença
      const fromLast = player.lastContent?.blobbiD;
      if (typeof fromLast === 'string' && fromLast.length > 0) {
        if (DEBUG_MP) {
          console.debug('[blobbi][mp][resolveBlobbiD] using cached blobbiD', {
            pubkey: player.pubkey, blobbiD: fromLast
          });
        }
        return fromLast;
      }

      try {
        const signal = AbortSignal.timeout(3000);
        const events = await nostr.query(
          [
            {
              kinds: [KIND_BLOBBI_STATE],
              authors: [player.pubkey],
              limit: 10,
            },
          ],
          { signal }
        );

        if (!events?.length) {
          if (DEBUG_MP) {
            console.debug('[blobbi][mp][resolveBlobbiD] no events found', {
              pubkey: player.pubkey
            });
          }
          return undefined;
        }

        // Filter for valid events with d tags and sort by created_at descending
        const validEvents = [...events]
          .filter(e => {
            if (typeof e?.created_at !== 'number') return false;
            const dTag = e.tags?.find(([k]) => k === 'd')?.[1];
            return typeof dTag === 'string' && dTag.length > 0;
          })
          .sort((a, b) => b.created_at - a.created_at);

        if (validEvents.length === 0) {
          if (DEBUG_MP) {
            console.debug('[blobbi][mp][resolveBlobbiD] no valid events with d tags', {
              pubkey: player.pubkey, totalEvents: events.length
            });
          }
          return undefined;
        }

        const latestEvent = validEvents[0];
        const d = latestEvent.tags.find(([k]) => k === 'd')?.[1];

        if (DEBUG_MP) {
          console.debug('[blobbi][mp][resolveBlobbiD] picked latest d', {
            pubkey: player.pubkey,
            d,
            created_at: latestEvent.created_at,
            totalEvents: events.length,
            validEvents: validEvents.length
          });
        }

        return typeof d === 'string' && d.length > 0 ? d : undefined;
      } catch (error) {
        if (DEBUG_MP) {
          console.debug('[blobbi][mp][resolveBlobbiD] query failed', {
            pubkey: player.pubkey,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return undefined;
      }
    },
    [nostr]
  );

  // Chat bubble management
  const {
    bubbles,
    queuedBubbles,
    showBubble,
    queueBubble,
    processQueuedBubbles,
    clearBubbles,
    removeBubblesForPubkey,
    isDuplicate,
  } = useChatBubbles();

  // Mirror of the live bubble map, so the mute/block eviction effect can read
  // what is currently on screen without listing `bubbles` as a dependency and
  // re-subscribing to the safety store on every bubble change.
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;

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
      kinds: [KIND_BLOBBI_STATE],
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
    // Resolve the user-facing name with the SAME priority used in the selection
    // screen / cards: the real `name` tag wins; never fall back to the raw
    // id/d-tag-derived code in user-facing labels.
    const name = getBlobbiDisplayName({
      id: dTag ?? '',
      name: get('name'),
      rawTags: event.tags,
    });
    const baseColor      = get('base_color')      || get('baseColor');
    const secondaryColor = get('secondary_color') || get('secondaryColor');
    const pattern        = get('pattern');
    const eyeColor       = get('eye_color')       || get('eyeColor');
    const specialMark    = get('special_mark')    || get('specialMark');
    const stageRaw       = get('stage') || get('blobbi_stage');
    const stage = stageRaw === 'egg' || stageRaw === 'baby' || stageRaw === 'adult'
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
            if (DEBUG_MP) console.debug('[Multiplayer] EOSE received, waiting for new events');
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
  }, [containerRef, isPositionBlocked, navApi]);

  const pixelToPercent = useCallback((p: {x:number; y:number}) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 75 };
    return { x: (p.x / rect.width) * 100, y: (p.y / rect.height) * 100 };
  }, [containerRef, isPositionBlocked, navApi]);

  // Rendered-pixels-per-world-pixel. The world is rendered at WORLD_WIDTH then
  // uniformly scaled by VirtualWorld, so rect.width === WORLD_WIDTH * scale.
  // Remote walk speed is normalized by this (see useIslandPresence) so it
  // matches the scale-corrected local player on both desktop and mobile.
  const getWorldScale = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 1;
    return rect.width / WORLD_WIDTH;
  }, [containerRef]);

  const {
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
    getWorldScale,
    nav: navApi,
    // Live gaze source: the presence rAF loop writes every remote's current
    // position here each frame, so watchers track moving targets smoothly
    // without waiting for a React re-render.
    livePositionsRef,
  });

  // ============================================================================
  // Sending
  // ============================================================================

  /**
   * Publish one message of any class.
   *
   * ONE publisher for text, quick phrases, templates and emotes. Four would be
   * four chances for the envelope, the tags, the expiration or the capability
   * check to drift apart, and the wire would end up carrying four dialects of
   * one protocol.
   *
   * Returns whether the message was published. A refusal — by capability, by
   * cooldown, or because this build cannot render what was asked for — is a
   * `false`, not an exception: none of those is exceptional, and the composer
   * only needs to know whether to clear itself. A genuine publish failure still
   * throws, exactly as before.
   */
  const sendMessage = useCallback(async (message: IslandMessage): Promise<boolean> => {
    if (!user) return false;

    // The send half of the capability check. Refusing here rather than only in
    // the composer means no other holder of the ref can route around it. Under
    // Standard every class is admitted, so this changes nothing.
    if (!admitChatMessage(safetyPolicy, message).admitted) return false;

    // Resolve locally what the message SAYS. Used for the optimistic bubble and
    // for the `alt` tag; never for the payload. A message this build cannot
    // render is one it has no business sending.
    const bubble = renderMessage(message);
    if (!bubble) return false;

    const now = Date.now();

    // Per-class cooldown: a one-tap emote needs a higher floor than a typed
    // sentence, because typing is its own rate limit and tapping is not.
    const cooldown = SEND_COOLDOWN_MS[message.type];
    if (now - (lastSendAtRef.current[message.type] ?? 0) < cooldown) return false;

    const expirationTime = Math.floor((now + CHAT_EVICT_MS) / 1000);

    const content = buildMessagePayload(message, {
      location: currentLocation,
      blobbiD: currentBlobbiD,
      ts: Math.floor(now / 1000),
    });

    const event = {
      kind: CHAT_KIND,
      content,
      tags: [
        ['d', sessionId],
        ['l', currentLocation],
        ['expiration', expirationTime.toString()],
        ['p', user.pubkey],
        ['i', islandId],
        // NIP-31: describes the event for clients that do not know this kind.
        // Built from the LOCAL rendering, and never read back by this app.
        ['alt', messageAltText(bubbleTextEquivalent(bubble))],
      ],
    };

    try {
      // Use Promise.allSettled for non-fatal publish attempts
      const results = await Promise.allSettled([publishEvent(event)]);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      if (DEBUG_MP) console.debug('[blobbi][chat] publish results', { successful, total: results.length, type: message.type });

      // Update the cooldown even on partial success
      lastSendAtRef.current[message.type] = now;

      // Show local bubble immediately (optimistic)
      showBubble('me', bubble, now + CHAT_EVICT_MS);
      return true;
    } catch (error) {
      console.error('Failed to publish message:', error);
      throw error;
    }
  }, [user, currentLocation, currentBlobbiD, islandId, publishEvent, showBubble, sessionId, safetyPolicy]);

  // ============================================================================
  // Chat Event Processing
  // ============================================================================

  /**
   * The inbound pipeline, in the order the steps have to happen.
   *
   *   scope → STRUCTURE → duplicate → CAPABILITY → flood → trusted render
   *
   * Two of those are the safety boundary and both run before anything can be
   * presented:
   *
   *  - **Structure** (`parseIslandChatPayload`) validates against this build's
   *    own catalogs and keeps only ids. A spoofed
   *    `{"type":"quick","phrase":"want-to-play","text":"<abuse>"}` loses its
   *    `text` here — nothing downstream can see a field the parser did not copy.
   *  - **Capability** (`admitChatMessage`) decides whether this CLASS of message
   *    is allowed at all, from the resolved policy and nothing else.
   *
   * Then the words are rebuilt locally by `renderMessage`, so the only class
   * whose text came from the sender is free text — which is exactly the class
   * the `freeTextChat` capability governs.
   */
  const processChatEvent = useCallback((event: NostrEvent) => {
    try {
      if (event.kind !== CHAT_KIND) return;

      // Skip own events
      if (event.pubkey === user?.pubkey) return;

      // MUTE / BLOCK, before anything is parsed.
      //
      // Placed here for two reasons. It is the cheapest check available — a
      // local map lookup against parsing an arbitrary attacker-supplied payload
      // — so a blocked sender's flood costs almost nothing to discard. And it is
      // sender-level, which is a different question from the capability gate
      // further down: that one asks "may this KIND of message be shown", this
      // one asks "may THIS PERSON be heard". Blocking implies muting, and the
      // precedence lives in `isCommunicationSilenced` so the two bits can never
      // be combined differently in two places.
      if (isCommunicationSilenced(event.pubkey)) return;

      const now = Date.now();
      const nowSec = Math.floor(now / 1000);

      // Check expiration
      const expirationTag = event.tags.find(([name]) => name === 'expiration')?.[1];
      if (expirationTag && parseInt(expirationTag) < nowSec) {
        return; // Expired
      }

      // Check location (tolerant parser: accepts 'l' or 'location')
      const locationTag =
        event.tags.find(([name]) => name === 'l')?.[1] ??
        event.tags.find(([name]) => name === 'location')?.[1];
      if (locationTag !== currentLocation) {
        return; // Different location
      }

      // Check if too old
      if (nowSec - event.created_at > CHAT_EVICT_MS / 1000) {
        return; // Too old
      }

      // 1. STRUCTURE. Cheapest meaningful rejection, and the step that strips a
      //    structured payload down to catalog ids.
      const parsed = parseIslandChatPayload(event.content);
      if (!parsed.ok) {
        if (DEBUG_MP) console.debug('[blobbi][chat] payload rejected', { reason: parsed.reason });
        return;
      }
      if (parsed.envelope.location !== currentLocation) return;

      // 2. Duplicate DELIVERY, keyed on the event id.
      //    It used to key on `pubkey:sessionId`, which suppressed every second
      //    message from a sender within the window — including two different
      //    ones, so "wave" then "heart" would have silently lost the heart. The
      //    rate limit that key was accidentally providing is now step 4, stated
      //    where it can be reasoned about.
      if (isDuplicate(event.id, CHAT_EVICT_MS)) {
        if (DEBUG_MP) console.debug('[blobbi][chat] duplicate event ignored', { id: event.id });
        return;
      }

      // 3. CAPABILITY. The data boundary: what a player is allowed to be shown,
      //    decided before anything can present it. The sender is not
      //    necessarily this build, so this — not the composer — is the check
      //    that protects a Family player.
      if (!admitChatMessage(safetyPolicy, parsed.message).admitted) return;

      // 4. Flood control, per sender. After the free checks so a stream of
      //    malformed events cannot consume a well-behaved sender's budget.
      if (!inboundThrottleRef.current.admit(event.pubkey, now)) {
        if (DEBUG_MP) console.debug('[blobbi][chat] sender throttled', { pubkey: event.pubkey });
        return;
      }

      // 5. TRUSTED RECONSTRUCTION. Every character of a structured message comes
      //    from this build's catalogs. A message referencing an entry this build
      //    does not have simply is not shown.
      const bubble = renderMessage(parsed.message);
      if (!bubble) return;

      // Evidence for a possible report, remembered at the moment the message is
      // accepted. Kind 21201 expires in ~10 s, so by the time a player opens the
      // card and picks Report the event is gone from everywhere else. Memory
      // only, one message per sender — see `recent-messages.ts`.
      rememberMessage(event.pubkey, {
        event,
        messageClass: parsed.message.type,
        renderedText: bubbleTextEquivalent(bubble),
        receivedAt: now,
      });

      const expiresAt = expirationTag ? parseInt(expirationTag) * 1000 : (now + CHAT_EVICT_MS);
      queueBubble(`${event.pubkey}:pending`, bubble, expiresAt);
    } catch (error) {
      console.error('Error processing chat event:', error);
    }
  }, [user?.pubkey, currentLocation, queueBubble, isDuplicate, safetyPolicy]);

  // ============================================================================
  // Chat Subscription
  // ============================================================================

  useEffect(() => {
    if (!user) return;

    const chatFilter: NostrFilter = {
      kinds: [CHAT_KIND],
      '#l': [currentLocation],
      '#i': [islandId],
      since: Math.floor((Date.now() - 5_000) / 1000),
    };

    if (DEBUG_MP) console.debug('[blobbi][chat] starting subscription', { chatFilter });
    const chatSubscription = subscribe(chatFilter, processChatEvent);
    return () => chatSubscription.close();
  }, [user?.pubkey, currentLocation, islandId, subscribe, processChatEvent]);

  // Process queued bubbles when players change
  useEffect(() => {
    // Build a stable lookup pubkey -> concrete [data-player-key="..."] once per players change
    const m = new Map<string, string>();
    for (const key of players.keys()) {
      const [pubkey] = key.split(':');
      m.set(pubkey, key);
    }
    anchorIndexRef.current = m;

    const isPlayerVisible = (playerKey: string) => {
      if (playerKey.endsWith(':pending')) {
        const pubkey = playerKey.replace(':pending', '');
        return anchorIndexRef.current.has(pubkey)
      }
      return players.has(playerKey);
    };
    processQueuedBubbles(isPlayerVisible);
  }, [players, queuedBubbles, processQueuedBubbles]);

  // Clear bubbles when location changes. The evidence buffer goes with them:
  // context from a room the player has left is not context they need, and
  // keeping it would turn a per-room buffer into a session log by accident.
  useEffect(() => {
    clearBubbles();
    clearRecentMessages();
  }, [currentLocation, clearBubbles]);

  /**
   * Muting or blocking removes what that player already said.
   *
   * The ingest gate stops the next message; this takes down the one still on
   * screen. Leaving it up for the rest of its four-second life after the player
   * pressed Mute would make the control look broken at exactly the wrong moment.
   *
   * Subscribed rather than derived so a mute performed in another tab clears
   * this tab too.
   */
  useEffect(() => {
    const evict = () => {
      for (const key of anchorIndexRef.current.keys()) {
        if (isCommunicationSilenced(key)) {
          removeBubblesForPubkey(key);
          forgetMessagesFrom(key);
        }
      }
      for (const bubble of bubblesRef.current.values()) {
        const [pubkey] = bubble.playerKey.split(':');
        if (pubkey && isCommunicationSilenced(pubkey)) {
          removeBubblesForPubkey(pubkey);
          forgetMessagesFrom(pubkey);
        }
      }
    };
    return subscribeRelationships(evict);
  }, [removeBubblesForPubkey]);

  // Expose the single send entry point to the parent.
  useEffect(() => {
    if (sendMessageRef) {
      sendMessageRef.current = sendMessage;
    }
    return () => {
      if (sendMessageRef) {
        sendMessageRef.current = null;
      }
    };
  }, [sendMessageRef, sendMessage]);

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

    // Check if this click should trigger world movement — the SAME shared
    // policy MovableBlobbi's input adapter uses (src/lib/world-input.ts), so
    // the local walk and the presence publish can never disagree about what
    // counts as a world tap.
    if (!containerRef.current || !shouldTriggerWorldMove(event, containerRef.current)) {
      if (DEBUG_MP) console.debug('[blobbi][mp][ui] click blocked by UI element');
      return;
    }

    if (DEBUG_MP) console.debug('[blobbi] CLICK start');

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

    // Check if we're in cooldown mode (after consecutive failures)
    if (cooldownActiveRef.current) {
      if (DEBUG_MP) console.debug('[blobbi][mp][ui] click ignored - cooldown active');
      return;
    }

    // Rate limiting: Ignore new publishes if less than 90ms passed since last publish
    const now = Date.now();
    if (now - lastPublishTimeRef.current < 90) {
      if (DEBUG_MP) console.debug('[blobbi][mp][ui] rate limited click', {
        timeSinceLastPublish: now - lastPublishTimeRef.current,
        targetPos
      });
      return;
    }

    // Latest-only queue: If a publish is in flight, store this as the pending target
    if (isPublishingRef.current) {
      if (DEBUG_MP) console.debug('[blobbi][mp][ui] click queued - replacing pending target', { targetPos });
      pendingTargetRef.current = targetPos;
      return;
    }

    // Clear any existing debounce timer
    if (publishDebounceTimerRef.current) {
      clearTimeout(publishDebounceTimerRef.current);
    }

    // Set up debounced movement
    publishDebounceTimerRef.current = setTimeout(async () => {
      try {
        isPublishingRef.current = true;
        lastPublishTimeRef.current = Date.now();

        // Use the latest pending target or the original target
        const finalTarget = pendingTargetRef.current || targetPos;
        pendingTargetRef.current = null; // Clear pending target

        if (DEBUG_MP) console.debug('[blobbi][mp][ui] executing debounced move', { finalTarget });

        await moveTo(finalTarget);

        // Reset consecutive failure count on success
        consecutiveFailureCountRef.current = 0;

        if (DEBUG_MP) console.debug('[blobbi][mp][ui] moved', { myPos: myPosRef.current });
        onMyPositionChange?.(myPosRef.current);
      } catch (error) {
        console.error('Failed to move:', error);

        // Track consecutive failures
        consecutiveFailureCountRef.current++;

        // If we have 3 consecutive failures, activate cooldown
        if (consecutiveFailureCountRef.current >= 3) {
          if (DEBUG_MP) console.debug('[blobbi][mp][ui] activating cooldown after 3 failures');
          cooldownActiveRef.current = true;

          // Clear cooldown after 0.75 seconds
          setTimeout(() => {
            cooldownActiveRef.current = false;
            consecutiveFailureCountRef.current = 0;
            if (DEBUG_MP) console.debug('[blobbi][mp][ui] cooldown ended');
          }, 750);
        }

        // Don't treat publish failures as fatal - just log and continue
        if (DEBUG_MP) console.debug('[blobbi][mp][ui] movement failed but continuing', { error });
      } finally {
        isPublishingRef.current = false;
        publishDebounceTimerRef.current = null;

        // If there's a pending target and we're not in cooldown, process it immediately
        if (pendingTargetRef.current && !cooldownActiveRef.current) {
          if (DEBUG_MP) console.debug('[blobbi][mp][ui] processing pending target immediately');
          setTimeout(() => {
            const pending = pendingTargetRef.current;
            if (pending) {
              pendingTargetRef.current = null;
              handleContainerClick({
                clientX: 0,
                clientY: 0,
                // Create a minimal event-like object
                preventDefault: () => {},
                stopPropagation: () => {},
                composedPath: () => [],
              } as unknown as MouseEvent | TouchEvent | PointerEvent);
            }
          }, 50);
        }
      }
    }, 150); // Debounce delay - only last click in rapid succession will trigger
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

  // Walk-to-interact (e.g. clicking a door) walks the local Blobbi to a target
  // and only then changes location. That walk goes through usePendingInteraction
  // (local-only), so without this remotes never saw the walk — the Blobbi just
  // vanished when the new-location presence arrived. Forward the broadcast walk
  // target to presence `moveTo` (publishMove) so remotes animate the walk-to-door
  // first; by the time the location change removes this player, the remote walk
  // has had the full travel time to play out.
  useEffect(() => {
    if (disabled || !user) return;

    const onPresenceMove = (e: Event) => {
      const detail = (e as CustomEvent<PresenceMoveDetail>).detail;
      const target = detail?.target;
      if (!target) return;
      moveTo({ x: target.x, y: target.y }).catch((err) => {
        if (DEBUG_MP) console.debug('[blobbi][mp][ui] presence-move failed', err);
      });
    };
    document.addEventListener(DOCK_EVENTS.presenceMove, onPresenceMove);

    return () => {
      document.removeEventListener(DOCK_EVENTS.presenceMove, onPresenceMove);
    };
  }, [disabled, user, moveTo]);

  // Synchronize the local player's hiding state (e.g. inside a Town bush).
  //
  // Publish path: arriving at a hiding spot flips `hiddenIn` to its id, which we
  // publish as an idle presence carrying the optional `hiddenIn` field. Remotes
  // suppress this Blobbi's in-world representation until it changes.
  //
  // Clear path: leaving always starts with movement, and every local movement
  // publishes a `moving` presence WITHOUT `hiddenIn` (via `moveTo`, from the
  // world-click handler or the walk-to-interact broadcast above) — that is what
  // reveals the Blobbi remotely. Here we only need to drop the local flag so
  // subsequent heartbeats stop advertising a spot the player already left.
  //
  // `syncedHiddenInRef` holds the last state actually synchronized:
  // `hideAt`/`clearHide` are rebuilt on every render (they close over the
  // publish callback) and this layer re-renders whenever any player moves, so
  // without the guard the effect would republish the same hide over and over.
  // Publishing strictly on TRANSITIONS also means re-entering the same bush can
  // never duplicate presence events.
  const syncedHiddenInRef = useRef<string | null>(null);
  useEffect(() => {
    if (disabled || !user) return;
    if (syncedHiddenInRef.current === hiddenIn) return;
    syncedHiddenInRef.current = hiddenIn;

    if (!hiddenIn) {
      clearHide();
      return;
    }

    hideAt(hiddenIn).catch((err) => {
      if (DEBUG_MP) console.debug('[blobbi][mp][ui] hide publish failed', err);
    });
  }, [hiddenIn, hideAt, clearHide, disabled, user]);

  // Synchronize the local player's THEATER SEAT, byte-for-byte the same shape as
  // the hiding sync above, and for the same reasons.
  //
  // Publish path: `sittingIn` only ever becomes non-null on CONFIRMED ARRIVAL
  // (TheaterSeat fires `onSit` from the walk's arrival callback, never from the
  // click), so a seat is never advertised while the Blobbi is still walking to
  // it. Remotes then snap this Blobbi to the seat's canonical anchor.
  //
  // Clear path: standing up always starts with movement, and every local
  // movement publishes a `moving` presence WITHOUT `seatId` (via `moveTo`) —
  // that is what stands the Blobbi up remotely, immediately, with no separate
  // event that could arrive out of order. Leaving the room does the same via the
  // location-change login publish. Both of those already null the hook's own
  // ref, so the `clearSit()` below publishes nothing and is normally redundant;
  // it exists so the hook's copy cannot outlive this prop if the seat is ever
  // cleared without moving. See `clearSit`'s contract in useIslandPresence.
  //
  // `syncedSeatIdRef` holds the last state actually synchronized: `sitAt` /
  // `clearSit` are rebuilt every render and this layer re-renders whenever any
  // player moves, so without the guard the effect would republish the same sit
  // continuously. Publishing strictly on TRANSITIONS also means re-entering the
  // same seat cannot duplicate presence events.
  //
  // Retry: the arrival publish is the ONLY thing that seats you remotely in a
  // timely way. If it fails (relay hiccup, offline for a moment) the next
  // heartbeat still carries the seat — but that is up to HEARTBEAT_INTERVAL_MS
  // away, so everyone else would watch you stand in front of your chair for ~25
  // seconds. So the seat is marked synchronized only once it is actually
  // published, and a transient failure schedules a bounded retry.
  //
  // Bounded on purpose, and only for TRANSIENT failures: a `'rejected'` id is
  // invalid and would fail identically forever, and after the attempt cap the
  // heartbeat remains the backstop. Neither path can turn into a publish loop.
  // ⚠️ THE CLAIM MUST BE TAKEN SYNCHRONOUSLY. `sitAt` gets a NEW identity on
  // every single render of this component — it closes over the `publish` arrow
  // built inline in the `useIslandPresence({...})` call below, which is a fresh
  // object each render — and this component re-renders constantly (every remote
  // player position update). So this effect re-runs many times per second, and
  // the ONLY thing standing between that and a publish flood is the guard above
  // seeing its own claim already recorded.
  //
  // Recording the claim inside the `await`'s `.then()` instead is what caused a
  // real flood: the effect re-ran (new `sitAt`) before the publish resolved, so
  // the claim was never recorded, so the guard never matched, so it published
  // again — several times per second, forever. Worse, `syncedSeatIdRef` being
  // stuck at `null` also made the `!sittingIn` branch a no-op on stand-up, so
  // `clearSit()` never ran and heartbeats kept advertising a seat the player had
  // already walked away from.
  //
  // Hence: claim first, publish second, and never cancel an in-flight publish
  // just because the effect re-ran with a new callback identity.
  const syncedSeatIdRef = useRef<string | null>(null);
  const sitAttemptsRef = useRef<{ seatId: string | null; count: number }>({ seatId: null, count: 0 });
  const sitRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sitRetryTick, setSitRetryTick] = React.useState(0);
  useEffect(() => {
    if (disabled || !user) return;
    if (syncedSeatIdRef.current === sittingIn) return;

    // Claim, before anything asynchronous can happen.
    syncedSeatIdRef.current = sittingIn;
    // A pending retry belongs to the seat we just stopped caring about.
    if (sitRetryTimerRef.current) {
      clearTimeout(sitRetryTimerRef.current);
      sitRetryTimerRef.current = null;
    }

    if (!sittingIn) {
      sitAttemptsRef.current = { seatId: null, count: 0 };
      clearSit();
      return;
    }

    const attempt =
      sitAttemptsRef.current.seatId === sittingIn ? sitAttemptsRef.current.count + 1 : 1;
    sitAttemptsRef.current = { seatId: sittingIn, count: attempt };

    void sitAt(sittingIn).then((result) => {
      // Settled: published, or refused for good. The claim stands, so no
      // re-render can publish this seat again.
      if (result !== 'failed') return;

      // The player left the seat (or took another one) while this was in
      // flight. Retrying now would publish a seat they are no longer in.
      if (syncedSeatIdRef.current !== sittingIn) return;

      if (attempt >= MAX_SIT_PUBLISH_ATTEMPTS) {
        if (DEBUG_MP) {
          console.debug('[blobbi][mp][ui] sit publish gave up; heartbeat will carry the seat', {
            seatId: sittingIn, attempts: attempt,
          });
        }
        return; // Claim stands: stop trying. The heartbeat is the backstop.
      }

      // Release the claim so the retry can re-enter, and wake the effect — its
      // deps would otherwise only change on an unrelated re-render.
      syncedSeatIdRef.current = null;
      sitRetryTimerRef.current = setTimeout(() => {
        sitRetryTimerRef.current = null;
        setSitRetryTick((n) => n + 1);
      }, SIT_PUBLISH_RETRY_MS);
    });
    // `sitRetryTick` is the retry trigger; see above.
  }, [sittingIn, sitAt, clearSit, disabled, user, sitRetryTick]);

  // Drop a pending retry on unmount only — NOT on every effect re-run, which is
  // what would cancel the in-flight publish this whole design depends on.
  useEffect(() => () => {
    if (sitRetryTimerRef.current) clearTimeout(sitRetryTimerRef.current);
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (publishDebounceTimerRef.current) {
        clearTimeout(publishDebounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      if (DEBUG_MP) console.debug('[blobbi][mp][render] players size', players.size);
    }
  }, [players.size]);

  const visiblePlayers = React.useMemo(
    () => Array.from(players.values()).filter(p => p.lastContent?.location === currentLocation),
    [players, currentLocation]
  );

  // ── Theater seat occupancy ──────────────────────────────────────────────
  // Which REMOTE claim wins each seat. Derived fresh from the live presence map,
  // so a player who walks away, changes room or simply stops publishing releases
  // their seat through the existing presence expiry — there is no separate
  // occupancy record to go stale, and nothing here to garbage-collect.
  //
  // `resolveRemoteSeatOccupancy` owns the duplicate-claim policy in full (local
  // player keeps their own seat; otherwise lowest hex pubkey wins; losers fall
  // back to normal rendering) — see `src/lib/theater-occupancy.ts`.
  const remoteSeatWinners = React.useMemo(() => {
    const claims: RemoteSeatClaim[] = [];
    for (const p of visiblePlayers) {
      if (p.seatId) claims.push({ seatId: p.seatId, pubkey: p.pubkey, sessionId: p.sessionId });
    }
    return resolveRemoteSeatOccupancy(claims, sittingIn);
  }, [visiblePlayers, sittingIn]);

  // Report the union (remote winners + the local seat) upward for the chairs.
  // Keyed on a stable signature so an unchanged occupancy set cannot loop the
  // parent's state update, which would re-render this layer, which would rebuild
  // the set, and so on.
  const occupiedSeats = React.useMemo(
    () => occupiedSeatIds(remoteSeatWinners, sittingIn),
    [remoteSeatWinners, sittingIn],
  );
  const occupiedSeatsSignature = React.useMemo(
    () => Array.from(occupiedSeats).sort().join('|'),
    [occupiedSeats],
  );
  const occupiedSeatsRef = useRef(occupiedSeats);
  occupiedSeatsRef.current = occupiedSeats;
  useEffect(() => {
    // Reads through the ref on purpose: the effect must fire on a change of
    // occupancy CONTENT (the signature), not on every new Set identity.
    void occupiedSeatsSignature;
    onOccupiedSeatsChange?.(occupiedSeatsRef.current);
  }, [occupiedSeatsSignature, onOccupiedSeatsChange]);

  // ── Shared watch session ────────────────────────────────────────────────
  // Publish participation strictly on TRANSITIONS, exactly like the seat above:
  // `setActivity` is rebuilt every render and this layer re-renders whenever any
  // player moves, so without the claim guard the effect would republish the same
  // session several times a second.
  //
  // No retry loop here, deliberately. Unlike a sit — where 25 s of standing in
  // front of your chair is very visible — the only thing a lost activity publish
  // costs is a participant count that is briefly one short, and the next
  // heartbeat carries it anyway. `setActivity` never throws.
  const syncedActivityRef = useRef<string | null>(null);
  useEffect(() => {
    if (disabled || !user) return;
    if (syncedActivityRef.current === activitySession) return;
    syncedActivityRef.current = activitySession;
    void setActivity(activitySession);
  }, [activitySession, disabled, setActivity, user]);

  // How many visible players claim this same session. Presence only — a player
  // who closed their laptop ages out through the existing expiry, with no second
  // timer and no way for this count to disagree with who is in the room.
  const participantCount = React.useMemo(() => {
    if (!activitySession) return 0;
    let remote = 0;
    for (const p of visiblePlayers) {
      if (p.activity?.session === activitySession) remote += 1;
    }
    return remote + 1; // the local player
  }, [activitySession, visiblePlayers]);

  useEffect(() => {
    onSessionParticipantsChange?.(participantCount);
  }, [onSessionParticipantsChange, participantCount]);

  // track last positions to infer heading (prevents weird flips on vertical moves)
  const lastPosRef = React.useRef(new Map<string, Position>());

  // Latest visible players, mirrored into a ref so the gaze timer can read them
  // without re-subscribing the interval on every render.
  const visiblePlayersRef = React.useRef(visiblePlayers);
  visiblePlayersRef.current = visiblePlayers;

  // Per-Blobbi attention *decision* (key -> AttentionState), refreshed by the
  // throttled timer below — never per animation frame. Stores target IDENTITY
  // (targetKey), not a frozen position, so sprites can resolve the target's
  // *live* position at render time and track a moving Blobbi continuously.
  const nearbyGazeRef = React.useRef(new Map<string, AttentionState>());
  // Per-Blobbi attention memory (key -> AttentionState), the persistent state
  // the resolver reads/writes each tick so attention can track the most
  // recently active Blobbi and linger briefly after it goes quiet. `null` key
  // is reserved for the local Blobbi's own attention.
  const attentionRef = React.useRef(new Map<string, AttentionState>());
  // Last movement heading (normalized) per player, used by the sprite to look
  // where it is walking. Updated in render (cheap) since position only changes
  // while moving — which already re-renders the parent.
  const headingRef = React.useRef(new Map<string, GazeOffset>());
  const NEARBY_GAZE_INTERVAL_MS = 400;
  const NEARBY_GAZE_THRESHOLD = 18; // percent-units distance
  const NEARBY_GAZE_THRESHOLD_SQ = NEARBY_GAZE_THRESHOLD * NEARBY_GAZE_THRESHOLD;

  const computeNearbyGaze = useCallback(() => {
    const remotes = visiblePlayersRef.current;
    const now = performance.now();

    // Unified candidate set: every remote Blobbi PLUS the local Blobbi. Each
    // entry exposes its position and activity so the same attention resolver
    // applies uniformly — this is what lets remotes notice and look at the
    // local Blobbi when it walks nearby (and vice-versa).
    // Players hidden inside a hiding spot are not part of the scene visually, so
    // they must not attract anyone's gaze — otherwise every nearby Blobbi would
    // stare straight at the bush and give the hiding player away.
    const candidates: GazeCandidate[] = remotes
      .filter((p) => !p.hiddenIn)
      .map((p) => ({
        key: `${p.pubkey}:${p.sessionId}`,
        position: p.position,
        activity: { isMoving: p.isMoving },
      }));

    // Include the local Blobbi as a candidate target (and as a "self" that
    // looks around). Position comes from myPosRef; activity from MovableBlobbi.
    const local = localActiveRef?.current ?? null;
    const localCandidate: GazeCandidate | null = localActiveRef
      ? {
          key: null,
          position: local?.position ?? myPosRef.current,
          activity: { isMoving: local?.isMoving ?? false },
        }
      : null;
    if (localCandidate) candidates.push(localCandidate);

    // Run the shared attention resolver for one "self": pull its remembered
    // AttentionState, resolve against all candidates, store the updated state.
    // All gaze decisions go through resolveAttention — the single source of
    // truth — so future activity kinds (emotes, interactions, actions) are
    // picked up everywhere automatically via activityPriority.
    const attention = attentionRef.current;
    const seenKeys = new Set<string>();
    const resolveFor = (self: GazeCandidate, stateKey: string): AttentionState => {
      seenKeys.add(stateKey);
      const prev = attention.get(stateKey) ?? emptyAttention();
      const nextState = resolveAttention(
        self,
        candidates,
        prev,
        now,
        NEARBY_GAZE_THRESHOLD_SQ,
      );
      attention.set(stateKey, nextState);
      return nextState;
    };

    // Seed live positions only for keys not already present (e.g. a brand-new
    // candidate before the rAF loop has written it). We do NOT overwrite or
    // clear existing entries: the presence rAF loop (and the local frame write)
    // are the authoritative ~60fps live source, and clobbering them here with
    // throttled candidate snapshots would reintroduce gaze lag. Stale keys for
    // departed players are pruned via the attention-map cleanup below; the live
    // map self-heals as the rAF loop only writes current candidates.
    const live = livePositionsRef.current;
    for (const c of candidates) {
      const k = c.key === null ? LOCAL_ATTENTION_KEY : c.key;
      if (!live.has(k)) live.set(k, c.position);
    }

    // Remote Blobbis: resolve each one's attention *decision* (target identity),
    // keyed by player. A target that goes inactive lingers for ATTENTION_HOLD_MS,
    // then releases, so the sprite falls back to movement heading / idle gaze.
    // Sprites resolve the target's *live* position at render time.
    const next = new Map<string, AttentionState>();
    for (const self of candidates) {
      if (self.key === null) continue; // local handled below
      next.set(self.key, resolveFor(self, self.key));
    }
    nearbyGazeRef.current = next;

    // Local Blobbi: resolve its attention *decision* (target identity) under the
    // reserved local key and store it. MovableBlobbi resolves the live target
    // position each frame from localAttentionRef + livePositionsRef — the same
    // identity-based path remote Blobbis use.
    if (localCandidate) {
      localAttentionRef.current = resolveFor(localCandidate, LOCAL_ATTENTION_KEY);
    }

    // Drop attention memory for Blobbis that are no longer candidates, so the
    // map can't grow unbounded as players come and go. Prune the live-positions
    // map by the same set (remote keys + the local key match between the two).
    for (const key of attention.keys()) {
      if (!seenKeys.has(key)) attention.delete(key);
    }
    for (const key of live.keys()) {
      if (!seenKeys.has(key)) live.delete(key);
    }
  }, [NEARBY_GAZE_THRESHOLD_SQ, localActiveRef, myPosRef, livePositionsRef, localAttentionRef]);

  // Drive nearby-gaze updates on a lightweight timer (not on render). This keeps
  // nearbyGazeRef + localAttentionRef fresh even when nothing is moving (so the
  // parent isn't re-rendering), without any per-frame state updates.
  useEffect(() => {
    computeNearbyGaze(); // prime immediately
    const id = setInterval(computeNearbyGaze, NEARBY_GAZE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [computeNearbyGaze]);

  // Background file for the current location — the canonical resolver, the
  // same one PlayingView renders with, so a remote Blobbi's depth/z math can
  // never disagree with the room the local player is looking at.
  const backgroundFile = useMemo(() => getBackgroundForLocation(currentLocation), [currentLocation]);

  // Get boundary for current location
  const boundary = useMemo(() => {
    return locationBoundaries[backgroundFile];
  }, [backgroundFile]);

  // Sprite size for this room — the SAME value MovableBlobbi gives the local
  // player, so a remote Blobbi is drawn at the size its owner sees.
  const blobbiSize = useMemo(() => getBlobbiSizeForLocation(currentLocation), [currentLocation]);

  // Depth scale at an arbitrary point, shared with MovableBlobbi so a remote
  // Blobbi is drawn exactly as its owner sees it. Pose-driven presentation
  // (position/scale/z/facing/shadow/float) comes from `resolveActorRender`;
  // this remains only for gaze endpoints, which need the scale at OTHER
  // points than the actor's own.
  const getDynamicScale = useCallback(
    (currentPos: Position): number => resolveBlobbiScale(currentPos, backgroundFile, boundary),
    [backgroundFile, boundary],
  );

  // ============================================================================
  // Render
  // ============================================================================

  const getAnchorEl = useCallback((playerKey: string) => {
    const container = containerRef.current;
    if (!container) return null;
    if (playerKey === 'me') {
      const id = myAnchorId ?? 'my-blobbi-anchor';
      return container.querySelector<HTMLElement>(`#${id}`);
    }
    const key = playerKey.endsWith(':pending')
      ? anchorIndexRef.current.get(playerKey.slice(0, -':pending'.length)) ?? ''
      : playerKey;
    if (!key) return null;
    return container.querySelector<HTMLElement>(`[data-player-key="${key}"]`);
  }, [containerRef, myAnchorId]);

  if (!user || disabled) return null

  if (error) { console.error('Multiplayer error:', error); return null;  }

  // Backstop for the local Blobbi's live position. The authoritative live write
  // is MovableBlobbi's per-frame effect (under LOCAL_ATTENTION_KEY); this just
  // refreshes it on render passes / when MovableBlobbi isn't wired to this ref.
  {
    const localPos = localActiveRef?.current?.position ?? myPosRef.current;
    if (localPos) livePositionsRef.current.set(LOCAL_ATTENTION_KEY, localPos);
  }

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      {/* Render other players */}
      {visiblePlayers.map((player, idx) => {
        if (DEBUG_MP && (idx % 8 === 0)) {
          if (DEBUG_MP) console.debug('[blobbi][mp][render] remote', {
            key: `${player.pubkey}:${player.sessionId}`,
            hasVisual: !!player.visual,
            name: player.visual?.name,
            animPos: player.position,
            isMoving: player.isMoving
          });
        }

        // Remote pose, derived from EXPLICIT presence fields only (never from
        // coordinates): a hiding spot id means hidden; a seat id means seated
        // only if this player WON the seat (see theater-occupancy) — a seat
        // lost to another claimant, and any unknown/stale/decorative id, falls
        // back to standing at the presence position rather than snapping to
        // some arbitrary chair.
        const seatWinner = player.seatId ? remoteSeatWinners.get(player.seatId) : undefined;
        const ownsSeat =
          seatWinner?.pubkey === player.pubkey && seatWinner?.sessionId === player.sessionId;
        const remotePose: BlobbiActorPose = player.hiddenIn
          ? { kind: 'hidden', spotId: player.hiddenIn }
          : ownsSeat && player.seatId
            ? { kind: 'seated', seatId: player.seatId }
            : { kind: 'standing' };

        // The complete visual consequence of that pose, from the SAME pure
        // resolver the local Blobbi renders through (src/lib/blobbi-pose.ts):
        // seat pose anchor + row z + per-row scale while seated, depth ramp and
        // y-band z otherwise, float suppressed while the presence rAF is
        // integrating movement.
        const render = resolveActorRender(remotePose, {
          groundPosition: player.position,
          backgroundFile,
          boundary,
          scaleByYPosition: true,
          suppressFloat: player.isMoving,
        });

        if (DEBUG_MP && player.seatId && !render.seatedIn) {
          console.debug('[blobbi][mp][seat] ignoring unusable seat claim', {
            pubkey: player.pubkey,
            seatId: player.seatId,
            reason: ownsSeat ? 'unknown or decorative seat' : 'seat claimed by another player',
          });
        }

        const renderPos = render.renderPosition;
        const dynamicZIndex = render.zIndex;
        const dynamicScale = render.scale;

        // Determine heading from last position to drive eye gaze, and store it
        // in headingRef so RemoteBlobbiSprite can read it on its own re-renders.
        // (Position only changes while moving, which already re-renders here.)
        const keyId = `${player.pubkey}:${player.sessionId}`;
        const last = lastPosRef.current.get(keyId) ?? player.position;
        const dx = player.position.x - last.x;
        const dy = player.position.y - last.y;
        lastPosRef.current.set(keyId, player.position);

        // Backstop write of the live-positions map in render. The authoritative
        // live source is the presence rAF loop (useIslandPresence), which writes
        // every frame; this just seeds/refreshes the entry on render passes too.
        livePositionsRef.current.set(keyId, player.position);

        if (player.isMoving && (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05)) {
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          headingRef.current.set(keyId, { x: dx / len, y: dy / len });
        }

        // This player is hidden inside a hiding spot (explicit presence state,
        // never inferred from position). Render ONLY the positioned anchor — no
        // sprite, no ground shadow, no name label — so nothing of their Blobbi
        // exists in the DOM while hidden. The anchor stays so their chat bubbles
        // still have somewhere to portal into.
        //
        // Read from the RESOLVED presentation, not from `player.hiddenIn`
        // directly: `resolveActorRender` is the single source of visual truth
        // for both wrappers (the local `MovableBlobbi` already reads
        // `render.visualHidden`), so the two paths cannot drift if the pose →
        // visual mapping ever gains a case. Presence interpretation is
        // unchanged — `hiddenIn` still, and only, produces the hidden pose above.
        const isHiddenInSpot = render.visualHidden;

        return (
          <BlobbiActor
            key={`${player.pubkey}:${player.sessionId}`}
            playerKey={`${player.pubkey}:${player.sessionId}`}
            position={renderPos}
            size={blobbiSize}
            scale={dynamicScale}
            zIndex={dynamicZIndex}
            seatedIn={render.seatedIn}
            hiddenIn={render.hiddenIn}
            visualHidden={render.visualHidden}
            hideShadow={render.hideShadow}
            disableFloat={render.disableFloat}
            // Remote positions are integrated per-frame by the presence rAF —
            // the anchor itself never eases.
            positionTransition={false}
            className={cn(
              "group",
              isHiddenInSpot ? "pointer-events-none" : "pointer-events-auto",
            )}
            labelSlot={
              !isHiddenInSpot && player.visual?.name ? (
                // Above the RENDERED body: the box is unscaled, so the visual
                // top sits at scale×100% of the box above the ground anchor.
                <div
                  className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
                  style={{ bottom: `calc(${dynamicScale * 100}% + 8px)` }}
                >
                  <div
                    className="bg-black/75 text-white text-xs px-2 py-1 rounded-full whitespace-nowrap
                               opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    aria-label={player.visual.name}
                    title={player.visual.name}
                  >
                    {player.visual.name}
                  </div>
                </div>
              ) : null
            }
          >
            {/* SPRITE – hover/click target */}
            <div
              className="peer pointer-events-auto select-none cursor-pointer"
              data-block-move="true"
              onPointerDown={(e) => {
                e.stopPropagation();
                if (!onOtherBlobbiClick) return;
                const visual = player.visual;
                if (!visual) return;
                void (async () => {
                  // ⚠️ Só prossegue se houver d-tag válida
                  const blobbiD = await resolveBlobbiD(player as PlayerLike);
                  if (!blobbiD) {
                    if (import.meta.env.MODE === 'development') {
                      console.warn('[blobbi][mp] blobbiD not found, skipping details fetch', {
                        pubkey: player.pubkey, sessionId: player.sessionId
                      });
                    }
                    return;
                  }
                  if (DEBUG_MP) console.log('[blobbi-debug][click] Remote Blobbi clicked:', {
                    pubkey: player.pubkey,
                    sessionId: player.sessionId,
                    blobbiD,
                    visualName: visual.name,
                    visualStage: visual.stage,
                    timestamp: new Date().toISOString()
                  });
                  onOtherBlobbiClick(player.pubkey, blobbiD, visual);
                  if (import.meta.env.MODE === 'development') {
                    console.debug('[blobbi][click] remote blobbi clicked', player.pubkey, blobbiD);
                  }
                })();
              }}
            >
              <RemoteBlobbiSprite
                visual={player.visual}
                isMoving={player.isMoving}
                position={renderPos}
                playerKey={keyId}
                nearbyGazeRef={nearbyGazeRef}
                livePositionsRef={livePositionsRef}
                headingRef={headingRef}
                idSuffix={`${player.pubkey}-${player.sessionId}`}
                facing={render.facing}
                size={blobbiSize}
                scale={dynamicScale}
                scaleAt={getDynamicScale}
              />
            </div>
          </BlobbiActor>
        );
      })}

      {/* Chat Bubbles Layer */}
      <ChatBubblesLayer
        bubbles={bubbles}
        getAnchorEl={getAnchorEl}
      />

      {/* Debug info (developer overlays toggle) */}
      {showDebugOverlays && (
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