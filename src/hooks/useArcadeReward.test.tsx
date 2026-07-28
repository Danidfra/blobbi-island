/**
 * Claim-boundary tests.
 *
 * The rule under test, in one line: **nothing reaches `confirmed` except a
 * publish that resolved AND a read-back whose delta matches the award.**
 * Everything else here is a way of getting that wrong — a timeout treated as
 * success, a double-click, a stale callback, a claim that raced an account
 * switch — and each one has to land somewhere honest instead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useArcadeReward } from './useArcadeReward';
import { QueryProviders } from '@/components/blobbi/arcade/dance/test-providers';
import {
  createFakeWriter,
  fakeUser,
} from '@/components/blobbi/arcade/dance/test-doubles';
import {
  hasClaimed,
  readClaim,
  readClaims,
  resetClaimLocks,
} from '@/lib/arcade-claim-ledger';
import { calculateArcadeReward } from '@/arcade/reward-policy';
import { DANCE_REWARD_POLICY } from '@/arcade/dance/dance-reward';
import { DANCE_STAT_KEYS } from '@/arcade/dance/dance-result';
import type { ArcadeGameResult } from '@/arcade/types';
import type { ArcadeRewardWriter } from '@/arcade/arcade-reward-boundary';
import {
  ARCADE_TICKET_ADDRESS,
  ArcadeRewardWriterError,
} from '@/inventory/arcade-reward-writer';

const PUBKEY = 'f'.repeat(64);

let currentUser: ReturnType<typeof fakeUser> | undefined = fakeUser(PUBKEY);

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser, users: currentUser ? [currentUser] : [] }),
}));

vi.mock('@nostrify/react', async () => {
  const actual = await vi.importActual<typeof import('@nostrify/react')>('@nostrify/react');
  return {
    ...actual,
    useNostr: () => ({
      nostr: {
        query: async () => [],
        event: async () => {
          throw new Error('The test pool refuses to publish');
        },
      },
    }),
  };
});

function result(overrides: Partial<ArcadeGameResult> = {}): ArcadeGameResult {
  return {
    runId: 'run-1',
    gameId: 'blobbi-dance',
    machineId: 'arcade-dance-machine',
    difficulty: 'normal',
    cleared: true,
    score: 100_000,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_068_000,
    stats: {
      [DANCE_STAT_KEYS.accuracy]: 96,
      [DANCE_STAT_KEYS.fullCombo]: 1,
      [DANCE_STAT_KEYS.completedNaturally]: 1,
    },
    ...overrides,
  };
}

const calculationFor = (r: ArcadeGameResult) =>
  calculateArcadeReward({
    policy: DANCE_REWARD_POLICY,
    result: r,
    itemAddress: ARCADE_TICKET_ADDRESS,
  });

function setup<W extends ArcadeRewardWriter>(
  writer: W = createFakeWriter({ quantities: [0, 8] }) as unknown as W,
) {
  const view = renderHook(() => useArcadeReward({ writer }), { wrapper: QueryProviders });
  return { ...view, writer };
}

beforeEach(() => {
  localStorage.clear();
  resetClaimLocks();
  currentUser = fakeUser(PUBKEY);
});

afterEach(() => {
  localStorage.clear();
  resetClaimLocks();
  vi.restoreAllMocks();
});

describe('the happy path', () => {
  it('confirms only after the read-back shows the exact delta', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();

    let attempt!: Awaited<ReturnType<typeof hook.current.claimReward>>;
    await act(async () => {
      attempt = await hook.current.claimReward(run, calculationFor(run));
    });

    expect(attempt).toMatchObject({ ok: true, phase: 'confirmed', quantity: 8 });
    expect(hook.current.state.phase).toBe('confirmed');
    expect(hook.current.state.message).toMatch(/8 Arcade Tickets added/);
    // Before AND after, in that order: the delta is what proves it.
    expect(writer.readCount()).toBe(2);
    expect(writer.publishCount()).toBe(1);
  });

  it('records the claim durably, so a remount cannot pay it again', async () => {
    const { result: hook } = setup(createFakeWriter({ quantities: [0, 8] }));
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });

    expect(hasClaimed(PUBKEY, 'run-1')).toBe(true);
    expect(readClaim(PUBKEY, 'run-1')).toMatchObject({ status: 'claimed', tickets: 8 });

    // A brand-new hook instance — the shell closed and reopened.
    const second = setup(createFakeWriter({ quantities: [8, 16] }));
    let attempt!: Awaited<ReturnType<typeof hook.current.claimReward>>;
    await act(async () => {
      attempt = await second.result.current.claimReward(run, calculationFor(run));
    });
    expect(attempt).toMatchObject({ ok: false, phase: 'already-claimed' });
    expect(second.writer.publishCount()).toBe(0);
  });

  it('persists a pending claim BEFORE anything is sent', async () => {
    let sawPendingRecord = false;
    const writer = createFakeWriter({ quantities: [0, 8] });
    const originalPublish = writer.publishTicketGrant.bind(writer);
    writer.publishTicketGrant = async (claim) => {
      // At publish time the claim must already exist in storage, or a refresh
      // here would lose the tickets with no record that they were owed.
      sawPendingRecord = readClaim(PUBKEY, 'run-1') !== null;
      return originalPublish(claim);
    };

    const { result: hook } = setup(writer);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(sawPendingRecord).toBe(true);
  });
});

describe('same-tick double claim', () => {
  it('publishes exactly once when two claims start in the same tick', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();
    const calculation = calculationFor(run);

    let attempts!: Awaited<ReturnType<typeof hook.current.claimReward>>[];
    await act(async () => {
      // No await between them — this is the shape of a double-click, and the
      // reason the guard is a synchronous lock rather than `isPending`.
      attempts = await Promise.all([
        hook.current.claimReward(run, calculation),
        hook.current.claimReward(run, calculation),
      ]);
    });

    expect(writer.publishCount()).toBe(1);
    expect(attempts.filter((a) => a.ok)).toHaveLength(1);
    expect(attempts.filter((a) => !a.ok)).toHaveLength(1);
  });

  it('publishes exactly once for ten simultaneous presses', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();
    const calculation = calculationFor(run);

    await act(async () => {
      await Promise.all(
        Array.from({ length: 10 }, () => hook.current.claimReward(run, calculation)),
      );
    });
    expect(writer.publishCount()).toBe(1);
  });

  it('holds the lock across a slow publication, then releases it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = createFakeWriter({ quantities: [0, 8], gate });
    const { result: hook } = setup(writer);
    const run = result();
    const calculation = calculationFor(run);

    let first!: Promise<unknown>;
    await act(async () => {
      first = hook.current.claimReward(run, calculation);
      // While the first is in flight, a second press must bounce off the lock.
      const second = await hook.current.claimReward(run, calculation);
      expect(second.ok).toBe(false);
      expect(second.phase).toBe('claiming');
      release();
      await first;
    });

    expect(writer.publishCount()).toBe(1);
    expect(hook.current.state.phase).toBe('confirmed');
  });
});

describe('REGRESSION: the observed 3 → 6 duplicate grant', () => {
  /**
   * The real manual failure, reproduced end to end.
   *
   * A 3-ticket reward was granted, the verification read did not yet show it
   * (the relay had not caught up), the claim was recorded as `failed`, the UI
   * offered "Try again", and the retry published a SECOND additive +3 — leaving
   * the player with 6.
   *
   * The writer here is a faithful stand-in for a relay: `publishTicketGrant`
   * ADDS to a running balance, exactly as `applyMutation({type:'add'})` does
   * against a fresh read. The first verification read is deliberately stale.
   */
  function laggyRelayWriter(startingBalance: number) {
    let balance = startingBalance;
    let publishes = 0;
    let reads = 0;
    let stale = true;
    return {
      publishCount: () => publishes,
      balance: () => balance,
      catchUp: () => {
        stale = false;
      },
      async publishTicketGrant(claim: { tickets: number }) {
        publishes += 1;
        // Additive, like the real kind:31633 grant.
        balance += claim.tickets;
      },
      async readTicketQuantity() {
        reads += 1;
        // The baseline read is accurate; the verification read lags behind.
        if (reads === 1) return balance;
        return stale ? startingBalance : balance;
      },
    };
  }

  it('publishes ONCE and leaves a delta of exactly 3, however many times the player acts', async () => {
    const writer = laggyRelayWriter(10);
    const { result: hook } = setup(writer);
    const run = result();
    const calculation = { ...calculationFor(run), quantity: 3 };
    // Force the awarded amount to the 3 tickets the manual test earned.
    const threeTicket = {
      ...calculation,
      award: { ...calculation.award, total: 3 },
      quantity: 3,
    };

    await act(async () => {
      await hook.current.claimReward(run, threeTicket);
    });

    // The write landed but could not be verified.
    expect(writer.publishCount()).toBe(1);
    expect(writer.balance()).toBe(13);
    expect(hook.current.state.phase).toBe('unresolved');
    expect(readClaim(PUBKEY, 'run-1')).toMatchObject({ status: 'ambiguous' });

    // The player does what they did in the manual test: presses the button
    // again. And again. And again.
    await act(async () => {
      await hook.current.claimReward(run, threeTicket);
      await hook.current.claimReward(run, threeTicket);
      await hook.current.claimReward(run, threeTicket);
    });

    // ONE publication. Balance 13, not 16 and certainly not 19.
    expect(writer.publishCount()).toBe(1);
    expect(writer.balance()).toBe(10 + 3);
    expect(hook.current.state.phase).toBe('unresolved');
  });

  it('resolves to confirmed once the relay catches up, still without republishing', async () => {
    const writer = laggyRelayWriter(10);
    const { result: hook } = setup(writer);
    const run = result();
    const base = calculationFor(run);
    const threeTicket = { ...base, award: { ...base.award, total: 3 }, quantity: 3 };

    await act(async () => {
      await hook.current.claimReward(run, threeTicket);
    });
    expect(hook.current.state.phase).toBe('unresolved');

    writer.catchUp();
    await act(async () => {
      await hook.current.reconcileClaim('run-1');
    });

    expect(hook.current.state.phase).toBe('confirmed');
    expect(writer.publishCount()).toBe(1);
    expect(writer.balance()).toBe(13);
    expect(hasClaimed(PUBKEY, 'run-1')).toBe(true);
  });

  it('stays unresolved for ever when the read never catches up — delta still exactly 3', async () => {
    const writer = laggyRelayWriter(10);
    const { result: hook } = setup(writer);
    const run = result();
    const base = calculationFor(run);
    const threeTicket = { ...base, award: { ...base.award, total: 3 }, quantity: 3 };

    await act(async () => {
      await hook.current.claimReward(run, threeTicket);
    });

    // The relay NEVER catches up. Check the status ten times, claim ten times.
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await hook.current.reconcileClaim('run-1');
        await hook.current.claimReward(run, threeTicket);
      }
    });

    expect(writer.publishCount()).toBe(1);
    expect(writer.balance() - 10).toBe(3);
    expect(hook.current.state.phase).toBe('unresolved');
    expect(readClaim(PUBKEY, 'run-1')).toMatchObject({ status: 'ambiguous', attempts: 1 });
  });

  it('survives a remount: the unresolved claim is not offered as a fresh claim', async () => {
    const writer = laggyRelayWriter(10);
    const first = setup(writer);
    const run = result();
    const base = calculationFor(run);
    const threeTicket = { ...base, award: { ...base.award, total: 3 }, quantity: 3 };

    await act(async () => {
      await first.result.current.claimReward(run, threeTicket);
    });
    first.unmount();

    // The shell was closed and reopened — a brand-new hook instance.
    const second = setup(writer);
    act(() => second.result.current.hydrate('run-1'));
    expect(second.result.current.state.phase).toBe('unresolved');

    await act(async () => {
      await second.result.current.claimReward(run, threeTicket);
    });
    expect(writer.publishCount()).toBe(1);
    expect(writer.balance()).toBe(13);
  });
});

