/**
 * The external consumption transaction, branch by branch.
 *
 * Driven through `runExternalConsumption` with a fake relay world, so every
 * failure the network can produce is reachable. The properties pinned here
 * are the ones the design is for:
 *
 *   - nothing is signed against an unresolved or empty balance;
 *   - ONE kind:1416 per player action, whatever the relays do;
 *   - the effect is keyed to the spend id and applied at most once;
 *   - every partial outcome is a resumable status, and the resume never
 *     signs a second spend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { clearExternalSpendOps, readExternalSpendOp } from '@/lib/external-spend-ledger';
import { PET_OP_MARKER_TAG, type PetStateNostr } from '@/lib/pet-state-transaction';
import type { PetState } from '@/lib/blobbi-types';

import { clearEstablishedSpends, establishedSpendsFor } from './established-spends';
import type { DiscoveredInventory } from './external-inventories';
import type { ExternalInventoryResolution } from './external-inventory-state';
import {
  applyExternalCompatibility,
  resolveExternalItemCompatibility,
} from './external-item-compatibility';
import type { SpendPublishDeps } from './external-spend';
import { KIND_GAME_INVENTORY, parseGameInventorySpend, setInventoryItemQuantity } from './package';
import { FARM_STRAWBERRY_EVENT } from './partner-item-event-fixtures';
import { parseInventoryEvent, parseTrustedItemDefinition, resolveFromDefinition } from './protocol-adapter';
import {
  INTERACTION_SPEND_MARKER,
  runExternalConsumption,
  type ConsumeExternalItemInput,
  type ExternalConsumptionDeps,
} from './useConsumeExternalItem';

const PUBKEY = 'f'.repeat(64);
const OTHER = 'e'.repeat(64);
const PET_ID = 'blobbi-aa-bb';
const FARM_ISSUER = 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const FARM_MAIN = `31633:${PUBKEY}:farm:main`;

type ReqMessage = ['EVENT', string, NostrEvent] | ['EOSE', string] | ['CLOSED', string, string];

function petEvent(overrides: { hunger?: number; createdAt?: number; extraTags?: string[][] } = {}): NostrEvent {
  const { hunger = 50, createdAt = 1_000, extraTags = [] } = overrides;
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
      ['energy', '80'],
      ['experience', '0'],
      ['care_streak', '0'],
      ['seed', 'abc'],
      ['adult_type', 'bloomi'],
      ['base_color', '#fff'],
      ['ditto_xp', '123'],
      ...extraTags,
    ],
    sig: 'sig',
  };
}

interface RelayOptions {
  /** How kind:31124 publishes behave. */
  petPublish?: 'ok' | 'timeout' | 'error';
}

function makePetRelay(initial: NostrEvent | null, options: RelayOptions = {}) {
  let stored = initial;
  const published: NostrEvent[] = [];
  const nostr: PetStateNostr = {
    req: () => {
      const script: ReqMessage[] = stored ? [['EVENT', 's', stored], ['EOSE', 's']] : [['EOSE', 's']];
      return (async function* () {
        for (const msg of script) yield msg;
      })();
    },
    query: async () => {
      throw new Error('query must not be used when req is available');
    },
    event: async (event) => {
      if (event.kind === 31124) {
        if (options.petPublish === 'timeout') {
          const error = new Error('timed out');
          error.name = 'TimeoutError';
          throw error;
        }
        if (options.petPublish === 'error') throw new Error('relay refused');
        if (!stored || event.created_at >= stored.created_at) stored = event;
      }
      published.push(event);
    },
  };
  return {
    nostr,
    published,
    getStored: () => stored,
    setStored: (e: NostrEvent | null) => {
      stored = e;
    },
    setPetPublish: (mode: RelayOptions['petPublish']) => {
      options.petPublish = mode;
    },
  };
}

function makeSigner(pubkey = PUBKEY) {
  let counter = 0;
  const signEvent = vi.fn(async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => {
    counter += 1;
    return { ...t, id: `signed-${counter}`.padEnd(64, '0'), pubkey, sig: 'sig' };
  });
  const user = { pubkey, signer: { signEvent } } as unknown as ExternalConsumptionDeps['user'];
  const spendsSigned = () => signEvent.mock.calls.filter(([t]) => t.kind === 1416).length;
  return { user, signEvent, spendsSigned };
}

