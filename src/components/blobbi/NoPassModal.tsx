import React from 'react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';

interface NoPassModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NoPassModal({ isOpen, onClose }: NoPassModalProps) {
  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="sm"
      title="Access denied"
      description="The elevator needs an Arcade Pass."
      icon="🚫"
      footer={
        <Button variant="accent" onClick={onClose} className="min-h-[44px]">
          Got it!
        </Button>
      }
    >
      <div className="space-y-3 text-center">
        <div className="rounded-panel border border-island-wood/20 bg-island-cream-2/60 p-5">
          <div aria-hidden className="mb-3 text-5xl">
            🛗
          </div>
          <p className="text-sm font-semibold text-island-ink">
            You don&apos;t have an arcade pass yet.
          </p>
        </div>
        <p className="rounded-xl border border-island-warn/30 bg-island-warn/5 px-3 py-2 text-xs text-island-ink-soft">
          💡 Look for the ticket counter in the arcade to buy an Arcade Pass for 20 coins.
        </p>
      </div>
    </BlobbiModal>
  );
}
