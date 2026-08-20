/**
 * Energy settles as an exactly-once DELTA against fresh state.
 *
 * The behaviours that matter, and why:
 *
 * - the subtraction uses the state read INSIDE the transaction, so a Mine can
 *   never resurrect energy another tab already spent;
 * - the same opId subtracts once, ever;
 * - an ambiguous publish is reconciled by an opaque marker on the event, not
 *   by guessing from the energy value (care actions move it too);
 * - unrelated pet fields and unknown tags survive the write;
 * - writes to one pet are serialized and strictly ordered in time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { createEnergySettler, PET_OP_MARKER_TAG } from './energy-settlement';
import { readPetState, type PetStateNostr } from '@/lib/pet-state-transaction';
import { clearPetEnergyOps, readPetEnergyOp } from '@/lib/pet-energy-ledger';

const PUBKEY = 'f'.repeat(64);
const PET_ID = 'blobbi-aa-bb';

type ReqMessage =
  | ['EVENT', string, NostrEvent]
  | ['EOSE', string]
  | ['CLOSED', string, string];

function petEvent(
  overrides: {
    energy?: number;
    hunger?: number;
    createdAt?: number;
    extraTags?: string[][];
  } = {},
): NostrEvent {
  const {
    energy = 80,
    hunger = 50,
    createdAt = 1_000,
    extraTags = [],
  } = overrides;
  return {
    id: `evt-${createdAt}`,
    pubkey: PUBKEY,
    kind: 31124,
    created_at: createdAt,
    content: '',
    tags: [
      ['d', PET_ID],
      ['stage', 'adult'],
      ['breeding_ready', 'false'],
      ['generation', '1'],
      ['hunger', String(hunger)],
      ['happiness', '80'],
      ['health', '80'],
      ['hygiene', '80'],
      ['energy', String(energy)],
      ['experience', '0'],
      ['care_streak', '0'],
      ['seed', 'abc'],
      ['adult_type', 'bloomi'],
      ['base_color', '#fff'],
      // An unknown tag from another client — must survive every write.
      ['ditto_xp', '123'],
      ...extraTags,
    ],
    sig: 'sig',
  };
}

interface RelayOptions {
  publish?: 'ok' | 'timeout' | 'error';
  /** Serve N unusable reads first. */
  unusableReads?: number;
}

function makeRelay(initial: NostrEvent | null, options: RelayOptions = {}) {
  let stored = initial;
  let unusable = options.unusableReads ?? 0;
  const published: NostrEvent[] = [];
  let signCounter = 0;

  const nostr: PetStateNostr = {
    req: () => {
      const script: ReqMessage[] =
        unusable > 0
          ? ((unusable -= 1), [['CLOSED', 's', 'unavailable']])
          : stored
            ? [['EVENT', 's', stored], ['EOSE', 's']]
            : [['EOSE', 's']];
      return (async function* () {
        for (const msg of script) yield msg;
      })();
    },
    query: async () => {
      throw new Error('query must not be used when req is available');
    },
    event: async (event) => {
      if (options.publish === 'timeout') {
        const error = new Error('timed out');
        error.name = 'TimeoutError';
        throw error;
      }
      if (options.publish === 'error') throw new Error('relay refused');
      published.push(event);
      if (!stored || event.created_at >= stored.created_at) stored = event;
    },
  };

  const user = {
    pubkey: PUBKEY,
    signer: {
      signEvent: vi.fn(async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
        signCounter += 1;
        return { ...t, id: `signed-${signCounter}`, pubkey: PUBKEY, sig: 'sig' };
      }),
    },
  } as never;

  return { nostr, user, published, getStored: () => stored, setStored: (e: NostrEvent) => { stored = e; } };
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

beforeEach(() => clearPetEnergyOps());
afterEach(() => {
  clearPetEnergyOps();
  vi.restoreAllMocks();
});

describe('the delta is applied to FRESH state, never the session snapshot', () => {
  it('80 → another tab spends 20 → Mine spends 30 → 30 (not 50)', async () => {
    // The session started at 80, but by settlement time the relay says 60.
    const relay = makeRelay(petEvent({ energy: 60 }));
    const settler = createEnergySettler({
      nostr: relay.nostr,
      user: relay.user,
      now: () => 1_700_000_000_000,
    });

    const outcome = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy',
      petId: PET_ID,
      amount: 30,
      label: 'mine-energy',
    });

    expect(outcome).toMatchObject({ status: 'applied', energyAfter: 30, appliedDelta: 30 });
    expect(tagValue(relay.getStored()!, 'energy')).toBe('30');
  });

  it('bounds at zero and settles ONCE — the remainder is forgiven', async () => {
    const relay = makeRelay(petEvent({ energy: 10 }));
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    const outcome = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy',
      petId: PET_ID,
      amount: 30,
      label: 'mine-energy',
    });

    expect(outcome).toMatchObject({ status: 'applied', energyAfter: 0, appliedDelta: 10 });
    // The unapplied 20 is never chased later: a repeat is idempotent.
    const again = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy',
      petId: PET_ID,
      amount: 30,
      label: 'mine-energy',
    });
    expect(again).toEqual({ status: 'already-applied' });
    expect(relay.published).toHaveLength(1);
  });

  it('refuses a nonsense amount instead of clamping it', async () => {
    const relay = makeRelay(petEvent());
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });
    for (const amount of [0, -5, 1.5]) {
      const outcome = await settler.settleEnergyDelta({
        opId: `op-${amount}`,
        petId: PET_ID,
        amount,
        label: 'mine-energy',
      });
      expect(outcome).toEqual({ status: 'failed', reason: 'invalid-amount' });
    }
    expect(relay.published).toHaveLength(0);
  });
});

