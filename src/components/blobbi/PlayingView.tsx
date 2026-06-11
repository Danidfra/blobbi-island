import React, { useRef, useState, useEffect } from 'react';
import { PlaceBackground } from './PlaceBackground';
import { MapButton } from './MapButton';
import { ArcadePassIcon } from './ArcadePassIcon';
import { MovableBlobbi, MovableBlobbiRef } from './MovableBlobbi';
import { LocationIndicator } from './LocationIndicator';

import { InteractiveElements } from './InteractiveElements';
import { useLocation } from '@/hooks/useLocation';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import type { Blobbi } from '@/hooks/useBlobbis';
import { Furniture } from './Furniture';
import { Position } from '@/lib/types';
import type { LocalActiveState } from '@/lib/gaze';
import { RefrigeratorModal } from './RefrigeratorModal';
import { ChestModal } from './ChestModal';
import { BlobbiInfoModal } from './BlobbiInfoModal';
import { SocialShareModal } from './SocialShareModal';
import { getBlobbiSizeForLocation } from '@/lib/location-blobbi-sizes';
import { BoundaryVisualizer } from './BoundaryVisualizer';
import { MiningGame } from './MiningGame';
import { getBlobbiInitialPosition } from '@/lib/location-initial-position';
import { MultiplayerLayer } from './MultiplayerLayer';
import { ChatInputBar } from '@/components/ChatInputBar';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@/hooks/useNostr';
import type { BlobbiVisual } from '@/lib/multiplayer';
import { KIND_BLOBBI_STATE } from '@/lib/blobbi-kinds';

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
  // Shared nearby-gaze target for the local Blobbi (nearest moving remote).
  // Written by MultiplayerLayer (throttled), read by MovableBlobbi per-frame.
  const localGazeTargetRef = useRef<Position | null>(null);
  // Shared snapshot of the local Blobbi (position + activity), written by
  // MovableBlobbi and read by MultiplayerLayer so remote Blobbis can look at
  // the local player when it walks (or, later, emotes/acts) nearby.
  const localActiveRef = useRef<LocalActiveState | null>(null);
  const chatFunctionRef = useRef<((text: string) => Promise<void>) | null>(null);
  const { currentLocation } = useLocation();
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const [modalKey, setModalKey] = useState<string>('self');
  const currentRemoteRef = useRef<{ pubkey: string; d: string } | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Clear arcade pass when leaving arcade locations
  React.useEffect(() => {
    if (!currentLocation.startsWith('arcade')) {
      sessionStorage.removeItem('has-arcade-pass');
    }
  }, [currentLocation]);
  const [bedPosition, setBedPosition] = useState<Position>({ x: 75, y: 70 });
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

  const [externalVisual, setExternalVisual] = useState<BlobbiVisual | null>(null);
  const [remotePreviewKey, setRemotePreviewKey] = useState<string | null>(null);

  // Adjusted position for sleeping Blobbi (slightly higher on the bed)
  const sleepingPosition = { x: bedPosition.x, y: bedPosition.y - 5 };
  const [isSleeping, setIsSleeping] = useState(false);
  const [isAttachedToBed, setIsAttachedToBed] = useState(false);

  // Chair state
  const [isSeated, setIsSeated] = useState(false);
  const [eyesClosed, setEyesClosed] = useState(false);
  const [isAttachedToChair, setIsAttachedToChair] = useState(false);

  const background = getBackgroundForLocation(currentLocation);
  const blobbiSize = getBlobbiSizeForLocation(currentLocation);
  const blobbiInitialPosition = getBlobbiInitialPosition(currentLocation);
  const [myPosition, setMyPosition] = useState<Position>(blobbiInitialPosition);
  const boundary = locationBoundaries[background] || {
    shape: 'rectangle',
    x: [0, 100],
    y: [60, 100],
  };

  const handleBedClick = () => {
    if (blobbiRef.current) {
      // Move to the sleeping position (slightly higher on the bed)
      blobbiRef.current.goTo(sleepingPosition);
    }
  };

  const handleMoveComplete = (position: Position) => {
    setMyPosition(position);

    // Check if Blobbi reached the sleeping position with tighter tolerance
    if (
      Math.abs(position.x - sleepingPosition.x) < 2 &&
      Math.abs(position.y - sleepingPosition.y) < 2
    ) {
      setIsSleeping(true);
      setIsAttachedToBed(true);
    }

    // Check if Blobbi is going to a chair (this will be handled by handleChairArrival)
    // Chair logic is handled separately in handleChairArrival
  };

  const handleWakeUp = () => {
    setIsSleeping(false);
    setIsAttachedToBed(false);
    // Also wake up from chair if seated
    if (isSeated) {
      setIsSeated(false);
      setEyesClosed(false);
      setIsAttachedToChair(false);
    }
  };

  const handleChairArrival = (position: Position) => {
    setIsSeated(true);
    setIsAttachedToChair(true);

    // If we have a blobbiRef, snap to exact position and stop movement
    if (blobbiRef.current) {
      blobbiRef.current.goTo(position, true); // immediate = true
    }
  };

  const handleChairLeave = () => {
    setIsSeated(false);
    setEyesClosed(false);
    setIsAttachedToChair(false);
  };

  const handleMoveStart = (destination: Position) => {
    setMyPosition(destination);

    // If starting to move while sleeping, wake up and detach from bed
    if (isSleeping || isAttachedToBed) {
      setIsSleeping(false);
      setIsAttachedToBed(false);
    }

    // If starting to move while seated, stand up from chair
    if (isSeated || isAttachedToChair) {
      setIsSeated(false);
      setEyesClosed(false);
      setIsAttachedToChair(false);
    }
  };

  const handleBedPositionChange = (newPosition: Position) => {
    setBedPosition(newPosition);
    // If Blobbi is attached to bed, move it with the bed immediately (no animation)
    // Use the adjusted sleeping position (slightly higher)
    if (isAttachedToBed && blobbiRef.current) {
      const newSleepingPosition = { x: newPosition.x, y: newPosition.y - 5 };
      blobbiRef.current.goTo(newSleepingPosition, true);
    }
  };

  const handleBlobbiClick = () => {
    console.log('[blobbi-debug][modal] Opening own Blobbi modal - clearing currentRemoteRef:', {
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
    console.log('[blobbi-debug][handleOtherBlobbiClick] Starting handleOtherBlobbiClick:', {
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

    console.log('[blobbi-debug][setState] Setting currentRemoteRef:', {
      playerPubkey,
      blobbiD,
      timestamp: new Date().toISOString()
    });

    currentRemoteRef.current = { pubkey: playerPubkey, d: blobbiD };
    if (fetchAbortRef.current) {
      console.log('[blobbi-debug][fetch] Aborting previous fetch request');
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

    console.log('[blobbi-debug][setState] Setting externalVisual:', {
      playerPubkey,
      blobbiD,
      visualName: blobbiVisual.name,
      visualStage: blobbiVisual.stage,
      timestamp: new Date().toISOString()
    });

    setExternalVisual(blobbiVisual);

    console.log('[blobbi-debug][setState] Setting basic read-only data:', {
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
      console.log('[blobbi-debug][fetch] Starting nostr.query for detailed data:', {
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

      console.log('[blobbi-debug][fetch] nostr.query completed:', {
        playerPubkey,
        blobbiD,
        eventsFound: events.length,
        signalAborted: signal.aborted,
        timestamp: new Date().toISOString()
      });

      if (signal.aborted) {
        console.log('[blobbi-debug][fetch] Query aborted, not applying results:', {
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

      console.log('[blobbi-debug][modal][debug] applying event', {
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
        console.log('[blobbi-debug][fetch] Target changed, not applying results:', {
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
        name: blobbiVisual.name || get('name') || 'Unnamed Blobbi',
      };

      console.log('[blobbi-debug][setState] Setting refined externalVisual:', {
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

      console.log('[blobbi-debug][setState] Setting detailed read-only data:', {
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

  const handleSendChatMessage = async (text: string) => {
    if (chatFunctionRef.current) {
      await chatFunctionRef.current(text);
    } else {
      throw new Error('Chat function not available');
    }
  };

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

  return (
    <PlaceBackground ref={containerRef}>
      <BoundaryVisualizer boundary={boundary} />
      {/* Interactive Elements - Background specific */}
      <InteractiveElements
        blobbiRef={blobbiRef}
        selectedBlobbi={selectedBlobbi}
        onChairArrival={handleChairArrival}
        onChairLeave={handleChairLeave}
      />

      {/* Furniture */}
      {background === 'home-inside.png' && (
        <>
          <Furniture
            id="refrigerator"
            containerRef={containerRef}
            initialPosition={{ x: 20, y: 70 }}
            boundary={boundary}
            imageUrl="/assets/interactive/furniture/refrigerator.png"
            hoverEffectImageUrl="/assets/interactive/furniture/refrigerator-door.png"
            size={{ width: 111, height: 173 }}
            backgroundFile={background}
            onClick={() => setIsRefrigeratorOpen(true)}
          />
          <Furniture
            id="chest"
            containerRef={containerRef}
            position={{ x: 40, y: 70 }}
            boundary={boundary}
            imageUrl="/assets/interactive/furniture/chest.png"
            hoverEffectImageUrl="/assets/interactive/furniture/chest-lid-open.png"
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
            imageUrl="/assets/interactive/furniture/bed.png"
            size={{ width: 100, height: 100 }}
            backgroundFile={background}
            onClick={handleBedClick}
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
        isVisible={!!selectedBlobbi}
        initialPosition={blobbiInitialPosition}
        backgroundFile={background}
        onMoveStart={handleMoveStart}
        onMoveComplete={handleMoveComplete}
        onWakeUp={handleWakeUp}
        onBlobbiClick={handleBlobbiClick}
        anchorId="my-blobbi-anchor"
        isSleeping={isSleeping}
        isAttachedToBed={isAttachedToBed}
        _isSeated={isSeated}
        eyesClosed={eyesClosed}
        isAttachedToChair={isAttachedToChair}
        sitZIndexOffset={2} // Default offset for chairs
        size={blobbiSize}
        scaleByYPosition={true}
        gazeTargetRef={localGazeTargetRef}
        localActiveRef={localActiveRef}
      />

      {/* Multiplayer Layer */}
      {selectedBlobbi && (
        <MultiplayerLayer
          containerRef={containerRef}
          currentBlobbiD={selectedBlobbi.id}
          startPosition={myPosition}
          onMyPositionChange={setMyPosition}
          chatFunctionRef={chatFunctionRef}
          myAnchorId="my-blobbi-anchor"
          onOtherBlobbiClick={handleOtherBlobbiClick}
          localGazeTargetRef={localGazeTargetRef}
          localActiveRef={localActiveRef}
        />
      )}

      {/* Chat Input Bar - only show when user is logged in and has a selected Blobbi */}
      {user && selectedBlobbi && (
        <ChatInputBar
          onSend={handleSendChatMessage}
          disabled={!user}
        />
      )}

      {/* Map Button and Arcade Pass Icon - Top Right */}
      <div
        className="absolute top-2 right-2 sm:top-4 sm:right-4 z-20 flex items-center space-x-2"
        data-block-move
      >
        <ArcadePassIcon />
        <MapButton />
      </div>

      {/* Current Location Indicator - Top Center */}
      <div
        className="absolute top-2 left-1/2 transform -translate-x-1/2 sm:top-4 z-20"
        data-block-move
      >
        <LocationIndicator />
      </div>



      {/* Blobbi Info Modal */}
      <BlobbiInfoModal
        key={modalKey}
        isOpen={isBlobbiInfoOpen}
        onClose={() => {
          setIsBlobbiInfoOpen(false);
          setReadOnlyBlobbiData(null);
          setExternalVisual(null);
          console.log('[blobbi-debug][modal] Modal closed - clearing currentRemoteRef:', {
            currentRemoteRefBefore: currentRemoteRef.current,
            timestamp: new Date().toISOString()
          });
          currentRemoteRef.current = null;
          if (fetchAbortRef.current) {
            fetchAbortRef.current.abort();
            fetchAbortRef.current = null;
          }
          setRemotePreviewKey(null);
        }}
        readOnly={!!readOnlyBlobbiData}
        externalBlobbiData={readOnlyBlobbiData || undefined}
        externalVisual={externalVisual || undefined}
        previewKey={remotePreviewKey ?? 'self'}
      />

      {/* Social Share Modal */}
      <SocialShareModal
        isOpen={isSocialShareOpen}
        onClose={() => setIsSocialShareOpen(false)}
        title="Share to Social Media"
        capturedPhoto={socialShareData.capturedPhoto}
        capturedPolaroidSrc={socialShareData.capturedPolaroidSrc}
      />
    </PlaceBackground>
  );
}