type PublishMode = 'accept' | 'silent' | 'refuse';

function makeSpendRelays(mode: PublishMode = 'accept', found: NostrEvent[] = []) {
  const state = { mode, found };
  const publish = vi.fn(async (event: NostrEvent) => {
    if (state.mode === 'accept') return [{ relay: 'wss://relay.primal.net', ok: true }, { relay: 'wss://relay.ditto.pub', ok: true }];
    if (state.mode === 'silent') {
      return [
        { relay: 'wss://relay.primal.net', ok: false, error: 'Timed out', indefinite: true },
        { relay: 'wss://relay.ditto.pub', ok: false, error: 'Timed out', indefinite: true },
      ];
    }
    void event;
    return [{ relay: 'wss://relay.primal.net', ok: false, error: 'blocked' }];
  });
  const findById = vi.fn(async () => ({ events: state.found, answered: true }));
  const deps: SpendPublishDeps = { publish, findById };
  return { deps, publish, findById, state };
}

function inventory(quantity: number): DiscoveredInventory {
  const snapshot = parseInventoryEvent({
    id: 'snap'.padEnd(64, '0'),
    pubkey: PUBKEY,
    created_at: 500,
    kind: KIND_GAME_INVENTORY,
    tags: [['d', 'farm:main'], ['a', STRAWBERRY, 'wss://relay.primal.net', String(quantity)]],
    content: '',
    sig: '',
  })!;
  return {
    id: 'farm:main',
    address: FARM_MAIN,
    owner: PUBKEY,
    contexts: ['game:farm'],
    createdAt: 500,
    items: [{ address: STRAWBERRY, relay: 'wss://relay.primal.net', quantity }],
    snapshot,
  };
}

function ready(inv: DiscoveredInventory, effective: number): ExternalInventoryResolution {
  const eff = setInventoryItemQuantity(inv.snapshot, STRAWBERRY, effective);
  return {
    status: 'ready',
    snapshot: inv.snapshot,
    inventory: eff,
    state: {
      base: inv.snapshot,
      inventory: eff,
      applications: [],
      applied: [],
      rejected: [],
      folded: [],
      voided: [],
      ignored: [],
      invalid: [],
      duplicateSpendIds: [],
    },
    chain: { status: 'resolved', chain: [], foldedSpendIds: [], voidedSpendIds: [], settledSpendIds: [], problems: [], warnings: [] },
    folds: [],
    spends: [],
  };
}

const strawberry = resolveFromDefinition(parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT)!);
const compatibility = resolveExternalItemCompatibility({ definition: strawberry })!;
const definition = applyExternalCompatibility(strawberry, compatibility);

function pet(stage = 'adult'): PetState {
  return {
    id: PET_ID,
    stage,
    hunger: 50,
    happiness: 80,
    health: 80,
    hygiene: 80,
    energy: 80,
    experience: 0,
    careStreak: 0,
    rawTags: [],
    rawContent: '',
  } as unknown as PetState;
}

function input(inv: DiscoveredInventory): ConsumeExternalItemInput {
  return { inventory: inv, itemAddress: STRAWBERRY, itemRelay: 'wss://relay.primal.net', definition, compatibility, petId: PET_ID };
}

interface World {
  deps: ExternalConsumptionDeps;
  signer: ReturnType<typeof makeSigner>;
  spendRelays: ReturnType<typeof makeSpendRelays>;
  petRelay: ReturnType<typeof makePetRelay>;
  fetchState: ReturnType<typeof vi.fn>;
  onSpendEstablished: ReturnType<typeof vi.fn>;
  onEffectApplied: ReturnType<typeof vi.fn>;
}

function world(options: {
  effective?: number | (() => number);
  state?: ExternalInventoryResolution | { status: 'error'; error: string };
  spendMode?: PublishMode;
  petPublish?: RelayOptions['petPublish'];
  petStage?: string;
  petHunger?: number;
  signerPubkey?: string;
} = {}): World {
  const inv = inventory(3);
  const signer = makeSigner(options.signerPubkey);
  const spendRelays = makeSpendRelays(options.spendMode);
  const petRelay = makePetRelay(petEvent({ hunger: options.petHunger }), { petPublish: options.petPublish });
  const fetchState = vi.fn(async () => {
    if (options.state) return options.state;
    const effective = typeof options.effective === 'function' ? options.effective() : (options.effective ?? 1);
    return ready(inv, effective);
  });
  const onSpendEstablished = vi.fn();
  const onEffectApplied = vi.fn();
  let clock = 1_700_000_000_000;
  const deps: ExternalConsumptionDeps = {
    user: signer.user,
    nostr: petRelay.nostr,
    pets: [pet(options.petStage)],
    spendRelays: spendRelays.deps,
    fetchState,
    relayHint: 'wss://relay.primal.net',
    now: () => (clock += 1000),
    onSpendEstablished,
    onEffectApplied,
  };
  return { deps, signer, spendRelays, petRelay, fetchState, onSpendEstablished, onEffectApplied };
}