describe('failures the UI must tell apart', () => {
  it('treats a publish TIMEOUT as unresolved, and never republishes it', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const writer = createFakeWriter({ publishError: timeout });
    const { result: hook } = setup(writer);
    const run = result();

    let attempt!: Awaited<ReturnType<typeof hook.current.claimReward>>;
    await act(async () => {
      attempt = await hook.current.claimReward(run, calculationFor(run));
    });

    expect(attempt).toMatchObject({
      ok: false,
      phase: 'unresolved',
      failure: 'publish-timeout',
      retryable: false,
    });
    expect(hook.current.state.message).toMatch(/will not send another grant/i);
    expect(hook.current.state.message).not.toMatch(/safe|try again/i);
    expect(readClaim(PUBKEY, 'run-1')).toMatchObject({ status: 'ambiguous' });

    // And a second attempt publishes nothing.
    const before = writer.publishCount();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(writer.publishCount()).toBe(before);
  });

  it('treats an UNCLASSIFIED publish rejection as unresolved, not as a clean failure', async () => {
    // `NPool.event` cannot tell "every relay refused it" from "the socket died
    // after the frame went out", so an unrecognised rejection must not be
    // presented as retryable.
    const writer = createFakeWriter({ publishError: new Error('all relays rejected') });
    const { result: hook } = setup(writer);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(hook.current.state.phase).toBe('unresolved');
    expect(hook.current.state.failure).toBe('verify-unavailable');
  });

  it('is unresolved when the read-back cannot be performed', async () => {
    const { result: hook } = setup(createFakeWriter({ quantities: [0, null] }));
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(hook.current.state.phase).toBe('unresolved');
    expect(hook.current.state.failure).toBe('verify-unavailable');
  });

  it('is unresolved when the read-back shows the wrong delta', async () => {
    const { result: hook } = setup(createFakeWriter({ quantities: [0, 3] }));
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(hook.current.state.phase).toBe('unresolved');
    expect(hook.current.state.failure).toBe('verify-mismatch');
    expect(hasClaimed(PUBKEY, 'run-1')).toBe(false);
  });

  it('publishes NOTHING when the baseline read fails, and stays retryable', async () => {
    // Without a baseline there is nothing to reconcile against later, so the
    // claim refuses to publish rather than becoming permanently unresolvable.
    const writer = createFakeWriter({ quantities: [null] });
    const { result: hook } = setup(writer);
    const run = result();

    let attempt!: Awaited<ReturnType<typeof hook.current.claimReward>>;
    await act(async () => {
      attempt = await hook.current.claimReward(run, calculationFor(run));
    });
    expect(attempt).toMatchObject({ phase: 'failed', failure: 'baseline-unavailable', retryable: true });
    expect(writer.publishCount()).toBe(0);
    expect(readClaim(PUBKEY, 'run-1')).toMatchObject({ status: 'failed' });
  });

  it('lets a PRE-PUBLISH failure be retried with the SAME run id, and confirm', async () => {
    const signerRefused = new ArcadeRewardWriterError('user rejected', 'sign-failed');
    const failing = createFakeWriter({ publishError: signerRefused });
    const { result: hook, unmount } = setup(failing);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(hook.current.state.phase).toBe('failed');
    expect(readClaim(PUBKEY, 'run-1')).toMatchObject({ status: 'failed' });
    unmount();

    const retry = createFakeWriter({ quantities: [0, 8] });
    const second = setup(retry);
    await act(async () => {
      await second.result.current.claimReward(run, calculationFor(run));
    });
    expect(second.result.current.state.phase).toBe('confirmed');
    expect(readClaim(PUBKEY, 'run-1')).toMatchObject({ status: 'claimed' });
  });
});

