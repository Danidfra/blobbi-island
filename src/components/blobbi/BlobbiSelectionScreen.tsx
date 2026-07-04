import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useBlobbonautProfile, useSetCurrentCompanion } from "@/hooks/useBlobbonautProfile";
import { isModernBlobbi } from "@/lib/blobbi-legacy";
import { BlobbiCard } from "./BlobbiCard";
import { BlobbiLoadingScreen } from "./BlobbiLoadingScreen";
import { MascotBlobbi } from "./MascotBlobbi";
import { X, Egg, RotateCw, Sparkles } from "lucide-react";

interface BlobbiSelectionScreenProps {
  onBlobbiSelected: (blobbi: Blobbi) => void;
  onCancel?: () => void;
  /**
   * Start the first-egg adoption/hatching ceremony. Shown as the empty-state
   * call to action when the user has no modern Blobbis to select.
   */
  onHatchFirstEgg?: () => void;
  /**
   * Whether this screen can be dismissed without selecting a Blobbi (true when
   * opened from the HUD during play, where the user already has an active
   * Blobbi to return to). Shows a persistent close/back control.
   */
  canClose?: boolean;
}

export function BlobbiSelectionScreen({ onBlobbiSelected, onCancel, onHatchFirstEgg, canClose = false }: BlobbiSelectionScreenProps) {
  const { user } = useCurrentUser();
  const { data: blobbis, isLoading, error } = useBlobbis();
  const { data: profile, isLoading: isLoadingCompanion } = useBlobbonautProfile();
  const currentCompanionId = profile?.currentCompanion;
  const { mutate: setCurrentCompanion, isPending: isUpdatingCompanion } = useSetCurrentCompanion();
  const [selectedBlobbi, setSelectedBlobbi] = useState<Blobbi | null>(null);

  // Only modern Blobbis appear in the collection UI. Legacy Blobbis (old format
  // without a seed / proper d-tag) are excluded — never deleted or mutated.
  const modernBlobbis = useMemo(
    () => (blobbis ?? []).filter(isModernBlobbi),
    [blobbis],
  );

  // Whether the user's current/active companion is a legacy Blobbi (it exists
  // in their data but won't show as a selectable card). When true we surface a
  // friendly notice asking them to pick a newer Blobbi to continue.
  const currentCompanionIsLegacy = useMemo(() => {
    if (!currentCompanionId) return false;
    return !modernBlobbis.some((b) => b.id === currentCompanionId);
  }, [currentCompanionId, modernBlobbis]);

  // Set initial selection based on current companion — but only if that
  // companion is a modern Blobbi that's actually selectable in the grid.
  useEffect(() => {
    if (currentCompanionId && !selectedBlobbi) {
      const currentBlobbi = modernBlobbis.find(b => b.id === currentCompanionId);
      if (currentBlobbi) {
        setSelectedBlobbi(currentBlobbi);
      }
    }
  }, [currentCompanionId, modernBlobbis, selectedBlobbi]);

  // Allow Escape to dismiss the screen when it can be closed (opened during play).
  useEffect(() => {
    if (!canClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [canClose, onCancel]);

  // Show loading screen while fetching data
  if (!user || isLoading || isLoadingCompanion) {
    return <BlobbiLoadingScreen />;
  }

  if (error) {
    return (
      <div className="flex min-h-full items-center justify-center bg-gradient-to-b from-island-sky/60 via-island-cream to-island-sand/60 p-4 sm:p-6">
        <div className="w-full max-w-sm rounded-3xl border-4 border-island-wood bg-island-cream p-6 text-center shadow-cozy-frame">
          <div className="mb-2 flex justify-center">
            <MascotBlobbi size="sm" sleeping />
          </div>
          <h3 className="text-lg font-bold text-island-ink">The nest is hiding</h3>
          <p className="mt-1 text-sm text-island-ink-soft">
            We couldn't reach your Blobbis right now.
            {error instanceof Error && (
              <span className="mt-1 block text-xs opacity-70">{error.message}</span>
            )}
          </p>
          <Button
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-full border-2 border-island-wood/40 bg-island-cream-2 text-island-ink shadow-cozy-soft transition-transform duration-150 ease-cozy hover:scale-[1.02] hover:bg-island-sand"
            variant="outline"
          >
            <RotateCw className="mr-2 size-4 text-island-ocean" />
            Try again
          </Button>
        </div>
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
    // Reset selection to current companion (only if it's a modern, selectable one)
    if (currentCompanionId) {
      const currentBlobbi = modernBlobbis.find(b => b.id === currentCompanionId);
      setSelectedBlobbi(currentBlobbi || null);
    } else {
      setSelectedBlobbi(null);
    }

    if (onCancel) {
      onCancel();
    }
  };

  const hasBlobbis = modernBlobbis.length > 0;
  const isAlreadyActive = !!selectedBlobbi && selectedBlobbi.id === currentCompanionId;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-island-sky/55 via-island-cream to-island-sand/60">
      {/* Persistent close/back control — always visible when this screen was
          opened from the HUD during play, so the user can return to the game
          without selecting a different Blobbi. */}
      {canClose && (
        <button
          type="button"
          onClick={() => onCancel?.()}
          aria-label="Close"
          title="Close"
          className="absolute top-3 right-3 z-20 inline-flex size-10 items-center justify-center rounded-full bg-island-cream text-island-ink shadow-cozy-raised transition-transform duration-150 ease-cozy hover:scale-105 hover:text-island-danger active:scale-95"
        >
          <X className="size-5" />
        </button>
      )}

      {/* Header */}
      <div className="shrink-0 px-4 pt-5 pb-3 text-center landscape:max-md:pt-4 landscape:max-md:pb-2 sm:px-6">
        <h2 className="text-2xl font-bold text-island-ink landscape:max-md:text-xl">
          Your Blobbi Nest
        </h2>
        <p className="mt-0.5 text-sm text-island-ink-soft landscape:max-md:text-xs">
          Choose the companion to join you on the island today
        </p>
      </div>

      {/* Collection (scrolls; footer stays pinned) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
        {/* Friendly notice when the current/active companion is from an older
            format and can't be shown. Only meaningful when there are modern
            Blobbis to switch to; the empty state covers the no-modern case. */}
        {currentCompanionIsLegacy && hasBlobbis && (
          <div className="mx-auto mb-4 max-w-2xl rounded-2xl border-2 border-island-wood/25 bg-island-cream-2/70 p-3 text-center shadow-cozy-soft">
            <p className="text-sm text-island-ink">
              <Sparkles className="mr-1 inline size-4 align-text-bottom text-island-purple" />
              Your current Blobbi is from an older format.
            </p>
            <p className="mt-0.5 text-xs text-island-ink-soft">
              Pick a newer Blobbi below to continue your island adventure.
            </p>
          </div>
        )}

        {hasBlobbis ? (
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 landscape:max-md:grid-cols-4 landscape:max-md:gap-2.5">
            {modernBlobbis.map((blobbi) => (
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
          /* Friendly empty state — no modern Blobbis to show (whether the nest
             is truly empty or only holds older-format Blobbis). */
          <div className="flex h-full items-center justify-center">
            <div className="w-full max-w-sm rounded-3xl border-2 border-dashed border-island-wood/35 bg-island-cream/80 p-8 text-center shadow-cozy-soft">
              <div className="mb-3 flex justify-center">
                <span className="inline-flex size-16 items-center justify-center rounded-full bg-island-sand text-island-wood-dark shadow-cozy-soft">
                  <Egg className="size-8" />
                </span>
              </div>
              <h3 className="text-lg font-bold text-island-ink">
                Your nest is empty
              </h3>
              <div className="mt-1 space-y-2 text-sm text-island-ink-soft">
                <p>You don't have a Blobbi yet.</p>
                <p>
                  Hatch your very first Blobbi right here on the island — no need
                  to leave.
                </p>
              </div>
              <Button
                onClick={() => onHatchFirstEgg?.()}
                disabled={!onHatchFirstEgg}
                className="mt-5 w-full rounded-full bg-island-purple font-bold text-white shadow-cozy-raised transition-transform duration-150 ease-cozy hover:scale-[1.02] hover:bg-island-purple/90 disabled:opacity-60"
              >
                <Egg className="mr-2 size-4" />
                Hatch your first Blobbi
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Pinned footer action */}
      {hasBlobbis && (
        <div className="shrink-0 border-t-2 border-island-wood/15 bg-island-cream/80 px-4 py-3 backdrop-blur-sm sm:px-6 landscape:max-md:py-2">
          <div className="mx-auto flex max-w-md items-center gap-3">
            {canClose && (
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isUpdatingCompanion}
                className="flex-1 rounded-full border-2 border-island-wood/40 bg-island-cream text-island-ink shadow-cozy-soft transition-transform duration-150 ease-cozy hover:scale-[1.02] hover:bg-island-cream-2"
              >
                Back
              </Button>
            )}
            <Button
              onClick={handleConfirmSelection}
              disabled={!selectedBlobbi || isUpdatingCompanion || isAlreadyActive}
              className="flex-1 rounded-full bg-island-purple font-bold text-white shadow-cozy-raised transition-transform duration-150 ease-cozy hover:scale-[1.02] hover:bg-island-purple/90 disabled:opacity-60"
            >
              {isUpdatingCompanion
                ? "Waking them up..."
                : isAlreadyActive
                  ? "Already with you"
                  : "Enter the island"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
