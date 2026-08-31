/**
 * The token counter — where Blobbi Coins become Arcade Tokens.
 *
 * This is the counter that used to sell the old Coin-priced Arcade Pass. It
 * sells the arcade's entry currency now, which is the same booth doing the
 * same job for the redesigned economy: it is where you pay to play.
 *
 * Deliberately NOT the Prize Counter. That one takes Arcade Tickets and hands
 * out prizes; this one takes Coins and hands out Tokens. Opposite ends of the
 * loop, and the copy here says so rather than leaving the player to work it
 * out from two similar-looking counters.
 */

import { useState } from 'react';

import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { Button } from '@/components/ui/button';
import { PriceTag } from '@/components/ui/item-tile';
import { CoinAmount } from '@/components/blobbi/CoinAmount';
import { useToast } from '@/hooks/useToast';
import { useCoinBalance } from '@/inventory/useCoinWallet';
import { useArcadeTokenBalance, useBuyArcadeTokens } from '@/hooks/useArcadeTokens';
import { formatFreePlays, formatPassRemaining, useArcadePass } from '@/hooks/useArcadePass';
import {
  ARCADE_TOKEN_PURCHASE_OPTIONS,
  arcadeTokenCoinCost,
} from '@/arcade/tokens/token-store';

import { ArcadeTokenAmount } from './ArcadeTokenAmount';

interface ArcadeTokenShopModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ArcadeTokenShopModal({ isOpen, onClose }: ArcadeTokenShopModalProps) {
  const { balance: coins, isLoading: coinsLoading } = useCoinBalance();
  const { balance: tokens, isLoading: tokensLoading } = useArcadeTokenBalance();
  const { mutateAsync: buyTokens, isPending } = useBuyArcadeTokens();
  const { toast } = useToast();
  const { isActive: hasPass, isUsable: passUsable, remainingMs, remainingFreePlays } = useArcadePass();
  const [error, setError] = useState<string | null>(null);

  /**
   * Synchronous double-submit guard, the pattern the shop and the pass
   * purchase both settled on: `isPending` flips a render too late to be the
   * gate, and this is real money.
   */
  const [inFlight, setInFlight] = useState(false);

  const buy = async (quantity: number) => {
    if (inFlight || isPending) return;
    setInFlight(true);
    setError(null);
    try {
      const result = await buyTokens({ quantity });
      if (result.outcome === 'applied') {
        toast({
          title: 'Tokens added',
          description: `You bought ${quantity} Arcade Token${quantity === 1 ? '' : 's'}.`,
        });
        return;
      }
      const message =
        result.outcome === 'blocked'
          ? 'Your earlier purchase is still being verified — nothing new was charged. Try again in a moment.'
          : 'That purchase could not be confirmed yet. Buying the same amount again checks this attempt first, so you cannot be charged twice for it.';
      setError(message);
      toast({ title: 'Purchase not confirmed', description: message, variant: 'destructive' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
      toast({ title: 'Purchase failed', description: message, variant: 'destructive' });
    } finally {
      setInFlight(false);
    }
  };

  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="sm"
      title="Token counter"
      description="Arcade Tokens let you play the games."
      icon="🕹️"
      footer={
        <Button variant="soft" onClick={onClose} className="min-h-[44px]">
          Done
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-panel border border-island-wood/20 bg-island-cream-2/60 px-3 py-2 text-sm">
          <span className="text-island-ink-soft">Your tokens</span>
          <ArcadeTokenAmount amount={tokens} loading={tokensLoading} />
        </div>
        <div className="flex items-center justify-between rounded-panel border border-island-wood/20 bg-island-cream-2/60 px-3 py-2 text-sm">
          <span className="text-island-ink-soft">Your coins</span>
          <CoinAmount amount={coins} loading={coinsLoading} />
        </div>

        {/*
          A pass holder is not being charged, and the counter is where they
          would come to find out why. Saying nothing here reads as a bug.

          The two states are told apart carefully. A Pass covers a LIMITED
          number of plays, so "you don't need tokens" is true only while the
          allowance lasts — telling an exhausted pass holder the same thing
          would send them away from the one counter that can help them.
        */}
        {hasPass && passUsable && (
          <p
            className="rounded-panel border border-island-purple/30 bg-island-purple/10 px-3 py-2 text-sm text-island-ink"
            data-pass-notice="usable"
          >
            Your Arcade Pass covers {formatFreePlays(remainingFreePlays)}, for another{' '}
            {formatPassRemaining(remainingMs)}. Tokens are only needed once those run out.
          </p>
        )}
        {hasPass && !passUsable && (
          <p
            className="rounded-panel border border-island-wood/30 bg-island-cream-2/60 px-3 py-2 text-sm text-island-ink"
            data-pass-notice="exhausted"
          >
            Your Arcade Pass free plays are used up. Games cost Arcade Tokens again —
            the pass itself expires in {formatPassRemaining(remainingMs)}.
          </p>
        )}

        <ul className="space-y-2">
          {ARCADE_TOKEN_PURCHASE_OPTIONS.map((quantity) => {
            const cost = arcadeTokenCoinCost(quantity);
            const affordable = coins !== null && coins >= cost;
            return (
              <li key={quantity}>
                <Button
                  variant="accent"
                  className="min-h-[44px] w-full justify-between"
                  disabled={!affordable || inFlight || isPending || coins === null}
                  onClick={() => void buy(quantity)}
                  data-token-offer={quantity}
                >
                  <span className="inline-flex items-center gap-1">
                    <ArcadeTokenAmount amount={quantity} />
                  </span>
                  <PriceTag amount={cost} affordable={affordable} />
                </Button>
              </li>
            );
          })}
        </ul>

        <p className="text-center text-xs text-island-ink-soft">
          Tokens are what you spend to play. Arcade Tickets are what the games
          pay you — take those to the prize counter.
        </p>

        {error && (
          <p role="alert" className="text-sm text-island-danger">
            {error}
          </p>
        )}
      </div>
    </BlobbiModal>
  );
}
