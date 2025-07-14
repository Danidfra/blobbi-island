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
import { CurrentBlobbiDisplay } from "@/components/blobbi/CurrentBlobbiDisplay";
import { MobileLandscapePrompt } from "@/components/blobbi/MobileLandscapePrompt";
import { InteractiveIslandMap, LocationModal } from "@/components/blobbi/InteractiveIslandMap";

type GameState = 'login' | 'loading' | 'selection' | 'playing';

export function BlobbiIsland() {
  const { user } = useCurrentUser();
  const isMobile = useIsMobile();
  const { data: blobbis, isLoading: isLoadingBlobbis, error: blobbiError } = useBlobbis();
  const { data: currentCompanionId, isLoading: isLoadingCompanion, error: companionError } = useCurrentCompanion();
  const [selectedBlobbi, setSelectedBlobbi] = useState<Blobbi | null>(null);
  const [gameState, setGameState] = useState<GameState>('login');
  const [isLandscape, setIsLandscape] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  // Determine game state based on user login and data loading
  useEffect(() => {
    if (!user) {
      setGameState('login');
      setSelectedBlobbi(null);
    } else if (isLoadingBlobbis || isLoadingCompanion) {
      setGameState('loading');
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

  const handleLocationClick = (locationId: string) => {
    setSelectedLocation(locationId);
  };

  const handleCloseLocationModal = () => {
    setSelectedLocation(null);
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
          <div className="relative w-full h-full bg-gradient-to-b from-sky-200 to-blue-300">
            {/* Interactive Island Map */}
            <InteractiveIslandMap onLocationClick={handleLocationClick} />

            {/* Current Blobbi Display - Floating in corner */}
            <div className="absolute top-4 left-4 z-10">
              <div className="bg-white/90 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg">
                <div className="flex items-center space-x-3">
                  <CurrentBlobbiDisplay
                    size="sm"
                    className="border-2 border-primary/30"
                    showFallback={true}
                    interactive={true}
                    onClick={() => setGameState('selection')}
                  />
                  <div className="text-left">
                    <p className="text-sm font-medium text-foreground">
                      {selectedBlobbi?.name || selectedBlobbi?.id}
                    </p>
                    <button
                      onClick={() => setGameState('selection')}
                      className="text-xs text-primary hover:underline"
                    >
                      Switch Blobbi
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return <BlobbiLoginScreen />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <BlobbiHeader />

      <main className="container mx-auto py-6">
        <BlobbiGameContainer>
          {renderGameContent()}
        </BlobbiGameContainer>
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-sm text-muted-foreground">
        <p>
          Vibed with{" "}
          <a
            href="https://soapbox.pub/mkstack"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            MKStack
          </a>
        </p>
      </footer>

      {/* Location Modal */}
      {selectedLocation && (
        <LocationModal
          locationId={selectedLocation}
          onClose={handleCloseLocationModal}
        />
      )}
    </div>
  );
}