describe('unrelated pet state survives settlement', () => {
  it('keeps another action\'s hunger change and unknown tags', async () => {
    // Base at Mine start was energy 80 / hunger 50; a care action since then
    // made it energy 60 / hunger 90. The Mine must not resurrect hunger 50.
    const relay = makeRelay(petEvent({ energy: 60, hunger: 90 }));
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    await settler.settleEnergyDelta({
      opId: 'mine:s1:energy',
      petId: PET_ID,
      amount: 30,
      label: 'mine-energy',
    });

    const stored = relay.getStored()!;
    expect(tagValue(stored, 'energy')).toBe('30');
    expect(tagValue(stored, 'hunger')).toBe('90');
    expect(tagValue(stored, 'ditto_xp')).toBe('123');
    expect(tagValue(stored, 'adult_type')).toBe('bloomi');
  });
});

describe('exactly-once', () => {
  it('the SAME opId subtracts once', async () => {
    const relay = makeRelay(petEvent({ energy: 80 }));
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    const first = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });
    const second = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });

    expect(first).toMatchObject({ status: 'applied', energyAfter: 60 });
    expect(second).toEqual({ status: 'already-applied' });
    expect(relay.published).toHaveLength(1);
    expect(tagValue(relay.getStored()!, 'energy')).toBe('60');
  });

  it('DIFFERENT opIds both subtract (80 −20 −10 = 50)', async () => {
    const relay = makeRelay(petEvent({ energy: 80 }));
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    await settler.settleEnergyDelta({ opId: 'a', petId: PET_ID, amount: 20, label: 'x' });
    await settler.settleEnergyDelta({ opId: 'b', petId: PET_ID, amount: 10, label: 'x' });

    expect(relay.published).toHaveLength(2);
    expect(tagValue(relay.getStored()!, 'energy')).toBe('50');
  });

  it('two CONCURRENT operations serialize and both apply', async () => {
    const relay = makeRelay(petEvent({ energy: 80 }));
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    await Promise.all([
      settler.settleEnergyDelta({ opId: 'a', petId: PET_ID, amount: 20, label: 'x' }),
      settler.settleEnergyDelta({ opId: 'b', petId: PET_ID, amount: 10, label: 'x' }),
    ]);

    expect(tagValue(relay.getStored()!, 'energy')).toBe('50');
  });

  it('a marker already on the event means already-applied, even with an empty ledger', async () => {
    const relay = makeRelay(
      petEvent({ energy: 60, extraTags: [[PET_OP_MARKER_TAG, 'mine:s1:energy']] }),
    );
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    // The ledger is empty (storage cleared after publish) — trust the relay.
    const outcome = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 30, label: 'mine-energy',
    });
    expect(outcome).toEqual({ status: 'already-applied' });
    expect(relay.published).toHaveLength(0);
  });

  it('keeps exactly ONE marker on the event across settlements', async () => {
    const relay = makeRelay(petEvent({ energy: 80 }));
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    await settler.settleEnergyDelta({ opId: 'a', petId: PET_ID, amount: 10, label: 'x' });
    await settler.settleEnergyDelta({ opId: 'b', petId: PET_ID, amount: 10, label: 'x' });

    const markers = relay.getStored()!.tags.filter(([n]) => n === PET_OP_MARKER_TAG);
    expect(markers).toHaveLength(1);
    expect(markers[0][1]).toBe('b');
  });
});