describe('an unexpected throw inside the lock', () => {
  it('stays UNRESOLVED when the record shows the attempt may have published', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    // Blow up after the publish, during verification bookkeeping.
    const realRead = writer.readTicketQuantity.bind(writer);
    let reads = 0;
    writer.readTicketQuantity = async () => {
      reads += 1;
      if (reads === 2) throw new Error('boom');
      return realRead();
    };

    const { result: hook } = setup(writer);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });

    expect(writer.publishCount()).toBe(1);
    expect(hook.current.state.phase).toBe('unresolved');
    // And it still blocks.
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(writer.publishCount()).toBe(1);
  });

  it('is a clean failure when nothing could have published', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    writer.readTicketQuantity = async () => {
      throw new Error('boom on the baseline read');
    };
    const { result: hook } = setup(writer);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(writer.publishCount()).toBe(0);
    expect(hook.current.state.phase).toBe('failed');
  });
});

describe('reconciliation is read-only — proven, not inferred', () => {
  /**
   * A writer that DETONATES if anything tries to publish.
   *
   * `publishCount()` assertions prove a publish did not *increment a counter*.
   * This proves the method is unreachable: reconciliation cannot call it, cannot
   * sign, and cannot reach `nostr.event`, because the only implementation of
   * those steps throws on contact.
   */
  function boobyTrappedWriter(quantities: readonly (number | null)[]) {
    let reads = 0;
    let publishes = 0;
    return {
      publishCount: () => publishes,
      arm: () => {
        publishes = -1; // any further publish is a test failure
      },
      async publishTicketGrant() {
        if (publishes < 0) {
          throw new Error('RECONCILIATION PUBLISHED — this must be unreachable');
        }
        publishes += 1;
      },
      async readTicketQuantity() {
        const value = quantities[Math.min(reads, quantities.length - 1)] ?? null;
        reads += 1;
        return value;
      },
    };
  }

  it('cannot reach publishTicketGrant, however many times it is invoked', async () => {
    const writer = boobyTrappedWriter([0, 0, 0, 0, 0, 0]);
    const { result: hook } = setup(writer);
    const run = result();

    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(hook.current.state.phase).toBe('unresolved');
    expect(writer.publishCount()).toBe(1);

    // From here on, ANY publish throws.
    writer.arm();
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await hook.current.reconcileClaim('run-1');
    });
    expect(hook.current.state.phase).toBe('unresolved');
  });

  it('never replaces an unresolved claim with a fresh, publishable one', async () => {
    const writer = boobyTrappedWriter([0, 0, 0]);
    const { result: hook } = setup(writer);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    writer.arm();

    await act(async () => {
      await hook.current.reconcileClaim('run-1');
    });
    const record = readClaim(PUBKEY, 'run-1')!;
    // Still ambiguous, still blocking, still the SAME run — reconciliation does
    // not mint a new claim and does not reset the status.
    expect(record.status).toBe('ambiguous');
    expect(record.runId).toBe('run-1');
    expect(record.attempts).toBe(1);
    expect(record.reconcileAttempts).toBeGreaterThan(0);

    // And a claim attempt after reconciliation still publishes nothing.
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(readClaim(PUBKEY, 'run-1')?.status).toBe('ambiguous');
  });
});

