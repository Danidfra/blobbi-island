import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  inFrameDialogPanelClass,
} from '@/components/ui/dialog';
import { useStageOverlayHost } from '@/contexts/StageOverlayContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useLocation } from '@/hooks/useLocation';
import type { LocationId } from '@/lib/location-types';

interface ElevatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FloorOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  location: string;
}

const floors: FloorOption[] = [
  {
    id: 'floor-1',
    name: 'Floor 1',
    description: 'Games on upper level',
    icon: '🎮',
    location: 'arcade-1'
  },
  {
    id: 'ground-floor',
    name: 'Ground floor',
    description: 'Entrance with prizes and tickets',
    icon: '🎯',
    location: 'arcade'
  },
  {
    id: 'basement',
    name: 'Basement (-1)',
    description: 'Attractions and surprises',
    icon: '🔍',
    location: 'arcade-minus1'
  }
];

export function ElevatorModal({ isOpen, onClose }: ElevatorModalProps) {
  const stageOverlayHost = useStageOverlayHost();
  const { setCurrentLocation } = useLocation();

  const handleFloorSelect = (location: string) => {
    setCurrentLocation(location as LocationId);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        /* Contained in the game window, like every other arcade surface, and
           sized against the STAGE rather than the viewport — see
           `inFrameDialogPanelClass`. `inFrame` supplies positioning only, so a
           dialog moved here must bring its own padding and side margins. */
        container={stageOverlayHost}
        inFrame
        className={cn(
          inFrameDialogPanelClass,
          'blobbi-card-xl rounded-panel border-2 border-island-wood/30',
        )}
      >
        <DialogHeader>
          <DialogTitle className="mb-4 text-center text-2xl font-bold text-island-ink">
            🛗 Select Floor
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="mb-6 text-center text-island-ink-soft">
            Choose which floor you want to visit:
          </p>

          <div className="space-y-3">
            {floors.map((floor) => (
              <Button
                key={floor.id}
                onClick={() => handleFloorSelect(floor.location)}
                variant="soft"
                className="flex h-auto min-h-[44px] w-full justify-between rounded-xl p-4 text-left"
              >
                <div className="flex items-center space-x-4">
                  <div aria-hidden className="text-2xl">{floor.icon}</div>
                  <div className="flex-1">
                    <div className="font-bold text-island-ink">{floor.name}</div>
                    <div className="text-sm text-island-ink-soft">{floor.description}</div>
                  </div>
                </div>
                <div aria-hidden className="text-island-purple">→</div>
              </Button>
            ))}
          </div>

          <Button
            variant="soft"
            onClick={onClose}
            className="mt-4 min-h-[44px] w-full justify-center rounded-xl"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}