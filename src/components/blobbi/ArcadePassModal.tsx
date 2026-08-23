import { useRef, useState } from 'react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/useToast';
import { useCoinBalance, useCoinWallet } from '@/inventory/useCoinWallet';
import { mintCoinOpId, CoinWalletError } from '@/inventory/coin-wallet';
import { grantArcadePass } from '@/lib/arcade-pass';

/** What an Arcade Pass costs, in Blobbi Coins. */
export const ARCADE_PASS_PRICE = 20;

/**
 * Sentinel distinguishing "the charge failed" from "the charge went through but
 * the pass could not be stored". The two need different copy: only the first can
 * honestly promise that no coins moved.
 */
const PASS_STORAGE_FAILED = '__pass-storage-failed__';

/**
 * Prefix marking an AMBIGUOUS charge message: the "no coins were deducted"
 * suffix would be a lie there, so the alert renders these verbatim.
 */
const CHARGE_AMBIGUOUS_PREFIX = '__ambiguous__';

interface ArcadePassModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Buy an Arcade Pass.
 *
 * ## Coin cutover
 *
 * The charge is a canonical Coin WALLET spend (official Blobbi Coin quantity
 * in kind:31633) — fresh authoritative balance read, strict publish (a
 * timeout is AMBIGUOUS, never success), durable per-operation ledger, and
 * read-back verification. The old kind:11125 path (and before it, the local
 * `updateOwnerCoins` mutation that published nothing at all) is gone.
 *
 * ## Transaction boundary
 *
 * **The pass is granted only after the spend reports `applied`.** Three
 * failure shapes, each with its own copy, because they are not the same:
 *
 * 1. **the spend threw** — provably pre-publish (insufficient funds, signer
 *    refusal…): no pass, and no coins moved;
 * 2. **the spend is `ambiguous`** — the publish MAY have landed. No pass is
 *    granted and no retry is offered here: the durable operation record
 *    blocks a duplicate, and reconciliation resolves it on the next wallet
 *    touch. The copy never claims the coins are safe;
 * 3. **the spend applied but storing the pass failed** — the coins are gone;
 *    the copy says so honestly. No compensating grant is attempted (a refund
 *    would be a second value mutation for a storage problem).
 */
export function ArcadePassModal({ isOpen, onClose }: ArcadePassModalProps) {
  const { balance: coins, isLoading: isLoadingBalance, isError, refetch } = useCoinBalance();
  const { toast } = useToast();
  const { spendCoins } = useCoinWallet();
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const balanceError = isError ? 'Balance unavailable' : null;

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
    setIsPurchasing(true);
    setPurchaseError(null);

    try {
      // The wallet re-reads the authoritative balance itself, so the number
      // rendered above is a display value only — never the basis for the
      // charge. One durable operation per attempt.
      const outcome = await spendCoins({
        opId: mintCoinOpId('arcade-pass'),
        amount: ARCADE_PASS_PRICE,
        label: 'arcade-pass',
      });
      if (outcome.status === 'ambiguous' || outcome.status === 'blocked') {
        const message =
          'The charge could not be confirmed. It will be reconciled — no pass was issued and nothing will be charged twice.';
        setPurchaseError(`${CHARGE_AMBIGUOUS_PREFIX}${message}`);
        toast({
          title: 'Purchase not confirmed',
          description: message,
          variant: 'destructive',
        });
        return;
      }
    } catch (error) {
      const message =
        error instanceof CoinWalletError && error.reason === 'insufficient-funds'
          ? 'Not enough Blobbi Coins'
          : error instanceof Error
            ? error.message
            : 'Could not reach a relay';
      setPurchaseError(message);
      toast({
        title: 'Purchase failed',
        description: `${message}. No coins were deducted and no pass was issued.`,
        variant: 'destructive',
      });
      return;
    } finally {
      inFlightRef.current = false;
      setIsPurchasing(false);
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
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="sm"
      title="Arcade Pass"
      description={`Costs ${ARCADE_PASS_PRICE} coins. Valid until you leave the arcade.`}
      icon="🎟️"
      footer={
        <>
          <Button
            variant="soft"
            onClick={onClose}
            disabled={isPurchasing}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            variant="accent"
            onClick={handlePurchasePass}
            disabled={!canPurchase}
            className="min-h-[44px]"
          >
            {isPurchasing ? 'Buying…' : 'Buy Ticket'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-center">
        <div className="rounded-panel border border-island-wood/20 bg-island-cream-2/60 p-4">
          <img
            src="/assets/items/tickets/arcade-ticket.png"
            alt=""
            aria-hidden
            className="mx-auto mb-2 size-20"
          />
          <p className="text-sm font-semibold text-island-ink">
            Access every arcade floor and the elevator.
          </p>
        </div>

        {/* The balance: a skeleton while unknown, an error when unreadable, a
            number only when it is genuinely a number. */}
        <div className="min-h-[1.5rem]" aria-live="polite">
          {isLoadingBalance ? (
            <div className="flex items-center justify-center gap-2 text-sm text-island-ink-soft">
              <span>Your current coins:</span>
              <Skeleton className="h-4 w-16" />
            </div>
          ) : balanceError ? (
            <div className="space-y-2">
              <p className="text-sm text-island-danger">Couldn&apos;t read your coin balance.</p>
              <Button
                type="button"
                variant="soft"
                size="sm"
                onClick={() => {
                  setPurchaseError(null);
                  refetch();
                }}
                className="min-h-[44px] rounded-full"
              >
                Try again
              </Button>
            </div>
          ) : (
            <p className="text-sm text-island-ink-soft">
              Your current coins: <span className="font-bold text-island-warn">{coins}</span>
            </p>
          )}
        </div>

        {!isLoadingBalance && !balanceError && !canAfford && (
          <p className="text-sm text-island-danger">
            You need {ARCADE_PASS_PRICE} coins to buy an Arcade Pass.
          </p>
        )}

        {purchaseError === PASS_STORAGE_FAILED ? (
          <p role="alert" className="text-sm text-island-danger">
            Your coins may already have been spent, but this browser refused to save the
            Arcade Pass. Enable site data for Blobbi Island and buy again.
          </p>
        ) : (
          purchaseError && (
            <p role="alert" className="text-sm text-island-danger">
              {purchaseError.startsWith(CHARGE_AMBIGUOUS_PREFIX)
                ? purchaseError.slice(CHARGE_AMBIGUOUS_PREFIX.length)
                : `${purchaseError}. No coins were deducted and no pass was issued.`}
            </p>
          )
        )}
      </div>
    </BlobbiModal>
  );
}