describe('the >= baseline + award inference, recorded deliberately', () => {
  /**
   * The reconciliation rule is `now >= baseline + award → confirm`. It is a
   * CONSERVATIVE INFERENCE, not proof that our specific event landed.
   *
   * This test documents the known false-positive: the Dance grant never landed,
   * an unrelated operation added more than the award, and reconciliation
   * confirms anyway. The player loses a reward they were owed.
   *
   * That direction is chosen on purpose. The opposite rule (`=== baseline +
   * award`, or refusing to confirm without stronger proof) does not prevent the
   * loss either — it just leaves the claim unresolved for ever — while any rule
   * that resolved the doubt by PUBLISHING AGAIN would reintroduce the 3 → 6
   * duplicate. Between "an owed reward is occasionally not paid" and "the
   * currency inflates", this phase picks the first.
   *
   * Fixing it properly needs per-event attribution, which kind:31633 cannot
   * express without inventing tags the canonical parser drops. Out of scope by
   * explicit instruction.
   */
  it('confirms a grant that never landed when an unrelated operation moved the balance', async () => {
    // baseline 10 · award 3 · the publish is lost · something else adds 5 → 15
    let balance = 10;
    let publishes = 0;
    const reads: number[] = [];
    const writer = {
      publishCount: () => publishes,
      async publishTicketGrant() {
        publishes += 1;
        // Deliberately does NOT add: this grant never reached a relay.
      },
      async readTicketQuantity() {
        reads.push(balance);
        return balance;
      },
    };

    const { result: hook } = setup(writer);
    const run = result();
    const base = calculationFor(run);
    const threeTicket = { ...base, award: { ...base.award, total: 3 }, quantity: 3 };

    await act(async () => {
      await hook.current.claimReward(run, threeTicket);
    });
    expect(hook.current.state.phase).toBe('unresolved');
    expect(publishes).toBe(1);

    // An unrelated, legitimate operation adds 5.
    balance = 15;

    await act(async () => {
      await hook.current.reconcileClaim('run-1');
    });

    // 15 >= 10 + 3, so the claim is confirmed even though the Dance grant is not
    // in that number. KNOWN AND ACCEPTED: the player is under-paid by 3, and the
    // economy is not inflated. No second publish was issued.
    expect(hook.current.state.phase).toBe('confirmed');
    expect(publishes).toBe(1);
    expect(readClaim(PUBKEY, 'run-1')).toMatchObject({ status: 'claimed' });
  });

  it('does NOT confirm when the balance moved by less than the award', async () => {
    // The inference is one-sided: it only ever confirms on enough evidence.
    const writer = createFakeWriter({ quantities: [10, 10, 12] });
    const { result: hook } = setup(writer);
    const run = result();
    const base = calculationFor(run);
    const threeTicket = { ...base, award: { ...base.award, total: 3 }, quantity: 3 };

    await act(async () => {
      await hook.current.claimReward(run, threeTicket);
    });
    await act(async () => {
      await hook.current.reconcileClaim('run-1');
    });
    expect(hook.current.state.phase).toBe('unresolved');
  });
});

