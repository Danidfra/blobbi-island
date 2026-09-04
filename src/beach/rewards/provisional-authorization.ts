/**
 * PROVISIONAL Beach reward authorization, the TEMPORARY, client-trusted
 * issuance layer.
 *
 * ## What this is, and is not
 *
 * The official Blobbi Coin item is real, and the balance it moves is the
 * player's canonical kind:31633 quantity. What is provisional is the
 * AUTHORIZATION: this module decides locally, in the official client, that a
 * finished hunt deserves its Coins, and then asks the canonical wallet to
 * apply them. Nothing here is an official grant, proves the player honestly
 * completed the minigame, or resists a modified client, the ledger, locks
 * and read-backs protect against ACCIDENTAL duplication and loss, not
 * cheating. Do not describe it otherwise anywhere.
 *
 * ## The replacement seam
 *
 * `TreasureHuntRewardAuthorizer` is the interface a future issuer-grant flow
 * implements instead:
 *
 * ```
 *   today:   finalized result → provisional local authorization → wallet grant
 *   future:  finalized result → request/receive official grant → verify
 *            → wallet-applied mutation
 * ```
 *
 * The Treasure Hunt model, the result calculation, the reward formula, the
 * HUD, shop spending and the balance reader all sit on the far sides of this
 * seam and must not change when it is swapped.
 *
 * ## Responsibilities (and non-responsibilities)
 *
 * Verifies round/result eligibility, fixes the deterministic amount in the
 * durable Beach ledger BEFORE any publish, and invokes the canonical Coin
 * wallet under the reservation's operation id (one id from reservation to
 * Coins: exactly-once end to end). It contains NO inventory serialization,
 * relay handling or publish logic: that is the wallet's.
 */

import type { TreasureHuntResult } from '@/beach/treasure-hunt';
import type { CoinWallet } from '@/inventory/coin-wallet';
import {
  finalizeBeachReward,
  readBeachRewardOp,
  resolveBeachReward,
} from '@/lib/beach-reward-ledger';

import { calculateTreasureHuntReward, rewardEligibility, type TreasureHuntCoinReward } from './coin-reward';
import type { BeachRewardPolicy } from './policy';

export type AuthorizeOutcome =
  /** Coins granted (or already granted earlier for this operation). */
  | {
      readonly status: 'applied';
      readonly reward: TreasureHuntCoinReward;
      readonly alreadyApplied: boolean;
    }
  /** The grant MAY have published. Durably recorded; reconcile, never retry blindly. */
  | { readonly status: 'ambiguous'; readonly reward: TreasureHuntCoinReward }
  /** Provably-unsent failure (signer, funds cap, ledger). Retry is safe. */
  | { readonly status: 'failed'; readonly reward: TreasureHuntCoinReward; readonly message: string }
  /** The finished round does not qualify. No slot interaction here. */
  | { readonly status: 'ineligible'; readonly reason: string }
  /** No usable reservation (missing/abandoned): nothing to pay. */
  | { readonly status: 'no-reservation' };

export interface TreasureHuntRewardAuthorizer {
  authorize(result: TreasureHuntResult, opId: string): Promise<AuthorizeOutcome>;
}

export interface ProvisionalAuthorizerDeps {
  readonly pubkey: string;
  readonly wallet: CoinWallet;
  readonly policy: BeachRewardPolicy;
  readonly now?: () => number;
}

export function createProvisionalTreasureHuntAuthorizer(
  deps: ProvisionalAuthorizerDeps,
): TreasureHuntRewardAuthorizer {
  const { pubkey, wallet, policy } = deps;
  const now = deps.now ?? Date.now;

  return {
    async authorize(result, opId): Promise<AuthorizeOutcome> {
      const op = readBeachRewardOp(pubkey, opId);
      if (!op || op.status === 'abandoned') return { status: 'no-reservation' };

      // Eligibility is re-checked even on resume; the reservation alone is
      // never authorization.
      const eligibility = rewardEligibility(result, policy);
      if (!eligibility.eligible) {
        return { status: 'ineligible', reason: eligibility.reason };
      }
      const reward = calculateTreasureHuntReward(result, policy);
      if (!reward) return { status: 'ineligible', reason: 'not-eligible' };

      if (op.status === 'applied') {
        return { status: 'applied', reward, alreadyApplied: true };
      }

      // Fix the amount durably BEFORE any grant. If this cannot land, no
      // publish happens: the same no-record-no-publish rule as the wallet.
      if (!finalizeBeachReward(pubkey, opId, reward.totalCoins, now())) {
        return {
          status: 'failed',
          reward,
          message: 'Could not durably record the reward; nothing was granted.',
        };
      }

      try {
        const outcome = await wallet.grantCoins({
          opId,
          amount: reward.totalCoins,
          label: 'beach-reward',
        });
        switch (outcome.status) {
          case 'applied':
            resolveBeachReward(pubkey, opId, 'applied', now());
            return { status: 'applied', reward, alreadyApplied: false };
          case 'already-applied':
            resolveBeachReward(pubkey, opId, 'applied', now());
            return { status: 'applied', reward, alreadyApplied: true };
          case 'ambiguous':
          case 'blocked':
            resolveBeachReward(pubkey, opId, 'ambiguous', now());
            return { status: 'ambiguous', reward };
          case 'skipped':
            // Beach reward ops carry no precondition, so the wallet can never
            // skip them; typed for exhaustiveness only.
            return {
              status: 'failed',
              reward,
              message: 'The reward grant was skipped unexpectedly.',
            };
        }
      } catch (error) {
        // Provably pre-publish: the op stays `finalized` and MAY be retried.
        return {
          status: 'failed',
          reward,
          message: error instanceof Error ? error.message : 'The reward could not be sent',
        };
      }
    },
  };
}
