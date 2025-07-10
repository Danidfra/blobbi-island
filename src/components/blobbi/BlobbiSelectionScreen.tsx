import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useCurrentCompanion, useSetCurrentCompanion } from "@/hooks/useCurrentCompanion";
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
  const { data: currentCompanionId, isLoading: isLoadingCompanion } = useCurrentCompanion();
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
      <div className="flex items-center justify-center h-full bg-gradient-to-b from-blue-100 to-green-100 p-6">
        <Card className="max-w-md shadow-lg border-2">
          <CardContent className="p-6 text-center space-y-4">
            <div className="text-4xl mb-4">😞</div>
            <h3 className="text-lg font-semibold text-destructive">Failed to load your Blobbis</h3>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Unknown error occurred'}
            </p>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="w-full"
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
    <div className="h-full bg-gradient-to-b from-blue-100 to-green-100 overflow-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-primary">Choose Your Blobbi</h2>
          <p className="text-muted-foreground">
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
          <Card className="border-dashed max-w-md mx-auto">
            <CardContent className="py-12 px-8 text-center">
              <div className="space-y-4">
                <div className="text-6xl">🥚</div>
                <h3 className="text-lg font-semibold">No Blobbis Found</h3>
                <p className="text-muted-foreground">
                  Create your first Blobbi at blobbi.pet to get started!
                </p>
                <Button
                  variant="outline"
                  onClick={() => window.open('https://blobbi.pet', '_blank')}
                  className="w-full"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
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
              className="flex-1"
              disabled={isUpdatingCompanion}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Cancel
            </Button>

            <Button
              onClick={handleConfirmSelection}
              disabled={!selectedBlobbi || isUpdatingCompanion || selectedBlobbi.id === currentCompanionId}
              className="flex-1"
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