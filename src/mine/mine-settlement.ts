/**
 * Mine session settlement — the service the Mine consumes.
 *
 * ## Why the ordering is Coin first
 *
 * Energy (kind:31124) and Coins (kind:31633) are different events. There is
 * **no atomic transaction across them**, and this module does not pretend
 * otherwise: settlement is *recoverable and idempotent*, not atomically
 * committed. Given that, the ordering is the whole design:
 *
 * ```
 *   Coin then energy → a failure between them leaves the player UP
 *   energy then Coin → a failure between them leaves the player DOWN  ← the old bug
 * ```
 *
 * The Coin half already has exactly-once machinery (the Coin op ledger), so it
 * is also the half most likely to resolve cleanly. Energy is only ever
 * attempted once Coins are known applied.
 *
 * ## Immutable finalization
 *
 * `energyDelta` and `coinReward` are frozen into the durable session BEFORE
 * either write. Recovery after a reload settles those recorded numbers and
 * never recomputes them from UI state that no longer exists.
 *
 * ## Ambiguity is never "probably fine"
 *
 * A Coin publish that may have landed stops settlement: energy is not charged
 * against an unconfirmed reward. The session stays `coin-pending` and a later
 * run reconciles it under the same operation id.
 */

import type { CoinWallet } from '@/inventory/coin-wallet';

import {
  mineCoinOpId,
  mineEnergyOpId,
  persistMineSession,
  readMineSession,
  unresolvedMineSessions,
  type MineSessionRecord,
} from './mine-session-ledger';
import type { EnergySettler } from './energy-settlement';

export interface MineSettlementDeps {
  readonly pubkey: string;
  readonly wallet: CoinWallet;
  readonly settler: EnergySettler;
  readonly now?: () => number;
}

export type StartSessionResult =
  | { readonly ok: true; readonly sessionId: string }
  /** Storage refused: no durable identity, so no reward-bearing session. */
  | { readonly ok: false; readonly reason: 'storage-unavailable' };

/** What the results screen needs to know. No implementation jargon. */
export type MineSettlementPhase =
  /** Both sides landed. */
  | 'settled'
  /** The reward could not be confirmed yet; energy has NOT been charged. */
  | 'coin-pending'
  /** Reward is safe; the Blobbi's energy update is still finishing. */
  | 'energy-pending'
  /** Nothing was published and the session is still recoverable. */
  | 'unresolved';

export interface MineSettlementResult {
  readonly phase: MineSettlementPhase;
  /** Coins the run earned, as frozen at finalization. */
  readonly coinReward: number;
  /** True once the Coin grant is known applied. */
  readonly coinApplied: boolean;
}

export interface MineSettlement {
  startSession(input: { petId: string; startEnergy: number }): StartSessionResult;
  /** Freeze the run's numbers. Must succeed before any value-bearing write. */
  finalizeSession(
    sessionId: string,
    values: { energyDelta: number; coinReward: number },
  ): boolean;
  /** Settle (or resume settling) a finalized session. Safe to call repeatedly. */
  settleSession(sessionId: string): Promise<MineSettlementResult>;
  /** A run that ended without finalizing owes nothing. */
  abandonSession(sessionId: string): void;
  /** Sessions that still need action, for startup recovery. */
  pendingSessions(): MineSessionRecord[];
  /**
   * Startup recovery. `open` sessions are abandoned (nothing was durable);
   * finalized/pending ones resume under their original operation ids.
   */
  recoverSessions(): Promise<MineSettlementResult[]>;
}

