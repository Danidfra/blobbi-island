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
import { CurrentBlobbiDisplay } from './CurrentBlobbiDisplay';
import { useIdleGaze } from '@/hooks/useIdleGaze';
import { cn } from '@/lib/utils';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import { resolveBlobbiScale, resolveBlobbiZIndex } from '@/lib/blobbi-world-render';
import { createWalkableApi } from '@/lib/multiplayer';
import { locationBoundaries } from '@/lib/location-boundaries';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';
import { useDebugOverlays } from '@/contexts/DebugOverlaysContext';
import { WORLD_WIDTH } from '@/components/shell/VirtualWorld';
import { DOCK_EVENTS, type PresenceMoveDetail } from '@/components/shell/dock-events';
import { ChatBubblesLayer } from '@/components/ChatBubblesLayer';
import { useChatBubbles } from '@/hooks/useChatBubbles';
import { CHAT_KIND, CHAT_EVICT_MS, CHAT_RATE_LIMIT_MS } from '@/lib/chat-config';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';

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
      const tx = attentionTarget.x - position.x;
      const ty = attentionTarget.y - position.y;
      const len = Math.sqrt(tx * tx + ty * ty) || 1;
      eyeOffset = { x: tx / len, y: ty / len };
    }
  }

  return (
    <CurrentBlobbiDisplay
      size="lg"
      visualOverride={visual || {
        baseColor: '#4F46E5',
        secondaryColor: '#7C3AED',
        eyeColor: '#1F2937',
        stage: 'baby',
      }}
      transparent
      showAccessories={false}
      className={cn(isMoving && "scale-105")}
      idSuffix={idSuffix}
      eyeOffset={eyeOffset}
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
  chatFunctionRef?: React.MutableRefObject<((text: string) => Promise<void>) | null>;
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
  chatFunctionRef,
  myAnchorId,
  onOtherBlobbiClick,
  hiddenIn = null,
  localAttentionRef: localAttentionRefProp,
  livePositionsRef: livePositionsRefProp,
  localActiveRef,
}: MultiplayerLayerProps) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
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
  const lastChatPublishRef = useRef<number>(0);
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
    isDuplicate,
  } = useChatBubbles();

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
  // Chat Message Publishing
  // ============================================================================

  const publishChatMessage = useCallback(async (text: string): Promise<void> => {
    if (!user || !text.trim()) return;

    const now = Date.now();

    // Rate limiting
    if (now - lastChatPublishRef.current < CHAT_RATE_LIMIT_MS) {
      throw new Error('Rate limited: Please wait before sending another message');
    }

    const expirationTime = Math.floor((now + CHAT_EVICT_MS) / 1000);

    const content = JSON.stringify({
      type: 'chat',
      location: currentLocation,
      blobbiD: currentBlobbiD,
      text: text.trim(),
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
        ['alt', `Chat message: ${text.slice(0, 50)}${text.length > 50 ? '...' : ''}`],
      ],
    };

    try {
      // Use Promise.allSettled for non-fatal publish attempts
      const results = await Promise.allSettled([publishEvent(event)]);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      if (DEBUG_MP) console.debug('[blobbi][chat] publish results', { successful, total: results.length });

      // Update rate limit timestamp even on partial success
      lastChatPublishRef.current = now;

      // Show local bubble immediately (optimistic)
      showBubble('me', text, now + CHAT_EVICT_MS);

    } catch (error) {
      console.error('Failed to publish chat message:', error);
      throw error;
    }
  }, [user, currentLocation, currentBlobbiD, islandId, publishEvent, showBubble, sessionId]);

  // ============================================================================
  // Chat Event Processing
  // ============================================================================

  const processChatEvent = useCallback((event: NostrEvent) => {
    try {
      if (event.kind !== CHAT_KIND) return;

      // Skip own events
      if (event.pubkey === user?.pubkey) return;

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

      let content;
      try {
        content = JSON.parse(event.content);
      } catch {
        return; // Invalid JSON
      }

      // Validate content structure
      if (content.type !== 'chat' ||
          content.location !== currentLocation ||
          !content.text ||
          typeof content.text !== 'string') {
        return;
      }

      // Sanitize text (remove HTML, trim)
      const sanitizedText = content.text.replace(/<[^>]*>/g, '').trim();
      if (!sanitizedText) return;

      // Dedupe by session ID
      const dTag = event.tags.find(([name]) => name === 'd')?.[1];
      if (!dTag) return;

      const dedupeKey = `${event.pubkey}:${dTag}`;
      if (isDuplicate(dedupeKey)) {
        if (DEBUG_MP) console.debug('[blobbi][chat] duplicate message ignored', { dedupeKey });
        return;
      }

      const expiresAt = expirationTag ? parseInt(expirationTag) * 1000 : (now + CHAT_EVICT_MS);
      queueBubble(`${event.pubkey}:pending`, sanitizedText, expiresAt);
    } catch (error) {
      console.error('Error processing chat event:', error);
    }
  }, [user?.pubkey, currentLocation, queueBubble, isDuplicate]);

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

  // Clear bubbles when location changes
  useEffect(() => {
    clearBubbles();
  }, [currentLocation, clearBubbles]);

  // Expose chat function to parent
  useEffect(() => {
    if (chatFunctionRef) {
      chatFunctionRef.current = publishChatMessage;
    }
    return () => {
      if (chatFunctionRef) {
        chatFunctionRef.current = null;
      }
    };
  }, [chatFunctionRef, publishChatMessage]);

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

  const shouldTriggerWorldMove = useCallback((ev: MouseEvent | TouchEvent | PointerEvent): boolean => {
    const container = containerRef.current;
    if (!container) return false;

    const isPrimaryPointer = (ev: MouseEvent | PointerEvent) =>
      (!('button' in ev) || ev.button === 0) &&
      !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey;

    const path = (ev as PointerEvent | MouseEvent).composedPath?.() as Element[] | undefined;
    const chain: Element[] =
      path?.filter((n) => n instanceof Element) as Element[] ??
      (ev.target instanceof Element ? [ev.target] : []);

    const BLOCK_UI_SELECTOR = [
      '[data-block-move]',
      '[data-overlay]',
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[role="menu"]',
      '[role="button"]',
      'button',
      'a[href]',
      'input, textarea, select',
      '.modal',
      '.drawer',
      '.popover',
      '.tooltip',
      '.map-ui'
    ].join(',');

    for (const el of chain) {
      if (el.matches?.(BLOCK_UI_SELECTOR)) return false;
      if (el !== container && el.hasAttribute?.('data-world-surface')) return false;
      // Check if click is on a player sprite (which has data-player-key attribute)
      if (el.closest?.('[data-player-key]')) return false;
    }

    if (!(ev.target instanceof Node) || !container.contains(ev.target)) return false;

    if ((ev instanceof MouseEvent || (window.PointerEvent && ev instanceof PointerEvent)) && !isPrimaryPointer(ev)) return false;

    return true;
  }, [containerRef]);

  const handleContainerClick = useCallback(async (event: MouseEvent | TouchEvent | PointerEvent) => {
    if (disabled || !user || clickHandledRef.current) {
      return;
    }

    // Check if this click should trigger world movement
    if (!shouldTriggerWorldMove(event)) {
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
  }, [disabled, user, containerRef, getPercentPosition, moveTo, onMyPositionChange, myPosRef, shouldTriggerWorldMove]);

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

  // Get background file for current location
  const backgroundFile = useMemo(() => {
    const locationToFile: Record<string, string> = {
      'town': 'town-open.webp',
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
    return locationToFile[currentLocation] || 'town-open.webp';
  }, [currentLocation]);

  // Get boundary for current location
  const boundary = useMemo(() => {
    return locationBoundaries[backgroundFile];
  }, [backgroundFile]);

  // Dynamic z-index and scaling, shared with MovableBlobbi so a remote Blobbi
  // is drawn exactly as its owner sees it (`src/lib/blobbi-world-render.ts`).
  const getDynamicZIndex = useCallback(
    (currentPos: Position, sitOffset = 0): number =>
      resolveBlobbiZIndex(currentPos, backgroundFile, sitOffset),
    [backgroundFile],
  );

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

        // Calculate dynamic z-index and scale (same as MovableBlobbi)
        const dynamicZIndex = getDynamicZIndex(player.position);
        const dynamicScale = getDynamicScale(player.position);

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
        const isHiddenInSpot = !!player.hiddenIn;

        return (
          <div
            key={`${player.pubkey}:${player.sessionId}`}
            className={cn(
              "absolute group",
              isHiddenInSpot ? "pointer-events-none" : "pointer-events-auto",
            )}
            data-player-key={`${player.pubkey}:${player.sessionId}`}
            data-hidden-in={player.hiddenIn}
            style={{
              left: `${player.position.x}%`,
              top: `${player.position.y}%`,
              transform: `translate(-50%, -50%)`,  // ⬅️ no scale/flip here
              zIndex: dynamicZIndex,
              filter: isHiddenInSpot ? undefined : 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.15))',
            }}
          >
            {!isHiddenInSpot && (
            <>
            {/* SPRITE – hover target (peer) */}
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
              style={{
                transform: `scale(${dynamicScale})`,
                transformOrigin: 'center center',
              }}
            >
          <div className={cn(
            !player.isMoving && "animate-float",
            "transition-transform duration-1000 ease-in-out"
          )}>
            <RemoteBlobbiSprite
              visual={player.visual}
              isMoving={player.isMoving}
              position={player.position}
              playerKey={keyId}
              nearbyGazeRef={nearbyGazeRef}
              livePositionsRef={livePositionsRef}
              headingRef={headingRef}
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
              transform: `translateX(-50%) scale(${dynamicScale})`,
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
            </>
            )}
        </div>
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