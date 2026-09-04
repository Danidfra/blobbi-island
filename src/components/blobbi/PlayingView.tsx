import React, { useCallback, useRef, useState, useEffect } from 'react';
import { PlaceBackground } from './PlaceBackground';
import { ArcadePassIcon } from './ArcadePassIcon';
import { ArcadeTicketBalance } from './ArcadeTicketBalance';
import { MovableBlobbi, MovableBlobbiRef } from './MovableBlobbi';

import { InteractiveElements } from './InteractiveElements';
import { useLocation } from '@/hooks/useLocation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { forgetWatchSession } from '@/hooks/useSharedPlayback';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import type { Blobbi } from '@/hooks/useBlobbis';
import { Furniture } from './Furniture';
import { Position } from '@/lib/types';
import type { LocalActiveState, AttentionState } from '@/lib/gaze';
import { emptyAttention } from '@/lib/gaze';
import { RefrigeratorModal } from './RefrigeratorModal';
import { ChestModal } from './ChestModal';
import { BlobbiInfoModal } from './BlobbiInfoModal';
import { SocialShareModal } from './SocialShareModal';
import { getBlobbiSizeForLocation } from '@/lib/location-blobbi-sizes';
import { useBlobbiPoseController } from '@/hooks/useBlobbiPoseController';
import { BoundaryVisualizer } from './BoundaryVisualizer';
import { MiningGame } from './MiningGame';
import { resolveActorSpawn } from '@/lib/location-initial-position';
import { MultiplayerLayer } from './MultiplayerLayer';
import { useNostr } from '@/hooks/useNostr';
import type { BlobbiVisual } from '@/lib/multiplayer';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';
import { getBlobbiDisplayName } from '@/lib/blobbi-legacy';
import { dbg } from '@/lib/debug';
import { useDebugOverlays } from '@/contexts/DebugOverlaysContext';
import { DOCK_EVENTS } from '@/components/shell/dock-events';
import { CommunicationPanel } from './communication/CommunicationPanel';
import type { IslandMessage } from '@/communication';
import { PlayerSafetyActions } from './player-safety/PlayerSafetyActions';
import { isBlocked, subscribeRelationships } from '@/player-safety';
import { resolveRemoteBlobbiDisplayName } from '@/blobbi-names';
import { useIslandSafetyPolicy } from '@/safety';
import { DEFAULT_ISLAND_ID } from '@/lib/multiplayer';

interface PlayingViewProps {
  selectedBlobbi: Blobbi | null;
}

type Stage = 'egg' | 'baby' | 'adult';
const normalizeStage = (s: unknown, fallback: Stage = 'baby'): Stage => {
  return s === 'egg' || s === 'baby' || s === 'adult' ? s : fallback;
};
const getTag = (event: { tags: string[][] }, name: string): string | undefined => {
  const t = event.tags.find(([n]) => n === name);
  return t?.[1];
};