describe('reconciliation is read-only', () => {
  it('publishes nothing when the evidence is inconclusive, and stays locked', async () => {
    const writer = createFakeWriter({ quantities: [0, 0, 0, 0] });
    const { result: hook } = setup(writer);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(hook.current.state.phase).toBe('unresolved');

    const publishes = writer.publishCount();
    await act(async () => {
      await hook.current.reconcileClaim('run-1');
      await hook.current.reconcileClaim('run-1');
      await hook.current.reconcileClaim('run-1');
    });

    expect(writer.publishCount()).toBe(publishes);
    expect(hook.current.state.phase).toBe('unresolved');
    expect(readClaim(PUBKEY, 'run-1')).toMatchObject({ status: 'ambiguous', reconcileAttempts: 3 });
  });

  it('reports an unreadable inventory without resolving anything', async () => {
    const writer = createFakeWriter({ quantities: [0, 0, null] });
    const { result: hook } = setup(writer);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    await act(async () => {
      await hook.current.reconcileClaim('run-1');
    });
    expect(hook.current.state.phase).toBe('unresolved');
    expect(hook.current.state.message).toMatch(/could not be read/i);
  });

  it('confirms when the balance later shows the award, without a second publish', async () => {
    // baseline 0, verify 0 (stale), reconcile 8 (caught up)
    const writer = createFakeWriter({ quantities: [0, 0, 8] });
    const { result: hook } = setup(writer);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(hook.current.state.phase).toBe('unresolved');

    await act(async () => {
      await hook.current.reconcileClaim('run-1');
    });
    expect(hook.current.state.phase).toBe('confirmed');
    expect(writer.publishCount()).toBe(1);
    expect(hasClaimed(PUBKEY, 'run-1')).toBe(true);
  });

  it('does nothing at all for a run with no recorded claim', async () => {
    const writer = createFakeWriter();
    const { result: hook } = setup(writer);
    await act(async () => {
      await hook.current.reconcileClaim('never-claimed');
    });
    expect(writer.publishCount()).toBe(0);
  });
});

