/**
 * Blobbi Coin: the ONE identity/config module for the official currency.
 *
 * Everything Coin-shaped in production imports these constants; nothing else
 * may hardcode the address, the `d`, or the issuer. The definition itself is
 * registered once in `src/protocol/event-registry.ts` and resolved through
 * the established official item path (relay fetch with exact-issuer trust,
 * bundled fallback otherwise): this module deliberately does NOT duplicate
 * the event JSON.
 *
 * ## Identity
 *
 * The canonical identity is the STABLE ADDRESS
 * `31632:<issuer>:blobbi:currency:coin`. The event id of the currently
 * published revision is recorded below for diagnostics/verification only,
 * a definition can be republished (new id, same address) without anything
 * about ownership changing. Never use the event id as identity.
 *
 * ## Balance bounds
 *
 * The published definition intentionally omits `max_stack` (optional per the
 * inventory spec; games MAY ignore it). For currency safety the application
 * enforces its own explicit ceiling, {@link MAX_COIN_BALANCE}, in the wallet:
 * a mutation that would exceed it is REJECTED, never silently clamped.
 */

import {
  BLOBBI_COIN_D as REGISTRY_COIN_D,
  BLOBBI_COIN_IMAGE_URL,
  BLOBBI_COIN_IMAGE_BACK_URL,
  OFFICIAL_ISSUER_PUBKEY,
  officialItemAddress,
} from '@/protocol/event-registry';

export const BLOBBI_COIN_D = REGISTRY_COIN_D;

/** The official issuer, same trust root as every official item. */
export const BLOBBI_COIN_ISSUER = OFFICIAL_ISSUER_PUBKEY;

/** `31632:<issuer>:blobbi:currency:coin`: derived, never hand-written. */
export const BLOBBI_COIN_ADDRESS = officialItemAddress(BLOBBI_COIN_D);

export const BLOBBI_COIN_NAME = 'Blobbi Coin';

/** The published `symbol` tag; the emoji fallback when artwork is unavailable. */
export const BLOBBI_COIN_SYMBOL = '🪙';

export { BLOBBI_COIN_IMAGE_URL, BLOBBI_COIN_IMAGE_BACK_URL };

/**
 * Event id of the CURRENTLY OBSERVED published definition revision.
 * Diagnostics and publication verification only; never identity.
 */
export const BLOBBI_COIN_DEFINITION_EVENT_ID =
  'fe3fce5a69d3fd93341a4b2d689bf3c97a986882fd5380d39ea1de8176d82797';

/**
 * Application-level balance ceiling, far above any legitimate balance, far
 * below `Number.MAX_SAFE_INTEGER` so additions can never approach unsafe
 * arithmetic. A grant that would exceed it is rejected loudly.
 */
export const MAX_COIN_BALANCE = 1_000_000_000;

/** Why a coin amount was refused. */
export type CoinAmountProblem =
  | 'not-a-number'
  | 'not-finite'
  | 'not-an-integer'
  | 'negative'
  | 'zero'
  | 'exceeds-maximum';

/**
 * Validate a single mutation amount (a grant or a spend). Returns the problem
 * or `null` when valid. Zero is reported so callers can implement their
 * documented no-op contract explicitly rather than publishing pointless
 * replacement events.
 */
export function coinAmountProblem(amount: number): CoinAmountProblem | null {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return 'not-a-number';
  if (!Number.isFinite(amount)) return 'not-finite';
  if (!Number.isInteger(amount)) return 'not-an-integer';
  if (amount < 0) return 'negative';
  if (amount === 0) return 'zero';
  if (amount > MAX_COIN_BALANCE) return 'exceeds-maximum';
  return null;
}

/** Is `balance` a well-formed stored balance (0..MAX, safe integer)? */
export function isValidCoinBalance(balance: number): boolean {
  return (
    typeof balance === 'number' &&
    Number.isSafeInteger(balance) &&
    balance >= 0 &&
    balance <= MAX_COIN_BALANCE
  );
}