const tagValue = (event: NostrEvent, name: string) => event.tags.find(([n]) => n === name)?.[1];

beforeEach(() => {
  clearExternalSpendOps();
  clearEstablishedSpends();
});
afterEach(() => vi.restoreAllMocks());

describe('the happy path', () => {
  it('spends one unit, feeds one segment, keys the effect to the spend id, and writes a receipt', async () => {
    const w = world({ effective: 1 });
    const result = await runExternalConsumption(w.deps, input(inventory(3)));

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.resumed).toBe(false);
    expect(result.alreadyApplied).toBe(false);

    // Exactly ONE spend, valid, naming the full addresses and quantity 1.
    expect(w.signer.spendsSigned()).toBe(1);
    const [spendEvent] = w.spendRelays.publish.mock.calls[0];
    const spend = parseGameInventorySpend(spendEvent);
    expect(spend?.inventoryAddress).toBe(FARM_MAIN);
    expect(spend?.itemAddress).toBe(STRAWBERRY);
    expect(spend?.quantity).toBe(1);
    expect(spend?.owner).toBe(PUBKEY);
    expect(spend?.client).toBe('blobbi-island');
    expect(spend?.purpose).toBe('feed:blobbi');
    expect(spendEvent.id).toBe(result.spendId);

    // The fresh derivation was consulted BEFORE signing.
    expect(w.fetchState).toHaveBeenCalledTimes(1);

    // The effect: one food segment on the authoritative pet, clamped, with the
    // spend id as the operation marker. Foreign tags survive.
    const state = w.petRelay.getStored()!;
    expect(tagValue(state, 'hunger')).toBe('75');
    expect(tagValue(state, 'happiness')).toBe('80');
    expect(tagValue(state, PET_OP_MARKER_TAG)).toBe(result.spendId);
    expect(tagValue(state, 'ditto_xp')).toBe('123');

    // The receipt: a kind:1124 referencing the spend.
    const receipt = w.petRelay.published.find((e) => e.kind === 1124)!;
    expect(receipt.tags).toContainEqual(['e', result.spendId, 'wss://relay.primal.net', INTERACTION_SPEND_MARKER]);
    expect(tagValue(receipt, 'action')).toBe('feed');

    // Caches: the spend is recorded as established, and the effect surfaced.
    expect(establishedSpendsFor(FARM_MAIN).map((e) => e.id)).toEqual([result.spendId]);
    expect(w.onSpendEstablished).toHaveBeenCalledTimes(1);
    expect(w.onEffectApplied).toHaveBeenCalledTimes(1);
    expect(w.onEffectApplied.mock.calls[0][1].newStats.hunger).toBe(75);
    expect(readExternalSpendOp(PUBKEY, result.spendId)?.status).toBe('applied');
  });

  it('clamps hunger at 100', async () => {
    const w = world({ effective: 2, petHunger: 90 });
    await runExternalConsumption(w.deps, input(inventory(3)));
    expect(tagValue(w.petRelay.getStored()!, 'hunger')).toBe('100');
  });

  it('never touches the owner\'s kind:31633 or publishes a kind:1417', async () => {
    const w = world({ effective: 1 });
    await runExternalConsumption(w.deps, input(inventory(3)));
    const kinds = new Set([
      ...w.petRelay.published.map((e) => e.kind),
      ...w.spendRelays.publish.mock.calls.map(([e]) => e.kind),
    ]);
    expect(kinds.has(31633)).toBe(false);
    expect(kinds.has(1417)).toBe(false);
    expect([...kinds].sort()).toEqual([1124, 1416, 31124]);
  });
});

