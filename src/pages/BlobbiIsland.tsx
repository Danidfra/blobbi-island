import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
import { isModernBlobbi } from "@/lib/blobbi-legacy";
import { BlobbiLoginScreen } from "@/components/blobbi/BlobbiLoginScreen";
import { BlobbiSelectionScreen } from "@/components/blobbi/BlobbiSelectionScreen";
import { BlobbiLoadingScreen } from "@/components/blobbi/BlobbiLoadingScreen";

import { BlobbiPortraitGate } from "@/components/shell/BlobbiPortraitGate";
import { BlobbiAppShell } from "@/components/shell/BlobbiAppShell";
import { LocationProvider } from "@/contexts/LocationContext";

// Lazy load heavy components
const PlayingView = lazy(() => import("@/components/blobbi/PlayingView").then(module => ({ default: module.PlayingView })));
const MapModal = lazy(() => import("@/components/blobbi/MapModal").then(module => ({ default: module.MapModal })));
const SceneTransition = lazy(() => import("@/components/blobbi/SceneTransition").then(module => ({ default: module.SceneTransition })));

// Loading component for lazy-loaded game components
const GameComponentLoading = () => (
  <div className="flex items-center justify-center h-64">
    <div className="text-center space-y-4">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      <p className="text-muted-foreground text-sm">Loading game...</p>
    </div>
  </div>
);

type GameState = 'login' | 'loading' | 'selection' | 'playing';

export function BlobbiIsland() {
  const { user } = useCurrentUser();
  const isMobile = useIsMobile();
  const { data: blobbis, isLoading: isLoadingBlobbis, error: blobbiError } = useBlobbis();
  const { data: profile, isLoading: isLoadingCompanion, error: companionError } = useBlobbonautProfile();
  const currentCompanionId = profile?.currentCompanion;
  // Track a manual (session) selection by ID only — never a snapshot object.
  // Resolving the live Blobbi from the ['blobbis'] cache keeps selectedBlobbi
  // reactive: if the chosen Blobbi's stats/appearance are updated, the playing
  // view re-reads the fresh object instead of a stale copy captured at click.
  const [manualSelectionId, setManualSelectionId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>('login');
  const [isLandscape, setIsLandscape] = useState(true);
  // When the player switches Blobbi *while already playing*, we keep the world
  // (PlayingView + multiplayer presence) MOUNTED and show the selection as an
  // overlay. Unmounting the world would reset the local position to spawn and
  // wipe the remote-players list — so instead we overlay and let the live world
  // swap only the Blobbi identity in place. This flag drives that overlay.
  const [isSwitchingBlobbi, setIsSwitchingBlobbi] = useState(false);

  // Derive selected Blobbi synchronously -- no race condition between effects.
  // Manual selection (from the selection screen) takes priority, then falls back
  // to the current_companion from the profile event.
  //
  // The auto-fallback only accepts a MODERN companion: if the saved
  // current_companion is a legacy Blobbi we deliberately resolve to null so the
  // app routes to the selection screen (which shows a friendly "older format"
  // notice and a modern-only grid) instead of silently entering the game with a
  // legacy Blobbi. An explicit manualSelection always wins and is unaffected.
  const selectedBlobbi = useMemo(() => {
    if (manualSelectionId && blobbis) {
      const manual = blobbis.find(b => b.id === manualSelectionId);
      if (manual) return manual;
    }
    if (currentCompanionId && blobbis) {
      const current = blobbis.find(b => b.id === currentCompanionId);
      return current && isModernBlobbi(current) ? current : null;
    }
    return null;
  }, [manualSelectionId, currentCompanionId, blobbis]);

  // Determine game state based on user login and data loading
  useEffect(() => {
    if (!user) {
      setGameState('login');
      setManualSelectionId(null);
      setIsSwitchingBlobbi(false);
    } else if (isLoadingBlobbis || isLoadingCompanion) {
      // Only show loading for a short time, then fall back to selection
      const loadingTimeout = setTimeout(() => {
        if (isLoadingBlobbis || isLoadingCompanion) {
          setGameState('selection');
        }
      }, 2000);

      setGameState('loading');

      return () => clearTimeout(loadingTimeout);
    } else if (blobbiError || companionError) {
      setGameState('selection');
    } else if (!blobbis || blobbis.length === 0) {
      setGameState('selection');
    } else if (!selectedBlobbi) {
      setGameState('selection');
    } else {
      setGameState('playing');
    }
  }, [user, isLoadingBlobbis, isLoadingCompanion, blobbiError, companionError, blobbis, selectedBlobbi]);

  // Check orientation on mobile
  useEffect(() => {
    if (!isMobile) {
      setIsLandscape(true);
      return;
    }

    const checkOrientation = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);

    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, [isMobile]);

  // Show landscape prompt on mobile portrait
  if (isMobile && !isLandscape) {
    return <BlobbiPortraitGate />;
  }

  const handleBlobbiSelected = (blobbi: Blobbi) => {
    setManualSelectionId(blobbi.id);
    setIsSwitchingBlobbi(false);
    setGameState('playing');
  };

  const handleSwitchBlobbi = () => {
    // If we're already in the world, open the selection as an OVERLAY and keep
    // the world mounted (preserves position + remote players). Only the Blobbi
    // identity changes in place once a new one is picked. If we're not playing
    // yet (no active Blobbi), fall back to the full selection screen.
    if (gameState === 'playing' && selectedBlobbi) {
      setIsSwitchingBlobbi(true);
      return;
    }
    setManualSelectionId(null);
    setGameState('selection');
  };

  const handleCancelSelection = () => {
    // Overlay switch: just close the overlay and stay in the live world.
    if (isSwitchingBlobbi) {
      setIsSwitchingBlobbi(false);
      return;
    }

    // If user has a current companion, go back to playing
    if (selectedBlobbi) {
      setGameState('playing');
      return;
    }

    // Otherwise stay in selection mode
    setGameState('selection');
  };

  const renderGameContent = () => {
    switch (gameState) {
      case 'login':
        return <BlobbiLoginScreen />;

      case 'loading':
        return <BlobbiLoadingScreen />;

      case 'selection':
        return (
          <BlobbiSelectionScreen
            onBlobbiSelected={handleBlobbiSelected}
            onCancel={handleCancelSelection}
            canClose={!!selectedBlobbi}
          />
        );

      case 'playing':
        return (
          <Suspense fallback={<GameComponentLoading />}>
            <PlayingView
              selectedBlobbi={selectedBlobbi}
            />
            {/* Switch-Blobbi overlay: the world stays mounted underneath so
                position and remote players are preserved; only the Blobbi
                identity swaps in place once a new one is chosen. */}
            {isSwitchingBlobbi && (
              <div className="absolute inset-0 z-40">
                <BlobbiSelectionScreen
                  onBlobbiSelected={handleBlobbiSelected}
                  onCancel={handleCancelSelection}
                  canClose
                />
              </div>
            )}
          </Suspense>
        );

      default:
        return <BlobbiLoginScreen />;
    }
  };

  const isPlaying = gameState === 'playing';

  return (
    <LocationProvider>
      <BlobbiAppShell
        screen={gameState}
        showGameChrome={isPlaying}
        inWorld={isPlaying}
        onOpenCollection={handleSwitchBlobbi}
      >
        {renderGameContent()}
        <Suspense fallback={null}>
          <SceneTransition />
          <MapModal />
        </Suspense>
      </BlobbiAppShell>
    </LocationProvider>
  );
}