export function createMineSettlement(deps: MineSettlementDeps): MineSettlement {
  const { pubkey, wallet, settler } = deps;
  const now = deps.now ?? Date.now;

  const save = (record: Omit<MineSessionRecord, 'updatedAt'>): boolean =>
    persistMineSession(pubkey, { ...record, updatedAt: now() });

  const result = (
    record: MineSessionRecord,
    phase: MineSettlementPhase,
  ): MineSettlementResult => ({
    phase,
    coinReward: record.coinReward ?? 0,
    coinApplied: record.coinStatus === 'applied',
  });

  const settle = async (record: MineSessionRecord): Promise<MineSettlementResult> => {
    if (record.status === 'settled') return result(record, 'settled');
    const coinReward = record.coinReward ?? 0;
    const energyDelta = record.energyDelta ?? 0;

    // ── 1. Coins ──────────────────────────────────────────────────────────
    let current = record;
    if (current.coinStatus !== 'applied') {
      if (coinReward <= 0) {
        current = { ...current, coinStatus: 'applied', updatedAt: now() };
        save(current);
      } else {
        save({ ...current, status: 'coin-pending' });
        try {
          const outcome = await wallet.grantCoins({
            opId: mineCoinOpId(current.sessionId),
            amount: coinReward,
            label: 'mine-reward',
          });
          if (outcome.status === 'applied' || outcome.status === 'already-applied') {
            current = { ...current, coinStatus: 'applied', updatedAt: now() };
            save({ ...current, status: 'coin-pending' });
          } else {
            // ambiguous | blocked | skipped: the grant MAY have landed. Do NOT
            // charge energy against an unconfirmed reward.
            current = { ...current, coinStatus: 'ambiguous', updatedAt: now() };
            save({ ...current, status: 'coin-pending' });
            return result(current, 'coin-pending');
          }
        } catch {
          // Provably unsent (or a wallet-level refusal). Retryable, same opId.
          current = { ...current, coinStatus: 'failed', updatedAt: now() };
          save({ ...current, status: 'coin-pending' });
          return result(current, 'unresolved');
        }
      }
    }

    // ── 2. Energy ─────────────────────────────────────────────────────────
    if (energyDelta <= 0) {
      current = { ...current, energyStatus: 'applied', updatedAt: now() };
      save({ ...current, status: 'settled' });
      return result(current, 'settled');
    }

    save({ ...current, status: 'energy-pending' });
    const energy = await settler.settleEnergyDelta({
      opId: mineEnergyOpId(current.sessionId),
      petId: current.petId,
      amount: energyDelta,
      label: 'mine-energy',
    });

    if (energy.status === 'applied' || energy.status === 'already-applied') {
      current = { ...current, energyStatus: 'applied', updatedAt: now() };
      save({ ...current, status: 'settled' });
      return result(current, 'settled');
    }
    if (energy.status === 'ambiguous' || energy.status === 'blocked') {
      current = { ...current, energyStatus: 'ambiguous', updatedAt: now() };
      save({ ...current, status: 'energy-pending' });
      return result(current, 'energy-pending');
    }
    // Provably unsent: the reward is safe and the same energy opId can retry.
    current = { ...current, energyStatus: 'failed', updatedAt: now() };
    save({ ...current, status: 'energy-pending' });
    return result(current, 'energy-pending');
  };

  return {
    startSession({ petId, startEnergy }): StartSessionResult {
      const startedAt = now();
      const sessionId = mintMineSessionId(startedAt);
      const ok = save({
        sessionId,
        petId,
        status: 'open',
        startedAt,
        startEnergy,
      });
      // No durable operation identity ⇒ no value-bearing operation. Same rule
      // the Coin wallet applies before it publishes.
      if (!ok) return { ok: false, reason: 'storage-unavailable' };
      return { ok: true, sessionId };
    },

    finalizeSession(sessionId, { energyDelta, coinReward }): boolean {
      const record = readMineSession(pubkey, sessionId);
      if (!record) return false;
      // Frozen once: a later call never re-writes the numbers.
      if (record.status !== 'open') return true;
      return save({
        ...record,
        status: 'finalized',
        energyDelta: Math.max(0, Math.trunc(energyDelta)),
        coinReward: Math.max(0, Math.trunc(coinReward)),
        finishedAt: now(),
      });
    },

    async settleSession(sessionId): Promise<MineSettlementResult> {
      const record = readMineSession(pubkey, sessionId);
      if (!record) {
        return { phase: 'unresolved', coinReward: 0, coinApplied: false };
      }
      if (record.status === 'open') {
        // Never settle a run whose numbers were not frozen.
        return { phase: 'unresolved', coinReward: 0, coinApplied: false };
      }
      if (record.status === 'abandoned') {
        return { phase: 'settled', coinReward: 0, coinApplied: false };
      }
      return settle(record);
    },

    abandonSession(sessionId): void {
      const record = readMineSession(pubkey, sessionId);
      if (!record || record.status !== 'open') return;
      save({ ...record, status: 'abandoned', note: 'never-finalized' });
    },

    pendingSessions(): MineSessionRecord[] {
      return unresolvedMineSessions(pubkey);
    },

    async recoverSessions(): Promise<MineSettlementResult[]> {
      const results: MineSettlementResult[] = [];
      for (const record of unresolvedMineSessions(pubkey)) {
        if (record.status === 'open') {
          // Nothing was ever owed: no reward fixed, no energy spent. The
          // player loses nothing, and we never fabricate a reward.
          save({ ...record, status: 'abandoned', note: 'recovered-open' });
          continue;
        }
        results.push(await settle(record));
      }
      return results;
    },
  };
}

/** A session id: unique per run, never security-bearing. */
export function mintMineSessionId(nowMs: number): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${nowMs.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
