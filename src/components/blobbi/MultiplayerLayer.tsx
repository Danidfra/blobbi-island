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
import { isBlobbiActive, type BlobbiActivity, type LocalActiveState } from '@/lib/gaze';
import type { BlobbiVisual } from '@/lib/multiplayer';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { CurrentBlobbiDisplay } from './CurrentBlobbiDisplay';
import { useIdleGaze } from '@/hooks/useIdleGaze';
import { cn } from '@/lib/utils';
import { nameFromDTag } from '@/lib/blobbi-name';
import { calculateBlobbiZIndex } from '@/lib/interactive-elements-config';
import { locationScalingConfig } from '@/lib/location-scaling-config';
import { createWalkableApi } from '@/lib/multiplayer';
import { locationBoundaries } from '@/lib/location-boundaries';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';
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
  headingRef,
  idSuffix,
}: {
  visual?: BlobbiVisual;
  isMoving: boolean;
  /** Current position (percent). Only changes while moving, which already re-renders. */
  position: Position;
  playerKey: string;
  /** Shared map of nearby gaze targets (percent), refreshed by a throttled timer. */
  nearbyGazeRef: React.MutableRefObject<Map<string, Position>>;
  /** Shared map of last movement headings (normalized) per player. */
  headingRef: React.MutableRefObject<Map<string, GazeOffset>>;
  idSuffix: string;
}) {
  // Idle gaze is active whenever the Blobbi is standing still. While idle it
  // drives ~60fps re-renders of *this* sprite only, and each render re-reads
  // the shared refs below — so a stationary Blobbi keeps reacting to passers.
  const idleGaze = useIdleGaze(!isMoving);

  // Resolve gaze priority on every render from the latest ref values:
  //   nearby moving Blobbi -> movement heading -> idle micro-movement.
  let eyeOffset: GazeOffset = idleGaze;

  const nearbyTarget = nearbyGazeRef.current.get(playerKey) ?? null;
  if (nearbyTarget) {
    const tx = nearbyTarget.x - position.x;
    const ty = nearbyTarget.y - position.y;
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    eyeOffset = { x: tx / len, y: ty / len };
  } else if (isMoving) {
    const heading = headingRef.current.get(playerKey);
    if (heading && (Math.abs(heading.x) > 0.01 || Math.abs(heading.y) > 0.01)) {
      eyeOffset = heading;
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
   * Optional shared ref written with the local Blobbi's nearby-gaze target
   * (the nearest moving remote Blobbi within range, or null). MovableBlobbi
   * reads this each frame so the local Blobbi can glance at passing Blobbis.
   * Using a ref avoids triggering re-renders on the ~400ms gaze cadence.
   */
  localGazeTargetRef?: React.MutableRefObject<Position | null>;
  /**
   * Optional shared ref carrying the local Blobbi's current position and
   * activity (written by MovableBlobbi each frame). MultiplayerLayer reads it
   * during the throttled gaze pass so remote Blobbis can treat the local
   * player as a nearby *active* gaze target (e.g. look at it while it walks).
   * null while the local Blobbi isn't mounted/visible.
   */
  localActiveRef?: React.MutableRefObject<LocalActiveState | null>;
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
  localGazeTargetRef,
  localActiveRef,
}: MultiplayerLayerProps) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { currentLocation } = useLocation();
  const { isPositionBlocked } = useMovementBlocker();

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
    const name = nameFromDTag(dTag) || get('name') || 'Unnamed Blobbi';
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
  }, [containerRef, isPositionBlocked, navApi]);

  const pixelToPercent = useCallback((p: {x:number; y:number}) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 75 };
    return { x: (p.x / rect.width) * 100, y: (p.y / rect.height) * 100 };
  }, [containerRef, isPositionBlocked, navApi]);

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
      if (DEBUG_MP) {
        console.debug('[blobbi][chat] publish results', { successful, total: results.length });
      }

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
      console.debug('[blobbi][mp][render] players size', players.size);
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

  // "Glance at a nearby moving Blobbi" gaze targets, keyed by player. Refreshed
  // by a throttled timer (below) — never per animation frame, and crucially
  // even when no player is moving, so a stationary Blobbi notices passers.
  const nearbyGazeRef = React.useRef(new Map<string, Position>());
  // Last movement heading (normalized) per player, used by the sprite to look
  // where it is walking. Updated in render (cheap) since position only changes
  // while moving — which already re-renders the parent.
  const headingRef = React.useRef(new Map<string, GazeOffset>());
  const NEARBY_GAZE_INTERVAL_MS = 400;
  const NEARBY_GAZE_THRESHOLD = 18; // percent-units distance
  const NEARBY_GAZE_THRESHOLD_SQ = NEARBY_GAZE_THRESHOLD * NEARBY_GAZE_THRESHOLD;

  const computeNearbyGaze = useCallback(() => {
    const remotes = visiblePlayersRef.current;

    // Unified candidate set: every remote Blobbi PLUS the local Blobbi. Each
    // entry exposes its position and activity so the same nearest-active-target
    // rule applies uniformly — this is what lets remotes notice and look at the
    // local Blobbi when it walks nearby (and vice-versa).
    type GazeCandidate = {
      key: string | null; // null = local Blobbi (handled via localGazeTargetRef)
      position: Position;
      activity: BlobbiActivity;
    };

    const candidates: GazeCandidate[] = remotes.map((p) => ({
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

    // For a given "self", find the nearest OTHER *active* candidate within range.
    const nearestActiveTarget = (self: GazeCandidate): Position | null => {
      let bestSq = NEARBY_GAZE_THRESHOLD_SQ;
      let bestPos: Position | null = null;
      for (const other of candidates) {
        if (other === self) continue;
        if (!isBlobbiActive(other.activity)) continue; // only look at active Blobbis
        const dx = other.position.x - self.position.x;
        const dy = other.position.y - self.position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestSq) {
          bestSq = distSq;
          bestPos = other.position;
        }
      }
      return bestPos;
    };

    // Remote Blobbis: store each one's nearest active target (keyed by player).
    // Rebuilt fresh each tick — when a target goes inactive it simply drops out,
    // so the sprite falls back to movement heading / idle gaze automatically.
    const next = new Map<string, Position>();
    for (const self of candidates) {
      if (self.key === null) continue; // local handled below
      const bestPos = nearestActiveTarget(self);
      if (bestPos) next.set(self.key, bestPos);
    }
    nearbyGazeRef.current = next;

    // Local Blobbi: nearest active candidate (remote) within range, or null.
    // Cleared to null when nothing nearby is active → MovableBlobbi reverts to
    // movement heading / idle gaze.
    if (localGazeTargetRef && localCandidate) {
      localGazeTargetRef.current = nearestActiveTarget(localCandidate);
    }
  }, [NEARBY_GAZE_THRESHOLD_SQ, localGazeTargetRef, localActiveRef, myPosRef]);

  // Drive nearby-gaze updates on a lightweight timer (not on render). This keeps
  // nearbyGazeRef + localGazeTargetRef fresh even when nothing is moving (so the
  // parent isn't re-rendering), without any per-frame state updates.
  useEffect(() => {
    computeNearbyGaze(); // prime immediately
    const id = setInterval(computeNearbyGaze, NEARBY_GAZE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [computeNearbyGaze]);

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

        // Determine heading from last position to drive eye gaze, and store it
        // in headingRef so RemoteBlobbiSprite can read it on its own re-renders.
        // (Position only changes while moving, which already re-renders here.)
        const keyId = `${player.pubkey}:${player.sessionId}`;
        const last = lastPosRef.current.get(keyId) ?? player.position;
        const dx = player.position.x - last.x;
        const dy = player.position.y - last.y;
        lastPosRef.current.set(keyId, player.position);

        if (player.isMoving && (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05)) {
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          headingRef.current.set(keyId, { x: dx / len, y: dy / len });
        }

        return (
          <div
            key={`${player.pubkey}:${player.sessionId}`}
            className="absolute pointer-events-auto group"
            data-player-key={`${player.pubkey}:${player.sessionId}`}
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
                  console.log('[blobbi-debug][click] Remote Blobbi clicked:', {
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
        </div>
        );
      })}

      {/* Chat Bubbles Layer */}
      <ChatBubblesLayer
        bubbles={bubbles}
        getAnchorEl={getAnchorEl}
      />

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