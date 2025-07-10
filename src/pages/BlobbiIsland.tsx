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
          <div className="flex items-center justify-center h-full bg-gradient-to-b from-blue-100 to-green-100">
            <div className="text-center space-y-6 p-8">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold text-primary">🏝️ Welcome to Blobbi Island!</h2>
                <p className="text-lg text-muted-foreground">
                  Playing with <span className="font-semibold text-primary">
                    {selectedBlobbi?.name || selectedBlobbi?.id}
                  </span>
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex justify-center">
                  <CurrentBlobbiDisplay
                    size="xl"
                    className="shadow-xl border-4 border-primary/30"
                    showFallback={true}
                    interactive={true}
                    onClick={() => setGameState('selection')}
                  />
                </div>
                <p className="text-muted-foreground">
                  Game world coming soon...
                </p>

                <button
                  onClick={() => setGameState('selection')}
                  className="text-sm text-primary hover:underline"
                >
                  Switch Blobbi
                </button>
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
    </div>
  );
}