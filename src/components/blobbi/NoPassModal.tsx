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

interface NoPassModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NoPassModal({ isOpen, onClose }: NoPassModalProps) {
  const stageOverlayHost = useStageOverlayHost();
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
          'blobbi-card-xl border-2 border-island-danger/40 rounded-2xl theme-transition',
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center text-island-danger mb-4">
            🚫 Access Denied
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="text-center">
            <div className="blobbi-card rounded-xl p-6 mb-4">
              <div className="text-6xl mb-4">🛗</div>
              <p className="text-lg font-semibold blobbi-text mb-2">
                You don't have an arcade pass!
              </p>
              <p className="text-sm blobbi-text-muted">
                Please purchase a ticket at the counter to use the elevator.
              </p>
            </div>

            <div className="blobbi-card rounded-lg p-3 mb-4 border-island-warn/30">
              <p className="text-sm blobbi-text">
                💡 Look for the ticket counter in the arcade to purchase an Arcade Pass for 20 coins.
              </p>
            </div>
          </div>

          <Button
            variant="accent"
            onClick={onClose}
            className="min-h-[44px] w-full"
          >
            Got it!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}