describe('a batch is ONE action', () => {
  it('quantity 3: ONE kind:1416 with quantity 3, hunger +3 segments, XP ×3, streak/last_meal/receipt once', async () => {
    const w = world({ effective: 4, petHunger: 10 });
    const result = await runExternalConsumption(w.deps, { ...input(inventory(4)), quantity: 3 });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;

    // One spend, carrying the batch.
    expect(w.signer.spendsSigned()).toBe(1);
    expect(w.spendRelays.publish).toHaveBeenCalledTimes(1);
    const spend = parseGameInventorySpend(w.spendRelays.publish.mock.calls[0][0])!;
    expect(spend.quantity).toBe(3);

    // One kind:31124, one kind:1124.
    expect(w.petRelay.published.filter((e) => e.kind === 31124)).toHaveLength(1);
    expect(w.petRelay.published.filter((e) => e.kind === 1124)).toHaveLength(1);

    // Hunger: 10 + 3 × 25 = 85. XP: the shared per-unit rule × 3.
    const state = w.petRelay.getStored()!;
    expect(tagValue(state, 'hunger')).toBe('85');
    // The streak advanced exactly once (from 0 to 1), not three times.
    expect(tagValue(state, 'care_streak')).toBe('1');
    expect(tagValue(state, PET_OP_MARKER_TAG)).toBe(result.spendId);
    expect(readExternalSpendOp(PUBKEY, result.spendId)?.quantity).toBe(3);
    // XP: the shared per-unit rule × 3 (measured against a single-unit run).
    const perUnit = (await runOnce(1)).experienceGained;
    expect(perUnit).toBeGreaterThan(0);
    expect(result.experienceGained).toBe(perUnit * 3);

    async function runOnce(q: number) {
      const w1 = world({ effective: 4, petHunger: 10 });
      clearExternalSpendOps();
      const r = await runExternalConsumption(w1.deps, { ...input(inventory(4)), quantity: q });
      clearExternalSpendOps();
      if (r.status !== 'applied') throw new Error(r.status);
      return r;
    }
  });

  it('clamps a batch at 100', async () => {
    const w = world({ effective: 4, petHunger: 60 });
    await runExternalConsumption(w.deps, { ...input(inventory(4)), quantity: 4 });
    expect(tagValue(w.petRelay.getStored()!, 'hunger')).toBe('100');
  });

  it('a quantity above the FRESH effective balance blocks before anything is signed', async () => {
    const w = world({ effective: 2 });
    await expect(runExternalConsumption(w.deps, { ...input(inventory(4)), quantity: 3 })).rejects.toThrow(/Only 2 Strawberry left/);
    expect(w.signer.signEvent).not.toHaveBeenCalled();
    expect(w.spendRelays.publish).not.toHaveBeenCalled();
  });

  it('a retry of a batch reuses the same spend and does not re-apply hunger or XP', async () => {
    const w = world({ effective: 4, petHunger: 10, petPublish: 'timeout' });
    const first = await runExternalConsumption(w.deps, { ...input(inventory(4)), quantity: 3 });
    expect(first.status).toBe('effect-ambiguous');
    // The timed-out publish HAD landed.
    w.petRelay.setStored(petEvent({ hunger: 85, createdAt: 2_000, extraTags: [[PET_OP_MARKER_TAG, first.spendId], ['experience', '30']] }));
    w.petRelay.setPetPublish('ok');
    const second = await runExternalConsumption(w.deps, { ...input(inventory(4)), quantity: 3 });
    expect(second).toMatchObject({ status: 'applied', spendId: first.spendId, alreadyApplied: true, experienceGained: 0 });
    expect(w.signer.spendsSigned()).toBe(1);
    expect(tagValue(w.petRelay.getStored()!, 'hunger')).toBe('85');
    expect(w.petRelay.published.filter((e) => e.kind === 31124)).toHaveLength(0);
  });

  it('a double-click on a batch cannot produce two spends', async () => {
    let remaining = 4;
    const w = world({ effective: () => remaining });
    w.onSpendEstablished.mockImplementation((record) => {
      remaining -= record.quantity;
    });
    const a = runExternalConsumption(w.deps, { ...input(inventory(4)), quantity: 3 });
    const b = runExternalConsumption(w.deps, { ...input(inventory(4)), quantity: 3 });
    await expect(a).resolves.toMatchObject({ status: 'applied' });
    await expect(b).rejects.toThrow(/Only 1 Strawberry left/);
    expect(w.signer.spendsSigned()).toBe(1);
  });
});