export function PlayingView({ selectedBlobbi }: PlayingViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);
  // Local Blobbi's attention *decision* (target identity) + the live positions
  // map. MovableBlobbi resolves the target's CURRENT position from these each
  // frame, so the local Blobbi tracks a moving target continuously, the exact
  // same mechanism RemoteBlobbiSprite uses, so local and remote can't diverge.
  const localAttentionRef = useRef<AttentionState>(emptyAttention());
  const livePositionsRef = useRef(new Map<string, Position>());
  // Shared snapshot of the local Blobbi (position + activity), written by
  // MovableBlobbi and read by MultiplayerLayer so remote Blobbis can look at
  // the local player when it walks (or, later, emotes/acts) nearby.
  const localActiveRef = useRef<LocalActiveState | null>(null);
  /**
   * The single publisher for every message class, filled in by
   * `MultiplayerLayer` (which owns the relay connection) and consumed by the
   * communication panel below.
   */
  const sendMessageRef = useRef<((message: IslandMessage) => Promise<boolean>) | null>(null);
  const [isCommunicationOpen, setIsCommunicationOpen] = useState(false);
  const { currentLocation, previousLocation, bootstrapPosition } = useLocation();
  const { user } = useCurrentUser();
  const policy = useIslandSafetyPolicy();
  const { nostr } = useNostr();
  const { showDebugOverlays } = useDebugOverlays();
  const [modalKey, setModalKey] = useState<string>('self');
  const currentRemoteRef = useRef<{ pubkey: string; d: string } | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // NOTE: leaving the arcade no longer revokes the Arcade Pass.
  //
  // The pass used to be a visit-scoped waiver bought for 20 coins, so walking
  // out ended it. It is now a 24-HOUR entitlement redeemed with Arcade Tickets,
  // and its only boundary is its expiry. Revoking it on the way out would
  // destroy something the player paid a day's worth of tickets for the moment
  // they stepped into Town.
  const [isRefrigeratorOpen, setIsRefrigeratorOpen] = useState(false);
  const [isChestOpen, setIsChestOpen] = useState(false);
  const [isBlobbiInfoOpen, setIsBlobbiInfoOpen] = useState(false);
  const [isSocialShareOpen, setIsSocialShareOpen] = useState(false);
  const [socialShareData, setSocialShareData] = useState<{ capturedPhoto: string | null; capturedPolaroidSrc: string | null }>({ capturedPhoto: null, capturedPolaroidSrc: null });
  const [readOnlyBlobbiData, setReadOnlyBlobbiData] = useState<{
    name: string;
    stage: string;
    hunger: number;
    energy: number;
    happiness: number;
    health: number;
    hygiene: number;
    experience: number;
    careStreak: number;
    generation: number;
    personality?: string | string[];
    trait?: string | string[];
    mood?: string;
    isSleeping?: boolean;
  } | null>(null);

  /**
   * Whose card is open, when it is another player's.
   *
   * Held in state rather than only in `currentRemoteRef` because the safety
   * actions and the block-eviction effect below both need to re-render on it,
   * a ref would leave the card showing someone who is no longer in the world.
   */
  const [readOnlyPubkey, setReadOnlyPubkey] = useState<string | null>(null);
  const [externalVisual, setExternalVisual] = useState<BlobbiVisual | null>(null);
  const [remotePreviewKey, setRemotePreviewKey] = useState<string | null>(null);

  // The shared watch session the local player is participating in, as the
  // session ADDRESS STRING and nothing else. Owned here for the same reason
  // `sittingIn` is: the theater reports it, presence publishes it, and both need
  // one answer. It is never a copy of playback state, what is playing lives in
  // the session event (see `docs/protocol/shared-playback-session.md` §14).
  const [activitySession, setActivitySession] = useState<string | null>(null);

  // How many visible players presence says are in that session, including this
  // one. Derived by MultiplayerLayer (which holds the live presence map) and
  // lifted here so the theater card can show it. Advisory, like seat occupancy.
  const [sessionParticipants, setSessionParticipants] = useState(1);

  // Theater seats that should LOOK occupied, remote players whose presence
  // claims a seat, plus the local player's own. Derived by MultiplayerLayer
  // (which holds the live presence map) and lifted here so the seats, which are
  // rendered by a sibling, can read a single answer. Purely visual: it reserves
  // nothing and never gates sitting down. See `src/lib/theater-occupancy.ts`.
  const [occupiedSeats, setOccupiedSeats] = useState<Set<string>>(() => new Set());

  // Leaving the location ends participation in whatever was playing in the
  // theater; presence must never point at a session the player has left.
  //
  // This is the ONLY implicit way out of a watch session. Standing up, walking
  // around the theater and changing seats all keep it, the session belongs to
  // being in the room, not to a chair. Leaving the room also forgets the
  // session for good, so walking back in does not silently rejoin it.
  // (Poses: seat, hiding spot, bed, reset inside useBlobbiPoseController.)
  useEffect(() => {
    setActivitySession(null);
    forgetWatchSession(user?.pubkey);
  }, [currentLocation, user?.pubkey]);

  /**
   * LOCAL-ONLY actor suppression for contained minigames (the treasure hunt).
   *
   * Deliberately NOT the pose controller's `hiddenIn`: that state is published
   * to presence (`MultiplayerLayer` calls `hideAt(hiddenIn)`) and means "this
   * player is hidden inside a world hiding spot": remote clients stop drawing
   * the player entirely. Being inside a minigame dialog is not a world state;
   * remote players should keep seeing this Blobbi standing at the shack. This
   * flag only gates the local `MovableBlobbi` render and resets with the
   * location, so a mid-game location change can never strand an invisible
   * actor.
   */
  const [actorSuppressed, setActorSuppressed] = useState(false);
  useEffect(() => {
    setActorSuppressed(false);
  }, [currentLocation]);

  const background = getBackgroundForLocation(currentLocation);
  const blobbiSize = getBlobbiSizeForLocation(currentLocation);
  // A resumed session opens where presence recorded; every other entry uses the
  // scene's canonical spawn. Read at `MovableBlobbi`'s first mount (it is keyed
  // on the location), so the actor's first frame is already right.
  const blobbiInitialPosition = resolveActorSpawn(
    bootstrapPosition,
    currentLocation,
    previousLocation,
  );
  const [myPosition, setMyPosition] = useState<Position>(blobbiInitialPosition);
  const boundary = locationBoundaries[background] || {
    shape: 'rectangle',
    x: [0, 100],
    y: [60, 100],
  };

  // ── Local pose orchestration ────────────────────────────────────────────
  // Sleeping / seated / hidden state, every transition into and out of those
  // poses, and the bed's pending-interaction walk all live in the pose
  // controller; this component just wires its handlers to the world.
  const {
    pose,
    sittingIn,
    hiddenIn,
    bedPosition,
    handleMoveStart,
    handleMoveComplete,
    handleWakeUp,
    sitInSeat,
    hideInSpot,
    requestBedSleep,
    handleBedPositionChange,
  } = useBlobbiPoseController({
    blobbiRef,
    currentLocation,
    boundary,
    onMoveStart: setMyPosition,
    onMoveComplete: setMyPosition,
  });

  const handleBlobbiClick = () => {
    dbg('[blobbi-debug][modal] Opening own Blobbi modal - clearing currentRemoteRef:', {
      currentRemoteRefBefore: currentRemoteRef.current,
      timestamp: new Date().toISOString()
    });

    currentRemoteRef.current = null;
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
      fetchAbortRef.current = null;
    }
    setModalKey(`self:${Date.now()}`);
    setRemotePreviewKey(null);
    setIsBlobbiInfoOpen(true);
    setReadOnlyBlobbiData(null); // limpa dados read-only ao abrir o seu próprio Blobbi
    setExternalVisual(null);     // garante que não vaze visual remoto
  };

  // Opens read-only Blobbi info for other users.
  // Receives blobbiD (d-tag), not the sessionId.
  const handleOtherBlobbiClick = async (playerPubkey: string, blobbiD: string, blobbiVisual: BlobbiVisual) => {
    dbg('[blobbi-debug][handleOtherBlobbiClick] Starting handleOtherBlobbiClick:', {
      playerPubkey,
      blobbiD,
      blobbiVisualName: blobbiVisual.name,
      blobbiVisualStage: blobbiVisual.stage,
      currentRemoteRefBefore: currentRemoteRef.current,
      timestamp: new Date().toISOString()
    });

    if (!blobbiD || typeof blobbiD !== 'string') {
      if (import.meta.env.MODE === 'development') {
        console.warn('[blobbi][ui] handleOtherBlobbiClick called without valid d-tag');
      }
      return; // evita abrir modal com dados errados de um "último" evento
    }

    dbg('[blobbi-debug][setState] Setting currentRemoteRef:', {
      playerPubkey,
      blobbiD,
      timestamp: new Date().toISOString()
    });

    currentRemoteRef.current = { pubkey: playerPubkey, d: blobbiD };
    setReadOnlyPubkey(playerPubkey);
    if (fetchAbortRef.current) {
      dbg('[blobbi-debug][fetch] Aborting previous fetch request');
      fetchAbortRef.current.abort();
    }
    fetchAbortRef.current = new AbortController();
    const localController = fetchAbortRef.current;
    const { signal } = localController;

    const basicBlobbiData = {
      name: blobbiVisual.name || 'Unknown Blobbi',
      stage: normalizeStage(blobbiVisual.stage ?? 'baby'),
      hunger: 50,
      energy: 50,
      happiness: 50,
      health: 100,
      hygiene: 50,
      experience: 0,
      careStreak: 0,
      generation: 1,
      isSleeping: false,
    };

    const mk = `remote:${playerPubkey}:${blobbiD}:${Date.now()}`;
    setModalKey(mk);
    setRemotePreviewKey(`${playerPubkey}:${blobbiD}`);

    dbg('[blobbi-debug][setState] Setting externalVisual:', {
      playerPubkey,
      blobbiD,
      visualName: blobbiVisual.name,
      visualStage: blobbiVisual.stage,
      timestamp: new Date().toISOString()
    });

    setExternalVisual(blobbiVisual);

    dbg('[blobbi-debug][setState] Setting basic read-only data:', {
      playerPubkey,
      blobbiD,
      name: basicBlobbiData.name,
      stage: basicBlobbiData.stage,
      timestamp: new Date().toISOString()
    });

    setReadOnlyBlobbiData(basicBlobbiData);
    setIsBlobbiInfoOpen(true);

    // Fetch detailed data in the background
    try {
      dbg('[blobbi-debug][fetch] Starting nostr.query for detailed data:', {
        playerPubkey,
        blobbiD,
        timestamp: new Date().toISOString()
      });

      const events = await nostr.query([{
        kinds: [KIND_BLOBBI_STATE],
        authors: [playerPubkey],
        '#d': [blobbiD],
        limit: 1,
      }], { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });

      dbg('[blobbi-debug][fetch] nostr.query completed:', {
        playerPubkey,
        blobbiD,
        eventsFound: events.length,
        signalAborted: signal.aborted,
        timestamp: new Date().toISOString()
      });

      if (signal.aborted) {
        dbg('[blobbi-debug][fetch] Query aborted, not applying results:', {
          playerPubkey,
          blobbiD,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (events.length === 0) {
        console.warn('[blobbi-debug][fetch] No Blobbi data found for player:', {
          playerPubkey,
          blobbiD,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const event = events.sort((a, b) => b.created_at - a.created_at)[0];
      const evD = event.tags.find(([k]) => k === 'd')?.[1];

      dbg('[blobbi-debug][modal][debug] applying event', {
        blobbiDFromEvent: evD,
        currentRemoteRef: currentRemoteRef.current,
        created_at: event.created_at,
        timestamp: new Date().toISOString()
      });

      if (evD !== blobbiD) {
        console.warn('[blobbi-debug][fetch] Event d-tag mismatch, ignoring:', {
          expected: blobbiD,
          got: evD,
          playerPubkey,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Verify that we're still targeting the same Blobbi before applying updates
      const isCurrentTarget = !signal.aborted &&
        currentRemoteRef.current?.pubkey === playerPubkey &&
        currentRemoteRef.current?.d === blobbiD;

      if (!isCurrentTarget) {
        dbg('[blobbi-debug][fetch] Target changed, not applying results:', {
          playerPubkey,
          blobbiD,
          currentRemoteRef: currentRemoteRef.current,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const get = (n: string) => event.tags.find(([k]) => k === n)?.[1];
      const refinedVisual: BlobbiVisual = {
        ...blobbiVisual,
        baseColor: get('base_color') ?? get('baseColor') ?? blobbiVisual.baseColor,
        secondaryColor: get('secondary_color') ?? get('secondaryColor') ?? blobbiVisual.secondaryColor,
        eyeColor: get('eye_color') ?? get('eyeColor') ?? blobbiVisual.eyeColor,
        pattern: get('pattern') ?? blobbiVisual.pattern,
        specialMark: get('special_mark') ?? get('specialMark') ?? blobbiVisual.specialMark,
        stage: normalizeStage(get('stage') ?? blobbiVisual.stage ?? 'baby'),
        adultType: get('adult_type') ?? get('adultType') ?? blobbiVisual.adultType,
        // The SECOND place a stranger's authored name becomes display text: the
        // modal refreshes the visual from the full event after opening. Resolved
        // through the same boundary, so the refresh cannot undo what the
        // presence-driven parse already made safe.
        name: resolveRemoteBlobbiDisplayName({
          policy,
          pubkey: playerPubkey,
          authoredName: getBlobbiDisplayName({
            id: get('d') ?? blobbiD ?? '',
            name: get('name'),
            rawTags: event.tags,
          }),
        }).name,
      };

      dbg('[blobbi-debug][setState] Setting refined externalVisual:', {
        playerPubkey,
        blobbiD,
        name: refinedVisual.name,
        stage: refinedVisual.stage,
        timestamp: new Date().toISOString()
      });
      setExternalVisual(refinedVisual);

      // Cria dados detalhados para o read-only
      const detailedBlobbiData = {
        id: blobbiD,
        name: refinedVisual.name || 'Unknown Blobbi',
        stage: normalizeStage(refinedVisual.stage ?? getTag(event, 'stage') ?? 'baby'),
        breedingReady: getTag(event, 'breeding_ready') === 'true',
        generation: parseInt(getTag(event, 'generation') ?? '1', 10),
        hunger: parseInt(getTag(event, 'hunger') ?? '50', 10),
        energy: parseInt(getTag(event, 'energy') ?? '50', 10),
        happiness: parseInt(getTag(event, 'happiness') ?? '50', 10),
        health: parseInt(getTag(event, 'health') ?? '100', 10),
        hygiene: parseInt(getTag(event, 'hygiene') ?? '50', 10),
        experience: parseInt(getTag(event, 'experience') ?? '0', 10),
        careStreak: parseInt(getTag(event, 'care_streak') ?? '0', 10),
        isSleeping: getTag(event, 'is_sleeping') === 'true',
        isDirty: getTag(event, 'is_dirty') === 'true',
        hasBuff: getTag(event, 'has_buff') === 'true',
        hasDebuff: getTag(event, 'has_debuff') === 'true',
        inParty: getTag(event, 'in_party') === 'true',
        visibleToOthers: getTag(event, 'visible_to_others') === 'true',
        personality: getTag(event, 'personality'),
        trait: getTag(event, 'trait'),
        mood: getTag(event, 'mood'),
      };

      dbg('[blobbi-debug][setState] Setting detailed read-only data:', {
        playerPubkey,
        blobbiD,
        name: detailedBlobbiData.name,
        stage: detailedBlobbiData.stage,
        generation: detailedBlobbiData.generation,
        timestamp: new Date().toISOString()
      });
      setReadOnlyBlobbiData(detailedBlobbiData);
    } catch (error) {
      console.error('[blobbi-debug][fetch] Failed to fetch other player Blobbi data:', {
        playerPubkey,
        blobbiD,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      // Keep basic data if fetch fails
    }
  };

  /**
   * Close the other-player card and forget everything derived from it.
   *
   * Shared by the modal's own close handler and by the block path, so a card
   * dismissed because its subject was blocked leaves exactly the same state
   * behind as one the player closed themselves.
   */
  const closeRemoteCard = useCallback(() => {
    setIsBlobbiInfoOpen(false);
    setReadOnlyBlobbiData(null);
    setExternalVisual(null);
    setRemotePreviewKey(null);
    setReadOnlyPubkey(null);
    currentRemoteRef.current = null;
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
      fetchAbortRef.current = null;
    }
  }, []);

  /**
   * A card open onto a player who has just been blocked must not stay open.
   *
   * Blocking removes them from the world; leaving their card up would be the
   * stale interaction the block was meant to end, and it would offer actions
   * against someone no longer present. Subscribed rather than derived so a block
   * performed in another tab closes this one too.
   */
  useEffect(() => {
    const closeIfBlocked = () => {
      const pubkey = currentRemoteRef.current?.pubkey;
      if (pubkey && isBlocked(pubkey)) closeRemoteCard();
    };
    return subscribeRelationships(closeIfBlocked);
  }, [closeRemoteCard]);

  const handleSendMessage = useCallback(async (message: IslandMessage) => {
    // Before the world has mounted there is nothing to publish through; that is
    // an ordinary startup state, not an error worth throwing over.
    const send = sendMessageRef.current;
    if (!send) return false;
    return send(message);
  }, []);

  // Listen for social share events from ShareModal
  useEffect(() => {
    const handleOpenSocialShare = (event: CustomEvent) => {
      const { capturedPhoto, capturedPolaroidSrc } = event.detail;
      setSocialShareData({ capturedPhoto, capturedPolaroidSrc });
      setIsSocialShareOpen(true);
    };

    document.addEventListener('openSocialShare', handleOpenSocialShare as EventListener);
    return () => {
      document.removeEventListener('openSocialShare', handleOpenSocialShare as EventListener);
    };
  }, []);

  // Listen for the bottom action dock's "My Blobbi" action.
  const openMyBlobbiRef = useRef<() => void>(() => {});
  openMyBlobbiRef.current = handleBlobbiClick;
  useEffect(() => {
    const open = () => openMyBlobbiRef.current?.();
    document.addEventListener(DOCK_EVENTS.openMyBlobbi, open);
    return () => document.removeEventListener(DOCK_EVENTS.openMyBlobbi, open);
  }, []);

  // The dock is a launcher: it asks for the communication panel and nothing
  // more. Sending no longer travels through a DOM event, the panel is rendered
  // here, next to the publisher, and hands it a typed message directly.
  useEffect(() => {
    const open = () => setIsCommunicationOpen(true);
    document.addEventListener(DOCK_EVENTS.openCommunication, open);
    return () => document.removeEventListener(DOCK_EVENTS.openCommunication, open);
  }, []);

  // Leaving the room closes the panel: a half-typed message to a room you are
  // no longer standing in has nowhere to go.
  useEffect(() => {
    setIsCommunicationOpen(false);
  }, [currentLocation]);

  return (
    <>
    <PlaceBackground ref={containerRef}>
      {showDebugOverlays && <BoundaryVisualizer boundary={boundary} />}
      {/* Interactive Elements - Background specific */}
      <InteractiveElements
        blobbiRef={blobbiRef}
        selectedBlobbi={selectedBlobbi}
        sittingIn={sittingIn}
        occupiedSeats={occupiedSeats}
        onSitInSeat={sitInSeat}
        sessionParticipants={sessionParticipants}
        onActivityChange={setActivitySession}
        hiddenIn={hiddenIn}
        onHideInSpot={hideInSpot}
        onActorSuppressionChange={setActorSuppressed}
      />

      {/* Furniture */}
      {background === 'home-inside.png' && (
        <>
          <Furniture
            id="refrigerator"
            containerRef={containerRef}
            initialPosition={{ x: 20, y: 70 }}
            boundary={boundary}
            imageUrl="/assets/locations/home/refrigerator.png"
            hoverEffectImageUrl="/assets/locations/home/refrigerator-door.png"
            size={{ width: 111, height: 173 }}
            backgroundFile={background}
            onClick={() => setIsRefrigeratorOpen(true)}
          />
          <Furniture
            id="chest"
            containerRef={containerRef}
            position={{ x: 40, y: 70 }}
            boundary={boundary}
            imageUrl="/assets/locations/home/chest.png"
            hoverEffectImageUrl="/assets/locations/home/chest-lid-open.png"
            size={{ width: 130, height: 130 }}
            backgroundFile={background}
            onClick={() => setIsChestOpen(true)}
          />
          <Furniture
            id="bed"
            containerRef={containerRef}
            position={bedPosition}
            onPositionChange={handleBedPositionChange}
            boundary={boundary}
            imageUrl="/assets/locations/home/bed.png"
            size={{ width: 100, height: 100 }}
            backgroundFile={background}
            onClick={requestBedSleep}
          />
          <RefrigeratorModal
            isOpen={isRefrigeratorOpen}
            onClose={() => setIsRefrigeratorOpen(false)}
          />
          <ChestModal
            isOpen={isChestOpen}
            onClose={() => setIsChestOpen(false)}
          />
        </>
      )}

      {background === 'cave-inside.png' && <MiningGame />}

      {/* Movable Blobbi Character */}
      <MovableBlobbi
        ref={blobbiRef}
        key={currentLocation}
        containerRef={containerRef}
        boundary={boundary}
        isVisible={!!selectedBlobbi && !actorSuppressed}
        // One coherent presentation description (standing / sleeping / seated /
        // hidden), owned by the pose controller and resolved through the same
        // pure resolver remote actors use.
        pose={pose}
        initialPosition={blobbiInitialPosition}
        backgroundFile={background}
        onMoveStart={handleMoveStart}
        onMoveComplete={handleMoveComplete}
        onWakeUp={handleWakeUp}
        onBlobbiClick={handleBlobbiClick}
        anchorId="my-blobbi-anchor"
        size={blobbiSize}
        scaleByYPosition={true}
        localAttentionRef={localAttentionRef}
        livePositionsRef={livePositionsRef}
        localActiveRef={localActiveRef}
      />

      {/* Multiplayer Layer */}
      {selectedBlobbi && (
        <MultiplayerLayer
          containerRef={containerRef}
          currentBlobbiD={selectedBlobbi.id}
          startPosition={myPosition}
          onMyPositionChange={setMyPosition}
          sendMessageRef={sendMessageRef}
          myAnchorId="my-blobbi-anchor"
          onOtherBlobbiClick={handleOtherBlobbiClick}
          hiddenIn={hiddenIn}
          sittingIn={sittingIn}
          onOccupiedSeatsChange={setOccupiedSeats}
          activitySession={activitySession}
          onSessionParticipantsChange={setSessionParticipants}
          localAttentionRef={localAttentionRef}
          livePositionsRef={livePositionsRef}
          localActiveRef={localActiveRef}
        />
      )}
    </PlaceBackground>

      {/* ── UI overlays (NOT world objects): rendered outside the scaled
          VirtualWorld so they keep full-stage sizing/positioning. Chat bubbles
          remain inside the world (they portal into the Blobbi anchors). ── */}

      {/* Communication panel. Anchored above the dock so it reads as coming out
          of the Talk button, inside the game frame rather than in a portal (the
          island can be fullscreen, and a portalled overlay would land outside
          it). It decides its own tabs from the safety policy. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center px-2 sm:bottom-20">
        <CommunicationPanel
          open={isCommunicationOpen}
          onClose={() => setIsCommunicationOpen(false)}
          onSend={handleSendMessage}
        />
      </div>
      {/* Arcade Pass Icon - top right, below the shell HUD.
          (Map and location now live in the shell HUD / dock.) */}
      <div
        className="absolute top-16 right-2 sm:top-20 sm:right-4 z-20 flex items-center space-x-2"
        data-block-move
      >
        {/*
          Two DISTINCT arcade concepts, deliberately not merged (see
          `ArcadeTicketBalance`): the ticket balance is persistent kind:31633
          currency, the pass is temporary sessionStorage floor access. Both are
          arcade-scoped, so neither clutters the rest of the island.
        */}
        {/*
          `showZero`: inside the arcade the counter is the point, the games
          award tickets, so a genuine zero, a loading read and an unavailable
          read each render distinctly instead of the chip silently hiding.
        */}
        {currentLocation.startsWith('arcade') && <ArcadeTicketBalance showZero />}
        <ArcadePassIcon />
      </div>


      {/* Blobbi Info Modal */}
      <BlobbiInfoModal
        key={modalKey}
        isOpen={isBlobbiInfoOpen}
        onClose={() => {
          setIsBlobbiInfoOpen(false);
          setReadOnlyBlobbiData(null);
          setExternalVisual(null);
          dbg('[blobbi-debug][modal] Modal closed - clearing currentRemoteRef:', {
            currentRemoteRefBefore: currentRemoteRef.current,
            timestamp: new Date().toISOString()
          });
          currentRemoteRef.current = null;
          if (fetchAbortRef.current) {
            fetchAbortRef.current.abort();
            fetchAbortRef.current = null;
          }
          setRemotePreviewKey(null);
          setReadOnlyPubkey(null);
        }}
        readOnly={!!readOnlyBlobbiData}
        externalBlobbiData={readOnlyBlobbiData || undefined}
        externalVisual={externalVisual || undefined}
        previewKey={remotePreviewKey ?? 'self'}
        footer={
          readOnlyBlobbiData && readOnlyPubkey ? (
            <PlayerSafetyActions
              pubkey={readOnlyPubkey}
              islandId={DEFAULT_ISLAND_ID}
              location={currentLocation}
              reporterPubkey={user?.pubkey ?? null}
              onBlocked={closeRemoteCard}
            />
          ) : undefined
        }
      />

      {/* Social Share Modal */}
      <SocialShareModal
        isOpen={isSocialShareOpen}
        onClose={() => setIsSocialShareOpen(false)}
        title="Share to Social Media"
        capturedPhoto={socialShareData.capturedPhoto}
        capturedPolaroidSrc={socialShareData.capturedPolaroidSrc}
      />
    </>
  );
}
