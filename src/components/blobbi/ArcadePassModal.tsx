import { useRef, useState } from 'react';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { useCoinBalance, useCoinWallet } from '@/inventory/useCoinWallet';
import { mintCoinOpId, CoinWalletError } from '@/inventory/coin-wallet';
import { grantArcadePass } from '@/lib/arcade-pass';
import { closeSpendIntent, openSpendIntent } from '@/lib/coin-spend-intent';

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
 * **The pass is granted only after the spend reports `applied` (or
 * `already-applied` — an earlier attempt of THIS purchase landed).** The
 * purchase's identity is a durable SPEND INTENT (see
 * `src/lib/coin-spend-intent.ts`, sessionStorage — the same tab-visit scope as
 * the pass itself): pressing Buy again reuses the same wallet opId, so the
 * wallet reconciles the earlier attempt instead of debiting independently.
 * Failure shapes, each with its own copy, because they are not the same:
 *
 * 1. **the spend threw** — provably pre-publish (insufficient funds, signer
 *    refusal…): no pass, and no coins moved. The intent is kept; reusing an
 *    unsent opId on retry is harmless;
 * 2. **the spend is `ambiguous`** — the publish MAY have landed. No pass is
 *    granted; the intent is KEPT, so Buy again first checks that charge and
 *    cannot charge twice for this pass;
 * 3. **the spend is `blocked`** — a previous attempt is still unresolved and
 *    unprovable for now; nothing new was charged;
 * 4. **the spend applied but storing the pass failed** — the coins are gone;
 *    the copy says so honestly, and the KEPT intent makes "buy again" deliver
 *    the already-paid pass rather than charging anew. No compensating grant
 *    is attempted (a refund would be a second value mutation for a storage
 *    problem).
 */
export function ArcadePassModal({ isOpen, onClose }: ArcadePassModalProps) {
  const { balance: coins, isLoading: isLoadingBalance, isError, refetch } = useCoinBalance();
  const { toast } = useToast();
  const { user } = useCurrentUser();
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

    // ONE durable identity for this purchase, scoped like the pass itself
    // (sessionStorage: survives a reload in this tab; a new tab is a new
    // visit and a genuinely new purchase). Buy pressed again reuses the same
    // wallet opId, so the wallet reconciles instead of re-debiting.
    const opened = openSpendIntent(
      user?.pubkey,
      { surface: 'arcade-pass', amount: ARCADE_PASS_PRICE },
      () => mintCoinOpId('arcade-pass'),
    );
    if (!opened) {
      const message = user?.pubkey
        ? 'This browser is blocking site data, so the purchase cannot be tracked safely. Nothing was charged.'
        : 'You must be logged in to buy an Arcade Pass.';
      setPurchaseError(message);
      toast({ title: 'Purchase failed', description: message, variant: 'destructive' });
      inFlightRef.current = false;
      setIsPurchasing(false);
      return;
    }

    let alreadyPaid = false;
    try {
      // The wallet re-reads the authoritative balance itself, so the number
      // rendered above is a display value only — never the basis for the
      // charge. One durable operation per logical purchase.
      const outcome = await spendCoins({
        opId: opened.intent.intentId,
        amount: ARCADE_PASS_PRICE,
        label: 'arcade-pass',
      });
      if (outcome.status === 'ambiguous') {
        const message =
          'The charge could not be confirmed yet, so no pass was issued. Press Buy again — it checks this charge first, so you cannot be charged twice for this pass.';
        setPurchaseError(`${CHARGE_AMBIGUOUS_PREFIX}${message}`);
        toast({
          title: 'Purchase not confirmed',
          description: message,
          variant: 'destructive',
        });
        return;
      }
      if (outcome.status === 'blocked') {
        const message =
          'Your previous attempt is still being verified — nothing new was charged. Try again in a moment.';
        setPurchaseError(`${CHARGE_AMBIGUOUS_PREFIX}${message}`);
        toast({
          title: 'Previous purchase still unresolved',
          description: message,
          variant: 'destructive',
        });
        return;
      }
      alreadyPaid = outcome.status === 'already-applied';
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
    // rather than being folded into "purchase failed". The intent stays OPEN
    // here on purpose: Buy again then resolves as `already-applied` and
    // delivers the paid pass without a second charge.
    if (!grantArcadePass()) {
      setPurchaseError(PASS_STORAGE_FAILED);
      toast({
        title: "Couldn't save your Arcade Pass",
        description:
          'Your coins may already have been spent, but the pass could not be saved. Enable site data, then press Buy again — the paid pass is delivered without a new charge.',
        variant: 'destructive',
      });
      return;
    }

    // Paid AND delivered: only now is the purchase finished, so only now does
    // the intent close (a later pass purchase is a genuinely new operation).
    closeSpendIntent(user?.pubkey, 'arcade-pass', opened.intent.intentId);

    toast({
      title: 'Arcade Pass Purchased!',
      description: alreadyPaid
        ? 'Your earlier purchase went through — no new charge was made. You can now use the elevator.'
        : 'You can now use the elevator to explore different floors.',
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
            Arcade Pass. Enable site data for Blobbi Island and press Buy again — the
            paid pass is delivered without a new charge.
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