describe('nothing is signed when', () => {
  async function expectNothingSigned(w: World, pattern: RegExp) {
    await expect(runExternalConsumption(w.deps, input(inventory(3)))).rejects.toThrow(pattern);
    expect(w.signer.signEvent).not.toHaveBeenCalled();
    expect(w.spendRelays.publish).not.toHaveBeenCalled();
    expect(w.petRelay.published).toHaveLength(0);
  }

  it('the effective quantity is zero — however many the raw snapshot claims', async () => {
    await expectNothingSigned(world({ effective: 0 }), /No Strawberry left/);
  });

  it('the source inventory is unresolved', async () => {
    const inv = inventory(3);
    await expectNothingSigned(
      world({
        state: {
          status: 'unresolved',
          snapshot: inv.snapshot,
          chain: { status: 'unresolved', chain: [], foldedSpendIds: [], voidedSpendIds: [], settledSpendIds: [], problems: [], warnings: [] },
          problems: [],
          folds: [],
          spends: [],
        },
      }),
      /cannot be verified/,
    );
  });

  it('the source inventory could not be read', async () => {
    await expectNothingSigned(world({ state: { status: 'error', error: 'no relay' } }), /Could not read/);
  });

  it('the Blobbi\'s stage forbids feeding', async () => {
    await expectNothingSigned(world({ petStage: 'egg' }), /cannot be used on a egg/);
  });

  it('the inventory belongs to another player', async () => {
    const w = world();
    const other = { ...inventory(3), owner: OTHER, address: `31633:${OTHER}:farm:main` };
    await expect(runExternalConsumption(w.deps, input(other))).rejects.toThrow(/another player/);
    expect(w.signer.signEvent).not.toHaveBeenCalled();
  });
});

describe('one spend per player action', () => {
  it('a double-click cannot sign twice: the second runs after the first, against the fresh balance', async () => {
    let remaining = 1;
    const w = world({ effective: () => remaining });
    w.onSpendEstablished.mockImplementation(() => {
      remaining -= 1;
    });
    // Two clicks before either settles.
    const first = runExternalConsumption(w.deps, input(inventory(3)));
    const second = runExternalConsumption(w.deps, input(inventory(3)));
    await expect(first).resolves.toMatchObject({ status: 'applied' });
    await expect(second).rejects.toThrow(/No Strawberry left/);
    expect(w.signer.spendsSigned()).toBe(1);
  });

  it('silence does NOT mint a second spend: unconfirmed, then the SAME event is republished', async () => {
    const w = world({ effective: 1, spendMode: 'silent' });
    const first = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(first.status).toBe('spend-unconfirmed');
    // No effect while the spend is unknown.
    expect(w.petRelay.published).toHaveLength(0);
    expect(readExternalSpendOp(PUBKEY, first.spendId)?.status).toBe('unconfirmed');

    // The relays come back. The retry republishes the identical bytes.
    w.spendRelays.state.mode = 'accept';
    const second = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(second).toMatchObject({ status: 'applied', spendId: first.spendId, resumed: true });
    expect(w.signer.spendsSigned()).toBe(1);
    // Same id, same bytes — it came back out of the durable ledger, not a signer.
    expect(w.spendRelays.publish.mock.calls[1][0]).toEqual(w.spendRelays.publish.mock.calls[0][0]);
    expect(w.spendRelays.publish.mock.calls[1][0].id).toBe(first.spendId);
    // The resume did not re-derive: the debit's existence was the question, not the balance.
    expect(w.fetchState).toHaveBeenCalledTimes(1);
  });

  it('silence, but the exact id is found on a relay = established; the effect follows', async () => {
    const w = world({ effective: 1, spendMode: 'silent' });
    w.spendRelays.findById.mockImplementation(async () => ({
      events: [w.spendRelays.publish.mock.calls[0][0]],
      answered: true,
    }));
    const result = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(result.status).toBe('applied');
    expect(readExternalSpendOp(PUBKEY, result.spendId)?.note).toBe('found');
  });

  it('a definite refusal is a failure with nothing applied; a new action signs a NEW spend', async () => {
    const w = world({ effective: 1, spendMode: 'refuse' });
    await expect(runExternalConsumption(w.deps, input(inventory(3)))).rejects.toThrow(/refused/);
    expect(w.petRelay.published).toHaveLength(0);
    const [refused] = w.spendRelays.publish.mock.calls[0];
    expect(readExternalSpendOp(PUBKEY, refused.id)?.status).toBe('failed');

    w.spendRelays.state.mode = 'accept';
    const result = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(result.status).toBe('applied');
    expect(result.status === 'applied' && result.spendId).not.toBe(refused.id);
    expect(w.signer.spendsSigned()).toBe(2);
  });
});

