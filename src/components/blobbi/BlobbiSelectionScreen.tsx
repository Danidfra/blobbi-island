import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useBlobbonautProfile, useSetCurrentCompanion } from "@/hooks/useBlobbonautProfile";
import { BlobbiCard } from "./BlobbiCard";
import { BlobbiLoadingScreen } from "./BlobbiLoadingScreen";
import { ExternalLink, ArrowLeft } from "lucide-react";

interface BlobbiSelectionScreenProps {
  onBlobbiSelected: (blobbi: Blobbi) => void;
  onCancel?: () => void;
}

export function BlobbiSelectionScreen({ onBlobbiSelected, onCancel }: BlobbiSelectionScreenProps) {
  const { user } = useCurrentUser();
  const { data: blobbis, isLoading, error } = useBlobbis();
  const { data: profile, isLoading: isLoadingCompanion } = useBlobbonautProfile();
  const currentCompanionId = profile?.currentCompanion;
  const { mutate: setCurrentCompanion, isPending: isUpdatingCompanion } = useSetCurrentCompanion();
  const [selectedBlobbi, setSelectedBlobbi] = useState<Blobbi | null>(null);

  // Set initial selection based on current companion
  useEffect(() => {
    if (currentCompanionId && blobbis && !selectedBlobbi) {
      const currentBlobbi = blobbis.find(b => b.id === currentCompanionId);
      if (currentBlobbi) {
        setSelectedBlobbi(currentBlobbi);
      }
    }
  }, [currentCompanionId, blobbis, selectedBlobbi]);

  // Show loading screen while fetching data
  if (!user || isLoading || isLoadingCompanion) {
    return <BlobbiLoadingScreen />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full blobbi-gradient-container p-6">
        <Card className="max-w-md blobbi-card-xl shadow-lg border-2 border-purple-300 dark:border-purple-600">
          <CardContent className="blobbi-section text-center space-y-4">
            <div className="text-4xl mb-4">😞</div>
            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">Failed to load your Blobbis</h3>
            <p className="text-sm blobbi-text-muted">
              {error instanceof Error ? error.message : 'Unknown error occurred'}
            </p>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="w-full blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleConfirmSelection = () => {
    if (!selectedBlobbi) return;

    // Only update if selection is different from current companion
    if (selectedBlobbi.id !== currentCompanionId) {
      setCurrentCompanion(selectedBlobbi.id);
    }

    onBlobbiSelected(selectedBlobbi);
  };

  const handleCancel = () => {
    // Reset selection to current companion
    if (currentCompanionId && blobbis) {
      const currentBlobbi = blobbis.find(b => b.id === currentCompanionId);
      setSelectedBlobbi(currentBlobbi || null);
    } else {
      setSelectedBlobbi(null);
    }

    if (onCancel) {
      onCancel();
    }
  };

  return (
    <div className="h-full blobbi-gradient-container overflow-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
            Choose Your Blobbi
          </h2>
          <p className="blobbi-text-muted">
            Select which Blobbi you'd like to play with today
          </p>
        </div>

        {/* Blobbi Cards Grid */}
        {blobbis && blobbis.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl mx-auto">
            {blobbis.map((blobbi) => (
              <BlobbiCard
                key={blobbi.id}
                blobbi={blobbi}
                isSelected={selectedBlobbi?.id === blobbi.id}
                isCurrent={currentCompanionId === blobbi.id}
                onSelect={() => setSelectedBlobbi(blobbi)}
                onConfirm={handleConfirmSelection}
              />
            ))}
          </div>
        ) : (
          /* No Blobbis Found */
          <Card className="border-dashed max-w-md mx-auto blobbi-card border-purple-200 dark:border-purple-700">
            <CardContent className="py-12 px-8 text-center">
              <div className="space-y-4">
                <div className="text-6xl">🥚</div>
                <h3 className="text-lg font-semibold blobbi-text">No Blobbis Found</h3>
                <p className="blobbi-text-muted">
                  Create your first Blobbi at blobbi.pet to get started!
                </p>
                <Button
                  variant="outline"
                  onClick={() => window.open('https://blobbi.pet', '_blank')}
                  className="w-full blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20"
                >
                  <ExternalLink className="w-4 h-4 mr-2 icon-purple" />
                  Create Your First Blobbi
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        {blobbis && blobbis.length > 0 && (
          <div className="flex justify-center gap-4 max-w-md mx-auto">
            <Button
              variant="outline"
              onClick={handleCancel}
              className="flex-1 blobbi-button border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20"
              disabled={isUpdatingCompanion}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Cancel
            </Button>

            <Button
              onClick={handleConfirmSelection}
              disabled={!selectedBlobbi || isUpdatingCompanion || selectedBlobbi.id === currentCompanionId}
              className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 font-medium theme-transition"
            >
              {isUpdatingCompanion ? "Updating..." :
               selectedBlobbi?.id === currentCompanionId ? "Already Selected" : "Enter Island"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}