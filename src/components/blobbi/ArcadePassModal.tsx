import { useRef, useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';
import { useToast } from '@/hooks/useToast';
import { useCoinsMutation } from '@/inventory/useCoinsMutation';
import { grantArcadePass } from '@/lib/arcade-pass';

/** What an Arcade Pass costs, in kind:11125 coins. */
export const ARCADE_PASS_PRICE = 20;

/**
 * Sentinel distinguishing "the charge failed" from "the charge went through but
 * the pass could not be stored". The two need different copy: only the first can
 * honestly promise that no coins moved.
 */
const PASS_STORAGE_FAILED = '__pass-storage-failed__';

interface ArcadePassModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Buy an Arcade Pass.
 *
 * ## What changed, and why it had to
 *
 * The purchase used to call `useOptimizedStatus().updateOwnerCoins(coins - 20)`,
 * which is a purely local optimistic mutation: it pushes onto a per-hook-instance
 * `useRef` and invalidates with `refetchType: 'none'`. Nothing was published. A
 * WebSocket spy during the audit's purchase recorded zero events beyond presence
 * heartbeats, the deduction was visible *only inside this modal*, and a reload
 * restored the full balance while clearing the pass — so passes were unlimited
 * and free.
 *
 * The charge now goes through `useCoinsMutation`, the canonical coin writer:
 * it re-reads the freshest kind:11125 available from the relay as its write
 * base, merges through `mergeOwnerProfileTags` (preserving unknown Ditto tags,
 * pets, achievements, current companion) plus the raw `inv` accessory tags,
 * refuses a negative result, and publishes exactly once.
 *
 * ## What "the charge succeeded" actually guarantees — and what it does not
 *
 * `useCoinsMutation` resolves once, in order: the freshest profile was fetched
 * and parsed, the new balance is non-negative, the signer produced a signed
 * kind:11125, and `nostr.event()` returned. It does **not** guarantee relay
 * settlement, and nothing here verifies the write afterwards:
 *
 * | outcome inside `useNostrPublish` | what this modal sees |
 * | --- | --- |
 * | a relay accepted the event | resolves — genuinely published |
 * | **5 s timeout / abort** | **resolves** — a `console.warn`, treated as success |
 * | every relay hard-rejected | throws |
 *
 * So a resolved charge can mean "no relay confirmed within 5 s", which includes
 * "no relay ever received it". That leniency is deliberate in the shared
 * primitive (it is tuned for presence heartbeats) and is NOT changed here — see
 * `docs/arcade-reward-publication-boundary.md` for why, and for the
 * strict-publish + verify pattern the reward phase will use instead. The
 * consequence for this modal is bounded and worth stating plainly: the failure
 * mode is a pass granted for coins that were never durably deducted, which
 * favours the player, is worth 20 coins, and expires when they leave the arcade.
 *
 * ## Transaction boundary
 *
 * **The pass is granted only after the coin publish resolves.** There is no
 * optimistic pass and no optimistic balance here — an optimistic update is only
 * honest when it is backed by a rollback, and the thing being "rolled back"
 * would be access the player had already used.
 *
 * Three outcomes, each reported differently, because they are not the same
 * thing:
 *
 * 1. **the charge threw** — no pass, and the coins were not deducted;
 * 2. **the charge resolved but storing the pass failed** — the coins may already
 *    be gone, so the copy must NOT claim otherwise. No compensating coin write
 *    is attempted: a refund would be a second unverified publish on top of a
 *    first one whose outcome we do not actually know, and could hand back coins
 *    that were never taken;
 * 3. **full success**.
 *
 * ## Loading and error states
 *
 * The balance used to render as `status.owner?.coins || 0`, so a query in flight
 * — or a failed one — told the player they had zero coins and disabled the
 * button. A transient relay problem presented as "you are broke". Now an
 * unresolved balance is a skeleton, a failed one is an error with a retry, and
 * neither is a number.
 */
export function ArcadePassModal({ isOpen, onClose }: ArcadePassModalProps) {
  const stageOverlayHost = useStageOverlayHost();
  const { status, refreshFromRelay } = useOptimizedStatus();
  const { toast } = useToast();
  const { mutateAsync: changeCoins, isPending: isPurchasing } = useCoinsMutation();
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const isLoadingBalance = status.isLoading;
  // A resolved-but-absent profile is as unknown as a failed one: the player has
  // a balance somewhere, we just could not read it.
  const balanceError = status.error ?? (!isLoadingBalance && !status.owner ? 'Balance unavailable' : null);
  const coins = status.owner?.coins ?? null;

  const canAfford = coins !== null && coins >= ARCADE_PASS_PRICE;
  const canPurchase = !isLoadingBalance && !balanceError && canAfford && !isPurchasing;

  /**
   * Synchronous double-submit guard.
   *
   * `isPending` only becomes true after React re-renders, so two clicks landing
   * in the same tick both pass `canPurchase` and both charge. A ref flips
   * immediately and is therefore the actual guarantee; the disabled button is a
   * UI courtesy on top of it.
   */
  const inFlightRef = useRef(false);

  const handlePurchasePass = async () => {
    if (!canPurchase || coins === null || inFlightRef.current) return;
    inFlightRef.current = true;
    setPurchaseError(null);

    try {
      // The canonical writer re-reads the balance itself, so the number rendered
      // above is a display value only — it is never the basis for the charge.
      await changeCoins(-ARCADE_PASS_PRICE);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not reach a relay';
      setPurchaseError(message);
      toast({
        title: 'Purchase failed',
        description: `${message}. No coins were deducted and no pass was issued.`,
        variant: 'destructive',
      });
      return;
    } finally {
      inFlightRef.current = false;
    }

    // Storage can refuse the write. Granting is the last step and the only one
    // after the coins have (probably) moved, so its failure gets its own copy
    // rather than being folded into "purchase failed".
    if (!grantArcadePass()) {
      setPurchaseError(PASS_STORAGE_FAILED);
      toast({
        title: "Couldn't save your Arcade Pass",
        description:
          'Your coins may already have been spent. Browser storage refused to save the pass — try enabling site data, then buy again.',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Arcade Pass Purchased!',
      description: 'You can now use the elevator to explore different floors.',
    });
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
          'blobbi-card-xl blobbi-gradient-container border-2 border-island-wood/30 rounded-2xl theme-transition',
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center text-island-ink mb-4">
            🎟️ Arcade Pass
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="text-center">
            <div className="blobbi-card rounded-xl p-4 mb-4">
              <img
                src="/assets/items/tickets/arcade-ticket.png"
                alt=""
                aria-hidden
                className="w-20 h-20 mx-auto mb-2"
              />
              <p className="text-lg font-semibold blobbi-text">
                Purchase an Arcade Pass for{' '}
                <span className="icon-yellow font-bold">{ARCADE_PASS_PRICE} coins</span>
              </p>
            </div>

            <div className="blobbi-card rounded-lg p-3 mb-4 border-island-ocean/30">
              <p className="text-sm blobbi-text">
                🎮 Access all arcade floors
                <br />
                🏢 Use the elevator freely
                <br />
                ⏰ Valid until you leave the arcade
              </p>
            </div>

            {/* The balance: a skeleton while unknown, an error when unreadable,
                a number only when it is genuinely a number. */}
            <div className="mb-4 min-h-[1.5rem]" aria-live="polite">
              {isLoadingBalance ? (
                <div className="flex items-center justify-center gap-2 text-sm blobbi-text-muted">
                  <span>Your current coins:</span>
                  <Skeleton className="h-4 w-16" />
                </div>
              ) : balanceError ? (
                <div className="space-y-2">
                  <p className="text-sm text-island-danger">
                    Couldn&apos;t read your coin balance.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPurchaseError(null);
                      refreshFromRelay();
                    }}
                    className="rounded-full"
                  >
                    Try again
                  </Button>
                </div>
              ) : (
                <p className="text-sm blobbi-text-muted">
                  Your current coins:{' '}
                  <span className="font-bold icon-yellow">{coins}</span>
                </p>
              )}
            </div>

            {!isLoadingBalance && !balanceError && !canAfford && (
              <p className="mb-4 text-sm text-island-danger">
                You need {ARCADE_PASS_PRICE} coins to buy an Arcade Pass.
              </p>
            )}

            {purchaseError === PASS_STORAGE_FAILED ? (
              <p role="alert" className="mb-4 text-sm text-island-danger">
                Your coins may already have been spent, but this browser refused to
                save the Arcade Pass. Enable site data for Blobbi Island and buy
                again.
              </p>
            ) : (
              purchaseError && (
                <p role="alert" className="mb-4 text-sm text-island-danger">
                  {purchaseError}. No coins were deducted and no pass was issued.
                </p>
              )
            )}
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isPurchasing}
              className="min-h-[44px] flex-1 blobbi-button rounded-full border-2 border-island-wood/40 hover:bg-island-cream-2"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePurchasePass}
              disabled={!canPurchase}
              className="min-h-[44px] flex-1 bg-island-purple hover:bg-island-purple/90 text-white rounded-full border-0 font-bold shadow-cozy-soft theme-transition"
            >
              {isPurchasing ? 'Buying…' : 'Buy Ticket'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
