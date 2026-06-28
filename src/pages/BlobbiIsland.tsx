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
  const [manualSelection, setManualSelection] = useState<Blobbi | null>(null);
  const [gameState, setGameState] = useState<GameState>('login');
  const [isLandscape, setIsLandscape] = useState(true);

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
    if (manualSelection) return manualSelection;
    if (currentCompanionId && blobbis) {
      const current = blobbis.find(b => b.id === currentCompanionId);
      return current && isModernBlobbi(current) ? current : null;
    }
    return null;
  }, [manualSelection, currentCompanionId, blobbis]);

  // Determine game state based on user login and data loading
  useEffect(() => {
    if (!user) {
      setGameState('login');
      setManualSelection(null);
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
    setManualSelection(blobbi);
    setGameState('playing');
  };

  const handleSwitchBlobbi = () => {
    setManualSelection(null);
    setGameState('selection');
  };

  const handleCancelSelection = () => {
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