describe('publication uncertainty', () => {
  it('a timeout is AMBIGUOUS, never success, and is not blind-retried', async () => {
    const relay = makeRelay(petEvent({ energy: 80 }), { publish: 'timeout' });
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    const outcome = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });
    expect(outcome).toEqual({ status: 'ambiguous', reason: 'publish-timeout' });
    expect(readPetEnergyOp(PUBKEY, 'mine:s1:energy')?.status).toBe('ambiguous');

    // A second attempt must NOT publish again.
    const retry = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });
    expect(retry).toEqual({ status: 'blocked', blockedBy: 'ambiguous' });
  });

  it('an ambiguous op reconciles to applied when its marker is found', async () => {
    const relay = makeRelay(petEvent({ energy: 80 }), { publish: 'timeout' });
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });
    await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });

    // The publish had in fact landed: the relay now serves the marked event.
    relay.setStored(
      petEvent({ energy: 60, createdAt: 2_000, extraTags: [[PET_OP_MARKER_TAG, 'mine:s1:energy']] }),
    );

    const record = await settler.reconcileEnergyOp('mine:s1:energy', PET_ID);
    expect(record?.status).toBe('applied');
    // And it is now idempotently done.
    const after = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });
    expect(after).toEqual({ status: 'already-applied' });
  });

  it('a signer refusal is provably unsent and retryable under the same opId', async () => {
    const relay = makeRelay(petEvent({ energy: 80 }));
    (relay.user as unknown as { signer: { signEvent: unknown } }).signer.signEvent = vi.fn(
      async () => {
        throw new Error('user rejected');
      },
    );
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    const outcome = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });
    expect(outcome).toEqual({ status: 'failed', reason: 'sign-failed' });
    expect(relay.published).toHaveLength(0);
    expect(readPetEnergyOp(PUBKEY, 'mine:s1:energy')?.status).toBe('failed');
  });
});

describe('read uncertainty', () => {
  it('an UNKNOWN pet read publishes nothing and stays pending', async () => {
    const relay = makeRelay(petEvent({ energy: 80 }), { unusableReads: 5 });
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    const outcome = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });
    expect(outcome).toEqual({ status: 'failed', reason: 'read-unknown' });
    expect(relay.published).toHaveLength(0);
  });

  it('a CONFIRMED-absent pet is refused, never created from scratch', async () => {
    const relay = makeRelay(null);
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });

    const outcome = await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });
    expect(outcome).toEqual({ status: 'failed', reason: 'pet-absent' });
    expect(relay.published).toHaveLength(0);
  });

  it('readPetState distinguishes found / absent / unknown', async () => {
    const found = makeRelay(petEvent());
    await expect(readPetState(found.nostr, PUBKEY, PET_ID)).resolves.toMatchObject({
      status: 'found',
    });

    const absent = makeRelay(null);
    await expect(readPetState(absent.nostr, PUBKEY, PET_ID)).resolves.toEqual({
      status: 'absent',
    });

    const unknown = makeRelay(petEvent(), { unusableReads: 5 });
    await expect(readPetState(unknown.nostr, PUBKEY, PET_ID)).resolves.toMatchObject({
      status: 'unknown',
    });
  });
});

describe('the op marker survives ORDINARY pet writes', () => {
  it('mergePetStateTags preserves it, so reconciliation stays possible', async () => {
    const { mergePetStateTags, parsePetState } = await import('@/lib/blobbi-parsers');
    const marked = petEvent({
      energy: 60,
      extraTags: [[PET_OP_MARKER_TAG, 'mine:s1:energy']],
    });
    const pet = parsePetState(marked)!;

    // A care action republishing this pet (the generic writer's shape).
    const tags = mergePetStateTags(pet, { hunger: '95' });

    expect(tags).toContainEqual([PET_OP_MARKER_TAG, 'mine:s1:energy']);
    expect(tags).toContainEqual(['hunger', '95']);
    expect(tags).toContainEqual(['ditto_xp', '123']);
  });

  it('an ambiguous op still reconciles after an unrelated care write', async () => {
    const relay = makeRelay(petEvent({ energy: 80 }), { publish: 'timeout' });
    const settler = createEnergySettler({ nostr: relay.nostr, user: relay.user });
    await settler.settleEnergyDelta({
      opId: 'mine:s1:energy', petId: PET_ID, amount: 20, label: 'mine-energy',
    });

    // The publish landed, and THEN a care action republished the pet — the
    // marker rides through the generic writer's unknown-tag passthrough.
    relay.setStored(
      petEvent({
        energy: 60,
        hunger: 95,
        createdAt: 3_000,
        extraTags: [[PET_OP_MARKER_TAG, 'mine:s1:energy']],
      }),
    );

    const record = await settler.reconcileEnergyOp('mine:s1:energy', PET_ID);
    expect(record?.status).toBe('applied');
  });
});

describe('replaceable-event ordering', () => {
  it('sequential writes get strictly increasing created_at under a frozen clock', async () => {
    const relay = makeRelay(petEvent({ energy: 90, createdAt: 1_700_000_000 }));
    const settler = createEnergySettler({
      nostr: relay.nostr,
      user: relay.user,
      // Frozen: without the monotonic rule all three would tie.
      now: () => 1_700_000_000_000,
    });

    await settler.settleEnergyDelta({ opId: 'a', petId: PET_ID, amount: 10, label: 'x' });
    await settler.settleEnergyDelta({ opId: 'b', petId: PET_ID, amount: 10, label: 'x' });
    await settler.settleEnergyDelta({ opId: 'c', petId: PET_ID, amount: 10, label: 'x' });

    const stamps = relay.published.map((e) => e.created_at);
    expect(stamps).toHaveLength(3);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    }
    // The relay retains the latest logical state.
    expect(tagValue(relay.getStored()!, 'energy')).toBe('60');
  });
});
