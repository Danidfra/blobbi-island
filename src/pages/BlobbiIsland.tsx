import { useState, useEffect } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useCurrentCompanion } from "@/hooks/useCurrentCompanion";
import { BlobbiHeader } from "@/components/blobbi/BlobbiHeader";
import { BlobbiGameContainer } from "@/components/blobbi/BlobbiGameContainer";
import { BlobbiLoginScreen } from "@/components/blobbi/BlobbiLoginScreen";
import { BlobbiSelectionScreen } from "@/components/blobbi/BlobbiSelectionScreen";
import { BlobbiLoadingScreen } from "@/components/blobbi/BlobbiLoadingScreen";

import { MobileLandscapePrompt } from "@/components/blobbi/MobileLandscapePrompt";
import { PlayingView } from "@/components/blobbi/PlayingView";
import { MapModal } from "@/components/blobbi/MapModal";
import { LocationProvider } from "@/contexts/LocationContext";
import { SceneTransition } from "@/components/blobbi/SceneTransition";

type GameState = 'login' | 'loading' | 'selection' | 'playing';

export function BlobbiIsland() {
  const { user } = useCurrentUser();
  const isMobile = useIsMobile();
  const { data: blobbis, isLoading: isLoadingBlobbis, error: blobbiError } = useBlobbis();
  const { data: currentCompanionId, isLoading: isLoadingCompanion, error: companionError } = useCurrentCompanion();
  const [selectedBlobbi, setSelectedBlobbi] = useState<Blobbi | null>(null);
  const [gameState, setGameState] = useState<GameState>('login');
  const [isLandscape, setIsLandscape] = useState(true);

  // Determine game state based on user login and data loading
  useEffect(() => {
    if (!user) {
      setGameState('login');
      setSelectedBlobbi(null);
    } else if (isLoadingBlobbis || isLoadingCompanion) {
      // Only show loading for a short time, then fall back to selection
      const loadingTimeout = setTimeout(() => {
        if (isLoadingBlobbis || isLoadingCompanion) {
          setGameState('selection');
        }
      }, 1000); // 1 second timeout for loading

      setGameState('loading');

      return () => clearTimeout(loadingTimeout);
    } else if (blobbiError || companionError) {
      setGameState('selection'); // Show selection screen with error handling
    } else if (!blobbis || blobbis.length === 0) {
      setGameState('selection'); // Show selection screen for creating first Blobbi
    } else if (!selectedBlobbi || !currentCompanionId) {
      setGameState('selection');
    } else {
      setGameState('playing');
    }
  }, [user, isLoadingBlobbis, isLoadingCompanion, blobbiError, companionError, blobbis, selectedBlobbi, currentCompanionId]);

  // Update selected Blobbi when current companion changes
  useEffect(() => {
    if (currentCompanionId && blobbis) {
      const companion = blobbis.find(b => b.id === currentCompanionId);
      if (companion) {
        setSelectedBlobbi(companion);
      }
    }
  }, [currentCompanionId, blobbis]);

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
    return <MobileLandscapePrompt />;
  }

  const handleBlobbiSelected = (blobbi: Blobbi) => {
    setSelectedBlobbi(blobbi);
    setGameState('playing');
  };

  const handleCancelSelection = () => {
    // If user has a current companion, go back to playing
    if (currentCompanionId && blobbis) {
      const companion = blobbis.find(b => b.id === currentCompanionId);
      if (companion) {
        setSelectedBlobbi(companion);
        setGameState('playing');
        return;
      }
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
          />
        );

      case 'playing':
        return (
          <PlayingView
            selectedBlobbi={selectedBlobbi}
          />
        );

      default:
        return <BlobbiLoginScreen />;
    }
  };

  return (
    <LocationProvider>
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900 theme-transition">
        <BlobbiHeader onSwitchBlobbi={() => setGameState('selection')} />

        <main className="container mx-auto py-6">
          <BlobbiGameContainer>
            {renderGameContent()}
            <SceneTransition />
            {/* Map Modal - Now properly scoped to game container */}
            <MapModal />
          </BlobbiGameContainer>
        </main>

        {/* Footer */}
        <footer className="text-center py-4 text-sm blobbi-text-muted">
          <p>
            Vibed with{" "}
            <a
              href="https://soapbox.pub/mkstack"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent hover:underline font-medium"
            >
              MKStack
            </a>
          </p>
        </footer>
      </div>
    </LocationProvider>
  );
}