describe('durable storage is a prerequisite', () => {
  it('publishes NOTHING when the ledger write throws', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    let attempt!: Awaited<ReturnType<typeof hook.current.claimReward>>;
    await act(async () => {
      attempt = await hook.current.claimReward(run, calculationFor(run));
    });

    expect(attempt).toMatchObject({ phase: 'failed', failure: 'ledger-unavailable', retryable: true });
    expect(writer.publishCount()).toBe(0);
    expect(hook.current.state.ledgerUnavailable).toBe(true);
  });

  it('publishes NOTHING when the write appears to succeed but does not read back', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();
    // setItem accepts the write and silently drops it — quota eviction, an
    // extension, private mode. A claim record that is not really there is how a
    // grant gets offered a second time.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});

    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(writer.publishCount()).toBe(0);
    expect(hook.current.state.failure).toBe('ledger-unavailable');
  });

  it('publishes NOTHING when the read-back returns a DIFFERENT status than was written', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      // Storage accepts the write but stores a stale version — the record the
      // caller relies on is not the record that is actually there.
      real.call(this, key, JSON.stringify({ [PUBKEY]: { 'run-1': { runId: 'run-1', gameId: 'blobbi-dance', machineId: 'arcade-dance-machine', status: 'failed', tickets: 8, createdAt: 1, updatedAt: 1, attempts: 0, failure: null, quantityBefore: null, reconcileAttempts: 0 } } }));
    });

    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(writer.publishCount()).toBe(0);
    expect(hook.current.state.failure).toBe('ledger-unavailable');
  });

  it('proceeds after a corrupt ledger, because corrupt is indistinguishable from empty', async () => {
    localStorage.setItem('blobbi:arcade:reward-claims', '{not json');
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();
    // A corrupt ledger reads as empty, so the claim proceeds — and the write
    // repairs the file. This is a deliberate trade: refusing every claim for
    // ever because of one bad byte would be worse, and the repaired record then
    // blocks normally. It DOES mean a hand-corrupted ledger loses its history,
    // which is the same class of client-side-state limitation documented in
    // `docs/blobbi-dance.md` §8.
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(writer.publishCount()).toBe(1);
    expect(readClaims(PUBKEY)['run-1']).toMatchObject({ status: 'claimed' });
  });
});

