/**
 * Mine session settlement, the service the Mine consumes.
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
 *
 * ## One run at a time
 *
 * `startSession` refuses while another run is in progress, so a second run
 * cannot be played against a Blobbi's energy while the first is still going.
 *
 * ```
 *   blocks a new run   open (and still heartbeating)
 *   does NOT block     finalized / coin-pending / energy-pending  ← gameplay
 *                      is over; blocking would shut the Mine until a relay
 *                      recovers
 *                      settled / abandoned                        ← terminal
 *                      open but gone quiet                        ← debris
 * ```
 *
 * Liveness comes from the playing tab's heartbeat on `updatedAt`, not from a
 * held lock: gameplay holds nothing, so a crashed tab frees the Mine by
 * falling silent rather than by being cleaned up. That is also why recovery
 * does not abandon every `open` record it finds; it runs whenever the cave
 * is opened, including in a second tab, and doing so voided the run being
 * played in the first.
 *
 * ## Why the lock spans both entry points
 *
 * `startSession` and `finalizeSession` both mutate `open` records, the first
 * sweeps debris and creates, the second freezes, so they share ONE queued
 * cross-tab critical section. Without it a finalize could read its record as
 * `open`, a concurrent start could sweep that same record as stale, and the
 * finalize would then write over the sweep's decision. Neither order loses
 * value (operation ids are deterministic and the Coin ledger is
 * exactly-once), but the state machine is only coherent if one writer touches
 * an `open` record at a time.
 *
 * There is no Coin budget to protect: the Mine has no daily cap. A run
 * freezes and settles the full reward its gems were worth.
 */

import type { CoinWallet } from '@/inventory/coin-wallet';

import { withQueuedCrossTabLock } from '@/lib/cross-tab-op-lock';

import {
  mineCoinOpId,
  mineEnergyOpId,
  partitionOpenMineSessions,
  persistMineSession,
  readMineSession,
  touchMineSession,
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
  | { readonly ok: false; readonly reason: 'storage-unavailable' }
  /**
   * Another tab is already playing a rewarded run for this account. Refused
   * so the Blobbi's energy is not spent on a run whose reward a concurrent
   * one may already have claimed.
   */
  | { readonly ok: false; readonly reason: 'session-in-progress' };

/** Outcome of freezing a run's numbers. */
export type FinalizeSessionResult =
  | {
      readonly ok: true;
      /** The reward frozen into the session, the run's full gem value. */
      readonly coinReward: number;
    }
  | { readonly ok: false; readonly reason: 'unknown-session' | 'storage-unavailable' };

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
  /**
   * Open a rewarded run, if one may be opened.
   *
   * Async because the whole check-and-create runs in the shared queued
   * cross-tab critical section; see the module note. The lock is released as
   * soon as the durable record exists; gameplay itself holds nothing.
   */
  startSession(input: {
    petId: string;
    startEnergy: number;
  }): Promise<StartSessionResult>;
  /**
   * Tell the ledger this run is still being played.
   *
   * Cheap and idempotent; the playing tab calls it on a timer. Only an `open`
   * record is touched, so a late beat cannot revive a finished run.
   */
  heartbeatSession(sessionId: string): void;
  /**
   * Freeze the run's numbers.
   *
   * Async because it runs in the same queued cross-tab critical section as
   * `startSession`: see the module note on why both must serialize. Must
   * succeed before any value-bearing write.
   */
  finalizeSession(
    sessionId: string,
    values: { energyDelta: number; coinReward: number },
  ): Promise<FinalizeSessionResult>;
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
    async startSession({ petId, startEnergy }): Promise<StartSessionResult> {
      // ONE critical section for the whole decision, on the SAME lock name
      // finalization takes: two tabs cannot both see "nothing active" and both
      // create a session, and a start queued behind a finalize sees the budget
      // that finalize just spent.
      const { value } = await withQueuedCrossTabLock(
        `blobbi-mine-budget:${pubkey}`,
        async (): Promise<StartSessionResult> => {
          const startedAt = now();

          // Debris first: an `open` record whose tab stopped heartbeating owes
          // nothing and must not keep the Mine shut.
          const { active, stale } = partitionOpenMineSessions(pubkey, startedAt);
          for (const record of stale) {
            save({ ...record, status: 'abandoned', note: 'stale-open-session' });
          }
          if (active.length > 0) {
            return { ok: false, reason: 'session-in-progress' };
          }

          const sessionId = mintMineSessionId(startedAt);
          const ok = save({
            sessionId,
            petId,
            status: 'open',
            startedAt,
            startEnergy,
          });
          // No durable operation identity ⇒ no value-bearing operation. Same
          // rule the Coin wallet applies before it publishes.
          if (!ok) return { ok: false, reason: 'storage-unavailable' };
          return { ok: true, sessionId };
        },
      );
      return value;
    },

    heartbeatSession(sessionId): void {
      touchMineSession(pubkey, sessionId, now());
    },

    async finalizeSession(
      sessionId,
      { energyDelta, coinReward },
    ): Promise<FinalizeSessionResult> {
      // Same critical section as `startSession`: both mutate `open` records,
      // and a freeze must not interleave with another tab's stale sweep.
      const { value } = await withQueuedCrossTabLock(
        `blobbi-mine-budget:${pubkey}`,
        async (): Promise<FinalizeSessionResult> => {
          const record = readMineSession(pubkey, sessionId);
          if (!record) return { ok: false, reason: 'unknown-session' };

          // Frozen once: a later call never re-writes the numbers, and never
          // spends the budget a second time. Recovery therefore replays
          // exactly what the run was worth when it ended.
          if (record.status !== 'open') {
            return { ok: true, coinReward: record.coinReward ?? 0 };
          }

          const frozen = Math.max(0, Math.trunc(coinReward));
          const stored = save({
            ...record,
            status: 'finalized',
            energyDelta: Math.max(0, Math.trunc(energyDelta)),
            coinReward: frozen,
            finishedAt: now(),
          });
          if (!stored) return { ok: false, reason: 'storage-unavailable' };
          return { ok: true, coinReward: frozen };
        },
      );
      return value;
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
      const { stale } = partitionOpenMineSessions(pubkey, now());
      const staleIds = new Set(stale.map((record) => record.sessionId));
      for (const record of unresolvedMineSessions(pubkey)) {
        if (record.status === 'open') {
          // Debris is abandoned; nothing was ever owed, so the player loses
          // nothing and no reward is fabricated. A session still being
          // heartbeaten is LEFT ALONE: recovery runs whenever the cave is
          // opened, including in a second tab, and abandoning a live run there
          // would silently void the run someone is playing in the first.
          if (!staleIds.has(record.sessionId)) continue;
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