describe('the effect is applied at most once per spend id', () => {
  it('an ambiguous pet-state publish is reported, then RECONCILED by marker — no second spend, no second effect', async () => {
    const w = world({ effective: 1, petPublish: 'timeout' });
    const first = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(first.status).toBe('effect-ambiguous');
    expect(readExternalSpendOp(PUBKEY, first.spendId)?.status).toBe('effect-ambiguous');
    expect(w.onEffectApplied).not.toHaveBeenCalled();

    // The timed-out publish HAD landed: the relay now serves the marked state.
    w.petRelay.setStored(petEvent({ hunger: 75, createdAt: 2_000, extraTags: [[PET_OP_MARKER_TAG, first.spendId]] }));
    w.petRelay.setPetPublish('ok');
    const second = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(second).toMatchObject({ status: 'applied', spendId: first.spendId, resumed: true, alreadyApplied: true });
    expect(w.signer.spendsSigned()).toBe(1);
    expect(w.petRelay.published.filter((e) => e.kind === 31124)).toHaveLength(0);
    expect(tagValue(w.petRelay.getStored()!, 'hunger')).toBe('75');
  });

  it('an ambiguous pet-state publish that did NOT land is applied on resume, still with one spend', async () => {
    const w = world({ effective: 1, petPublish: 'timeout' });
    const first = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(first.status).toBe('effect-ambiguous');

    w.petRelay.setPetPublish('ok');
    const second = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(second).toMatchObject({ status: 'applied', spendId: first.spendId, resumed: true, alreadyApplied: false });
    expect(w.signer.spendsSigned()).toBe(1);
    expect(tagValue(w.petRelay.getStored()!, 'hunger')).toBe('75');
  });

  it('a relay refusal of the pet state is treated as AMBIGUOUS by the pet-state primitive, and resumed the same way', async () => {
    // `runPetStateTransaction` classifies every non-timeout publish error as
    // `publish-unknown`: a refusal message is not proof the event did not land
    // somewhere. So the recovery path is the ambiguous one.
    const w = world({ effective: 1, petPublish: 'error' });
    const first = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(first.status).toBe('effect-ambiguous');
    w.petRelay.setPetPublish('ok');
    const second = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(second).toMatchObject({ status: 'applied', spendId: first.spendId, resumed: true });
    expect(w.signer.spendsSigned()).toBe(1);
  });

  it('a DEFINITE pet-state failure (the signer refuses) leaves the spend established and the effect owed', async () => {
    const w = world({ effective: 1 });
    let refuseOnce = true;
    const original = w.signer.signEvent.getMockImplementation()!;
    w.signer.signEvent.mockImplementation(async (t) => {
      if (t.kind === 31124 && refuseOnce) {
        refuseOnce = false;
        throw new Error('user rejected');
      }
      return original(t);
    });
    const first = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(first.status).toBe('effect-pending');
    expect(readExternalSpendOp(PUBKEY, first.spendId)?.status).toBe('established');
    expect(w.petRelay.published).toHaveLength(0);

    const second = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(second).toMatchObject({ status: 'applied', spendId: first.spendId, resumed: true });
    expect(w.signer.spendsSigned()).toBe(1);
    expect(w.spendRelays.publish).toHaveBeenCalledTimes(1);
  });

  it('a receipt failure is a warning, never a reason to redo anything', async () => {
    const w = world({ effective: 1 });
    const original = w.petRelay.nostr.event;
    w.petRelay.nostr.event = async (event, opts) => {
      if (event.kind === 1124) throw new Error('receipt relay down');
      return original(event, opts);
    };
    const result = await runExternalConsumption(w.deps, input(inventory(3)));
    expect(result).toMatchObject({ status: 'applied' });
    expect(result.status === 'applied' && result.warning).toMatch(/receipt/);
    expect(readExternalSpendOp(PUBKEY, result.status === 'applied' ? result.spendId : '')?.status).toBe('applied');
  });
});