describe('an existing durable record blocks a new grant', () => {
  it.each([['publishing'], ['verifying'], ['ambiguous'], ['claimed']] as const)(
    'a %s record publishes nothing',
    async (status) => {
      localStorage.setItem(
        'blobbi:arcade:reward-claims',
        JSON.stringify({
          [PUBKEY]: {
            'run-1': {
              runId: 'run-1',
              gameId: 'blobbi-dance',
              machineId: 'arcade-dance-machine',
              status,
              tickets: 8,
              createdAt: 1,
              updatedAt: 1,
              attempts: 1,
              failure: null,
              quantityBefore: 0,
              reconcileAttempts: 0,
            },
          },
        }),
      );
      const writer = createFakeWriter({ quantities: [0, 8] });
      const { result: hook } = setup(writer);
      const run = result();
      await act(async () => {
        await hook.current.claimReward(run, calculationFor(run));
      });
      expect(writer.publishCount()).toBe(0);
    },
  );

  it('a failed-before-publish record may be retried', async () => {
    localStorage.setItem(
      'blobbi:arcade:reward-claims',
      JSON.stringify({
        [PUBKEY]: {
          'run-1': {
            runId: 'run-1',
            gameId: 'blobbi-dance',
            machineId: 'arcade-dance-machine',
            status: 'failed',
            tickets: 8,
            createdAt: 1,
            updatedAt: 1,
            attempts: 1,
            failure: 'sign-failed',
            quantityBefore: null,
            reconcileAttempts: 0,
          },
        },
      }),
    );
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();
    await act(async () => {
      await hook.current.claimReward(run, calculationFor(run));
    });
    expect(writer.publishCount()).toBe(1);
    expect(hook.current.state.phase).toBe('confirmed');
  });
});

