import React from 'react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import { ARCADE_PASS_PRICE } from '@/lib/arcade-pass';
import { PriceTag } from '@/components/ui/item-tile';

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
        <p className="inline-flex flex-wrap items-center justify-center gap-1 rounded-xl border border-island-warn/30 bg-island-warn/5 px-3 py-2 text-xs text-island-ink-soft">
          {/* The price comes from the one place that defines it, so this can
              never drift away from what the counter actually charges. */}
          <span aria-hidden>💡</span>
          Buy an Arcade Pass at the counter for
          <PriceTag amount={ARCADE_PASS_PRICE} />
          — your Arcade Tickets are not spent.
        </p>
      </div>
    </BlobbiModal>
  );
}
