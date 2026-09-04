import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';

/**
 * The Furniture Store's shopping surface, a FOUNDATION, deliberately empty.
 *
 * ## What this is, and what it is not
 *
 * It is the one dialog the showroom's two controls open, mounted only while
 * open, with a title, a close and a place for a catalog to arrive. It is the
 * structural half of a shop.
 *
 * It is NOT a shop yet, and nothing here pretends otherwise. There are no
 * prices, no currency, no purchase call, no inventory write and no publisher,
 * this module imports none of them, which is a stronger statement than "we do
 * not call them": there is no code path from this component to a Nostr event.
 * The Furniture Store's economy has not been designed, and inventing a
 * placeholder price is how a placeholder becomes a promise.
 *
 * The empty state says so in the player's language rather than showing a blank
 * box: the same courtesy the Clothing Store's unstocked rails already extend.
 *
 * ## Where the catalog will go
 *
 * The `<div>` below the header is the slot: a future pass fills it from the
 * shared item catalog and hangs the shared purchase hook off it, exactly as
 * `CareStoreModal` and `ClothingStoreModal` do. Adding that should not have to
 * move the title, the close, the mount lifecycle or the room's state, which is
 * the whole point of landing this shape first.
 */

interface FurnitureStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FurnitureStoreModal({ isOpen, onClose }: FurnitureStoreModalProps) {
  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="lg"
      title="Furniture Store"
      description="Furnish your Blobbi's home."
      icon="🛋️"
      bodyClassName="flex min-h-0 flex-col gap-3 p-3 sm:p-4"
      footer={
        <Button variant="soft" onClick={onClose} className="min-h-[44px]">
          Done
        </Button>
      }
    >
      <div data-furniture-store-catalog className="space-y-4">
        <div className="rounded-panel border-2 border-dashed border-island-wood/30 px-4 py-8 text-center">
          <p className="text-sm text-island-ink-soft">
            The showroom is still being set up; nothing is on sale here yet.
          </p>
          <p className="mt-1 text-xs text-island-ink-soft/80">
            Furniture for your Blobbi's home is coming soon.
          </p>
        </div>
      </div>
    </BlobbiModal>
  );
}