describe('two hook instances in one document', () => {
  it('publish once for the same (pubkey, runId)', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const a = setup(writer);
    const b = setup(writer);
    const run = result();
    const calculation = calculationFor(run);

    await act(async () => {
      await Promise.all([
        a.result.current.claimReward(run, calculation),
        b.result.current.claimReward(run, calculation),
      ]);
    });
    expect(writer.publishCount()).toBe(1);
  });
});

describe('refusals before anything is sent', () => {
  it('refuses when nobody is signed in', async () => {
    currentUser = undefined;
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();

    let attempt!: Awaited<ReturnType<typeof hook.current.claimReward>>;
    await act(async () => {
      attempt = await hook.current.claimReward(run, calculationFor(run));
    });
    expect(attempt).toMatchObject({ ok: false, phase: 'failed' });
    expect(hook.current.state.message).toMatch(/log in/i);
    expect(writer.publishCount()).toBe(0);
    expect(hook.current.isLoggedIn).toBe(false);
  });

  it('refuses an ineligible calculation, quoting the reason', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const aborted = result({
      stats: { ...result().stats, [DANCE_STAT_KEYS.completedNaturally]: 0 },
    });

    await act(async () => {
      await hook.current.claimReward(aborted, calculationFor(aborted));
    });
    expect(hook.current.state.phase).toBe('failed');
    expect(hook.current.state.message).toMatch(/did not reach the end/);
    expect(writer.publishCount()).toBe(0);
  });

  it("refuses a calculation that belongs to another run", async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const { result: hook } = setup(writer);
    const run = result();
    const other = calculationFor(result({ runId: 'run-2' }));

    await act(async () => {
      await hook.current.claimReward(run, other);
    });
    expect(hook.current.state.message).toMatch(/does not belong/);
    expect(writer.publishCount()).toBe(0);
  });
});

describe('claims that outlive their component', () => {
  it('finishes its bookkeeping after unmount without touching React state', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = createFakeWriter({ quantities: [0, 8], gate });
    const { result: hook, unmount } = setup(writer);
    const run = result();

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = hook.current.claimReward(run, calculationFor(run));
    });

    // The player closes the shell mid-claim.
    unmount();
    await act(async () => {
      release();
      await pending;
    });

    // The write still completed and is still recorded — losing the record would
    // be worse than a stale render, because the tickets are genuinely granted.
    expect(writer.publishCount()).toBe(1);
    await waitFor(() => expect(hasClaimed(PUBKEY, 'run-1')).toBe(true));
  });

  it('records the claim against the account that EARNED it, not the one signed in later', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = createFakeWriter({ quantities: [0, 8], gate });
    const { result: hook } = setup(writer);
    const run = result();

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = hook.current.claimReward(run, calculationFor(run));
    });

    // Account switch while the publish is in flight.
    currentUser = fakeUser('a'.repeat(64));
    await act(async () => {
      release();
      await pending;
    });

    expect(hasClaimed(PUBKEY, 'run-1')).toBe(true);
    expect(hasClaimed('a'.repeat(64), 'run-1')).toBe(false);
  });
});

describe('hydration across mounts', () => {
  it('shows a confirmed claim as already-claimed after a remount', async () => {
    const writer = createFakeWriter({ quantities: [0, 8] });
    const first = setup(writer);
    const run = result();
    await act(async () => {
      await first.result.current.claimReward(run, calculationFor(run));
    });
    first.unmount();

    const second = setup(writer);
    act(() => second.result.current.hydrate('run-1'));
    expect(second.result.current.state.phase).toBe('already-claimed');
  });

  it('hydrates a run with no record to idle, so a fresh claim is offered', () => {
    const { result: hook } = setup();
    act(() => hook.current.hydrate('never-seen'));
    expect(hook.current.state).toMatchObject({ phase: 'idle', quantity: 0 });
  });

  it('clears state when there is no run at all', () => {
    const { result: hook } = setup();
    act(() => hook.current.hydrate(null));
    expect(hook.current.state.phase).toBe('idle');
  });
});
